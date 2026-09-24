CREATE TABLE IF NOT EXISTS flush_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shed_code varchar NOT NULL,
  batch_code varchar NOT NULL,
  started_at timestamptz NOT NULL,
  phase varchar(32) NOT NULL,
  closed_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shed_code, batch_code)
);

CREATE INDEX IF NOT EXISTS idx_flush_batches_shed_started
  ON flush_batches (shed_code, started_at DESC);

CREATE TABLE IF NOT EXISTS flush_phase_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES flush_batches (id),
  phase varchar(32) NOT NULL,
  occurred_at timestamptz NOT NULL,
  note text,
  recorded_by varchar,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flush_phase_events_batch
  ON flush_phase_events (batch_id, occurred_at);

CREATE TABLE IF NOT EXISTS harvest_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_date date NOT NULL,
  shed_code varchar NOT NULL,
  camera_code varchar NOT NULL,
  mature_count integer NOT NULL,
  mushroom_count integer NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'open',
  assignee varchar,
  shift varchar(16),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_date, shed_code, camera_code)
);

CREATE INDEX IF NOT EXISTS idx_harvest_tasks_date_shed
  ON harvest_tasks (task_date, shed_code);
