CREATE TABLE IF NOT EXISTS daily_aggregates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day varchar(10) NOT NULL,
  grain varchar NOT NULL,
  shed_code varchar NOT NULL,
  camera_code varchar NOT NULL DEFAULT '',
  mushroom_count integer NOT NULL,
  cap_diameter_mean double precision,
  sample_count integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_aggregates_subject
  ON daily_aggregates (day, grain, shed_code, camera_code);

CREATE INDEX IF NOT EXISTS idx_daily_aggregates_shed_day
  ON daily_aggregates (shed_code, day);
