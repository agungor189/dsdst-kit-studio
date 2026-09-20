ALTER TABLE complementary_products RENAME COLUMN unit_type TO legacy_unit_type;
ALTER TABLE complementary_products ADD COLUMN unit_type TEXT NOT NULL DEFAULT 'piece'
  CHECK(unit_type IN ('piece','meter','square_meter','kg','roll','package','box'));
UPDATE complementary_products SET unit_type = CASE
  WHEN base_uom_code IN ('piece','meter','square_meter','kg','roll','package','box') THEN base_uom_code
  WHEN legacy_unit_type = 'METER' THEN 'meter'
  WHEN legacy_unit_type = 'M2' THEN 'square_meter'
  ELSE 'piece'
END;
ALTER TABLE complementary_products ADD COLUMN material_behavior TEXT
  CHECK(material_behavior IS NULL OR material_behavior = 'continuous_cut');

ALTER TABLE kit_variant_complementary_items ADD COLUMN base_uom_code_snapshot TEXT
  CHECK(base_uom_code_snapshot IS NULL OR base_uom_code_snapshot IN ('piece','meter','square_meter','kg','roll','package','box'));
UPDATE kit_variant_complementary_items SET base_uom_code_snapshot = (
  SELECT base_uom_code FROM complementary_products
  WHERE complementary_products.id = kit_variant_complementary_items.complementary_product_id
)
WHERE base_uom_code_snapshot IS NULL;
