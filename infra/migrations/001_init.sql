CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar NOT NULL UNIQUE,
  password_hash varchar NOT NULL,
  display_name varchar NOT NULL,
  role varchar NOT NULL,
  shed_codes text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sheds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar NOT NULL UNIQUE,
  name varchar NOT NULL,
  location varchar,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar NOT NULL UNIQUE,
  name varchar NOT NULL,
  type varchar NOT NULL,
  shed_code varchar NOT NULL,
  parent_code varchar,
  online_status varchar NOT NULL DEFAULT 'offline',
  last_seen_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recognition_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key varchar NOT NULL UNIQUE,
  shed_code varchar NOT NULL,
  camera_code varchar NOT NULL,
  recognized_at timestamptz NOT NULL,
  mushroom_count integer NOT NULL,
  mature_count integer NOT NULL,
  cap_diameters jsonb NOT NULL DEFAULT '[]',
  avg_cap_diameter double precision,
  disease_count integer NOT NULL DEFAULT 0,
  disease_level integer NOT NULL DEFAULT 0,
  snapshot_object_key varchar,
  snapshot_url varchar,
  temperature double precision,
  humidity double precision,
  co2 double precision,
  substrate_moisture double precision,
  source varchar NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recognition_shed_time ON recognition_records (shed_code, recognized_at);
CREATE INDEX IF NOT EXISTS idx_recognition_camera_time ON recognition_records (camera_code, recognized_at);

CREATE TABLE IF NOT EXISTS alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar NOT NULL,
  metric varchar NOT NULL,
  threshold double precision NOT NULL,
  level varchar NOT NULL,
  shed_code varchar,
  enabled boolean NOT NULL DEFAULT true,
  window_minutes integer NOT NULL DEFAULT 720,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id varchar,
  metric varchar,
  shed_code varchar NOT NULL,
  camera_code varchar,
  level varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'open',
  title varchar NOT NULL,
  message text NOT NULL,
  metric_value double precision,
  threshold double precision,
  acked_by varchar,
  acked_at timestamptz,
  ack_note text,
  closed_by varchar,
  closed_at timestamptz,
  close_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_shed_status ON alerts (shed_code, status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar,
  username varchar,
  action varchar NOT NULL,
  resource varchar NOT NULL,
  detail jsonb,
  ip varchar,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingest_rejects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source varchar NOT NULL,
  errors jsonb NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
