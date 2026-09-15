import type Database from "better-sqlite3";

export type PanelConnector = {
  id: string; sku: string; name_tr?: string; name_en?: string; title?: string;
  supplier_code?: string; material?: string; form?: string; size?: string; image?: string;
  purchase_cost?: number; sale_price: number; central_stock?: number; updated_at?: string;
};

export async function syncPanelConnectors(db: Database.Database) {
  const baseUrl = process.env.PANEL_API_URL?.replace(/\/$/, "");
  const apiKey = process.env.PANEL_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("PANEL_API_URL and PANEL_API_KEY are required for catalog sync");
  const response = await fetch(`${baseUrl}/api/kit-catalog/connectors`, { headers: { "x-api-key": apiKey } });
  if (!response.ok) throw new Error(`Panel catalog sync failed with ${response.status}`);
  const payload = await response.json() as { success: boolean; data: PanelConnector[] };
  if (!payload.success || !Array.isArray(payload.data)) throw new Error("Panel catalog response is invalid");
  const upsert = db.prepare(`
    INSERT INTO panel_connector_cache (product_id,sku,name_tr,name_en,supplier_code,material,form,size,image,purchase_cost_cents,sale_price_cents,central_stock,panel_updated_at,synced_at)
    VALUES (@id,@sku,@name_tr,@name_en,@supplier_code,@material,@form,@size,@image,@purchase_cost_cents,@sale_price_cents,@central_stock,@updated_at,CURRENT_TIMESTAMP)
    ON CONFLICT(product_id) DO UPDATE SET sku=excluded.sku,name_tr=excluded.name_tr,name_en=excluded.name_en,
      supplier_code=excluded.supplier_code,material=excluded.material,form=excluded.form,size=excluded.size,image=excluded.image,
      purchase_cost_cents=excluded.purchase_cost_cents,sale_price_cents=excluded.sale_price_cents,central_stock=excluded.central_stock,
      panel_updated_at=excluded.panel_updated_at,synced_at=CURRENT_TIMESTAMP
  `);
  db.transaction((rows: PanelConnector[]) => rows.forEach((row) => upsert.run({
    ...row,
    name_tr: row.name_tr || row.title || row.sku,
    purchase_cost_cents: Math.round((row.purchase_cost || 0) * 100),
    sale_price_cents: Math.round(row.sale_price * 100),
    central_stock: Math.trunc(row.central_stock || 0),
  })))(payload.data);
  return payload.data.length;
}
