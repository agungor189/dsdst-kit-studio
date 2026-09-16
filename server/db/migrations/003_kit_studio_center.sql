ALTER TABLE kits ADD COLUMN sku TEXT;
ALTER TABLE kits ADD COLUMN sale_price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kits ADD COLUMN labor_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kits ADD COLUMN packaging_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kits ADD COLUMN other_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kits ADD COLUMN deleted_at TEXT;

ALTER TABLE kit_variants ADD COLUMN compatibility_warnings_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE panel_connector_cache ADD COLUMN model TEXT;

ALTER TABLE profiles ADD COLUMN catalog_source TEXT NOT NULL DEFAULT 'LOCAL';
ALTER TABLE profiles ADD COLUMN panel_updated_at TEXT;
ALTER TABLE profiles ADD COLUMN catalog_active INTEGER NOT NULL DEFAULT 1;

ALTER TABLE complementary_products ADD COLUMN catalog_source TEXT NOT NULL DEFAULT 'LOCAL';
ALTER TABLE complementary_products ADD COLUMN panel_updated_at TEXT;
ALTER TABLE complementary_products ADD COLUMN catalog_active INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kits_active_sku
  ON kits(sku COLLATE NOCASE)
  WHERE sku IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_kits_deleted_updated ON kits(deleted_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_catalog_source ON profiles(catalog_source, catalog_active);
CREATE INDEX IF NOT EXISTS idx_complements_catalog_source ON complementary_products(catalog_source, catalog_active);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('panel_profile_count', '0'),
  ('panel_complement_count', '0');
