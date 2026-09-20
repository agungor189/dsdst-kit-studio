ALTER TABLE panel_connector_cache ADD COLUMN catalog_version_ref TEXT;
ALTER TABLE panel_connector_cache ADD COLUMN uom_registry_version TEXT;
ALTER TABLE panel_connector_cache ADD COLUMN base_uom_code TEXT;

ALTER TABLE profiles ADD COLUMN catalog_version_ref TEXT;
ALTER TABLE profiles ADD COLUMN uom_registry_version TEXT;
ALTER TABLE profiles ADD COLUMN base_uom_code TEXT;
ALTER TABLE profiles ADD COLUMN standard_purchase_lengths_mm_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE profiles ADD COLUMN custom_length_allowed INTEGER NOT NULL DEFAULT 0 CHECK(custom_length_allowed IN (0,1));

ALTER TABLE complementary_products ADD COLUMN catalog_version_ref TEXT;
ALTER TABLE complementary_products ADD COLUMN uom_registry_version TEXT;
ALTER TABLE complementary_products ADD COLUMN base_uom_code TEXT;

CREATE INDEX IF NOT EXISTS idx_panel_connector_catalog_version ON panel_connector_cache(catalog_version_ref);
CREATE INDEX IF NOT EXISTS idx_profiles_catalog_version ON profiles(catalog_version_ref);
CREATE INDEX IF NOT EXISTS idx_complements_catalog_version ON complementary_products(catalog_version_ref);
