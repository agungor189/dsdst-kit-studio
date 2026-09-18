import type { Connector, Profile } from "./types.js";

export type CanonicalMaterial = "ALUMINUM" | "PPR" | "CARBON_STEEL" | "CAST_IRON" | "PREMIUM_CAST_IRON" | "STAINLESS_STEEL" | "GALVANIZED_STEEL" | "OTHER";

export const MATERIAL_LABELS: Record<CanonicalMaterial, string> = {
  ALUMINUM: "Alüminyum", PPR: "PPR", CARBON_STEEL: "Karbon Çelik", CAST_IRON: "Döküm",
  PREMIUM_CAST_IRON: "Premium Döküm", STAINLESS_STEEL: "Paslanmaz Çelik", GALVANIZED_STEEL: "Galvaniz Çelik", OTHER: "Diğer",
};
export const MATERIAL_ORDER = Object.keys(MATERIAL_LABELS) as CanonicalMaterial[];

const ROUND_SIZES = [
  { code: "R050", nominal: '1/2"', aliases: ["1/2", "0.5"], mm: 21.3 },
  { code: "R075", nominal: '3/4"', aliases: ["3/4", "0.75"], mm: 26.9 },
  { code: "R100", nominal: '1"', aliases: ["1"], mm: 33.7 },
  { code: "R125", nominal: '1.25"', aliases: ["11/4", "1.25"], mm: 42.4 },
  { code: "R150", nominal: '1.5"', aliases: ["11/2", "1.5"], mm: 48.3 },
  { code: "R200", nominal: '2"', aliases: ["2"], mm: 60.3 },
  { code: "R250", nominal: '2.5"', aliases: ["21/2", "2.5"], mm: 76.1 },
  { code: "R300", nominal: '3"', aliases: ["3"], mm: 88.9 },
  { code: "R400", nominal: '4"', aliases: ["4"], mm: 114.3 },
] as const;

const ROUND_ALIASES = ROUND_SIZES.reduce<Record<string, number>>((result, size) => {
  result[size.code] = size.mm; size.aliases.forEach((alias) => { result[alias] = size.mm; }); return result;
}, {});
const token = (value: unknown) => String(value || "").replace(/,/g, ".").replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().trim();
const compactToken = (value: unknown) => token(value).replace(/[^A-Z0-9]/g, "");
const close = (left: number, right: number) => Math.abs(left - right) < 0.05;
const formatMm = (value: number) => String(Number(value.toFixed(3)));

function roundDiameter(value: unknown) {
  const raw = token(value); const compact = raw.replace(/\s+/g, "").replace(/INCH|INC|\"/g, "");
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

export function normalizeMaterial(value?: string | null): CanonicalMaterial {
  const normalized = compactToken(value); if (!normalized) return "OTHER";
  if (normalized.includes("PREMIUMCASTIRON") || normalized.includes("PREMIUMDOKUM")) return "PREMIUM_CAST_IRON";
  if (normalized.includes("PPR")) return "PPR";
  if (normalized.includes("ALUMIN")) return "ALUMINUM";
  if (normalized.includes("STAINLESS") || normalized.includes("PASLANMAZ")) return "STAINLESS_STEEL";
  if (normalized.includes("GALVAN")) return "GALVANIZED_STEEL";
  if (normalized.includes("CARBONSTEEL") || normalized.includes("KARBONCELIK")) return "CARBON_STEEL";
  if (normalized.includes("CASTIRON") || normalized.includes("DOKUM")) return "CAST_IRON";
  return "OTHER";
}

export function materialLabel(value?: string | null) { const canonical = normalizeMaterial(value); return canonical === "OTHER" && value?.trim() ? value.trim() : MATERIAL_LABELS[canonical]; }
export function shapeLabel(shape: Profile["shape"]) { return shape === "ROUND" ? "Yuvarlak" : shape === "SQUARE" ? "Kare" : "Dikdörtgen"; }

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

export function profileMatchesConnector(profile: Profile, connector: Connector) { const profileKey = physicalSizeKey(profile); const connectorKey = physicalSizeKey(connector); return Boolean(profileKey && connectorKey && profileKey === connectorKey); }
export function connectorsShareSize(left: Connector, right: Connector) { const leftKey = physicalSizeKey(left); const rightKey = physicalSizeKey(right); return Boolean(leftKey && rightKey && leftKey === rightKey); }
export function materialDiffers(profile: Profile, connector: Connector) { return Boolean(connector.compatible_material_group && normalizeMaterial(profile.material) !== normalizeMaterial(connector.compatible_material_group)); }

export function profileSizeLabel(profile: Profile) {
  const key = physicalSizeKey(profile); if (!key) return profile.compatibility_group || profile.nominal_size || "Ölçü belirtilmemiş";
  if (key.startsWith("ROUND:")) {
    const diameter = Number(key.split(":")[1]); const known = ROUND_SIZES.find((size) => close(size.mm, diameter));
    if (known) return `${known.code} · ${known.nominal} · Ø${formatMm(known.mm)} mm`;
    return `${profile.nominal_size || profile.compatibility_group || "Yuvarlak"} · Ø${formatMm(diameter)} mm`;
  }
  const [, dimensions] = key.split(":"); const [width, height] = dimensions.split("X").map(Number);
  if (profile.shape === "SQUARE" && close(width, height)) return `S${formatMm(width)} · ${formatMm(width)}×${formatMm(height)} mm`;
  return `REC${formatMm(width)}X${formatMm(height)} · ${formatMm(width)}×${formatMm(height)} mm`;
}

export function profileSearchText(profile: Profile) {
  const canonical = normalizeMaterial(profile.material);
  const knownRoundSize = profile.shape === "ROUND" ? ROUND_SIZES.find((size) => physicalSizeKey(profile) === `ROUND:${size.mm}`) : undefined;
  const nominalAliases = knownRoundSize ? `${knownRoundSize.code} ${knownRoundSize.nominal} ${knownRoundSize.nominal.replace('"', " inch")} ${knownRoundSize.aliases.join(" ")}` : "";
  return token([profile.name, profile.compatibility_group, profile.nominal_size, nominalAliases, profile.material, canonical, MATERIAL_LABELS[canonical], profile.shape, shapeLabel(profile.shape), profileSizeLabel(profile), physicalSizeKey(profile), profile.wall_thickness_mm != null ? `${profile.wall_thickness_mm} mm et kalinligi` : "", profile.supplier_name].filter(Boolean).join(" "));
}

export type ProfileFamily = { key: string; label: string; variants: Profile[] };
export type ProfileShapeGroup = { shape: Profile["shape"]; label: string; families: ProfileFamily[] };
export type ProfileMaterialGroup = { key: CanonicalMaterial; label: string; shapes: ProfileShapeGroup[] };

export function groupProfiles(profiles: Profile[]): ProfileMaterialGroup[] {
  const materials = new Map<CanonicalMaterial, Map<Profile["shape"], Map<string, Profile[]>>>();
  for (const profile of profiles) {
    const material = normalizeMaterial(profile.material); const shapes = materials.get(material) || new Map(); const families = shapes.get(profile.shape) || new Map();
    const sizeKey = physicalSizeKey(profile) || `UNKNOWN:${token(profile.compatibility_group || profile.nominal_size || profile.name)}`;
    families.set(sizeKey, [...(families.get(sizeKey) || []), profile]); shapes.set(profile.shape, families); materials.set(material, shapes);
  }
  return [...materials.entries()].sort(([left], [right]) => MATERIAL_ORDER.indexOf(left) - MATERIAL_ORDER.indexOf(right)).map(([material, shapes]) => ({
    key: material, label: MATERIAL_LABELS[material], shapes: [...shapes.entries()]
      .sort(([left], [right]) => ["SQUARE", "ROUND", "RECTANGULAR"].indexOf(left) - ["SQUARE", "ROUND", "RECTANGULAR"].indexOf(right))
      .map(([shape, families]) => ({ shape, label: shapeLabel(shape), families: [...families.entries()].map(([key, variants]) => ({
        key, label: profileSizeLabel(variants[0]), variants: [...variants].sort((left, right) => `${left.wall_thickness_mm || 0}|${left.supplier_name || ""}|${left.name}`.localeCompare(`${right.wall_thickness_mm || 0}|${right.supplier_name || ""}|${right.name}`, "tr", { numeric: true })),
      })).sort((left, right) => left.label.localeCompare(right.label, "tr", { numeric: true })) })),
  }));
}
