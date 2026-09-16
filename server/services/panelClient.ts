import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { mapPanelConnector } from "./compatibilityMapper.js";

export type PanelConnector = {
  id: string; sku: string; name_tr?: string; name_en?: string; title?: string;
  supplier_code?: string; material?: string; form?: string; form_code?: string;
  tube_type_code?: string; size_code?: string; size?: string; pipe_size?: string;
  normalized_material?: string; normalized_size?: string; normalized_tube_type?: string; normalized_pipe_size?: string;
  image?: string; purchase_cost?: number; sale_price?: number; central_stock?: number; updated_at?: string;
};

export type SyncResult = { synced: number; compatible: number; unresolved: number; lastSyncedAt: string };

function config() {
  const baseUrl = process.env.PANEL_API_URL?.replace(/\/$/, "");
  const apiKey = process.env.PANEL_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("PANEL_API_URL and PANEL_API_KEY are required for catalog sync");
  return { baseUrl, apiKey };
}

function setting(db: Database.Database, key: string, value: string) {
  db.prepare("INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}

export function getPanelSyncStats(db: Database.Database) {
  const values = Object.fromEntries((db.prepare("SELECT key,value FROM app_settings WHERE key LIKE 'panel_%'").all() as { key: string; value: string }[]).map((row) => [row.key, row.value]));
  const counts = db.prepare(`SELECT COUNT(*) connectorCount,
    SUM(CASE WHEN compatibility_status='COMPATIBLE' THEN 1 ELSE 0 END) compatibleCount,
    SUM(CASE WHEN compatibility_status='UNRESOLVED' THEN 1 ELSE 0 END) unresolvedCount
    FROM panel_connector_cache WHERE catalog_active=1`).get() as any;
  return {
    lastSyncedAt: values.panel_last_synced_at || null,
    lastAttemptAt: values.panel_last_attempt_at || null,
    panelReachable: values.panel_reachable === "true",
    lastError: values.panel_last_error || null,
    connectorCount: Number(counts.connectorCount || 0), compatibleCount: Number(counts.compatibleCount || 0),
    unresolvedCount: Number(counts.unresolvedCount || 0),
  };
}

export async function syncPanelConnectors(db: Database.Database, fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  setting(db, "panel_last_attempt_at", new Date().toISOString());
  try {
    const { baseUrl, apiKey } = config();
    const response = await fetchImpl(`${baseUrl}/api/kit-catalog/connectors`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Panel catalog sync failed with ${response.status}`);
    const payload = await response.json() as { success: boolean; data: PanelConnector[] };
    if (!payload.success || !Array.isArray(payload.data)) throw new Error("Panel catalog response is invalid");

    const upsertCache = db.prepare(`INSERT INTO panel_connector_cache
      (product_id,sku,name_tr,name_en,supplier_code,material,form,form_code,tube_type_code,size_code,size,pipe_size,
       normalized_material,normalized_size,normalized_tube_type,normalized_pipe_size,image,purchase_cost_cents,sale_price_cents,
       central_stock,panel_updated_at,synced_at,compatibility_status,compatibility_source,compatibility_note,catalog_active)
      VALUES (@id,@sku,@name_tr,@name_en,@supplier_code,@material,@form,@form_code,@tube_type_code,@size_code,@size,@pipe_size,
       @normalized_material,@normalized_size,@normalized_tube_type,@normalized_pipe_size,@image,@purchase_cost_cents,@sale_price_cents,
       @central_stock,@updated_at,CURRENT_TIMESTAMP,@compatibility_status,@compatibility_source,@compatibility_note,1)
      ON CONFLICT(product_id) DO UPDATE SET sku=excluded.sku,name_tr=excluded.name_tr,name_en=excluded.name_en,
       supplier_code=excluded.supplier_code,material=excluded.material,form=excluded.form,form_code=excluded.form_code,
       tube_type_code=excluded.tube_type_code,size_code=excluded.size_code,size=excluded.size,pipe_size=excluded.pipe_size,
       normalized_material=excluded.normalized_material,normalized_size=excluded.normalized_size,
       normalized_tube_type=excluded.normalized_tube_type,normalized_pipe_size=excluded.normalized_pipe_size,image=excluded.image,
       purchase_cost_cents=excluded.purchase_cost_cents,sale_price_cents=excluded.sale_price_cents,central_stock=excluded.central_stock,
       panel_updated_at=excluded.panel_updated_at,synced_at=CURRENT_TIMESTAMP,compatibility_status=excluded.compatibility_status,
       compatibility_source=excluded.compatibility_source,compatibility_note=excluded.compatibility_note,catalog_active=1`);
    const existing = db.prepare("SELECT mapping_source FROM connector_compatibility WHERE product_id=?");
    const removeAuto = db.prepare("DELETE FROM connector_compatibility WHERE product_id=? AND mapping_source!='MANUAL'");
    const upsertCompatibility = db.prepare(`INSERT INTO connector_compatibility
      (id,product_id,connector_role,profile_shape,profile_width_mm,profile_height_mm,outside_diameter_mm,nominal_size,
       compatible_material_group,compatibility_group,mapping_source)
      VALUES (@id,@product_id,@connector_role,@profile_shape,@profile_width_mm,@profile_height_mm,@outside_diameter_mm,@nominal_size,
       @compatible_material_group,@compatibility_group,@mapping_source)
      ON CONFLICT(product_id) DO UPDATE SET connector_role=excluded.connector_role,profile_shape=excluded.profile_shape,
       profile_width_mm=excluded.profile_width_mm,profile_height_mm=excluded.profile_height_mm,outside_diameter_mm=excluded.outside_diameter_mm,
       nominal_size=excluded.nominal_size,compatible_material_group=excluded.compatible_material_group,
       compatibility_group=excluded.compatibility_group,mapping_source=excluded.mapping_source,active=1,updated_at=CURRENT_TIMESTAMP`);

    let compatible = 0; let unresolved = 0;
    const syncedAt = new Date().toISOString();
    db.transaction((rows: PanelConnector[]) => {
      db.prepare("UPDATE panel_connector_cache SET catalog_active=0").run();
      for (const row of rows) {
        const manual = (existing.get(row.id) as any)?.mapping_source === "MANUAL";
        const mapped = mapPanelConnector(row);
        const effective = manual ? { ...mapped, status: "COMPATIBLE" as const, source: "MANUAL", note: "Yönetici tarafından eşlendi" } : mapped;
        if (effective.status === "COMPATIBLE") compatible++; else unresolved++;
        upsertCache.run({
          id: row.id, sku: row.sku, name_tr: row.name_tr || row.title || row.sku, name_en: row.name_en || null,
          supplier_code: row.supplier_code || null, material: row.material || null, form: row.form || row.form_code || null,
          form_code: row.form_code || row.form || null, tube_type_code: row.tube_type_code || null, size_code: row.size_code || null,
          size: row.size || null, pipe_size: row.pipe_size || null, normalized_material: row.normalized_material || null,
          normalized_size: row.normalized_size || null, normalized_tube_type: row.normalized_tube_type || null,
          normalized_pipe_size: row.normalized_pipe_size || null, image: row.image || null,
          purchase_cost_cents: Math.round(Number(row.purchase_cost || 0) * 100), sale_price_cents: Math.round(Number(row.sale_price || 0) * 100),
          central_stock: Math.trunc(Number(row.central_stock || 0)), updated_at: row.updated_at || null,
          compatibility_status: effective.status, compatibility_source: effective.source, compatibility_note: effective.note,
        });
        if (manual) continue;
        if (mapped.status === "UNRESOLVED") { removeAuto.run(row.id); continue; }
        upsertCompatibility.run({
          id: crypto.randomUUID(), product_id: row.id, connector_role: mapped.connector_role, profile_shape: mapped.profile_shape,
          profile_width_mm: mapped.profile_width_mm ?? null, profile_height_mm: mapped.profile_height_mm ?? null,
          outside_diameter_mm: mapped.outside_diameter_mm ?? null, nominal_size: mapped.nominal_size ?? null,
          compatible_material_group: mapped.compatible_material_group ?? null, compatibility_group: mapped.compatibility_group,
          mapping_source: mapped.source,
        });
      }
      setting(db, "panel_reachable", "true"); setting(db, "panel_last_synced_at", syncedAt); setting(db, "panel_last_error", "");
    })(payload.data);
    return { synced: payload.data.length, compatible, unresolved, lastSyncedAt: syncedAt };
  } catch (error) {
    setting(db, "panel_reachable", "false");
    setting(db, "panel_last_error", error instanceof Error ? error.message.slice(0, 300) : "Panel bağlantısı başarısız");
    throw error;
  }
}

export async function fetchPanelProductImage(productId: string, imagePath: string, fetchImpl: typeof fetch = fetch) {
  const { baseUrl, apiKey } = config();
  const target = new URL(imagePath, `${baseUrl}/`);
  if (target.origin !== new URL(baseUrl).origin) throw new Error("Unsafe Panel image URL");
  const response = await fetchImpl(target, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Panel image ${productId} failed with ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!type.startsWith("image/")) throw new Error("Panel image response is not an image");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 8 * 1024 * 1024) throw new Error("Panel image is too large");
  return { buffer, type };
}
