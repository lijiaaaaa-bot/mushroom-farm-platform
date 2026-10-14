import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** make up 会拉取的镜像。摘要是多架构 index，不是浮动标签。 */
export const PULLED_IMAGES = {
  postgres:
    'postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea',
  redis: 'redis:7-alpine@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499',
  mosquitto:
    'eclipse-mosquitto:2@sha256:38c0da4f2ef84284d47b3b3eeea1cb3bdeabe81ee10caf0cd5c5ff61ee3ea408',
};

/** 对象存储基础镜像。只在构建 Dockerfile 时拉取，不作为 compose 服务名。 */
export const DEBIAN_IMAGE =
  'debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587';

/** 本地构建。make up 不向仓库拉取这个名字。 */
export const OBJECT_STORAGE_IMAGE = 'mushroom-object-store:20260916';

const BLOCKED_IMAGE_REPOS = ['pgsty/silo', 'quay.io/minio/minio', 'minio/minio'];
const DIGEST_IMAGE = /^[a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$/;

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function parseServices(text) {
  const services = {};
  let inServices = false;
  let current = null;
  for (const line of text.split('\n')) {
    if (line === 'services:') {
      inServices = true;
      current = null;
      continue;
    }
    if (inServices && /^\S/.test(line)) {
      inServices = false;
      current = null;
    }
    if (!inServices) continue;
    const service = line.match(/^  ([a-z0-9-]+):\s*$/);
    if (service) {
      current = service[1];
      services[current] = { image: '', pullPolicy: '', buildContext: '' };
      continue;
    }
    if (!current) continue;
    const image = line.match(/^    image:\s*(\S+)\s*$/);
    if (image) services[current].image = image[1];
    const pull = line.match(/^    pull_policy:\s*(\S+)\s*$/);
    if (pull) services[current].pullPolicy = pull[1];
    const context = line.match(/^      context:\s*(\S+)\s*$/);
    if (context) services[current].buildContext = context[1];
  }
  return services;
}

function imageLines(text) {
  return text.split('\n').filter((line) => line.trim().startsWith('image:'));
}

function blockedHit(text, rel) {
  const hits = [];
  for (const line of imageLines(text)) {
    for (const blocked of BLOCKED_IMAGE_REPOS) {
      if (line.includes(blocked)) hits.push(`${rel} 含有 ${blocked}: ${line.trim()}`);
    }
  }
  return hits;
}

export function checkComposeImages() {
  const errors = [];
  const compose = read('docker-compose.yml');
  const cold = read('docker-compose.minio-cold.yml');
  const dockerfile = read('infra/object-store/Dockerfile');
  const services = parseServices(compose);
  const expectedServices = ['postgres', 'redis', 'minio', 'mosquitto'];

  if (Object.keys(services).join(',') !== expectedServices.join(',')) {
    errors.push(`docker-compose.yml 服务应为 ${expectedServices.join(', ')}`);
  }
  for (const name of ['postgres', 'redis', 'mosquitto']) {
    if (services[name]?.image !== PULLED_IMAGES[name]) {
      errors.push(`${name} 镜像应为 ${PULLED_IMAGES[name]}`);
    }
    if (!DIGEST_IMAGE.test(services[name]?.image || '')) {
      errors.push(`${name} 镜像没有 sha256 摘要`);
    }
  }
  const minio = services.minio;
  if (minio?.image !== OBJECT_STORAGE_IMAGE) {
    errors.push(`minio 镜像应为 ${OBJECT_STORAGE_IMAGE}`);
  }
  if (minio?.pullPolicy !== 'build') {
    errors.push('minio 需要 pull_policy: build，避免向 Docker Hub 拉取本地镜像名');
  }
  if (minio?.buildContext !== './infra/object-store') {
    errors.push('minio 构建上下文应为 ./infra/object-store');
  }
  errors.push(...blockedHit(compose, 'docker-compose.yml'));

  const coldServices = parseServices(cold);
  const coldMinio = coldServices['minio-cold'];
  if (coldMinio?.image !== OBJECT_STORAGE_IMAGE) {
    errors.push(`minio-cold 镜像应为 ${OBJECT_STORAGE_IMAGE}`);
  }
  if (coldMinio?.pullPolicy !== 'build') {
    errors.push('minio-cold 需要 pull_policy: build');
  }
  if (coldMinio?.buildContext !== './infra/object-store') {
    errors.push('minio-cold 构建上下文应为 ./infra/object-store');
  }
  errors.push(...blockedHit(cold, 'docker-compose.minio-cold.yml'));

  const debianArg = dockerfile.match(/^ARG DEBIAN_IMAGE=(\S+)\s*$/m);
  if (debianArg?.[1] !== DEBIAN_IMAGE) {
    errors.push(`Dockerfile 的 DEBIAN_IMAGE 应为 ${DEBIAN_IMAGE}`);
  }
  if (!/^FROM \$\{DEBIAN_IMAGE\}\s*$/m.test(dockerfile)) {
    errors.push('Dockerfile 应从 ${DEBIAN_IMAGE} 构建');
  }
  if (dockerfile.includes('pgsty/silo:') || dockerfile.includes('quay.io/minio')) {
    errors.push('Dockerfile 不应引用 pgsty/silo 或 quay.io/minio 镜像');
  }

  return { errors, services };
}

function officialRepo(image) {
  const name = image.slice(0, image.indexOf(':'));
  return `library/${name}`;
}

async function headOk(url, headers) {
  const response = await fetch(url, { method: 'HEAD', headers, redirect: 'follow' });
  if (response.ok) return;
  throw new Error(`${response.status} ${url}`);
}

async function probeDigest(image) {
  const digest = image.slice(image.indexOf('@') + 1);
  const repo = officialRepo(image);
  const tokenResponse = await fetch(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`,
  );
  if (!tokenResponse.ok) throw new Error(`Docker Hub 令牌 ${tokenResponse.status} ${repo}`);
  const token = (await tokenResponse.json()).token;
  await headOk(`https://registry-1.docker.io/v2/${repo}/manifests/${digest}`, {
    Authorization: `Bearer ${token}`,
    Accept:
      'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
  });
}

function siloUrls(dockerfile) {
  const tag = dockerfile.match(/^ARG SILO_TAG=(\S+)\s*$/m)?.[1];
  const version = dockerfile.match(/^ARG SILO_VERSION=(\S+)\s*$/m)?.[1];
  const files = [...dockerfile.matchAll(/file="(silo_[^"]+)"/g)].map((match) =>
    match[1].replaceAll('${SILO_VERSION}', version || ''),
  );
  if (!tag || !version || files.some((file) => file.includes('$'))) return [];
  return files.map((file) => `https://github.com/pgsty/silo/releases/download/${tag}/${file}`);
}

export async function probeComposeImages() {
  const dockerfile = read('infra/object-store/Dockerfile');
  const images = [...Object.values(PULLED_IMAGES), DEBIAN_IMAGE];
  for (const image of images) {
    await probeDigest(image);
    console.log(`reachable  ${image}`);
  }
  const urls = siloUrls(dockerfile);
  if (urls.length !== 2) {
    throw new Error(`Dockerfile 里应有 amd64 与 arm64 两个 silo 包地址，实际 ${urls.length} 个`);
  }
  for (const url of urls) {
    await headOk(url, { 'User-Agent': 'mushroom-farm-compose-images' });
    console.log(`reachable  ${url}`);
  }
  console.log(`local-build  ${OBJECT_STORAGE_IMAGE}`);
}

function printPlan() {
  for (const [name, image] of Object.entries(PULLED_IMAGES)) {
    console.log(`pull   ${name}  ${image}`);
  }
  console.log(`build  minio  ${OBJECT_STORAGE_IMAGE}  from ${DEBIAN_IMAGE}`);
  console.log('skip   pgsty/silo  quay.io/minio/minio  Docker Hub mushroom-object-store');
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { errors } = checkComposeImages();
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  printPlan();
  if (process.argv.includes('--probe')) {
    probeComposeImages().catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
  }
}
