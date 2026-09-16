import type Database from "better-sqlite3";

export type ProfileCompatibility = {
  shape: string; material: string; width_mm: number | null; height_mm: number | null;
  outside_diameter_mm: number | null; nominal_size: string | null; wall_thickness_mm: number | null;
  compatibility_group: string;
};

export type ConnectorCompatibility = {
  connector_role: string; profile_shape: string; profile_width_mm: number | null; profile_height_mm: number | null;
  outside_diameter_mm: number | null; nominal_size: string | null; compatible_material_group: string | null;
  wall_min_mm: number | null; wall_max_mm: number | null; compatibility_group: string;
};

const sameNumber = (left: number | null, right: number | null) => left == null || right == null || Math.abs(left - right) < 0.001;
const materialGroup = (value: string) => {
  const normalized = value.replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.includes("ALUMIN") || normalized.includes("ALUMINYUM")) return "ALUMINUM";
  if (normalized.includes("PASLANMAZ") || normalized.includes("STAINLESS")) return "STAINLESS_STEEL";
  if (normalized.includes("CELIK") || normalized.includes("STEEL")) return "STEEL";
  return normalized;
};

export function isCompatible(connector: ConnectorCompatibility, profile: ProfileCompatibility) {
  if (connector.compatibility_group !== profile.compatibility_group) return false;
  if (connector.profile_shape !== profile.shape) return false;
  if (connector.compatible_material_group && materialGroup(connector.compatible_material_group) !== materialGroup(profile.material)) return false;
  if (!sameNumber(connector.profile_width_mm, profile.width_mm) || !sameNumber(connector.profile_height_mm, profile.height_mm)) return false;
  if (!sameNumber(connector.outside_diameter_mm, profile.outside_diameter_mm)) return false;
  if (connector.nominal_size && profile.nominal_size && connector.nominal_size !== profile.nominal_size) return false;
  if (profile.wall_thickness_mm != null && connector.wall_min_mm != null && profile.wall_thickness_mm < connector.wall_min_mm) return false;
  if (profile.wall_thickness_mm != null && connector.wall_max_mm != null && profile.wall_thickness_mm > connector.wall_max_mm) return false;
  return true;
}

export function getProfileCompatibility(db: Database.Database, profileId: string) {
  return db.prepare(`SELECT ps.shape, ps.material, ps.width_mm, ps.height_mm, ps.outside_diameter_mm,
    ps.nominal_size, ps.wall_thickness_mm, ps.compatibility_group
    FROM profiles p JOIN profile_specs ps ON ps.id=p.spec_id WHERE p.id=? AND p.active=1`).get(profileId) as ProfileCompatibility | undefined;
}

export function getConnectorCompatibility(db: Database.Database, productId: string) {
  return db.prepare("SELECT connector_role,profile_shape,profile_width_mm,profile_height_mm,outside_diameter_mm,nominal_size,compatible_material_group,wall_min_mm,wall_max_mm,compatibility_group FROM connector_compatibility WHERE product_id=? AND active=1").get(productId) as ConnectorCompatibility | undefined;
}

export function compatibleConnectorsForProfile(db: Database.Database, profileId: string) {
  const profile = getProfileCompatibility(db, profileId);
  if (!profile) return [];
  const rows = db.prepare(`SELECT pc.*, cc.connector_role,cc.profile_shape,cc.profile_width_mm,cc.profile_height_mm,
    cc.outside_diameter_mm,cc.nominal_size,cc.compatible_material_group,cc.wall_min_mm,cc.wall_max_mm,cc.compatibility_group
    FROM panel_connector_cache pc JOIN connector_compatibility cc ON cc.product_id=pc.product_id
    WHERE cc.active=1 AND pc.catalog_active=1 AND pc.compatibility_status='COMPATIBLE' ORDER BY cc.connector_role,pc.sku`).all() as any[];
  return rows.filter((row) => isCompatible(row, profile));
}

export function compatibleProfilesForConnector(db: Database.Database, productId: string) {
  const connector = getConnectorCompatibility(db, productId);
  if (!connector) return [];
  const rows = db.prepare(`SELECT p.*,ps.shape,ps.material,ps.width_mm,ps.height_mm,ps.outside_diameter_mm,
    ps.nominal_size,ps.wall_thickness_mm,ps.compatibility_group FROM profiles p JOIN profile_specs ps ON ps.id=p.spec_id
    WHERE p.active=1 ORDER BY p.name`).all() as any[];
  return rows.filter((row) => isCompatible(connector, row));
}

export function resolveConnector(db: Database.Database, role: string, profileId: string) {
  return compatibleConnectorsForProfile(db, profileId).find((connector: any) => connector.connector_role === role) || null;
}

export function validateConnectorSelection(db: Database.Database, profileId: string, productId: string) {
  const profile = getProfileCompatibility(db, profileId);
  const connector = getConnectorCompatibility(db, productId);
  return Boolean(profile && connector && isCompatible(connector, profile));
}
