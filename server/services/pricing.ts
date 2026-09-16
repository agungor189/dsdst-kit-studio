export type PricingInput = {
  connectors: { quantity: number; purchase_price_snapshot_cents: number; sale_price_snapshot_cents: number }[];
  profile: { purchase_price_snapshot_cents: number; sale_price_snapshot_cents: number; weight_per_meter_snapshot_kg: number; raw_length_mm?: number } | null;
  cuts: { quantity: number; length_mm: number }[];
  complementary: { quantity_milli: number; purchase_price_snapshot_cents: number; sale_price_snapshot_cents: number }[];
  vatRateBasisPoints: number;
};

export type PricingResult = {
  connectors: { cost_cents: number; sale_cents: number };
  profiles: { cost_cents: number; sale_cents: number; total_millimeters: number; purchased_millimeters: number; raw_bar_count: number; waste_millimeters: number; utilization_basis_points: number; total_meters_milli: number; weight_grams: number };
  complementary: { cost_cents: number; sale_cents: number };
  total_cost_cents: number; sale_ex_vat_cents: number; gross_profit_cents: number;
  gross_margin_basis_points: number; vat_rate_basis_points: number; vat_cents: number; sale_inc_vat_cents: number;
};

const roundedRatio = (value: number, numerator: number, denominator: number) => Math.round((value * numerator) / denominator);

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
  const connectorCost = input.connectors.reduce((sum, item) => sum + item.purchase_price_snapshot_cents * item.quantity, 0);
  const connectorSale = input.connectors.reduce((sum, item) => sum + item.sale_price_snapshot_cents * item.quantity, 0);
  const totalMillimeters = input.cuts.reduce((sum, cut) => sum + cut.quantity * cut.length_mm, 0);
  const optimization = input.profile?.raw_length_mm ? optimizeProfileCuts(input.cuts, input.profile.raw_length_mm) : { raw_bar_count: 0, purchased_millimeters: totalMillimeters, waste_millimeters: 0, utilization_basis_points: totalMillimeters ? 10_000 : 0 };
  // Kit costing is based on consumed profile length. Raw-bar optimization remains visible
  // as a purchasing/fire metric, but reusable offcuts are not charged to one kit.
  const profileCost = input.profile ? roundedRatio(input.profile.purchase_price_snapshot_cents, totalMillimeters, 1000) : 0;
  const profileSale = input.profile ? roundedRatio(input.profile.sale_price_snapshot_cents, totalMillimeters, 1000) : 0;
  const weightGrams = input.profile ? Math.round(input.profile.weight_per_meter_snapshot_kg * totalMillimeters) : 0;
  const complementaryCost = input.complementary.reduce((sum, item) => sum + roundedRatio(item.purchase_price_snapshot_cents, item.quantity_milli, 1000), 0);
  const complementarySale = input.complementary.reduce((sum, item) => sum + roundedRatio(item.sale_price_snapshot_cents, item.quantity_milli, 1000), 0);
  const totalCost = connectorCost + profileCost + complementaryCost;
  const saleExVat = connectorSale + profileSale + complementarySale;
  const grossProfit = saleExVat - totalCost;
  const vat = roundedRatio(saleExVat, input.vatRateBasisPoints, 10_000);
  return {
    connectors: { cost_cents: connectorCost, sale_cents: connectorSale },
    profiles: { cost_cents: profileCost, sale_cents: profileSale, total_millimeters: totalMillimeters, purchased_millimeters: optimization.purchased_millimeters, raw_bar_count: optimization.raw_bar_count, waste_millimeters: optimization.waste_millimeters, utilization_basis_points: optimization.utilization_basis_points, total_meters_milli: totalMillimeters, weight_grams: weightGrams },
    complementary: { cost_cents: complementaryCost, sale_cents: complementarySale },
    total_cost_cents: totalCost,
    sale_ex_vat_cents: saleExVat,
    gross_profit_cents: grossProfit,
    gross_margin_basis_points: saleExVat ? Math.round((grossProfit * 10_000) / saleExVat) : 0,
    vat_rate_basis_points: input.vatRateBasisPoints,
    vat_cents: vat,
    sale_inc_vat_cents: saleExVat + vat,
  };
}
