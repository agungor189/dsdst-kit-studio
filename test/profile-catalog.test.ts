import assert from "node:assert/strict";
import { test } from "node:test";
import { groupProfiles, materialDiffers, normalizeMaterial, physicalSizeKey, profileMatchesConnector, profileSearchText, profileSizeLabel } from "../src/compatibility.js";
import type { Connector, Profile } from "../src/types.js";

const profile = (overrides: Partial<Profile> = {}): Profile => ({
  id: overrides.id || "profile", name: "Test profil", shape: "ROUND", material: "Aluminum", compatibility_group: "R100",
  outside_diameter_mm: 33.7, nominal_size: '1"', wall_thickness_mm: 2, supplier_name: "Örnek Tedarik",
  purchase_price_per_meter_cents: 10000, sale_price_per_meter_cents: 14000, markup_basis_points: 4000,
  weight_per_meter_kg: 1.2, raw_length_mm: 6000, ...overrides,
});

const connector = (overrides: Partial<Connector> = {}): Connector => ({
  product_id: "connector-1", sku: "AL-R100-ELB", name_tr: "Dirsek", profile_shape: "ROUND", compatible_material_group: "ALUMINUM",
  outside_diameter_mm: 33.7, nominal_size: '1"', compatibility_group: "R100", compatibility_status: "COMPATIBLE",
  sale_price_cents: 1000, purchase_cost_cents: 700, central_stock: 10, ...overrides,
});

test("Aluminum yazım varyasyonları tek ALUMINUM kategorisine normalize edilir", () => {
  for (const value of ["Aluminum", "Aluminium", "Alüminyum", "Aluminum Alloy"]) assert.equal(normalizeMaterial(value), "ALUMINUM");
});

test("desteklenen malzeme aileleri kanonik değerlere normalize edilir", () => {
  assert.equal(normalizeMaterial("PPR-C"), "PPR");
  assert.equal(normalizeMaterial("Carbon Steel"), "CARBON_STEEL");
  assert.equal(normalizeMaterial("Premium Cast Iron"), "PREMIUM_CAST_IRON");
  assert.equal(normalizeMaterial("Paslanmaz Çelik"), "STAINLESS_STEEL");
  assert.equal(normalizeMaterial("Galvanizli Çelik"), "GALVANIZED_STEEL");
  assert.equal(normalizeMaterial("Bronz"), "OTHER");
});

test("R075 etiketi kod, nominal inç ve dış çapı birlikte gösterir", () => {
  assert.equal(profileSizeLabel(profile({ compatibility_group: "R075", outside_diameter_mm: 26.9, nominal_size: "3/4 inch" })), 'R075 · 3/4" · Ø26.9 mm');
});

test("R100, R150 ve R200 etiketleri deterministiktir", () => {
  assert.equal(profileSizeLabel(profile()), 'R100 · 1" · Ø33.7 mm');
  assert.equal(profileSizeLabel(profile({ compatibility_group: "R150", outside_diameter_mm: 48.3, nominal_size: '1.5"' })), 'R150 · 1.5" · Ø48.3 mm');
  assert.equal(profileSizeLabel(profile({ compatibility_group: "R200", outside_diameter_mm: 60.3, nominal_size: '2"' })), 'R200 · 2" · Ø60.3 mm');
});

test("S40 kare profil etiketi ve canonical anahtarı fiziksel ölçüden türetilir", () => {
  const square = profile({ shape: "SQUARE", compatibility_group: "SQ-40X40", width_mm: 40, height_mm: 40, outside_diameter_mm: undefined, nominal_size: undefined });
  assert.equal(physicalSizeKey(square), "SQUARE:40X40");
  assert.equal(profileSizeLabel(square), "S40 · 40×40 mm");
});

test("R100, 1 inch, 33.7 mm ve RD-33.7 aynı fiziksel anahtarda gruplanır", () => {
  const variants = [
    profile({ id: "code", outside_diameter_mm: undefined, nominal_size: "R100", compatibility_group: "R100" }),
    profile({ id: "inch", outside_diameter_mm: undefined, nominal_size: "1 inch", compatibility_group: "legacy" }),
    profile({ id: "mm", outside_diameter_mm: undefined, nominal_size: "33.7 mm", compatibility_group: "legacy" }),
    profile({ id: "rd", outside_diameter_mm: undefined, nominal_size: undefined, compatibility_group: "RD-33.7" }),
  ];
  assert.deepEqual(new Set(variants.map(physicalSizeKey)), new Set(["ROUND:33.7"]));
  assert.equal(groupProfiles(variants)[0].shapes[0].families.length, 1);
});

test("farklı fiziksel ölçüler ayrı aileler olarak kalır", () => {
  const groups = groupProfiles([profile(), profile({ id: "r150", outside_diameter_mm: 48.3, compatibility_group: "R150", nominal_size: '1.5"' })]);
  assert.equal(groups[0].shapes[0].families.length, 2);
});

test("aynı ailede et kalınlığı ve tedarikçi varyantları korunur", () => {
  const groups = groupProfiles([profile({ id: "thin", wall_thickness_mm: 1.5 }), profile({ id: "thick", wall_thickness_mm: 2, supplier_name: "Başka Tedarik" })]);
  assert.deepEqual(groups[0].shapes[0].families[0].variants.map((item) => item.id), ["thin", "thick"]);
});

test("alüminyum yazım varyasyonları tek malzeme başlığında birleşir", () => {
  const groups = groupProfiles([profile({ id: "tr", material: "Alüminyum" }), profile({ id: "en", material: "Aluminium" })]);
  assert.equal(groups.length, 1); assert.equal(groups[0].key, "ALUMINUM"); assert.equal(groups[0].shapes[0].families[0].variants.length, 2);
});

test("aynı ölçüde PPR profil alüminyum bağlantıya fiziksel olarak uyar ve malzeme uyarısı üretir", () => {
  const ppr = profile({ material: "PPR" }); const aluminumConnector = connector();
  assert.equal(profileMatchesConnector(ppr, aluminumConnector), true);
  assert.equal(materialDiffers(ppr, aluminumConnector), true);
});

test("arama kod, nominal ölçü, malzeme, et kalınlığı ve tedarikçiyi kapsar", () => {
  const haystack = profileSearchText(profile({ material: "Alüminyum", wall_thickness_mm: 1.5, supplier_name: "Anadolu Metal" }));
  for (const query of ["R100", "1 INCH", "ALUMINYUM", "1.5 MM ET", "ANADOLU METAL"]) assert.ok(haystack.includes(query));
});

test("bağlantı seçildiğinde yalnızca aynı fiziksel ölçü eşleşir, malzeme filtre olmaz", () => {
  const aluminumConnector = connector();
  assert.equal(profileMatchesConnector(profile({ material: "PPR" }), aluminumConnector), true);
  assert.equal(profileMatchesConnector(profile({ outside_diameter_mm: 48.3, compatibility_group: "R150" }), aluminumConnector), false);
});
