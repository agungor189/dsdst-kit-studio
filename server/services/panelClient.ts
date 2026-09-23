import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { mapPanelConnector } from "./compatibilityMapper.js";

export type PanelCatalogProduct = {
  id: string;
  sku: string;
  name_tr?: string;
  name_en?: string;
  title?: string;
  catalog_type:
    "product" | "profile" | "connector" | "cap" | "wheel" | "complementary";
  catalog_version: number;
  catalog_version_ref: string;
  uom_registry_version: string;
  base_uom: {
    code:
      "piece" | "meter" | "square_meter" | "kg" | "roll" | "package" | "box";
    base_quantum: string;
    quantity_scale: number;
  };
  dimensions: {
    length_mm: number | null;
    width_mm: number | null;
    height_mm: number | null;
    diameter_mm: number | null;
  };
  mass_grams: number | null;
  material_behavior?: "continuous_cut" | null;
  profile?: null | {
    material: string;
    form: string;
    width_mm: string | null;
    height_mm: string | null;
    diameter_mm: string | null;
    wall_thickness_mm: string;
    width_micrometers: number | null;
    height_micrometers: number | null;
    diameter_micrometers: number | null;
    wall_thickness_micrometers: number;
    standard_purchase_lengths_mm: number[];
    custom_length_allowed: boolean;
  };
  supplier_code?: string;
  material?: string;
  form?: string;
  form_code?: string;
  tube_type_code?: string;
  size_code?: string;
  size?: string;
  pipe_size?: string;
  normalized_material?: string;
  normalized_size?: string;
  normalized_tube_type?: string;
  normalized_pipe_size?: string;
  model?: string;
  image?: string;
  updated_at?: string;
};

export type KitPublicationProposal = {
  workspaceKitId: string;
  workspaceVersionId: string;
  publishedKitId: string | null;
  sku: string;
  title: string;
  description?: string | null;
  components: Array<{
    productId: string;
    catalogVersionRef: string;
    quantityBaseInt: number;
    role: string;
  }>;
  profileCutPlan?: null | {
    profileProductId: string;
    catalogVersionRef: string;
    cuts: Array<{ quantity: number; lengthMm: number; label?: string | null }>;
  };
  packagingPlan: {
    packageCount: number;
    instructionVersion: string;
    installationGuideVersion: string;
    packages: Array<{
      packageNumber: number;
      dimensionsMm?: {
        length?: number | null;
        width?: number | null;
        height?: number | null;
      };
      targetWeightGrams?: number | null;
      items: Array<{ productId: string; quantityBaseInt: number }>;
    }>;
  };
  finalSalePriceMinor: number;
  currency: "TRY";
  authoredContentHash: string;
};

export type PanelConnector = PanelCatalogProduct;
export type SyncResult = {
  synced: number;
  profilesSynced: number;
  complementsSynced: number;
  compatible: number;
  unresolved: number;
  lastSyncedAt: string;
};

function config() {
  const baseUrl = process.env.PANEL_API_URL?.replace(/\/$/, "");
  const apiKey = process.env.PANEL_API_KEY;
  if (!baseUrl || !apiKey)
    throw new Error(
      "PANEL_API_URL and PANEL_API_KEY are required for catalog sync",
    );
  return { baseUrl, apiKey };
}

async function publicationRequest<T>(
  path: string,
  panelJwt: string,
  body: unknown,
  operationId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const { baseUrl, apiKey } = config();
  if (!panelJwt) throw new Error("PANEL_USER_SESSION_REQUIRED");
  const response = await fetchImpl(
    `${baseUrl}/api/kit-publications/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        authorization: `Bearer ${panelJwt}`,
        ...(operationId ? { "x-operation-id": operationId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as any;
  if (!response.ok || payload?.success === false) {
    const error = new Error(
      payload?.error?.message ||
        `Panel kit publication failed (${response.status})`,
    ) as Error & { status?: number; code?: string; detail?: unknown };
    error.status = response.status;
    error.code = payload?.error?.code || "PANEL_PUBLICATION_FAILED";
    error.detail = payload;
    throw error;
  }
  return payload.data as T;
}

export function previewKitPublication(
  proposal: KitPublicationProposal,
  panelJwt: string,
  fetchImpl: typeof fetch = fetch,
) {
  return publicationRequest<any>(
    "preview",
    panelJwt,
    proposal,
    undefined,
    fetchImpl,
  );
}

export function publishKitPublication(
  input: {
    proposal: KitPublicationProposal;
    approvedContentHash: string;
    approvedPolicyHash: string;
  },
  panelJwt: string,
  operationId: string,
  fetchImpl: typeof fetch = fetch,
) {
  return publicationRequest<any>(
    "publish",
    panelJwt,
    input,
    operationId,
    fetchImpl,
  );
}

export async function getKitPublicationPolicy(
  panelJwt: string,
  fetchImpl: typeof fetch = fetch,
) {
  const { baseUrl, apiKey } = config();
  const response = await fetchImpl(
    `${baseUrl}/api/kit-publications/v1/policy`,
    {
      headers: { "x-api-key": apiKey, authorization: `Bearer ${panelJwt}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as any;
  if (!response.ok || payload?.success === false)
    throw new Error(
      payload?.error?.message ||
        `Panel publication policy failed (${response.status})`,
    );
  return payload.data as {
    kerf_mm: number;
    formula_version: string;
    updated_at: string;
  };
}

function setting(db: Database.Database, key: string, value: string) {
  db.prepare(
    "INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, value);
}

export function getPanelSyncStats(db: Database.Database) {
  const values = Object.fromEntries(
    (
      db
        .prepare("SELECT key,value FROM app_settings WHERE key LIKE 'panel_%'")
        .all() as { key: string; value: string }[]
    ).map((row) => [row.key, row.value]),
  );
  const counts = db
    .prepare(
      `SELECT COUNT(*) connectorCount,
    SUM(CASE WHEN compatibility_status='COMPATIBLE' THEN 1 ELSE 0 END) compatibleCount,
    SUM(CASE WHEN compatibility_status='UNRESOLVED' THEN 1 ELSE 0 END) unresolvedCount
    FROM panel_connector_cache WHERE catalog_active=1`,
    )
    .get() as any;
  return {
    lastSyncedAt: values.panel_last_synced_at || null,
    lastAttemptAt: values.panel_last_attempt_at || null,
    panelReachable: values.panel_reachable === "true",
    lastError: values.panel_last_error || null,
    connectorCount: Number(counts.connectorCount || 0),
    compatibleCount: Number(counts.compatibleCount || 0),
    unresolvedCount: Number(counts.unresolvedCount || 0),
    profileCount: Number(values.panel_profile_count || 0),
    complementCount: Number(values.panel_complement_count || 0),
  };
}

async function catalog<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  fetchImpl: typeof fetch,
) {
  const response = await fetchImpl(`${baseUrl}/api/catalog/v1/${path}`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Panel ${path} sync failed with ${response.status}`);
  const payload = (await response.json()) as { success: boolean; data: T[] };
  if (!payload.success || !Array.isArray(payload.data))
    throw new Error(`Panel ${path} response is invalid`);
  return payload.data;
}

export async function syncPanelConnectors(
  db: Database.Database,
  fetchImpl: typeof fetch = fetch,
): Promise<SyncResult> {
  setting(db, "panel_last_attempt_at", new Date().toISOString());
  try {
    const { baseUrl, apiKey } = config();
    const products = await catalog<PanelCatalogProduct>(
      baseUrl,
      apiKey,
      "products",
      fetchImpl,
    );
    const connectors = products.filter(
      (row) => row.catalog_type === "connector",
    );
    const profiles = products.filter((row) => row.catalog_type === "profile");
    const complements = products.filter(
      (row) =>
        row.catalog_type === "complementary" ||
        row.catalog_type === "cap" ||
        row.catalog_type === "wheel",
    );

    const upsertCache = db.prepare(`INSERT INTO panel_connector_cache
      (product_id,sku,name_tr,name_en,supplier_code,material,form,form_code,tube_type_code,size_code,size,pipe_size,
       normalized_material,normalized_size,normalized_tube_type,normalized_pipe_size,image,purchase_cost_cents,sale_price_cents,
       central_stock,unit_weight_grams,panel_updated_at,synced_at,compatibility_status,compatibility_source,compatibility_note,catalog_active,model,
       catalog_version_ref,uom_registry_version,base_uom_code,cost_status,sale_price_status)
      VALUES (@id,@sku,@name_tr,@name_en,@supplier_code,@material,@form,@form_code,@tube_type_code,@size_code,@size,@pipe_size,
       @normalized_material,@normalized_size,@normalized_tube_type,@normalized_pipe_size,@image,@purchase_cost_cents,@sale_price_cents,
       0,@unit_weight_grams,@updated_at,CURRENT_TIMESTAMP,@compatibility_status,@compatibility_source,@compatibility_note,1,@model,
       @catalog_version_ref,@uom_registry_version,@base_uom_code,'UNKNOWN','UNKNOWN')
      ON CONFLICT(product_id) DO UPDATE SET sku=excluded.sku,name_tr=excluded.name_tr,name_en=excluded.name_en,
       supplier_code=excluded.supplier_code,material=excluded.material,form=excluded.form,form_code=excluded.form_code,
       tube_type_code=excluded.tube_type_code,size_code=excluded.size_code,size=excluded.size,pipe_size=excluded.pipe_size,
       normalized_material=excluded.normalized_material,normalized_size=excluded.normalized_size,
       normalized_tube_type=excluded.normalized_tube_type,normalized_pipe_size=excluded.normalized_pipe_size,image=excluded.image,
       unit_weight_grams=excluded.unit_weight_grams,
       panel_updated_at=excluded.panel_updated_at,synced_at=CURRENT_TIMESTAMP,compatibility_status=excluded.compatibility_status,
       compatibility_source=excluded.compatibility_source,compatibility_note=excluded.compatibility_note,catalog_active=1,model=excluded.model,
       catalog_version_ref=excluded.catalog_version_ref,uom_registry_version=excluded.uom_registry_version,base_uom_code=excluded.base_uom_code,
       cost_status='UNKNOWN',sale_price_status='UNKNOWN'`);
    const removeAuto = db.prepare(
      "DELETE FROM connector_compatibility WHERE product_id=?",
    );
    const ensureRole = db.prepare(
      "INSERT OR IGNORE INTO connector_roles (code,name) VALUES (?,?)",
    );
    const upsertCompatibility = db.prepare(`INSERT INTO connector_compatibility
      (id,product_id,connector_role,profile_shape,profile_width_mm,profile_height_mm,outside_diameter_mm,nominal_size,
       compatible_material_group,compatibility_group,mapping_source)
      VALUES (@id,@product_id,@connector_role,@profile_shape,@profile_width_mm,@profile_height_mm,@outside_diameter_mm,@nominal_size,
       @compatible_material_group,@compatibility_group,@mapping_source)
      ON CONFLICT(product_id) DO UPDATE SET connector_role=excluded.connector_role,profile_shape=excluded.profile_shape,
       profile_width_mm=excluded.profile_width_mm,profile_height_mm=excluded.profile_height_mm,outside_diameter_mm=excluded.outside_diameter_mm,
       nominal_size=excluded.nominal_size,compatible_material_group=excluded.compatible_material_group,
       compatibility_group=excluded.compatibility_group,mapping_source=excluded.mapping_source,active=1,updated_at=CURRENT_TIMESTAMP`);

    let compatible = 0;
    let unresolved = 0;
    const syncedAt = new Date().toISOString();
    db.transaction((rows: PanelConnector[]) => {
      db.prepare("UPDATE panel_connector_cache SET catalog_active=0").run();
      for (const row of rows) {
        const mapped = mapPanelConnector(row);
        if (mapped.status === "COMPATIBLE") compatible++;
        else unresolved++;
        upsertCache.run({
          id: row.id,
          sku: row.sku,
          name_tr: row.name_tr || row.title || row.sku,
          name_en: row.name_en || null,
          supplier_code: row.supplier_code || null,
          material: row.material || null,
          form: row.form || row.form_code || null,
          form_code: row.form_code || row.form || null,
          tube_type_code: row.tube_type_code || null,
          size_code: row.size_code || null,
          size: row.size || null,
          pipe_size: row.pipe_size || null,
          normalized_material: row.normalized_material || null,
          normalized_size: row.normalized_size || null,
          normalized_tube_type: row.normalized_tube_type || null,
          normalized_pipe_size: row.normalized_pipe_size || null,
          image: row.image || null,
          model: row.model || null,
          purchase_cost_cents: 0,
          sale_price_cents: 0,
          unit_weight_grams: row.mass_grams,
          updated_at: row.updated_at || null,
          compatibility_status: mapped.status,
          compatibility_source: mapped.source,
          compatibility_note: mapped.note,
          catalog_version_ref: row.catalog_version_ref,
          uom_registry_version: row.uom_registry_version,
          base_uom_code: row.base_uom.code,
        });
        if (mapped.status === "UNRESOLVED") {
          removeAuto.run(row.id);
          continue;
        }
        ensureRole.run(mapped.connector_role, mapped.connector_role);
        upsertCompatibility.run({
          id: crypto.randomUUID(),
          product_id: row.id,
          connector_role: mapped.connector_role,
          profile_shape: mapped.profile_shape,
          profile_width_mm: mapped.profile_width_mm ?? null,
          profile_height_mm: mapped.profile_height_mm ?? null,
          outside_diameter_mm: mapped.outside_diameter_mm ?? null,
          nominal_size: mapped.nominal_size ?? null,
          compatible_material_group: mapped.compatible_material_group ?? null,
          compatibility_group: mapped.compatibility_group,
          mapping_source: mapped.source,
        });
      }
      db.prepare(
        "UPDATE profiles SET catalog_active=0 WHERE catalog_source='PANEL'",
      ).run();
      const upsertSpec =
        db.prepare(`INSERT INTO profile_specs (id,shape,material,width_mm,height_mm,outside_diameter_mm,nominal_size,wall_thickness_mm,compatibility_group,size_compatibility_group,width_micrometers,height_micrometers,outside_diameter_micrometers,wall_thickness_micrometers)
        VALUES (@id,@shape,@material,@width,@height,@diameter,@nominal,@wall,@key,@group,@width_micrometers,@height_micrometers,@diameter_micrometers,@wall_micrometers)
        ON CONFLICT(id) DO UPDATE SET shape=excluded.shape,material=excluded.material,width_mm=excluded.width_mm,height_mm=excluded.height_mm,outside_diameter_mm=excluded.outside_diameter_mm,nominal_size=excluded.nominal_size,wall_thickness_mm=excluded.wall_thickness_mm,size_compatibility_group=excluded.size_compatibility_group,width_micrometers=excluded.width_micrometers,height_micrometers=excluded.height_micrometers,outside_diameter_micrometers=excluded.outside_diameter_micrometers,wall_thickness_micrometers=excluded.wall_thickness_micrometers`);
      const upsertProfile =
        db.prepare(`INSERT INTO profiles (id,spec_id,name,raw_length_mm,weight_per_meter_kg,purchase_price_per_meter_cents,sale_price_per_meter_cents,markup_basis_points,image_path,active,catalog_source,panel_updated_at,catalog_active,catalog_version_ref,uom_registry_version,base_uom_code,standard_purchase_lengths_mm_json,custom_length_allowed)
        VALUES (@id,@spec_id,@name,@raw_length,0,0,0,0,@image,1,'PANEL',@updated_at,1,@catalog_version_ref,@uom_registry_version,@base_uom_code,@standard_lengths,@custom_length_allowed)
        ON CONFLICT(id) DO UPDATE SET spec_id=excluded.spec_id,name=excluded.name,raw_length_mm=excluded.raw_length_mm,image_path=excluded.image_path,active=1,catalog_source='PANEL',panel_updated_at=excluded.panel_updated_at,catalog_active=1,catalog_version_ref=excluded.catalog_version_ref,uom_registry_version=excluded.uom_registry_version,base_uom_code=excluded.base_uom_code,standard_purchase_lengths_mm_json=excluded.standard_purchase_lengths_mm_json,custom_length_allowed=excluded.custom_length_allowed,cost_status='UNKNOWN',sale_price_status='UNKNOWN',updated_at=CURRENT_TIMESTAMP`);
      for (const row of profiles) {
        if (!row.profile || row.base_uom.code !== "meter")
          throw new Error(
            `Panel profile ${row.id} has an invalid catalog/UOM contract`,
          );
        const shape =
          row.profile.form === "round"
            ? "ROUND"
            : row.profile.form === "rectangular"
              ? "RECTANGULAR"
              : "SQUARE";
        const width = row.profile.width_mm;
        const height = row.profile.height_mm;
        const diameter = row.profile.diameter_mm;
        const compatibilityGroup =
          shape === "ROUND" ? `RD-${diameter}` : `SQ-${width}X${height}`;
        const specId = `panel-spec-${row.id}`;
        upsertSpec.run({
          id: specId,
          shape,
          material: row.profile.material,
          width: width == null ? null : Number(width),
          height: height == null ? null : Number(height),
          diameter: diameter == null ? null : Number(diameter),
          nominal: null,
          wall: Number(row.profile.wall_thickness_mm),
          key: `${compatibilityGroup}|${specId}`,
          group: compatibilityGroup,
          width_micrometers: row.profile.width_micrometers,
          height_micrometers: row.profile.height_micrometers,
          diameter_micrometers: row.profile.diameter_micrometers,
          wall_micrometers: row.profile.wall_thickness_micrometers,
        });
        const rawLength = row.profile.standard_purchase_lengths_mm.includes(
          6000,
        )
          ? 6000
          : Math.max(...row.profile.standard_purchase_lengths_mm);
        upsertProfile.run({
          id: row.id,
          spec_id: specId,
          name: row.title,
          raw_length: rawLength,
          image: row.image || null,
          updated_at: row.updated_at || null,
          catalog_version_ref: row.catalog_version_ref,
          uom_registry_version: row.uom_registry_version,
          base_uom_code: row.base_uom.code,
          standard_lengths: JSON.stringify(
            row.profile.standard_purchase_lengths_mm,
          ),
          custom_length_allowed: row.profile.custom_length_allowed ? 1 : 0,
        });
      }
      db.prepare(
        "UPDATE complementary_products SET catalog_active=0 WHERE catalog_source='PANEL'",
      ).run();
      const upsertComplement =
        db.prepare(`INSERT INTO complementary_products (id,name,sku_optional,description,legacy_unit_type,unit_type,purchase_unit_price_cents,sale_unit_price_cents,markup_basis_points,weight_per_unit_grams,image_path,notes,active,catalog_source,panel_updated_at,catalog_active,catalog_version_ref,uom_registry_version,base_uom_code,material_behavior)
        VALUES (@id,@name,@sku,NULL,@legacy_unit,@unit,0,0,0,@weight,@image,NULL,1,'PANEL',@updated_at,1,@catalog_version_ref,@uom_registry_version,@base_uom_code,@material_behavior)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,sku_optional=excluded.sku_optional,unit_type=excluded.unit_type,weight_per_unit_grams=COALESCE(excluded.weight_per_unit_grams,complementary_products.weight_per_unit_grams),image_path=excluded.image_path,active=1,catalog_source='PANEL',panel_updated_at=excluded.panel_updated_at,catalog_active=1,catalog_version_ref=excluded.catalog_version_ref,uom_registry_version=excluded.uom_registry_version,base_uom_code=excluded.base_uom_code,material_behavior=excluded.material_behavior,cost_status='UNKNOWN',sale_price_status='UNKNOWN',updated_at=CURRENT_TIMESTAMP`);
      for (const row of complements) {
        const legacyUnit =
          row.base_uom.code === "meter"
            ? "METER"
            : row.base_uom.code === "square_meter"
              ? "M2"
              : "PIECE";
        upsertComplement.run({
          id: row.id,
          name: row.title,
          sku: row.sku,
          legacy_unit: legacyUnit,
          unit: row.base_uom.code,
          weight: row.mass_grams,
          image: row.image || null,
          updated_at: row.updated_at || null,
          catalog_version_ref: row.catalog_version_ref,
          uom_registry_version: row.uom_registry_version,
          base_uom_code: row.base_uom.code,
          material_behavior: row.material_behavior || null,
        });
      }
      setting(db, "panel_profile_count", String(profiles.length));
      setting(db, "panel_complement_count", String(complements.length));
      setting(db, "panel_reachable", "true");
      setting(db, "panel_last_synced_at", syncedAt);
      setting(db, "panel_last_error", "");
    })(connectors);
    return {
      synced: connectors.length,
      profilesSynced: profiles.length,
      complementsSynced: complements.length,
      compatible,
      unresolved,
      lastSyncedAt: syncedAt,
    };
  } catch (error) {
    setting(db, "panel_reachable", "false");
    setting(
      db,
      "panel_last_error",
      error instanceof Error
        ? error.message.slice(0, 300)
        : "Panel bağlantısı başarısız",
    );
    throw error;
  }
}

export async function fetchPanelProductImage(
  productId: string,
  imagePath: string,
  fetchImpl: typeof fetch = fetch,
) {
  const { baseUrl, apiKey } = config();
  const target = new URL(imagePath, `${baseUrl}/`);
  if (target.origin !== new URL(baseUrl).origin)
    throw new Error("Unsafe Panel image URL");
  const response = await fetchImpl(target, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`Panel image ${productId} failed with ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!type.startsWith("image/"))
    throw new Error("Panel image response is not an image");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 8 * 1024 * 1024)
    throw new Error("Panel image is too large");
  return { buffer, type };
}
