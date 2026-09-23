ALTER TABLE kits ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'DRAFT'
  CHECK(publication_state IN ('DRAFT','PREVIEWED','PUBLISHED'));
ALTER TABLE kits ADD COLUMN published_kit_id TEXT;
ALTER TABLE kits ADD COLUMN published_product_id TEXT;
ALTER TABLE kits ADD COLUMN current_published_version_id TEXT;
ALTER TABLE kits ADD COLUMN current_published_version_number INTEGER
  CHECK(current_published_version_number IS NULL OR current_published_version_number > 0);
ALTER TABLE kits ADD COLUMN current_published_content_hash TEXT
  CHECK(current_published_content_hash IS NULL OR length(current_published_content_hash) = 64);
ALTER TABLE kits ADD COLUMN final_sale_price_minor INTEGER CHECK(final_sale_price_minor IS NULL OR final_sale_price_minor >= 0);
ALTER TABLE kits ADD COLUMN packaging_instruction_version TEXT;
ALTER TABLE kits ADD COLUMN installation_guide_version TEXT;

ALTER TABLE kit_versions ADD COLUMN workspace_variant_id TEXT;
ALTER TABLE kit_versions ADD COLUMN authored_content_hash TEXT CHECK(authored_content_hash IS NULL OR length(authored_content_hash) = 64);
ALTER TABLE kit_versions ADD COLUMN panel_content_hash TEXT CHECK(panel_content_hash IS NULL OR length(panel_content_hash) = 64);
ALTER TABLE kit_versions ADD COLUMN panel_policy_hash TEXT CHECK(panel_policy_hash IS NULL OR length(panel_policy_hash) = 64);
ALTER TABLE kit_versions ADD COLUMN published_kit_id TEXT;
ALTER TABLE kit_versions ADD COLUMN published_product_id TEXT;
ALTER TABLE kit_versions ADD COLUMN published_version_id TEXT;
ALTER TABLE kit_versions ADD COLUMN published_version_number INTEGER CHECK(published_version_number IS NULL OR published_version_number > 0);
ALTER TABLE kit_versions ADD COLUMN proposal_json TEXT;
ALTER TABLE kit_versions ADD COLUMN panel_response_json TEXT;
ALTER TABLE kit_versions ADD COLUMN published_operation_id TEXT;

CREATE TABLE kit_packaging_packages (
  id                    TEXT PRIMARY KEY,
  variant_id            TEXT NOT NULL,
  package_number        INTEGER NOT NULL CHECK(package_number > 0),
  length_mm             INTEGER CHECK(length_mm IS NULL OR length_mm > 0),
  width_mm              INTEGER CHECK(width_mm IS NULL OR width_mm > 0),
  height_mm             INTEGER CHECK(height_mm IS NULL OR height_mm > 0),
  target_weight_grams   INTEGER CHECK(target_weight_grams IS NULL OR target_weight_grams > 0),
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(variant_id) REFERENCES kit_variants(id) ON DELETE CASCADE,
  UNIQUE(variant_id, package_number)
);

CREATE TABLE kit_packaging_items (
  id                    TEXT PRIMARY KEY,
  package_id            TEXT NOT NULL,
  product_id            TEXT NOT NULL,
  quantity_base_int     INTEGER NOT NULL CHECK(quantity_base_int > 0),
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(package_id) REFERENCES kit_packaging_packages(id) ON DELETE CASCADE,
  UNIQUE(package_id, product_id)
);

CREATE TABLE kit_publication_attempts (
  id                    TEXT PRIMARY KEY,
  variant_id            TEXT NOT NULL,
  operation_id          TEXT,
  state                 TEXT NOT NULL CHECK(state IN ('PREVIEWED','PUBLISHED','FAILED')),
  authored_content_hash TEXT NOT NULL CHECK(length(authored_content_hash) = 64),
  panel_content_hash    TEXT,
  panel_policy_hash     TEXT,
  proposal_json         TEXT NOT NULL,
  response_json         TEXT,
  error_code            TEXT,
  actor_id              TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(variant_id) REFERENCES kit_variants(id) ON DELETE RESTRICT,
  UNIQUE(operation_id)
);

CREATE INDEX idx_kit_publication_attempts_variant ON kit_publication_attempts(variant_id, created_at DESC);
CREATE INDEX idx_kit_packaging_packages_variant ON kit_packaging_packages(variant_id, package_number);
CREATE UNIQUE INDEX idx_kit_versions_published_version ON kit_versions(published_version_id) WHERE published_version_id IS NOT NULL;
CREATE UNIQUE INDEX idx_kit_versions_published_operation ON kit_versions(published_operation_id) WHERE published_operation_id IS NOT NULL;

CREATE TRIGGER trg_kit_versions_published_immutable_update
BEFORE UPDATE ON kit_versions WHEN OLD.published_version_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'published kit version is immutable'); END;

CREATE TRIGGER trg_kit_versions_published_immutable_delete
BEFORE DELETE ON kit_versions WHEN OLD.published_version_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'published kit version is immutable'); END;
