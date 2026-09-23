ALTER TABLE ingest_rejects
  ADD COLUMN IF NOT EXISTS channel varchar NOT NULL DEFAULT 'recognition';

ALTER TABLE ingest_rejects
  ADD COLUMN IF NOT EXISTS shed_code varchar;

ALTER TABLE ingest_rejects
  ADD COLUMN IF NOT EXISTS code varchar;

CREATE INDEX IF NOT EXISTS idx_ingest_rejects_created
  ON ingest_rejects (created_at);

CREATE INDEX IF NOT EXISTS idx_ingest_rejects_shed_created
  ON ingest_rejects (shed_code, created_at);

CREATE TABLE IF NOT EXISTS heartbeat_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source varchar NOT NULL,
  shed_code varchar NOT NULL,
  device_code varchar NOT NULL,
  duplicate boolean NOT NULL DEFAULT false,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_receipts_shed_created
  ON heartbeat_receipts (shed_code, created_at);
