CREATE TABLE IF NOT EXISTS system_params (
  id smallint PRIMARY KEY CHECK (id = 1),
  image_retention_days integer NOT NULL DEFAULT 30 CHECK (image_retention_days BETWEEN 1 AND 3650),
  timeseries_retention_days integer NOT NULL DEFAULT 90 CHECK (timeseries_retention_days BETWEEN 1 AND 3650),
  alert_unread_poll_seconds integer NOT NULL DEFAULT 15 CHECK (alert_unread_poll_seconds BETWEEN 5 AND 300),
  updated_at timestamptz,
  updated_by varchar
);

INSERT INTO system_params (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
