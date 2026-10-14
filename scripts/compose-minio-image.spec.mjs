import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEBIAN_IMAGE,
  OBJECT_STORAGE_IMAGE,
  PULLED_IMAGES,
  checkComposeImages,
} from './compose-images.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('make up pins pulled images and builds object storage locally', () => {
  const { errors } = checkComposeImages();
  assert.deepEqual(errors, []);
  assert.match(PULLED_IMAGES.postgres, /@sha256:[a-f0-9]{64}$/);
  assert.match(PULLED_IMAGES.redis, /@sha256:[a-f0-9]{64}$/);
  assert.match(PULLED_IMAGES.mosquitto, /@sha256:[a-f0-9]{64}$/);
  assert.equal(OBJECT_STORAGE_IMAGE.includes('@'), false);
  assert.match(DEBIAN_IMAGE, /^debian:bookworm-slim@sha256:[a-f0-9]{64}$/);
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
