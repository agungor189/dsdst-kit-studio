import type { Connector, Profile } from "./types";

const ROUND_ALIASES: Record<string, number> = {
  R050: 21.3, "1/2": 21.3, R075: 26.9, "3/4": 26.9, R100: 33.7, "1": 33.7,
  R125: 42.4, "11/4": 42.4, R150: 48.3, "11/2": 48.3, R200: 60.3, "2": 60.3,
};

const token = (value: unknown) => String(value || "").replace(/,/g, ".").replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().trim();

function roundDiameter(value: unknown) {
  const raw = token(value); const compact = raw.replace(/\s+/g, "").replace(/INCH|INÇ|\"/g, "");
  if (ROUND_ALIASES[compact] != null) return ROUND_ALIASES[compact];
  const code = compact.match(/(?:^|[^A-Z0-9])(R\d{3})(?:$|[^A-Z0-9])/)?.[1];
  if (code && ROUND_ALIASES[code] != null) return ROUND_ALIASES[code];
  const millimeters = raw.match(/(?:RD[-\s]?|OD\s*|Ø\s*)?(\d+(?:\.\d+)?)\s*MM\b/)?.[1] || raw.match(/^RD[-\s]?(\d+(?:\.\d+)?)$/)?.[1];
  return millimeters ? Number(millimeters) : undefined;
}

function squareDimensions(value: unknown) {
  const raw = token(value); const pair = raw.match(/(\d+(?:\.\d+)?)\s*[X×*]\s*(\d+(?:\.\d+)?)/);
  if (pair) return [Number(pair[1]), Number(pair[2])] as const;
  const single = raw.replace(/\s+/g, "").match(/^(?:SQ[-]?|S)(\d+(?:\.\d+)?)(?:MM)?$/)?.[1];
  return single ? [Number(single), Number(single)] as const : undefined;
}

export function physicalSizeKey(item: Profile | Connector) {
  const shape = ("shape" in item ? item.shape : item.profile_shape || "").toUpperCase();
  if (shape === "ROUND") {
    const diameter = Number(item.outside_diameter_mm) || roundDiameter(item.compatibility_group) || roundDiameter(item.nominal_size);
    return diameter ? `ROUND:${Number(diameter.toFixed(3))}` : null;
  }
  if (shape === "SQUARE" || shape === "RECTANGULAR") {
    const fallback = squareDimensions(item.compatibility_group);
    const width = Number("shape" in item ? item.width_mm : item.profile_width_mm) || fallback?.[0];
    const height = Number("shape" in item ? item.height_mm : item.profile_height_mm) || fallback?.[1];
    return width && height ? `${shape}:${Number(width.toFixed(3))}X${Number(height.toFixed(3))}` : null;
  }
  return null;
}

export function profileMatchesConnector(profile: Profile, connector: Connector) {
  const profileKey = physicalSizeKey(profile); const connectorKey = physicalSizeKey(connector); const wall = profile.wall_thickness_mm;
  return Boolean(profileKey && connectorKey && profileKey === connectorKey
    && (wall == null || connector.wall_min_mm == null || wall >= connector.wall_min_mm)
    && (wall == null || connector.wall_max_mm == null || wall <= connector.wall_max_mm));
}

export function connectorsShareSize(left: Connector, right: Connector) {
  const leftKey = physicalSizeKey(left); const rightKey = physicalSizeKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export function materialDiffers(profile: Profile, connector: Connector) {
  const normalize = (value: unknown) => {
    const normalized = token(value).replace(/[^A-Z0-9]/g, "");
    if (normalized.includes("ALUMIN") || normalized.includes("ALUMINYUM")) return "ALUMINUM";
    if (normalized.includes("PREMIUMCASTIRON")) return "PREMIUMCASTIRON";
    if (normalized.includes("CASTIRON") || normalized.includes("DOKUM")) return "CASTIRON";
    if (normalized.includes("CARBONSTEEL") || normalized.includes("KARBON")) return "CARBONSTEEL";
    if (normalized.includes("STAINLESS") || normalized.includes("PASLANMAZ")) return "STAINLESSSTEEL";
    return normalized;
  };
  return Boolean(connector.compatible_material_group && normalize(profile.material) !== normalize(connector.compatible_material_group));
}

export function profileSizeLabel(profile: Profile) {
  if (profile.shape === "ROUND") return profile.nominal_size || (profile.outside_diameter_mm ? `Ø${profile.outside_diameter_mm} mm` : profile.compatibility_group);
  return profile.width_mm && profile.height_mm ? `${profile.width_mm}×${profile.height_mm} mm` : profile.compatibility_group;
}
