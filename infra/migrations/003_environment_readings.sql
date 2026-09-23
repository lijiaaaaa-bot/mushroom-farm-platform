CREATE TABLE IF NOT EXISTS environment_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key varchar NOT NULL UNIQUE,
  shed_code varchar NOT NULL,
  sensor_code varchar NOT NULL,
  observed_at timestamptz NOT NULL,
  temperature double precision,
  humidity double precision,
  co2 double precision,
  substrate_moisture double precision,
  source varchar NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_environment_shed_time
  ON environment_readings (shed_code, observed_at);
