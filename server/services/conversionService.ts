import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { resolveConnector } from "./compatibility.js";
import { calculatePricing } from "./pricing.js";
import { variantDetail } from "./variantService.js";

function targetProfile(db: Database.Database, profileId: string) {
  return db.prepare(`SELECT p.*,ps.shape,ps.material,ps.width_mm,ps.height_mm,ps.outside_diameter_mm,ps.nominal_size,
    ps.wall_thickness_mm,COALESCE(ps.size_compatibility_group,ps.compatibility_group) compatibility_group
    FROM profiles p JOIN profile_specs ps ON ps.id=p.spec_id
    WHERE p.id=? AND p.active=1 AND p.catalog_source='PANEL' AND p.catalog_active=1 AND p.catalog_version_ref IS NOT NULL`).get(profileId) as any;
}

function summary(pricing: any) {
  return {
    product_cost_cents: pricing.component_cost_cents, extra_cost_cents: pricing.extra_cost_cents, total_cost_cents: pricing.total_cost_cents,
    sale_price_cents: pricing.total_inc_vat_cents, subtotal_ex_vat_cents: pricing.subtotal_ex_vat_cents, vat_cents: pricing.vat_cents,
    profit_cents: pricing.profit_cents, margin_percent: pricing.margin_percent,
    total_weight_grams: pricing.total_weight_grams, weight_complete: pricing.weight_complete,
  };
}

export function previewVariantConversion(db: Database.Database, sourceVariantId: string, targetProfileId: string) {
  const source = variantDetail(db, sourceVariantId);
  const profile = targetProfile(db, targetProfileId);
  if (!source || !profile) return null;
  if (source.cuts.some((cut: any) => Number(cut.length_mm) > Number(profile.raw_length_mm))) return null;
  const mapped = source.connectors.map((line: any) => ({
    role: line.connector_role, quantity: line.quantity,
    connector: resolveConnector(db, line.connector_role, targetProfileId) as any,
  }));
  const missingRoles = mapped.filter((line: any) => !line.connector).map((line: any) => line.role);
  const resolvedCount = mapped.length - missingRoles.length;
  const connectors = mapped.filter((line: any) => line.connector).map((line: any) => ({
    quantity: line.quantity,
    purchase_price_snapshot_cents: line.connector.purchase_cost_cents,
    sale_price_snapshot_cents: line.connector.sale_price_cents,
    unit_weight_snapshot_grams: line.connector.unit_weight_grams,
    product_id: line.connector.product_id, sku_snapshot: line.connector.sku, product_name_snapshot: line.connector.name_tr,
  }));
  const pricing = calculatePricing({
    connectors,
    profile: {
      purchase_price_snapshot_cents: profile.purchase_price_per_meter_cents,
      sale_price_snapshot_cents: profile.sale_price_per_meter_cents,
      markup_basis_points_snapshot: profile.markup_basis_points,
      weight_per_meter_snapshot_kg: profile.weight_per_meter_kg,
      raw_length_mm: profile.raw_length_mm, profile_id: profile.id, current_name: profile.name,
    },
    cuts: source.cuts,
    complementary: source.complementary_items,
    vatRateBasisPoints: Number((db.prepare("SELECT value FROM app_settings WHERE key='vat_rate_basis_points'").get() as any)?.value || 2000),
    laborCostCents: Number(source.labor_cost_cents || 0), packagingCostCents: Number(source.packaging_cost_cents || 0), otherCostCents: Number(source.other_cost_cents || 0),
  });
  const status = missingRoles.length === 0 ? "FULL" : resolvedCount > 0 ? "PARTIAL" : "INCOMPATIBLE";
  return {
    status, missing_roles: missingRoles,
    source: { id: source.id, profile_id: source.profile_id, configuration: source.configuration, pricing: source.pricing, summary: source.summary },
    target: {
      profile: { id: profile.id, name: profile.name, shape: profile.shape, material: profile.material, compatibility_group: profile.compatibility_group, wall_thickness_mm: profile.wall_thickness_mm, nominal_size: profile.nominal_size, width_mm: profile.width_mm, height_mm: profile.height_mm, outside_diameter_mm: profile.outside_diameter_mm },
      connectors: mapped.map((line: any) => ({ role: line.role, quantity: line.quantity, product_id: line.connector?.product_id || null, sku: line.connector?.sku || null })),
      pricing, summary: summary(pricing),
    },
  };
}

export function conversionOptions(db: Database.Database, sourceVariantId: string, mode: "connector" | "profile") {
  const source = variantDetail(db, sourceVariantId);
  if (!source) return null;
  const profiles = db.prepare(`SELECT p.id,COALESCE(ps.size_compatibility_group,ps.compatibility_group) compatibility_group
    FROM profiles p JOIN profile_specs ps ON ps.id=p.spec_id
    WHERE p.active=1 AND p.catalog_source='PANEL' AND p.catalog_active=1 AND p.catalog_version_ref IS NOT NULL AND p.id!=? ORDER BY ps.shape,ps.outside_diameter_mm,ps.width_mm,ps.wall_thickness_mm`).all(source.profile_id) as any[];
  return profiles
    .filter((profile) => mode === "profile" ? profile.compatibility_group === source.compatibility_group : profile.compatibility_group !== source.compatibility_group)
    .map((profile) => previewVariantConversion(db, sourceVariantId, profile.id))
    .filter((preview): preview is NonNullable<typeof preview> => Boolean(preview))
    .filter((preview) => preview.status !== "INCOMPATIBLE");
}

export function deriveKit(db: Database.Database, sourceVariantId: string, targetProfileId: string, input: { name: string; sku?: string | null }) {
  const source = variantDetail(db, sourceVariantId);
  const profile = targetProfile(db, targetProfileId);
  const preview = previewVariantConversion(db, sourceVariantId, targetProfileId);
  if (!source || !profile || !preview) return { error: "NOT_FOUND" as const };
  if (preview.status !== "FULL") return { error: "INCOMPLETE_CONVERSION" as const, missing: preview.missing_roles };
  const kitId = crypto.randomUUID(); const variantId = crypto.randomUUID();
  db.transaction(() => {
    db.prepare(`INSERT INTO kits (id,name,sku,description,status,sale_price_cents,labor_cost_cents,packaging_cost_cents,other_cost_cents,derived_from_kit_id)
      SELECT ?,?,?,description,'DRAFT',sale_price_cents,labor_cost_cents,packaging_cost_cents,other_cost_cents,id FROM kits WHERE id=?`)
      .run(kitId, input.name, input.sku || null, source.kit_id);
    db.prepare("INSERT INTO kit_variants (id,kit_id,name,profile_id,status) VALUES (?,?,?,?, 'DRAFT')").run(variantId, kitId, profile.name, profile.id);
    const insertConnector = db.prepare(`INSERT INTO kit_variant_connectors (id,variant_id,connector_role,product_id,quantity,purchase_price_snapshot_cents,sale_price_snapshot_cents,unit_weight_snapshot_grams,product_name_snapshot,sku_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const line of preview.target.connectors) {
      const connector = resolveConnector(db, line.role, profile.id) as any;
      insertConnector.run(crypto.randomUUID(), variantId, line.role, connector.product_id, line.quantity, connector.purchase_cost_cents, connector.sale_price_cents, connector.unit_weight_grams, connector.name_tr, connector.sku);
    }
    const profileLineId = crypto.randomUUID();
    db.prepare("INSERT INTO kit_variant_profiles (id,variant_id,profile_id,purchase_price_snapshot_cents,sale_price_snapshot_cents,markup_basis_points_snapshot,weight_per_meter_snapshot_kg) VALUES (?,?,?,?,?,?,?)")
      .run(profileLineId, variantId, profile.id, profile.purchase_price_per_meter_cents, profile.sale_price_per_meter_cents, profile.markup_basis_points, profile.weight_per_meter_kg);
    const insertCut = db.prepare("INSERT INTO kit_variant_profile_cuts (id,variant_profile_id,quantity,length_mm,label) VALUES (?,?,?,?,?)");
    for (const cut of source.cuts) insertCut.run(crypto.randomUUID(), profileLineId, cut.quantity, cut.length_mm, cut.label ?? null);
    const insertComplement = db.prepare(`INSERT INTO kit_variant_complementary_items (id,variant_id,complementary_product_id,quantity_milli,purchase_price_snapshot_cents,sale_price_snapshot_cents,markup_basis_points_snapshot,weight_per_unit_snapshot_grams,product_name_snapshot,unit_type_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const line of source.complementary_items) insertComplement.run(crypto.randomUUID(), variantId, line.complementary_product_id, line.quantity_milli, line.purchase_price_snapshot_cents, line.sale_price_snapshot_cents, line.markup_basis_points_snapshot, line.weight_per_unit_snapshot_grams, line.product_name_snapshot, line.unit_type_snapshot);
  })();
  db.prepare("UPDATE kits SET sale_price_cents=? WHERE id=?").run(preview.target.pricing.total_inc_vat_cents, kitId);
  return { kitId, variantId };
}
