import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 匿名可拉取。入口把 `server /data` 转成 silo。 */
export const OBJECT_STORAGE_IMAGE = 'pgsty/silo:RELEASE.2026-09-16T00-00-00Z';

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.minio-cold.yml'];

export function objectStorageImages(composeText) {
  return composeText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('image:'))
    .map((line) => line.slice('image:'.length).trim())
    .filter((image) => /minio|silo/i.test(image));
}

test('hot and cold compose pin the anonymously pullable object storage image', () => {
  for (const rel of COMPOSE_FILES) {
    const images = objectStorageImages(readFileSync(join(root, rel), 'utf8'));
    assert.deepEqual(images, [OBJECT_STORAGE_IMAGE], rel);
  }
});

test('quay.io/minio/minio is not the pinned object storage image', () => {
  const archived = 'quay.io/minio/minio:RELEASE.2024-12-18T13-15-44Z';
  for (const rel of COMPOSE_FILES) {
    const text = readFileSync(join(root, rel), 'utf8');
    assert.equal(text.includes(archived), false, rel);
    assert.equal(text.includes('quay.io/minio'), false, rel);
  }
});
