ALTER TABLE panel_connector_cache ADD COLUMN cost_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(cost_status IN ('UNKNOWN','KNOWN'));
ALTER TABLE panel_connector_cache ADD COLUMN sale_price_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(sale_price_status IN ('UNKNOWN','KNOWN'));

ALTER TABLE profiles ADD COLUMN cost_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(cost_status IN ('UNKNOWN','KNOWN'));
ALTER TABLE profiles ADD COLUMN sale_price_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(sale_price_status IN ('UNKNOWN','KNOWN'));

ALTER TABLE complementary_products ADD COLUMN cost_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(cost_status IN ('UNKNOWN','KNOWN'));
ALTER TABLE complementary_products ADD COLUMN sale_price_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(sale_price_status IN ('UNKNOWN','KNOWN'));

ALTER TABLE profile_specs ADD COLUMN width_micrometers INTEGER CHECK(width_micrometers IS NULL OR width_micrometers > 0);
ALTER TABLE profile_specs ADD COLUMN height_micrometers INTEGER CHECK(height_micrometers IS NULL OR height_micrometers > 0);
ALTER TABLE profile_specs ADD COLUMN outside_diameter_micrometers INTEGER CHECK(outside_diameter_micrometers IS NULL OR outside_diameter_micrometers > 0);
ALTER TABLE profile_specs ADD COLUMN wall_thickness_micrometers INTEGER CHECK(wall_thickness_micrometers IS NULL OR wall_thickness_micrometers > 0);

UPDATE profile_specs SET
  width_micrometers=CASE WHEN width_mm IS NULL THEN NULL ELSE CAST(width_mm * 1000 AS INTEGER) END,
  height_micrometers=CASE WHEN height_mm IS NULL THEN NULL ELSE CAST(height_mm * 1000 AS INTEGER) END,
  outside_diameter_micrometers=CASE WHEN outside_diameter_mm IS NULL THEN NULL ELSE CAST(outside_diameter_mm * 1000 AS INTEGER) END,
  wall_thickness_micrometers=CASE WHEN wall_thickness_mm IS NULL THEN NULL ELSE CAST(wall_thickness_mm * 1000 AS INTEGER) END;
