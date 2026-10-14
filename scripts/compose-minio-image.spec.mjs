import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 本地构建。make up 不拉取 pgsty/silo 或 quay.io/minio/minio。 */
export const OBJECT_STORAGE_IMAGE = 'mushroom-object-store:20260916';

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.minio-cold.yml'];
const BLOCKED_IMAGE_REPOS = ['pgsty/silo', 'quay.io/minio/minio', 'minio/minio'];

export function objectStorageImages(composeText) {
  const images = [];
  let inService = false;
  for (const line of composeText.split('\n')) {
    const service = line.match(/^  ([a-z0-9-]+):\s*$/);
    if (service) {
      inService = service[1] === 'minio' || service[1] === 'minio-cold';
      continue;
    }
    if (!inService) continue;
    const image = line.match(/^    image:\s*(\S+)\s*$/);
    if (image) images.push(image[1]);
  }
  return images;
}

test('hot and cold compose build the local object storage image', () => {
  for (const rel of COMPOSE_FILES) {
    const text = readFileSync(join(root, rel), 'utf8');
    assert.deepEqual(objectStorageImages(text), [OBJECT_STORAGE_IMAGE], rel);
    assert.match(text, /context: \.\/infra\/object-store/, rel);
    const imageLines = text.split('\n').filter((line) => line.trim().startsWith('image:'));
    for (const blocked of BLOCKED_IMAGE_REPOS) {
      for (const line of imageLines) {
        assert.equal(line.includes(blocked), false, `${rel} ${line}`);
      }
    }
  }
});

test('object store Dockerfile pins the release tarball checksums', () => {
  const dockerfile = readFileSync(join(root, 'infra/object-store/Dockerfile'), 'utf8');
  assert.match(dockerfile, /RELEASE\.2026-09-16T00-00-00Z/);
  assert.match(dockerfile, /381e745510a8fb64323d7bb3207f95984b7f4ed826f4fcad318f97683c420c73/);
  assert.match(dockerfile, /6e697d3e1d70f2343fe829cd6820a0b840d4619f1dde546424de80e529636ed2/);
  assert.match(dockerfile, /sha256sum -c/);
  assert.equal(dockerfile.includes('pgsty/silo:'), false);
  assert.equal(dockerfile.includes('quay.io/minio'), false);
});
