export type CatalogEconomics = { cost_status?: string | null; sale_price_status?: string | null; id?: string; product_id?: string };

export function assertKnownCatalogEconomics(item: CatalogEconomics, kind: string): void {
  if (item.cost_status !== "KNOWN" || item.sale_price_status !== "KNOWN") {
    throw new Error(`CATALOG_ECONOMICS_UNKNOWN:${kind}:${item.product_id || item.id || "unknown"}`);
  }
}
