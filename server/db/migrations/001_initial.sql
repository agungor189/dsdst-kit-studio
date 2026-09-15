PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, contact_name TEXT, phone TEXT, whatsapp TEXT,
  email TEXT, website TEXT, address TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profile_specs (
  id TEXT PRIMARY KEY, shape TEXT NOT NULL CHECK(shape IN ('SQUARE','ROUND','RECTANGULAR')),
  material TEXT NOT NULL, width_mm REAL, height_mm REAL, outside_diameter_mm REAL,
  nominal_size TEXT, wall_thickness_mm REAL, compatibility_group TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, spec_id TEXT NOT NULL, name TEXT NOT NULL, raw_length_mm INTEGER NOT NULL DEFAULT 6000,
  weight_per_meter_kg REAL NOT NULL DEFAULT 0, purchase_price_per_meter_cents INTEGER NOT NULL DEFAULT 0,
  sale_price_per_meter_cents INTEGER NOT NULL DEFAULT 0, supplier_id TEXT, image_path TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(spec_id) REFERENCES profile_specs(id) ON DELETE RESTRICT,
  FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS profile_supplier_offers (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, supplier_id TEXT NOT NULL, price_per_meter_cents INTEGER NOT NULL,
  supplier_sku TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS complementary_products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, sku_optional TEXT, description TEXT,
  unit_type TEXT NOT NULL CHECK(unit_type IN ('PIECE','METER','M2')),
  purchase_unit_price_cents INTEGER NOT NULL DEFAULT 0, sale_unit_price_cents INTEGER NOT NULL DEFAULT 0,
  supplier_id TEXT, image_path TEXT, website_url_optional TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS complementary_supplier_offers (
  id TEXT PRIMARY KEY, complementary_product_id TEXT NOT NULL, supplier_id TEXT NOT NULL,
  price_cents INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(complementary_product_id) REFERENCES complementary_products(id) ON DELETE CASCADE,
  FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS panel_connector_cache (
  product_id TEXT PRIMARY KEY, sku TEXT NOT NULL, name_tr TEXT NOT NULL, name_en TEXT,
  supplier_code TEXT, material TEXT, form TEXT, size TEXT, image TEXT,
  purchase_cost_cents INTEGER NOT NULL DEFAULT 0, sale_price_cents INTEGER NOT NULL,
  central_stock INTEGER NOT NULL DEFAULT 0, panel_updated_at TEXT, synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS connector_roles (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS connector_compatibility (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL UNIQUE, connector_role TEXT NOT NULL,
  profile_shape TEXT NOT NULL CHECK(profile_shape IN ('SQUARE','ROUND','RECTANGULAR')),
  profile_width_mm REAL, profile_height_mm REAL, outside_diameter_mm REAL, nominal_size TEXT,
  compatible_material_group TEXT, wall_min_mm REAL, wall_max_mm REAL,
  compatibility_group TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES panel_connector_cache(product_id) ON DELETE CASCADE,
  FOREIGN KEY(connector_role) REFERENCES connector_roles(code) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS kits (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','ACTIVE','ARCHIVED')), kit_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS kit_variants (
  id TEXT PRIMARY KEY, kit_id TEXT NOT NULL, name TEXT NOT NULL, profile_id TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','INCOMPLETE','APPROVED','ARCHIVED')),
  missing_mappings_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(kit_id) REFERENCES kits(id) ON DELETE CASCADE,
  FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS kit_variant_connectors (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, connector_role TEXT NOT NULL, product_id TEXT,
  quantity INTEGER NOT NULL CHECK(quantity > 0), purchase_price_snapshot_cents INTEGER,
  sale_price_snapshot_cents INTEGER, product_name_snapshot TEXT, sku_snapshot TEXT,
  FOREIGN KEY(variant_id) REFERENCES kit_variants(id) ON DELETE CASCADE,
  FOREIGN KEY(connector_role) REFERENCES connector_roles(code) ON DELETE RESTRICT,
  FOREIGN KEY(product_id) REFERENCES panel_connector_cache(product_id) ON DELETE RESTRICT,
  UNIQUE(variant_id, connector_role)
);

CREATE TABLE IF NOT EXISTS kit_variant_profiles (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL UNIQUE, profile_id TEXT NOT NULL,
  purchase_price_snapshot_cents INTEGER NOT NULL, sale_price_snapshot_cents INTEGER NOT NULL,
  weight_per_meter_snapshot_kg REAL NOT NULL,
  FOREIGN KEY(variant_id) REFERENCES kit_variants(id) ON DELETE CASCADE,
  FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS kit_variant_profile_cuts (
  id TEXT PRIMARY KEY, variant_profile_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
  length_mm INTEGER NOT NULL CHECK(length_mm > 0), label TEXT,
  FOREIGN KEY(variant_profile_id) REFERENCES kit_variant_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kit_variant_complementary_items (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, complementary_product_id TEXT NOT NULL, quantity_milli INTEGER NOT NULL CHECK(quantity_milli > 0),
  purchase_price_snapshot_cents INTEGER NOT NULL, sale_price_snapshot_cents INTEGER NOT NULL,
  product_name_snapshot TEXT NOT NULL, unit_type_snapshot TEXT NOT NULL,
  FOREIGN KEY(variant_id) REFERENCES kit_variants(id) ON DELETE CASCADE,
  FOREIGN KEY(complementary_product_id) REFERENCES complementary_products(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS kit_pricing_snapshots (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, reason TEXT NOT NULL, pricing_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(variant_id) REFERENCES kit_variants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kit_versions (
  id TEXT PRIMARY KEY, kit_id TEXT NOT NULL, version INTEGER NOT NULL, bom_json TEXT NOT NULL,
  pricing_snapshot_json TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(kit_id) REFERENCES kits(id) ON DELETE CASCADE, UNIQUE(kit_id, version)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_compatibility_group ON connector_compatibility(compatibility_group, connector_role);
CREATE INDEX IF NOT EXISTS idx_variants_kit ON kit_variants(kit_id);
CREATE INDEX IF NOT EXISTS idx_connectors_variant ON kit_variant_connectors(variant_id);
