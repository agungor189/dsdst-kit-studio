import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { mapPanelConnector } from "./compatibilityMapper.js";

export type PanelConnector = {
  id: string; sku: string; name_tr?: string; name_en?: string; title?: string;
  supplier_code?: string; material?: string; form?: string; form_code?: string;
  tube_type_code?: string; size_code?: string; size?: string; pipe_size?: string;
  normalized_material?: string; normalized_size?: string; normalized_tube_type?: string; normalized_pipe_size?: string;
  model?: string;
  image?: string; purchase_cost?: number; sale_price?: number; central_stock?: number; weight_grams?: number; weight?: number; updated_at?: string;
};

export type PanelProfile = { id: string; name: string; shape?: string; dimension?: string; material?: string; thickness?: string; effective_price_per_meter?: number; price_per_meter?: number; weight_per_meter?: number; stock_length_mm?: number; updated_at?: string };
export type PanelComplement = { id: string; name: string; category?: string; description?: string; supplier_reference?: string; unit?: string; purchase_price?: number; unit_weight_kg?: number; weight_per_unit_grams?: number; image?: string; notes?: string; updated_at?: string };
export type SyncResult = { synced: number; profilesSynced: number; complementsSynced: number; compatible: number; unresolved: number; lastSyncedAt: string };

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
    profileCount: Number(values.panel_profile_count || 0), complementCount: Number(values.panel_complement_count || 0),
  };
}

function profileSpec(row: PanelProfile) {
  const source = `${row.dimension || ""}`.replace(/,/g, ".");
  const numbers = [...source.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  const shapeText = String(row.shape || "").toLocaleLowerCase("tr");
  const round = /round|yuvarlak|daire|boru/.test(shapeText);
  const shape = round ? "ROUND" : numbers.length > 1 && numbers[0] !== numbers[1] ? "RECTANGULAR" : "SQUARE";
  const dimension = numbers[0] || 1;
  const width = round ? null : dimension;
  const height = round ? null : (numbers[1] || dimension);
  const diameter = round ? dimension : null;
  const compatibilityGroup = round ? `RD-${diameter}` : `SQ-${width}X${height}`;
  return { shape, width, height, diameter, compatibilityGroup };
}

async function catalog<T>(baseUrl: string, apiKey: string, path: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${baseUrl}/api/kit-catalog/${path}`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Panel ${path} sync failed with ${response.status}`);
  const payload = await response.json() as { success: boolean; data: T[] };
  if (!payload.success || !Array.isArray(payload.data)) throw new Error(`Panel ${path} response is invalid`);
  return payload.data;
}

export async function syncPanelConnectors(db: Database.Database, fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  setting(db, "panel_last_attempt_at", new Date().toISOString());
  try {
    const { baseUrl, apiKey } = config();
    const [connectors, profiles, complements] = await Promise.all([
      catalog<PanelConnector>(baseUrl, apiKey, "connectors", fetchImpl),
      catalog<PanelProfile>(baseUrl, apiKey, "profiles", fetchImpl),
      catalog<PanelComplement>(baseUrl, apiKey, "complementary-products", fetchImpl),
    ]);

    const upsertCache = db.prepare(`INSERT INTO panel_connector_cache
      (product_id,sku,name_tr,name_en,supplier_code,material,form,form_code,tube_type_code,size_code,size,pipe_size,
       normalized_material,normalized_size,normalized_tube_type,normalized_pipe_size,image,purchase_cost_cents,sale_price_cents,
       central_stock,unit_weight_grams,panel_updated_at,synced_at,compatibility_status,compatibility_source,compatibility_note,catalog_active,model)
      VALUES (@id,@sku,@name_tr,@name_en,@supplier_code,@material,@form,@form_code,@tube_type_code,@size_code,@size,@pipe_size,
       @normalized_material,@normalized_size,@normalized_tube_type,@normalized_pipe_size,@image,@purchase_cost_cents,@sale_price_cents,
       @central_stock,@unit_weight_grams,@updated_at,CURRENT_TIMESTAMP,@compatibility_status,@compatibility_source,@compatibility_note,1,@model)
      ON CONFLICT(product_id) DO UPDATE SET sku=excluded.sku,name_tr=excluded.name_tr,name_en=excluded.name_en,
       supplier_code=excluded.supplier_code,material=excluded.material,form=excluded.form,form_code=excluded.form_code,
       tube_type_code=excluded.tube_type_code,size_code=excluded.size_code,size=excluded.size,pipe_size=excluded.pipe_size,
       normalized_material=excluded.normalized_material,normalized_size=excluded.normalized_size,
       normalized_tube_type=excluded.normalized_tube_type,normalized_pipe_size=excluded.normalized_pipe_size,image=excluded.image,
       purchase_cost_cents=excluded.purchase_cost_cents,sale_price_cents=excluded.sale_price_cents,central_stock=excluded.central_stock,unit_weight_grams=excluded.unit_weight_grams,
       panel_updated_at=excluded.panel_updated_at,synced_at=CURRENT_TIMESTAMP,compatibility_status=excluded.compatibility_status,
       compatibility_source=excluded.compatibility_source,compatibility_note=excluded.compatibility_note,catalog_active=1,model=excluded.model`);
    const removeAuto = db.prepare("DELETE FROM connector_compatibility WHERE product_id=?");
    const ensureRole = db.prepare("INSERT OR IGNORE INTO connector_roles (code,name) VALUES (?,?)");
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
        const mapped = mapPanelConnector(row);
        if (mapped.status === "COMPATIBLE") compatible++; else unresolved++;
        upsertCache.run({
          id: row.id, sku: row.sku, name_tr: row.name_tr || row.title || row.sku, name_en: row.name_en || null,
          supplier_code: row.supplier_code || null, material: row.material || null, form: row.form || row.form_code || null,
          form_code: row.form_code || row.form || null, tube_type_code: row.tube_type_code || null, size_code: row.size_code || null,
          size: row.size || null, pipe_size: row.pipe_size || null, normalized_material: row.normalized_material || null,
          normalized_size: row.normalized_size || null, normalized_tube_type: row.normalized_tube_type || null,
          normalized_pipe_size: row.normalized_pipe_size || null, image: row.image || null,
          model: row.model || null,
          purchase_cost_cents: Math.round(Number(row.purchase_cost || 0) * 100), sale_price_cents: Math.round(Number(row.sale_price || 0) * 100),
          central_stock: Math.trunc(Number(row.central_stock || 0)), unit_weight_grams: Number(row.weight_grams || row.weight || 0) || null, updated_at: row.updated_at || null,
          compatibility_status: mapped.status, compatibility_source: mapped.source, compatibility_note: mapped.note,
        });
        if (mapped.status === "UNRESOLVED") { removeAuto.run(row.id); continue; }
        ensureRole.run(mapped.connector_role, mapped.connector_role);
        upsertCompatibility.run({
          id: crypto.randomUUID(), product_id: row.id, connector_role: mapped.connector_role, profile_shape: mapped.profile_shape,
          profile_width_mm: mapped.profile_width_mm ?? null, profile_height_mm: mapped.profile_height_mm ?? null,
          outside_diameter_mm: mapped.outside_diameter_mm ?? null, nominal_size: mapped.nominal_size ?? null,
          compatible_material_group: mapped.compatible_material_group ?? null, compatibility_group: mapped.compatibility_group,
          mapping_source: mapped.source,
        });
      }
      db.prepare("UPDATE profiles SET catalog_active=0 WHERE catalog_source='PANEL'").run();
      const upsertSpec = db.prepare(`INSERT INTO profile_specs (id,shape,material,width_mm,height_mm,outside_diameter_mm,nominal_size,wall_thickness_mm,compatibility_group,size_compatibility_group)
        VALUES (@id,@shape,@material,@width,@height,@diameter,@nominal,@wall,@key,@group)
        ON CONFLICT(id) DO UPDATE SET shape=excluded.shape,material=excluded.material,width_mm=excluded.width_mm,height_mm=excluded.height_mm,outside_diameter_mm=excluded.outside_diameter_mm,nominal_size=excluded.nominal_size,wall_thickness_mm=excluded.wall_thickness_mm,size_compatibility_group=excluded.size_compatibility_group`);
      const upsertProfile = db.prepare(`INSERT INTO profiles (id,spec_id,name,raw_length_mm,weight_per_meter_kg,purchase_price_per_meter_cents,sale_price_per_meter_cents,markup_basis_points,image_path,active,catalog_source,panel_updated_at,catalog_active)
        VALUES (@id,@spec_id,@name,@raw_length,@weight,@price,@price,0,NULL,1,'PANEL',@updated_at,1)
        ON CONFLICT(id) DO UPDATE SET spec_id=excluded.spec_id,name=excluded.name,raw_length_mm=excluded.raw_length_mm,weight_per_meter_kg=excluded.weight_per_meter_kg,purchase_price_per_meter_cents=excluded.purchase_price_per_meter_cents,sale_price_per_meter_cents=ROUND(excluded.purchase_price_per_meter_cents*(10000+profiles.markup_basis_points)/10000.0),active=1,catalog_source='PANEL',panel_updated_at=excluded.panel_updated_at,catalog_active=1,updated_at=CURRENT_TIMESTAMP`);
      for (const row of profiles) {
        const spec = profileSpec(row);
        const specId = `panel-spec-${row.id}`;
        upsertSpec.run({ id: specId, shape: spec.shape, material: row.material || "UNKNOWN", width: spec.width, height: spec.height, diameter: spec.diameter, nominal: row.dimension || null, wall: Number.parseFloat(String(row.thickness || "0")) || 0, key: `${spec.compatibilityGroup}|${specId}`, group: spec.compatibilityGroup });
        upsertProfile.run({ id: row.id, spec_id: specId, name: row.name, raw_length: Math.round(Number(row.stock_length_mm || 6000)), weight: Number(row.weight_per_meter || 0), price: Math.round(Number(row.effective_price_per_meter ?? row.price_per_meter ?? 0) * 100), updated_at: row.updated_at || null });
      }
      db.prepare("UPDATE complementary_products SET catalog_active=0 WHERE catalog_source='PANEL'").run();
      const upsertComplement = db.prepare(`INSERT INTO complementary_products (id,name,sku_optional,description,unit_type,purchase_unit_price_cents,sale_unit_price_cents,markup_basis_points,weight_per_unit_grams,image_path,notes,active,catalog_source,panel_updated_at,catalog_active)
        VALUES (@id,@name,@sku,@description,@unit,@price,@price,0,@weight,@image,@notes,1,'PANEL',@updated_at,1)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,sku_optional=excluded.sku_optional,description=excluded.description,unit_type=excluded.unit_type,purchase_unit_price_cents=excluded.purchase_unit_price_cents,sale_unit_price_cents=ROUND(excluded.purchase_unit_price_cents*(10000+complementary_products.markup_basis_points)/10000.0),weight_per_unit_grams=COALESCE(excluded.weight_per_unit_grams,complementary_products.weight_per_unit_grams),image_path=COALESCE(complementary_products.image_path,excluded.image_path),notes=excluded.notes,active=1,catalog_source='PANEL',panel_updated_at=excluded.panel_updated_at,catalog_active=1,updated_at=CURRENT_TIMESTAMP`);
      for (const row of complements) {
        const unitText = String(row.unit || "adet").toLocaleLowerCase("tr");
        const unit = unitText.includes("m²") || unitText.includes("m2") ? "M2" : unitText.includes("metre") || unitText === "m" ? "METER" : "PIECE";
        upsertComplement.run({ id: row.id, name: row.name, sku: row.supplier_reference || null, description: row.description || row.category || null, unit, price: Math.round(Number(row.purchase_price || 0) * 100), weight: Number(row.weight_per_unit_grams || 0) || (Number(row.unit_weight_kg || 0) * 1000) || null, image: row.image || null, notes: row.notes || null, updated_at: row.updated_at || null });
      }
      setting(db, "panel_profile_count", String(profiles.length)); setting(db, "panel_complement_count", String(complements.length));
      setting(db, "panel_reachable", "true"); setting(db, "panel_last_synced_at", syncedAt); setting(db, "panel_last_error", "");
    })(connectors);
    return { synced: connectors.length, profilesSynced: profiles.length, complementsSynced: complements.length, compatible, unresolved, lastSyncedAt: syncedAt };
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
