-- Manual Timescale enablement. Do not run this from make migrate.
-- Default local demo uses postgres:16-alpine, which does not ship this extension.
-- Unique indexes must include the partition column before create_hypertable.
-- The current primary keys and idempotency keys do not, so this script stops after
-- documenting the statements instead of altering those constraints.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- After the unique indexes include recognized_at / observed_at:
-- SELECT create_hypertable('recognition_records', 'recognized_at', if_not_exists => TRUE, migrate_data => TRUE);
-- SELECT create_hypertable('environment_readings', 'observed_at', if_not_exists => TRUE, migrate_data => TRUE);

-- Retention matches TIMESERIES_RETENTION_DAYS (90). Leave commented so a demo
-- database is not dropped by an unattended policy.
-- SELECT add_retention_policy('recognition_records', INTERVAL '90 days', if_not_exists => TRUE);
-- SELECT add_retention_policy('environment_readings', INTERVAL '90 days', if_not_exists => TRUE);
