import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { calculatePricing } from "./pricing.js";
import { assertKnownCatalogEconomics } from "./catalogEconomics.js";

export function variantDetail(db: Database.Database, variantId: string) {
  const variant = db.prepare(`SELECT v.*,k.name kit_name,k.sku kit_sku,k.sale_price_cents,k.labor_cost_cents,k.packaging_cost_cents,k.other_cost_cents,p.name profile_name,COALESCE(ps.size_compatibility_group,ps.compatibility_group) compatibility_group,ps.shape,ps.material,ps.width_mm,ps.height_mm,ps.outside_diameter_mm,ps.nominal_size,ps.wall_thickness_mm
    FROM kit_variants v JOIN kits k ON k.id=v.kit_id LEFT JOIN profiles p ON p.id=v.profile_id
    LEFT JOIN profile_specs ps ON ps.id=p.spec_id WHERE v.id=? AND k.deleted_at IS NULL`).get(variantId) as any;
  if (!variant) return null;
  variant.missing_mappings = JSON.parse(variant.missing_mappings_json || "[]");
  variant.compatibility_warnings = JSON.parse(variant.compatibility_warnings_json || "[]");
  variant.connectors = db.prepare(`SELECT line.*,cache.image current_image,cache.central_stock current_stock,cache.name_tr current_name,cache.sku current_sku,
    cache.purchase_cost_cents current_purchase_cost_cents,cache.unit_weight_grams current_unit_weight_grams,cache.catalog_active
    FROM kit_variant_connectors line LEFT JOIN panel_connector_cache cache ON cache.product_id=line.product_id
    WHERE line.variant_id=? ORDER BY line.connector_role`).all(variantId);
  variant.profile = db.prepare(`SELECT line.*,p.name current_name,p.image_path current_image,p.purchase_price_per_meter_cents current_purchase_price_cents,p.markup_basis_points current_markup_basis_points,
    p.raw_length_mm,p.catalog_active,COALESCE(ps.size_compatibility_group,ps.compatibility_group) compatibility_group,ps.shape
    FROM kit_variant_profiles line JOIN profiles p ON p.id=line.profile_id JOIN profile_specs ps ON ps.id=p.spec_id
    WHERE line.variant_id=?`).get(variantId) as any;
  variant.cuts = variant.profile ? db.prepare("SELECT * FROM kit_variant_profile_cuts WHERE variant_profile_id=? ORDER BY length_mm DESC").all(variant.profile.id) : [];
  variant.complementary_items = db.prepare(`SELECT line.*,product.image_path current_image,product.name current_name,product.catalog_source,product.catalog_active,
    product.purchase_unit_price_cents current_purchase_price_cents,product.markup_basis_points current_markup_basis_points,product.weight_per_unit_grams current_weight_per_unit_grams
    FROM kit_variant_complementary_items line LEFT JOIN complementary_products product ON product.id=line.complementary_product_id
    WHERE line.variant_id=? ORDER BY line.product_name_snapshot`).all(variantId);
  try {
    variant.pricing = { authoritative: true, ...priceVariant(db, variant) };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("CATALOG_ECONOMICS_UNKNOWN")) throw error;
    variant.pricing = { authoritative: false, status: "UNKNOWN", error: "CATALOG_ECONOMICS_UNKNOWN" };
  }
  variant.configuration = {
    material: variant.material, shape: variant.shape, compatibility_group: variant.compatibility_group,
    wall_thickness_mm: variant.wall_thickness_mm, size: variant.nominal_size || (variant.shape === "ROUND" ? `Ø${variant.outside_diameter_mm}` : `${variant.width_mm}×${variant.height_mm}`),
  };
  variant.summary = variant.pricing.authoritative ? {
    product_cost_cents: variant.pricing.component_cost_cents,
    extra_cost_cents: variant.pricing.extra_cost_cents,
    total_cost_cents: variant.pricing.total_cost_cents,
    sale_price_cents: variant.pricing.total_inc_vat_cents,
    subtotal_ex_vat_cents: variant.pricing.subtotal_ex_vat_cents,
    vat_cents: variant.pricing.vat_cents,
    profit_cents: variant.pricing.profit_cents,
    margin_percent: variant.pricing.margin_percent,
    total_weight_grams: variant.pricing.total_weight_grams,
    weight_complete: variant.pricing.weight_complete,
  } : {
    authoritative: false,
    economics_status: "UNKNOWN",
    product_cost_cents: null,
    total_cost_cents: null,
    sale_price_cents: null,
    profit_cents: null,
    margin_percent: null,
  };
  return variant;
}

export function priceVariant(db: Database.Database, preloaded: any) {
  const variant = preloaded?.connectors ? preloaded : variantDetail(db, String(preloaded));
  if (!variant) throw new Error("Variant not found");
  const vatRate = Number((db.prepare("SELECT value FROM app_settings WHERE key='vat_rate_basis_points'").get() as any)?.value || 2000);
  return calculatePricing({
    connectors: variant.connectors, profile: variant.profile || null, cuts: variant.cuts, complementary: variant.complementary_items,
    vatRateBasisPoints: vatRate, laborCostCents: Number(variant.labor_cost_cents || 0), packagingCostCents: Number(variant.packaging_cost_cents || 0), otherCostCents: Number(variant.other_cost_cents || 0),
  });
}

export function quoteCatalogSelection(db: Database.Database, input: { profile_id?: string | null; connectors: { product_id: string; quantity: number }[]; cuts: { quantity: number; length_mm: number }[]; complementary_items: { product_id: string; quantity: number }[]; labor_cost_cents?: number; packaging_cost_cents?: number; other_cost_cents?: number }) {
  const profile = input.profile_id ? db.prepare("SELECT id profile_id,name current_name,raw_length_mm,weight_per_meter_kg weight_per_meter_snapshot_kg,purchase_price_per_meter_cents purchase_price_snapshot_cents,sale_price_per_meter_cents sale_price_snapshot_cents,markup_basis_points markup_basis_points_snapshot,cost_status,sale_price_status FROM profiles WHERE id=? AND active=1 AND catalog_source='PANEL' AND catalog_active=1 AND catalog_version_ref IS NOT NULL").get(input.profile_id) as any : null;
  if (input.profile_id && !profile) throw new Error("INVALID_PROFILE");
  if (!profile && input.cuts.length) throw new Error("INVALID_PROFILE_CUTS");
  if (profile) assertKnownCatalogEconomics(profile, "PROFILE");
  const connectorQuery = db.prepare("SELECT product_id,sku sku_snapshot,name_tr product_name_snapshot,purchase_cost_cents purchase_price_snapshot_cents,sale_price_cents sale_price_snapshot_cents,unit_weight_grams unit_weight_snapshot_grams,cost_status,sale_price_status FROM panel_connector_cache WHERE product_id=? AND catalog_active=1 AND catalog_version_ref IS NOT NULL");
  const connectors = input.connectors.map((line) => { const product = connectorQuery.get(line.product_id) as any; if (!product) throw new Error(`INVALID_CONNECTOR:${line.product_id}`); assertKnownCatalogEconomics(product, "CONNECTOR"); return { ...product, quantity: line.quantity }; });
  const complementQuery = db.prepare("SELECT id,id complementary_product_id,name product_name_snapshot,purchase_unit_price_cents purchase_price_snapshot_cents,sale_unit_price_cents sale_price_snapshot_cents,markup_basis_points markup_basis_points_snapshot,weight_per_unit_grams weight_per_unit_snapshot_grams,cost_status,sale_price_status,base_uom_code FROM complementary_products WHERE id=? AND active=1 AND catalog_source='PANEL' AND catalog_active=1 AND catalog_version_ref IS NOT NULL");
  const complementary = input.complementary_items.map((line) => { const product = complementQuery.get(line.product_id) as any; if (!product) throw new Error(`INVALID_COMPLEMENTARY:${line.product_id}`); assertKnownCatalogEconomics(product, "COMPLEMENTARY"); if (product.base_uom_code === "piece" && !Number.isInteger(line.quantity)) throw new Error(`PIECE_QUANTITY_MUST_BE_INTEGER:${line.product_id}`); return { ...product, quantity_milli: Math.round(line.quantity * 1000) }; });
  const vatRate = Number((db.prepare("SELECT value FROM app_settings WHERE key='vat_rate_basis_points'").get() as any)?.value || 2000);
  return calculatePricing({ connectors, profile, cuts: input.cuts, complementary, vatRateBasisPoints: vatRate, laborCostCents: input.labor_cost_cents, packagingCostCents: input.packaging_cost_cents, otherCostCents: input.other_cost_cents });
}

export function savePricingSnapshot(db: Database.Database, variantId: string, reason: string) {
  const pricing = priceVariant(db, variantId);
  db.prepare("INSERT INTO kit_pricing_snapshots (id,variant_id,reason,pricing_json) VALUES (?,?,?,?)").run(crypto.randomUUID(), variantId, reason, JSON.stringify(pricing));
  return pricing;
}
