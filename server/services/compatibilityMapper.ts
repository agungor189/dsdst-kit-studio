import type { PanelConnector } from "./panelClient.js";

export type MappedCompatibility = {
  status: "COMPATIBLE" | "UNRESOLVED";
  source: "STRUCTURED" | "SKU_FALLBACK" | null;
  note: string | null;
  connector_role?: string;
  profile_shape?: "SQUARE" | "ROUND" | "RECTANGULAR";
  profile_width_mm?: number;
  profile_height_mm?: number;
  outside_diameter_mm?: number;
  nominal_size?: string;
  compatible_material_group?: string;
  compatibility_group?: string;
};

const roleAliases: Record<string, string> = {
  ELB: "ELB", BAS: "BAS", CAP: "BAS", TEE: "TEE", "3W": "3W", W3: "3W",
  "4W": "4W", W4: "4W", "5W": "5W", W5: "5W", B4W: "B4W", BW4: "B4W",
  LTE: "LTE", LTEE: "LTE", CRS: "CRS", CPL: "CPL", BCP: "BCP", CPH: "BCP",
  "45T": "45T", T45: "45T",
};

const inchOutsideDiameters: Record<string, number> = {
  "1/2": 21.3, "3/4": 26.9, "1": 33.7, "1 1/4": 42.4, "1 1/2": 48.3, "2": 60.3,
};

const clean = (value: unknown) => String(value || "").trim();
const token = (value: unknown) => clean(value).replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const numberLabel = (value: number) => Number(value.toFixed(3)).toString();

function roleFrom(value: unknown): string | undefined {
  return roleAliases[token(value)];
}

function shapeFrom(value: unknown): MappedCompatibility["profile_shape"] | undefined {
  const normalized = token(value);
  if (/^S\d/.test(normalized)) return "SQUARE";
  if (/^R\d/.test(normalized)) return "ROUND";
  if (["S", "SQ", "SQUARE", "KARE", "RECTANGULAR", "DIKDORTGEN"].includes(normalized)) return normalized === "RECTANGULAR" || normalized === "DIKDORTGEN" ? "RECTANGULAR" : "SQUARE";
  if (["R", "RD", "ROUND", "YUVARLAK", "BORU"].includes(normalized)) return "ROUND";
  return undefined;
}

function parseSquare(value: unknown) {
  const match = clean(value).replace(/,/g, ".").match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  return match ? [Number(match[1]), Number(match[2])] as const : undefined;
}

function parseRound(value: unknown) {
  const raw = clean(value).replace(/,/g, ".");
  if (/^R100$/i.test(raw)) return { od: 33.7, nominal: '1"' };
  const fraction = raw.match(/(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*(?:in|inch|\")/i)?.[1]?.replace(/\s+/g, " ");
  if (fraction) {
    if (inchOutsideDiameters[fraction]) return { od: inchOutsideDiameters[fraction], nominal: `${fraction}\"` };
    const pieces = fraction.split(" ");
    const last = pieces.at(-1)!;
    const [a, b] = last.split("/").map(Number);
    const inches = pieces.length > 1 ? Number(pieces[0]) + a / b : b ? a / b : Number(last);
    if (Number.isFinite(inches)) return { od: inches * 25.4, nominal: `${fraction}\"` };
  }
  const millimeters = raw.match(/(?:Ø|OD\s*)?(\d+(?:\.\d+)?)\s*(?:mm)?/i)?.[1];
  return millimeters ? { od: Number(millimeters), nominal: undefined } : undefined;
}

function materialGroup(row: PanelConnector) {
  const value = token(row.normalized_material || row.material);
  if (!value) return undefined;
  if (value.includes("ALUMIN") || value.includes("ALUMINYUM")) return "ALUMINUM";
  if (value.includes("PASLANMAZ") || value.includes("STAINLESS")) return "STAINLESS_STEEL";
  if (value.includes("CELIK") || value.includes("STEEL")) return "STEEL";
  return value;
}

export function mapPanelConnector(row: PanelConnector): MappedCompatibility {
  let usedSku = false;
  let role = roleFrom(row.form_code || row.form);
  let shape = shapeFrom(row.tube_type_code || row.normalized_tube_type);
  let sizeValue = row.normalized_pipe_size || row.normalized_size || row.pipe_size || row.size || row.size_code;
  const skuParts = clean(row.sku).split("-").filter(Boolean);
  if (!role) { role = [...skuParts].reverse().map(roleFrom).find((value): value is string => Boolean(value)) || undefined; usedSku = Boolean(role); }
  if (!shape) { shape = skuParts.map(shapeFrom).find(Boolean); usedSku = usedSku || Boolean(shape); }
  if (!sizeValue) {
    sizeValue = skuParts.find((part) => parseSquare(part) || /^(?:R?\d+|\d+(?:IN)?)$/i.test(part));
    usedSku = usedSku || Boolean(sizeValue);
  }

  const result: MappedCompatibility = { status: "UNRESOLVED", source: null, note: null };
  if (!role || !shape || !sizeValue) {
    result.note = "Rol, profil şekli veya ölçü Panel alanlarından belirlenemedi";
    return result;
  }

  if (shape === "SQUARE" || shape === "RECTANGULAR") {
    const dimensions = parseSquare(sizeValue) || (() => {
      const match = clean(sizeValue).match(/(?:SQ|S)(\d+(?:\.\d+)?)/i);
      if (match) return [Number(match[1]), Number(match[1])] as const;
      const single = clean(sizeValue).replace(",", ".").match(/^(\d+(?:\.\d+)?)\s*(?:mm)?$/i);
      return single ? [Number(single[1]), Number(single[1])] as const : undefined;
    })();
    if (!dimensions) return { ...result, note: "Kare/dikdörtgen ölçüsü çözümlenemedi" };
    const [width, height] = dimensions;
    return {
      status: "COMPATIBLE", source: usedSku ? "SKU_FALLBACK" : "STRUCTURED", note: usedSku ? "SKU yedek ayrıştırması kullanıldı" : null,
      connector_role: role, profile_shape: shape, profile_width_mm: width, profile_height_mm: height,
      compatible_material_group: materialGroup(row), compatibility_group: `SQ-${numberLabel(width)}X${numberLabel(height)}`,
    };
  }

  const round = parseRound(sizeValue);
  if (!round) return { ...result, note: "Yuvarlak dış çap çözümlenemedi" };
  return {
    status: "COMPATIBLE", source: usedSku ? "SKU_FALLBACK" : "STRUCTURED", note: usedSku ? "SKU yedek ayrıştırması kullanıldı" : null,
    connector_role: role, profile_shape: "ROUND", outside_diameter_mm: round.od, nominal_size: round.nominal,
    compatible_material_group: materialGroup(row), compatibility_group: `RD-${numberLabel(round.od)}`,
  };
}
