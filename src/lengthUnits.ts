export type DisplayLengthUnit = "mm" | "cm" | "m";

const MILLIMETERS_PER_UNIT: Record<DisplayLengthUnit, bigint> = {
  mm: 1n,
  cm: 10n,
  m: 1000n,
};

export function parseLengthToMm(value: string, unit: DisplayLengthUnit): number | null {
  const source = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(source)) return null;
  const [whole, fraction = ""] = source.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}`) * MILLIMETERS_PER_UNIT[unit];
  if (numerator % denominator !== 0n) return null;
  const millimeters = numerator / denominator;
  if (millimeters > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(millimeters);
}

export function formatLengthFromMm(millimeters: number, unit: DisplayLengthUnit): string {
  if (!Number.isSafeInteger(millimeters) || millimeters < 0) throw new Error("Length must be a non-negative integer millimeter value");
  const scale = Number(MILLIMETERS_PER_UNIT[unit]);
  if (scale === 1) return String(millimeters);
  const whole = Math.trunc(millimeters / scale);
  const remainder = millimeters % scale;
  if (!remainder) return String(whole);
  return `${whole}.${String(remainder).padStart(String(scale).length - 1, "0").replace(/0+$/, "")}`;
}
