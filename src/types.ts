export type Profile = { id: string; name: string; shape: string; material: string; compatibility_group: string; purchase_price_per_meter_cents: number; sale_price_per_meter_cents: number; weight_per_meter_kg: number };
export type Connector = { product_id: string; sku: string; name_tr: string; connector_role: string; compatibility_group: string; sale_price_cents: number; purchase_cost_cents: number; central_stock: number };
export type Complementary = { id: string; name: string; unit_type: "PIECE" | "METER" | "M2"; purchase_unit_price_cents: number; sale_unit_price_cents: number };
export type Bootstrap = { profiles: Profile[]; connectors: Connector[]; complementaryProducts: Complementary[]; settings: Record<string, string> };
