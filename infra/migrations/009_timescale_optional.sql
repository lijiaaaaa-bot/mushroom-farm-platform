-- Optional Timescale path. Vanilla PostgreSQL records a notice and keeps plain tables.
-- Hypertable conversion is manual: infra/timescale/enable.sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'
  ) THEN
    RAISE NOTICE 'timescaledb is available. Hypertable conversion stays manual: infra/timescale/enable.sql';
  ELSE
    RAISE NOTICE 'timescaledb is not installed. recognition_records and environment_readings stay plain tables.';
  END IF;
END $$;
