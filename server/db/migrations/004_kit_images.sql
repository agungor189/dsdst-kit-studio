CREATE TABLE IF NOT EXISTS kit_images (
  id TEXT PRIMARY KEY,
  kit_id TEXT NOT NULL,
  image_path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(kit_id) REFERENCES kits(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kit_images_kit ON kit_images(kit_id, sort_order, created_at);

ALTER TABLE profile_specs ADD COLUMN size_compatibility_group TEXT;
UPDATE profile_specs SET size_compatibility_group=compatibility_group WHERE size_compatibility_group IS NULL;
CREATE INDEX IF NOT EXISTS idx_profile_specs_size_group ON profile_specs(size_compatibility_group);

INSERT OR IGNORE INTO connector_roles (code, name) VALUES ('6W','6 Yollu'),('AFB','AFB');
