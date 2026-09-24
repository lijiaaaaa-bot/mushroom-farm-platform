CREATE TABLE IF NOT EXISTS metric_buckets_hour (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shed_code varchar NOT NULL,
  camera_code varchar NOT NULL DEFAULT '',
  bucket_start timestamptz NOT NULL,
  metric varchar(64) NOT NULL,
  value double precision,
  sample_count integer NOT NULL DEFAULT 0,
  value_sum double precision,
  latest_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_metric_buckets_hour_subject
  ON metric_buckets_hour (shed_code, camera_code, bucket_start, metric);

CREATE INDEX IF NOT EXISTS idx_metric_buckets_hour_start
  ON metric_buckets_hour (bucket_start);

CREATE TABLE IF NOT EXISTS metric_buckets_day (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shed_code varchar NOT NULL,
  camera_code varchar NOT NULL DEFAULT '',
  bucket_start timestamptz NOT NULL,
  metric varchar(64) NOT NULL,
  value double precision,
  sample_count integer NOT NULL DEFAULT 0,
  value_sum double precision,
  latest_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_metric_buckets_day_subject
  ON metric_buckets_day (shed_code, camera_code, bucket_start, metric);

CREATE INDEX IF NOT EXISTS idx_metric_buckets_day_start
  ON metric_buckets_day (bucket_start);
