import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { calculatePricing } from "./pricing.js";

export function variantDetail(db: Database.Database, variantId: string) {
  const variant = db.prepare(`SELECT v.*,k.name kit_name,k.sku kit_sku,k.sale_price_cents,k.labor_cost_cents,k.packaging_cost_cents,k.other_cost_cents,p.name profile_name,ps.compatibility_group,ps.shape
    FROM kit_variants v JOIN kits k ON k.id=v.kit_id LEFT JOIN profiles p ON p.id=v.profile_id
    LEFT JOIN profile_specs ps ON ps.id=p.spec_id WHERE v.id=? AND k.deleted_at IS NULL`).get(variantId) as any;
  if (!variant) return null;
  variant.missing_mappings = JSON.parse(variant.missing_mappings_json || "[]");
  variant.compatibility_warnings = JSON.parse(variant.compatibility_warnings_json || "[]");
  variant.connectors = db.prepare(`SELECT line.*,cache.image current_image,cache.central_stock current_stock,cache.name_tr current_name,cache.sku current_sku,
    cache.purchase_cost_cents current_purchase_cost_cents,cache.catalog_active
    FROM kit_variant_connectors line LEFT JOIN panel_connector_cache cache ON cache.product_id=line.product_id
    WHERE line.variant_id=? ORDER BY line.connector_role`).all(variantId);
  variant.profile = db.prepare(`SELECT line.*,p.name current_name,p.image_path current_image,p.purchase_price_per_meter_cents current_purchase_price_cents,
    p.raw_length_mm,p.catalog_active,ps.compatibility_group,ps.shape
    FROM kit_variant_profiles line JOIN profiles p ON p.id=line.profile_id JOIN profile_specs ps ON ps.id=p.spec_id
    WHERE line.variant_id=?`).get(variantId) as any;
  variant.cuts = variant.profile ? db.prepare("SELECT * FROM kit_variant_profile_cuts WHERE variant_profile_id=? ORDER BY length_mm DESC").all(variant.profile.id) : [];
  variant.complementary_items = db.prepare(`SELECT line.*,product.image_path current_image,product.name current_name,product.catalog_source,product.catalog_active,
    product.purchase_unit_price_cents current_purchase_price_cents
    FROM kit_variant_complementary_items line LEFT JOIN complementary_products product ON product.id=line.complementary_product_id
    WHERE line.variant_id=? ORDER BY line.product_name_snapshot`).all(variantId);
  variant.pricing = priceVariant(db, variant);
  const extras = Number(variant.labor_cost_cents || 0) + Number(variant.packaging_cost_cents || 0) + Number(variant.other_cost_cents || 0);
  variant.summary = {
    product_cost_cents: variant.pricing.total_cost_cents,
    extra_cost_cents: extras,
    total_cost_cents: variant.pricing.total_cost_cents + extras,
    sale_price_cents: Number(variant.sale_price_cents || 0),
    profit_cents: Number(variant.sale_price_cents || 0) - variant.pricing.total_cost_cents - extras,
    margin_percent: Number(variant.sale_price_cents || 0) > 0 ? ((Number(variant.sale_price_cents) - variant.pricing.total_cost_cents - extras) / Number(variant.sale_price_cents)) * 100 : 0,
  };
  return variant;
}

export function priceVariant(db: Database.Database, preloaded: any) {
  const variant = preloaded?.connectors ? preloaded : variantDetail(db, String(preloaded));
  if (!variant) throw new Error("Variant not found");
  const vatRate = Number((db.prepare("SELECT value FROM app_settings WHERE key='vat_rate_basis_points'").get() as any)?.value || 2000);
  return calculatePricing({ connectors: variant.connectors, profile: variant.profile || null, cuts: variant.cuts, complementary: variant.complementary_items, vatRateBasisPoints: vatRate });
}

export function savePricingSnapshot(db: Database.Database, variantId: string, reason: string) {
  const pricing = priceVariant(db, variantId);
  db.prepare("INSERT INTO kit_pricing_snapshots (id,variant_id,reason,pricing_json) VALUES (?,?,?,?)").run(crypto.randomUUID(), variantId, reason, JSON.stringify(pricing));
  return pricing;
}
