ALTER TABLE profiles ADD COLUMN markup_basis_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE complementary_products ADD COLUMN markup_basis_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE complementary_products ADD COLUMN weight_per_unit_grams REAL;
ALTER TABLE panel_connector_cache ADD COLUMN unit_weight_grams REAL;

ALTER TABLE kit_variant_connectors ADD COLUMN unit_weight_snapshot_grams REAL;
ALTER TABLE kit_variant_profiles ADD COLUMN markup_basis_points_snapshot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kit_variant_complementary_items ADD COLUMN markup_basis_points_snapshot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kit_variant_complementary_items ADD COLUMN weight_per_unit_snapshot_grams REAL;

UPDATE profiles SET markup_basis_points = CASE WHEN purchase_price_per_meter_cents > 0 THEN MAX(0, ROUND((sale_price_per_meter_cents * 1.0 / purchase_price_per_meter_cents - 1) * 10000)) ELSE 0 END;
UPDATE complementary_products SET markup_basis_points = CASE WHEN purchase_unit_price_cents > 0 THEN MAX(0, ROUND((sale_unit_price_cents * 1.0 / purchase_unit_price_cents - 1) * 10000)) ELSE 0 END;
UPDATE kit_variant_profiles SET markup_basis_points_snapshot = CASE WHEN purchase_price_snapshot_cents > 0 THEN MAX(0, ROUND((sale_price_snapshot_cents * 1.0 / purchase_price_snapshot_cents - 1) * 10000)) ELSE 0 END;
UPDATE kit_variant_complementary_items SET markup_basis_points_snapshot = CASE WHEN purchase_price_snapshot_cents > 0 THEN MAX(0, ROUND((sale_price_snapshot_cents * 1.0 / purchase_price_snapshot_cents - 1) * 10000)) ELSE 0 END;
