ALTER TABLE panel_connector_cache ADD COLUMN form_code TEXT;
ALTER TABLE panel_connector_cache ADD COLUMN tube_type_code TEXT;
ALTER TABLE panel_connector_cache ADD COLUMN size_code TEXT;
ALTER TABLE panel_connector_cache ADD COLUMN pipe_size TEXT;
ALTER TABLE panel_connector_cache ADD COLUMN normalized_material TEXT;
ALTER TABLE panel_connector_cache ADD COLUMN normalized_size TEXT;
ALTER TABLE panel_connector_cache ADD COLUMN normalized_tube_type TEXT;
ALTER TABLE panel_connector_cache ADD COLUMN normalized_pipe_size TEXT;
ALTER TABLE panel_connector_cache ADD COLUMN compatibility_status TEXT NOT NULL DEFAULT 'UNRESOLVED';
ALTER TABLE panel_connector_cache ADD COLUMN compatibility_source TEXT;
ALTER TABLE panel_connector_cache ADD COLUMN compatibility_note TEXT;
ALTER TABLE panel_connector_cache ADD COLUMN catalog_active INTEGER NOT NULL DEFAULT 1;

ALTER TABLE connector_compatibility ADD COLUMN mapping_source TEXT NOT NULL DEFAULT 'MANUAL';

INSERT OR IGNORE INTO connector_roles (code, name) VALUES
  ('ELB','ELB'),('BAS','BAS'),('TEE','TEE'),('3W','3W'),('4W','4W'),('5W','5W'),
  ('B4W','B4W'),('LTE','LTE'),('CRS','CRS'),('CPL','CPL'),('BCP','BCP'),('45T','45T');

UPDATE profile_specs SET compatibility_group = CASE
  WHEN shape IN ('SQUARE','RECTANGULAR') AND width_mm IS NOT NULL AND height_mm IS NOT NULL
    THEN 'SQ-' || printf('%g', width_mm) || 'X' || printf('%g', height_mm)
  WHEN shape = 'ROUND' AND outside_diameter_mm IS NOT NULL
    THEN 'RD-' || printf('%g', outside_diameter_mm)
  ELSE compatibility_group END;

UPDATE connector_compatibility SET compatibility_group = CASE
  WHEN profile_shape IN ('SQUARE','RECTANGULAR') AND profile_width_mm IS NOT NULL AND profile_height_mm IS NOT NULL
    THEN 'SQ-' || printf('%g', profile_width_mm) || 'X' || printf('%g', profile_height_mm)
  WHEN profile_shape = 'ROUND' AND outside_diameter_mm IS NOT NULL
    THEN 'RD-' || printf('%g', outside_diameter_mm)
  ELSE compatibility_group END;

CREATE INDEX IF NOT EXISTS idx_panel_connector_cache_status
  ON panel_connector_cache(catalog_active, compatibility_status);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('panel_reachable', 'false'),
  ('panel_last_attempt_at', ''),
  ('panel_last_synced_at', ''),
  ('panel_last_error', 'Henüz senkronize edilmedi');
