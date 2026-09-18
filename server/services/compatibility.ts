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

type PhysicalSize = Pick<ProfileCompatibility, "shape" | "width_mm" | "height_mm" | "outside_diameter_mm" | "nominal_size" | "compatibility_group"> | Pick<ConnectorCompatibility, "profile_shape" | "profile_width_mm" | "profile_height_mm" | "outside_diameter_mm" | "nominal_size" | "compatibility_group">;

const ROUND_ALIASES: Record<string, number> = {
  R050: 21.3, "1/2": 21.3, R075: 26.9, "3/4": 26.9, R100: 33.7, "1": 33.7,
  R125: 42.4, "11/4": 42.4, R150: 48.3, "11/2": 48.3, R200: 60.3, "2": 60.3,
};
const close = (left: number, right: number) => Math.abs(left - right) < 0.05;
const token = (value: unknown) => String(value || "").replace(/,/g, ".").replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().trim();
const shapeOf = (item: PhysicalSize) => "shape" in item ? item.shape : item.profile_shape;

function roundDiameter(value: unknown) {
  const raw = token(value);
  const compact = raw.replace(/\s+/g, "").replace(/INCH|INÇ|\"/g, "");
  if (ROUND_ALIASES[compact] != null) return ROUND_ALIASES[compact];
  const coded = compact.match(/(?:^|[^A-Z0-9])(R\d{3})(?:$|[^A-Z0-9])/)?.[1];
  if (coded && ROUND_ALIASES[coded] != null) return ROUND_ALIASES[coded];
  const millimeters = raw.match(/(?:RD[-\s]?|OD\s*|Ø\s*)?(\d+(?:\.\d+)?)\s*MM\b/)?.[1]
    || raw.match(/^RD[-\s]?(\d+(?:\.\d+)?)$/)?.[1];
  return millimeters ? Number(millimeters) : undefined;
}

function squareDimensions(value: unknown) {
  const raw = token(value);
  const pair = raw.match(/(\d+(?:\.\d+)?)\s*[X×*]\s*(\d+(?:\.\d+)?)/);
  if (pair) return [Number(pair[1]), Number(pair[2])] as const;
  const single = raw.replace(/\s+/g, "").match(/^(?:SQ[-]?|S)(\d+(?:\.\d+)?)(?:MM)?$/)?.[1];
  return single ? [Number(single), Number(single)] as const : undefined;
}

/** Returns a material-independent canonical key for the physical profile envelope. */
export function canonicalSizeKey(item: PhysicalSize) {
  const shape = String(shapeOf(item) || "").toUpperCase();
  if (shape === "ROUND") {
    const diameter = Number(item.outside_diameter_mm) || roundDiameter(item.compatibility_group) || roundDiameter(item.nominal_size);
    return diameter ? `ROUND:${Number(diameter.toFixed(3))}` : null;
  }
  if (shape === "SQUARE" || shape === "RECTANGULAR") {
    const fallback = squareDimensions(item.compatibility_group);
    const width = Number("width_mm" in item ? item.width_mm : item.profile_width_mm) || fallback?.[0];
    const height = Number("height_mm" in item ? item.height_mm : item.profile_height_mm) || fallback?.[1];
    return width && height ? `${shape}:${Number(width.toFixed(3))}X${Number(height.toFixed(3))}` : null;
  }
  return null;
}

export function isCompatible(connector: ConnectorCompatibility, profile: ProfileCompatibility) {
  if (connector.profile_shape !== profile.shape) return false;
  const connectorKey = canonicalSizeKey(connector); const profileKey = canonicalSizeKey(profile);
  if (!connectorKey || !profileKey || connectorKey !== profileKey) return false;
  if (connector.profile_shape === "ROUND" && connector.outside_diameter_mm != null && profile.outside_diameter_mm != null && !close(connector.outside_diameter_mm, profile.outside_diameter_mm)) return false;
  if (profile.wall_thickness_mm != null && connector.wall_min_mm != null && profile.wall_thickness_mm < connector.wall_min_mm) return false;
  if (profile.wall_thickness_mm != null && connector.wall_max_mm != null && profile.wall_thickness_mm > connector.wall_max_mm) return false;
  return true;
}

export function getProfileCompatibility(db: Database.Database, profileId: string) {
  return db.prepare(`SELECT ps.shape, ps.material, ps.width_mm, ps.height_mm, ps.outside_diameter_mm,
    ps.nominal_size, ps.wall_thickness_mm, COALESCE(ps.size_compatibility_group,ps.compatibility_group) compatibility_group
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
    ps.nominal_size,ps.wall_thickness_mm,COALESCE(ps.size_compatibility_group,ps.compatibility_group) compatibility_group FROM profiles p JOIN profile_specs ps ON ps.id=p.spec_id
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
