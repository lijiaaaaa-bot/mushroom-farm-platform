ALTER TABLE alerts ADD COLUMN IF NOT EXISTS recognition_id uuid;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS snapshot_object_key varchar;
