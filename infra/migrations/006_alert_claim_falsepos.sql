ALTER TABLE alerts ADD COLUMN IF NOT EXISTS close_reason varchar;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS claimed_by varchar;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS claim_note text;
