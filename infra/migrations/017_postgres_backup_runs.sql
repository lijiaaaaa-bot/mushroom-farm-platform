CREATE TABLE IF NOT EXISTS postgres_backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status varchar(16) NOT NULL CHECK (status IN ('success', 'failed')),
  finished_at timestamptz NOT NULL,
  file_name varchar,
  bytes bigint,
  error_message text,
  triggered_by varchar
);

CREATE INDEX IF NOT EXISTS idx_postgres_backup_runs_finished
  ON postgres_backup_runs (finished_at DESC);

CREATE INDEX IF NOT EXISTS idx_postgres_backup_runs_success
  ON postgres_backup_runs (finished_at DESC)
  WHERE status = 'success';
