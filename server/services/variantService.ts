import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { calculatePricing } from "./pricing.js";

export function variantDetail(db: Database.Database, variantId: string) {
  const variant = db.prepare(`SELECT v.*,k.name kit_name,p.name profile_name,ps.compatibility_group,ps.shape
    FROM kit_variants v JOIN kits k ON k.id=v.kit_id LEFT JOIN profiles p ON p.id=v.profile_id
    LEFT JOIN profile_specs ps ON ps.id=p.spec_id WHERE v.id=?`).get(variantId) as any;
  if (!variant) return null;
  variant.missing_mappings = JSON.parse(variant.missing_mappings_json || "[]");
  variant.connectors = db.prepare("SELECT * FROM kit_variant_connectors WHERE variant_id=? ORDER BY connector_role").all(variantId);
  variant.profile = db.prepare("SELECT * FROM kit_variant_profiles WHERE variant_id=?").get(variantId) as any;
  variant.cuts = variant.profile ? db.prepare("SELECT * FROM kit_variant_profile_cuts WHERE variant_profile_id=? ORDER BY length_mm DESC").all(variant.profile.id) : [];
  variant.complementary_items = db.prepare("SELECT * FROM kit_variant_complementary_items WHERE variant_id=? ORDER BY product_name_snapshot").all(variantId);
  variant.pricing = priceVariant(db, variant);
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
