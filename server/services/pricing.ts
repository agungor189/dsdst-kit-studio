export type MissingWeightItem = { type: "CONNECTOR" | "PROFILE" | "COMPLEMENTARY"; id?: string | null; name: string; quantity: number };

export type PricingInput = {
  connectors: { quantity: number; purchase_price_snapshot_cents: number; sale_price_snapshot_cents: number; unit_weight_snapshot_grams?: number | null; product_id?: string | null; sku_snapshot?: string | null; product_name_snapshot?: string | null }[];
  profile: { purchase_price_snapshot_cents: number; markup_basis_points_snapshot?: number | null; sale_price_snapshot_cents?: number; weight_per_meter_snapshot_kg: number; raw_length_mm?: number; profile_id?: string; current_name?: string; product_name_snapshot?: string } | null;
  cuts: { quantity: number; length_mm: number }[];
  complementary: { quantity_milli: number; purchase_price_snapshot_cents: number; markup_basis_points_snapshot?: number | null; sale_price_snapshot_cents?: number; weight_per_unit_snapshot_grams?: number | null; complementary_product_id?: string; product_name_snapshot?: string }[];
  vatRateBasisPoints: number;
  laborCostCents?: number; packagingCostCents?: number; otherCostCents?: number;
};

export type PricingResult = {
  connector_cost_cents: number; profile_cost_cents: number; complementary_cost_cents: number; component_cost_cents: number;
  labor_cost_cents: number; packaging_cost_cents: number; other_cost_cents: number; extra_cost_cents: number; total_cost_cents: number;
  connector_sale_cents: number; profile_sale_cents: number; complementary_sale_cents: number; subtotal_ex_vat_cents: number;
  profit_cents: number; margin_basis_points: number; margin_percent: number; vat_rate_basis_points: number; vat_cents: number; total_inc_vat_cents: number;
  connector_weight_grams: number; profile_weight_grams: number; complementary_weight_grams: number; total_weight_grams: number;
  weight_complete: boolean; missing_weight_items: MissingWeightItem[];
  connectors: { cost_cents: number; sale_cents: number; weight_grams: number };
  profiles: { cost_cents: number; sale_cents: number; total_millimeters: number; purchased_millimeters: number; raw_bar_count: number; waste_millimeters: number; utilization_basis_points: number; total_meters_milli: number; weight_grams: number };
  complementary: { cost_cents: number; sale_cents: number; weight_grams: number };
  sale_ex_vat_cents: number; gross_profit_cents: number; gross_margin_basis_points: number; sale_inc_vat_cents: number;
};

const roundedRatio = (value: number, numerator: number, denominator: number) => Math.round((value * numerator) / denominator);
export const priceWithMarkup = (purchaseCents: number, markupBasisPoints: number) => roundedRatio(purchaseCents, 10_000 + markupBasisPoints, 10_000);

function markupOf(item: { purchase_price_snapshot_cents: number; markup_basis_points_snapshot?: number | null; sale_price_snapshot_cents?: number }) {
  if (item.markup_basis_points_snapshot != null) return Number(item.markup_basis_points_snapshot);
  return item.purchase_price_snapshot_cents > 0 && item.sale_price_snapshot_cents != null
    ? Math.max(0, Math.round((item.sale_price_snapshot_cents / item.purchase_price_snapshot_cents - 1) * 10_000)) : 0;
}
function saleUnitOf(item: { purchase_price_snapshot_cents: number; markup_basis_points_snapshot?: number | null; sale_price_snapshot_cents?: number }) {
  return item.markup_basis_points_snapshot == null && item.sale_price_snapshot_cents != null
    ? item.sale_price_snapshot_cents : priceWithMarkup(item.purchase_price_snapshot_cents, markupOf(item));
}

export function optimizeProfileCuts(cuts: { quantity: number; length_mm: number }[], rawLengthMm: number, kerfMm = 3) {
  const pieces = cuts.flatMap((cut) => Array.from({ length: cut.quantity }, () => cut.length_mm)).sort((a, b) => b - a);
  if (!pieces.length || rawLengthMm <= 0) return { raw_bar_count: 0, purchased_millimeters: 0, waste_millimeters: 0, utilization_basis_points: 0, bars: [] as number[][] };
  if (pieces.some((piece) => piece > rawLengthMm)) throw new Error("CUT_LONGER_THAN_RAW_PROFILE");
  const bars: number[][] = [];
  for (const piece of pieces) {
    const target = bars.find((bar) => bar.reduce((sum, item) => sum + item, 0) + piece + kerfMm * bar.length <= rawLengthMm);
    if (target) target.push(piece); else bars.push([piece]);
  }
  const used = pieces.reduce((sum, piece) => sum + piece, 0);
  const kerf = bars.reduce((sum, bar) => sum + Math.max(0, bar.length - 1) * kerfMm, 0);
  const purchased = bars.length * rawLengthMm;
  return { raw_bar_count: bars.length, purchased_millimeters: purchased, waste_millimeters: purchased - used - kerf, utilization_basis_points: purchased ? Math.round((used * 10_000) / purchased) : 0, bars };
}

export function calculatePricing(input: PricingInput): PricingResult {
  const missing: MissingWeightItem[] = [];
  const connectorCost = input.connectors.reduce((sum, item) => sum + item.purchase_price_snapshot_cents * item.quantity, 0);
  const connectorSale = input.connectors.reduce((sum, item) => sum + item.sale_price_snapshot_cents * item.quantity, 0);
  const connectorWeight = input.connectors.reduce((sum, item) => {
    const weight = Number(item.unit_weight_snapshot_grams || 0);
    if (weight <= 0 && item.quantity > 0) missing.push({ type: "CONNECTOR", id: item.product_id, name: item.sku_snapshot || item.product_name_snapshot || "Bağlantı elemanı", quantity: item.quantity });
    return sum + (weight > 0 ? weight * item.quantity : 0);
  }, 0);
  const totalMillimeters = input.cuts.reduce((sum, cut) => sum + cut.quantity * cut.length_mm, 0);
  const optimization = input.profile?.raw_length_mm ? optimizeProfileCuts(input.cuts, input.profile.raw_length_mm) : { raw_bar_count: 0, purchased_millimeters: totalMillimeters, waste_millimeters: 0, utilization_basis_points: totalMillimeters ? 10_000 : 0 };
  const profileCost = input.profile ? roundedRatio(input.profile.purchase_price_snapshot_cents, totalMillimeters, 1000) : 0;
  const profileSale = input.profile ? roundedRatio(saleUnitOf(input.profile), totalMillimeters, 1000) : 0;
  const profileWeightRate = Number(input.profile?.weight_per_meter_snapshot_kg || 0);
  if (input.profile && totalMillimeters > 0 && profileWeightRate <= 0) missing.push({ type: "PROFILE", id: input.profile.profile_id, name: input.profile.current_name || input.profile.product_name_snapshot || "Profil", quantity: totalMillimeters / 1000 });
  const profileWeight = profileWeightRate > 0 ? profileWeightRate * totalMillimeters : 0;
  const complementaryCost = input.complementary.reduce((sum, item) => sum + roundedRatio(item.purchase_price_snapshot_cents, item.quantity_milli, 1000), 0);
  const complementarySale = input.complementary.reduce((sum, item) => sum + roundedRatio(saleUnitOf(item), item.quantity_milli, 1000), 0);
  const complementaryWeight = input.complementary.reduce((sum, item) => {
    const weight = Number(item.weight_per_unit_snapshot_grams || 0);
    if (weight <= 0 && item.quantity_milli > 0) missing.push({ type: "COMPLEMENTARY", id: item.complementary_product_id, name: item.product_name_snapshot || "Tamamlayıcı ürün", quantity: item.quantity_milli / 1000 });
    return sum + (weight > 0 ? roundedRatio(weight, item.quantity_milli, 1000) : 0);
  }, 0);
  const componentCost = connectorCost + profileCost + complementaryCost;
  const labor = Number(input.laborCostCents || 0); const packaging = Number(input.packagingCostCents || 0); const other = Number(input.otherCostCents || 0);
  const extraCost = labor + packaging + other; const totalCost = componentCost + extraCost;
  const subtotal = connectorSale + profileSale + complementarySale; const profit = subtotal - totalCost;
  const marginBasisPoints = subtotal ? Math.round((profit * 10_000) / subtotal) : 0;
  const vat = roundedRatio(subtotal, input.vatRateBasisPoints, 10_000);
  const connectorWeightRounded = Math.round(connectorWeight); const profileWeightRounded = Math.round(profileWeight); const complementaryWeightRounded = Math.round(complementaryWeight);
  const result = {
    connector_cost_cents: connectorCost, profile_cost_cents: profileCost, complementary_cost_cents: complementaryCost, component_cost_cents: componentCost,
    labor_cost_cents: labor, packaging_cost_cents: packaging, other_cost_cents: other, extra_cost_cents: extraCost, total_cost_cents: totalCost,
    connector_sale_cents: connectorSale, profile_sale_cents: profileSale, complementary_sale_cents: complementarySale, subtotal_ex_vat_cents: subtotal,
    profit_cents: profit, margin_basis_points: marginBasisPoints, margin_percent: marginBasisPoints / 100, vat_rate_basis_points: input.vatRateBasisPoints, vat_cents: vat, total_inc_vat_cents: subtotal + vat,
    connector_weight_grams: connectorWeightRounded, profile_weight_grams: profileWeightRounded, complementary_weight_grams: complementaryWeightRounded,
    total_weight_grams: connectorWeightRounded + profileWeightRounded + complementaryWeightRounded, weight_complete: missing.length === 0, missing_weight_items: missing,
  };
  return { ...result,
    connectors: { cost_cents: connectorCost, sale_cents: connectorSale, weight_grams: connectorWeightRounded },
    profiles: { cost_cents: profileCost, sale_cents: profileSale, total_millimeters: totalMillimeters, purchased_millimeters: optimization.purchased_millimeters, raw_bar_count: optimization.raw_bar_count, waste_millimeters: optimization.waste_millimeters, utilization_basis_points: optimization.utilization_basis_points, total_meters_milli: totalMillimeters, weight_grams: profileWeightRounded },
    complementary: { cost_cents: complementaryCost, sale_cents: complementarySale, weight_grams: complementaryWeightRounded },
    sale_ex_vat_cents: subtotal, gross_profit_cents: profit, gross_margin_basis_points: marginBasisPoints, sale_inc_vat_cents: subtotal + vat,
  };
}
