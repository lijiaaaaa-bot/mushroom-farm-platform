ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;
