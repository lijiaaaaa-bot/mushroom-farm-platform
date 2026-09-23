CREATE TABLE IF NOT EXISTS alert_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  alert_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, alert_id)
);

CREATE INDEX IF NOT EXISTS idx_alert_reads_user ON alert_reads (user_id);
