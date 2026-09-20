export const COMPLEMENTARY_UOM_CODES = ["piece", "meter", "square_meter", "kg", "roll", "package", "box"] as const;
export type ComplementaryUomCode = typeof COMPLEMENTARY_UOM_CODES[number];

const discreteUoms = new Set<ComplementaryUomCode>(["piece", "roll", "package", "box"]);

export function complementaryQuantityMilli(product: { id?: string; base_uom_code?: string | null }, quantity: number): number {
  const code = product.base_uom_code as ComplementaryUomCode;
  const id = product.id || "unknown";
  if (!COMPLEMENTARY_UOM_CODES.includes(code) || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`INVALID_COMPLEMENTARY_QUANTITY:${id}`);
  }
  if (discreteUoms.has(code) && !Number.isInteger(quantity)) {
    throw new Error(`DISCRETE_QUANTITY_MUST_BE_INTEGER:${code}:${id}`);
  }
  const scaled = Math.round(quantity * 1000);
  if (!Number.isSafeInteger(scaled) || Math.abs(quantity - scaled / 1000) > 1e-12) {
    throw new Error(`COMPLEMENTARY_QUANTITY_PRECISION_EXCEEDED:${code}:${id}`);
  }
  return scaled;
}
