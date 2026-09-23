import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Client } = require(join(root, 'apps/api/node_modules/pg'));

const databaseUrl =
  process.env.DATABASE_URL || 'postgres://mushroom:mushroom@127.0.0.1:5432/mushroom';
const dir = join(root, 'infra/migrations');
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const client = new Client({ connectionString: databaseUrl });
await client.connect();
await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);
for (const file of files) {
  const applied = await client.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
  if (applied.rowCount) {
    console.log(`skip ${file}`);
    continue;
  }
  const sql = readFileSync(join(dir, file), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log(`applied ${file}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`migration failed: ${file}`);
    throw error;
  }
}
await client.end();
