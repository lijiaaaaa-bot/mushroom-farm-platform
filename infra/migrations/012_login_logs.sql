CREATE TABLE IF NOT EXISTS login_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar,
  username varchar,
  result varchar(16) NOT NULL CHECK (result IN ('success', 'failure')),
  ip varchar,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_logs_created_at
  ON login_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_logs_username_created
  ON login_logs (username, created_at DESC);
