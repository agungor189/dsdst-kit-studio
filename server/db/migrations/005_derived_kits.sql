ALTER TABLE kits ADD COLUMN derived_from_kit_id TEXT REFERENCES kits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_kits_derived_from ON kits(derived_from_kit_id);
