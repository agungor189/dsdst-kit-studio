type PanelConnectorDescriptor = {
  id?: string;
  sku: string;
  title?: string;
  form?: string;
  form_code?: string;
  tube_type_code?: string;
  size_code?: string;
  size?: string;
  pipe_size?: string;
  material?: string;
  normalized_material?: string;
  normalized_size?: string;
  normalized_tube_type?: string;
  normalized_pipe_size?: string;
};

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
  configuration_code?: string;
};

const knownRoleAliases: Record<string, string> = {
  ELB: "ELB", BAS: "BAS", CAP: "BAS", TEE: "TEE", "3W": "3W", W3: "3W",
  "4W": "4W", W4: "4W", "5W": "5W", W5: "5W", "6W": "6W", W6: "6W",
  B4W: "B4W", BW4: "B4W", LTE: "LTE", LTEE: "LTE", CRS: "CRS", CPL: "CPL",
  BCP: "BCP", CPH: "BCP", "45T": "45T", T45: "45T", AFB: "AFB",
};

const roundCodes: Record<string, { od: number; nominal: string }> = {
  R050: { od: 21.3, nominal: '1/2"' }, R075: { od: 26.9, nominal: '3/4"' },
  R100: { od: 33.7, nominal: '1"' }, R125: { od: 42.4, nominal: '1 1/4"' },
  R150: { od: 48.3, nominal: '1 1/2"' }, R200: { od: 60.3, nominal: '2"' },
};

const inchOutsideDiameters: Record<string, number> = {
  "1/2": 21.3, "3/4": 26.9, "1": 33.7, "1 1/4": 42.4, "1 1/2": 48.3, "2": 60.3,
};
const materialPrefixes: Record<string, string> = {
  PCI: "PREMIUM_CAST_IRON", CI: "CAST_IRON", CS: "CARBON_STEEL", SS: "STAINLESS_STEEL",
  AL: "ALUMINUM", GI: "GALVANIZED_STEEL",
};

const clean = (value: unknown) => String(value || "").trim();
const token = (value: unknown) => clean(value).replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const numberLabel = (value: number) => Number(value.toFixed(3)).toString();

function roleFrom(value: unknown, acceptUnknown = false): string | undefined {
  const normalized = token(value);
  if (knownRoleAliases[normalized]) return knownRoleAliases[normalized];
  return acceptUnknown && /^[A-Z0-9]{2,10}$/.test(normalized) ? normalized : undefined;
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
  const raw = clean(value).replace(/,/g, ".");
  const pair = raw.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  if (pair) return [Number(pair[1]), Number(pair[2])] as const;
  const code = token(raw).match(/^S(\d+(?:\.\d+)?)$/);
  if (code) return [Number(code[1]), Number(code[1])] as const;
  const single = raw.match(/^(\d+(?:\.\d+)?)\s*(?:mm)?$/i);
  return single ? [Number(single[1]), Number(single[1])] as const : undefined;
}

function parseRound(value: unknown) {
  const raw = clean(value).replace(/,/g, ".");
  const coded = roundCodes[token(raw)];
  if (coded) return coded;
  const fraction = raw.match(/(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*(?:in|inch|")/i)?.[1]?.replace(/\s+/g, " ");
  if (fraction) {
    if (inchOutsideDiameters[fraction]) return { od: inchOutsideDiameters[fraction], nominal: `${fraction}"` };
    const pieces = fraction.split(" ");
    const last = pieces.at(-1)!;
    const [a, b] = last.split("/").map(Number);
    const inches = pieces.length > 1 ? Number(pieces[0]) + a / b : b ? a / b : Number(last);
    if (Number.isFinite(inches)) return { od: inches * 25.4, nominal: `${fraction}"` };
  }
  const millimeters = raw.match(/(?:Ø|OD\s*)?(\d+(?:\.\d+)?)\s*(?:mm)?/i)?.[1];
  return millimeters ? { od: Number(millimeters), nominal: undefined } : undefined;
}

function materialFromFields(row: PanelConnectorDescriptor) {
  const value = token(row.normalized_material || row.material);
  if (!value) return undefined;
  if (value.includes("ALUMIN") || value.includes("ALUMINYUM")) return "ALUMINUM";
  if (value.includes("PASLANMAZ") || value.includes("STAINLESS")) return "STAINLESS_STEEL";
  if (value.includes("DOKUM") || value.includes("CASTIRON")) return "CAST_IRON";
  if (value.includes("KARBON") || value.includes("CARBONSTEEL")) return "CARBON_STEEL";
  if (value.includes("CELIK") || value.includes("STEEL")) return "STEEL";
  return value;
}

/** Parses the material-size-model SKU convention without user-maintained mappings. */
export function parseConnectorSku(sku: string): Partial<MappedCompatibility> {
  const parts = clean(sku).split("-").map(token).filter(Boolean);
  const material = materialPrefixes[parts[0]];
  const sizeCode = parts.find((part) => /^S\d+(?:\.\d+)?$/.test(part) || /^R\d{3}$/.test(part));
  const role = roleFrom(parts.at(-1), true);
  if (!sizeCode || !role) return { compatible_material_group: material };
  if (sizeCode.startsWith("S")) {
    const dimensions = parseSquare(sizeCode)!;
    return {
      connector_role: role, profile_shape: "SQUARE", profile_width_mm: dimensions[0], profile_height_mm: dimensions[1],
      compatible_material_group: material, compatibility_group: `SQ-${numberLabel(dimensions[0])}X${numberLabel(dimensions[1])}`,
      configuration_code: `${parts[0]}-${sizeCode}`,
    };
  }
  const round = parseRound(sizeCode);
  if (!round) return { connector_role: role, compatible_material_group: material };
  return {
    connector_role: role, profile_shape: "ROUND", outside_diameter_mm: round.od, nominal_size: round.nominal,
    compatible_material_group: material, compatibility_group: `RD-${numberLabel(round.od)}`,
    configuration_code: `${parts[0]}-${sizeCode}`,
  };
}

export function mapPanelConnector(row: PanelConnectorDescriptor): MappedCompatibility {
  const parsedSku = parseConnectorSku(row.sku);
  const structuredRole = roleFrom(row.form_code || row.form);
  const structuredShape = shapeFrom(row.tube_type_code || row.normalized_tube_type);
  const hasSkuConfiguration = Boolean(parsedSku.configuration_code);
  const role = hasSkuConfiguration ? parsedSku.connector_role : structuredRole || parsedSku.connector_role;
  const shape = hasSkuConfiguration ? parsedSku.profile_shape : structuredShape || parsedSku.profile_shape;
  const sizeValue = row.normalized_pipe_size || row.normalized_size || row.pipe_size || row.size || row.size_code;
  const skuFallback = !structuredRole || !structuredShape || !sizeValue;
  const material = parsedSku.compatible_material_group || materialFromFields(row);
  if (!role || !shape) return { status: "UNRESOLVED", source: null, note: "SKU veya ürün özelliklerinden model ve profil şekli çıkarılamadı" };

  if (shape === "SQUARE" || shape === "RECTANGULAR") {
    const dimensions = hasSkuConfiguration && parsedSku.profile_width_mm && parsedSku.profile_height_mm ? [parsedSku.profile_width_mm, parsedSku.profile_height_mm] as const : parseSquare(sizeValue) || (parsedSku.profile_width_mm && parsedSku.profile_height_mm ? [parsedSku.profile_width_mm, parsedSku.profile_height_mm] as const : undefined);
    if (!dimensions) return { status: "UNRESOLVED", source: null, note: "Kare/dikdörtgen ölçüsü otomatik çözümlenemedi" };
    const [width, height] = dimensions;
    return {
      status: "COMPATIBLE", source: skuFallback ? "SKU_FALLBACK" : "STRUCTURED", note: null,
      connector_role: role, profile_shape: shape, profile_width_mm: width, profile_height_mm: height,
      compatible_material_group: material, compatibility_group: `SQ-${numberLabel(width)}X${numberLabel(height)}`,
      configuration_code: parsedSku.configuration_code,
    };
  }
  const round = hasSkuConfiguration && parsedSku.outside_diameter_mm ? { od: parsedSku.outside_diameter_mm, nominal: parsedSku.nominal_size } : parseRound(sizeValue) || (parsedSku.outside_diameter_mm ? { od: parsedSku.outside_diameter_mm, nominal: parsedSku.nominal_size } : undefined);
  if (!round) return { status: "UNRESOLVED", source: null, note: "Yuvarlak ölçü otomatik çözümlenemedi" };
  return {
    status: "COMPATIBLE", source: skuFallback ? "SKU_FALLBACK" : "STRUCTURED", note: null,
    connector_role: role, profile_shape: "ROUND", outside_diameter_mm: round.od, nominal_size: round.nominal,
    compatible_material_group: material, compatibility_group: `RD-${numberLabel(round.od)}`,
    configuration_code: parsedSku.configuration_code,
  };
}
