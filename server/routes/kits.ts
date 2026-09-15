import crypto from "node:crypto";
import type Database from "better-sqlite3";
import express from "express";
import { z } from "zod";
import { resolveConnector, validateConnectorSelection } from "../services/compatibility.js";
import { savePricingSnapshot, variantDetail } from "../services/variantService.js";

const connectorInput = z.object({ role: z.string().min(2), quantity: z.number().int().positive(), product_id: z.string().optional() });
const cutInput = z.object({ quantity: z.number().int().positive(), length_mm: z.number().int().positive(), label: z.string().optional() });
const complementaryInput = z.object({ product_id: z.string().min(1), quantity: z.number().positive() });
const variantInput = z.object({ profile_id: z.string().min(1), connectors: z.array(connectorInput), cuts: z.array(cutInput), complementary_items: z.array(complementaryInput) });

function kitDetail(db: Database.Database, kitId: string) {
  const kit = db.prepare("SELECT * FROM kits WHERE id=?").get(kitId) as any;
  if (!kit) return null;
  kit.variants = (db.prepare("SELECT id FROM kit_variants WHERE kit_id=? ORDER BY created_at").all(kitId) as { id: string }[]).map((row) => variantDetail(db, row.id));
  return kit;
}

export function createKitsRouter(db: Database.Database) {
  const router = express.Router();

  router.get("/kits", (_req, res) => res.json((db.prepare("SELECT id FROM kits ORDER BY updated_at DESC").all() as { id: string }[]).map((row) => kitDetail(db, row.id))));
  router.get("/kits/:id", (req, res) => { const kit = kitDetail(db, req.params.id); return kit ? res.json(kit) : res.status(404).json({ error: "NOT_FOUND" }); });

  router.post("/kits", (req, res) => {
    const body = z.object({ name: z.string().min(2), description: z.string().optional(), profile_id: z.string().min(1), variant_name: z.string().optional() }).parse(req.body);
    const profile = db.prepare("SELECT id,name FROM profiles WHERE id=? AND active=1").get(body.profile_id) as any;
    if (!profile) return res.status(400).json({ error: "INVALID_PROFILE" });
    const kitId = crypto.randomUUID(); const variantId = crypto.randomUUID();
    db.transaction(() => {
      db.prepare("INSERT INTO kits (id,name,description) VALUES (?,?,?)").run(kitId, body.name, body.description ?? null);
      db.prepare("INSERT INTO kit_variants (id,kit_id,name,profile_id) VALUES (?,?,?,?)").run(variantId, kitId, body.variant_name || profile.name, profile.id);
    })();
    res.status(201).json(kitDetail(db, kitId));
  });

  router.put("/variants/:id", (req, res) => {
    if (Array.isArray(req.body?.connectors) && req.body.connectors.some((item: any) => "sale_price" in item || "sale_price_cents" in item || "purchase_cost" in item || "purchase_price_snapshot_cents" in item)) {
      return res.status(400).json({ error: "CONNECTOR_PRICE_OVERRIDE_FORBIDDEN" });
    }
    const body = variantInput.parse(req.body);
    const variant = db.prepare("SELECT id,kit_id,status FROM kit_variants WHERE id=?").get(req.params.id) as any;
    if (!variant) return res.status(404).json({ error: "NOT_FOUND" });
    if (variant.status === "APPROVED") return res.status(409).json({ error: "APPROVED_VARIANT_REQUIRES_NEW_VERSION" });
    const profile = db.prepare("SELECT * FROM profiles WHERE id=? AND active=1").get(body.profile_id) as any;
    if (!profile) return res.status(400).json({ error: "INVALID_PROFILE" });
    const complementaryLookup = db.prepare("SELECT * FROM complementary_products WHERE id=? AND active=1");
    for (const line of body.connectors) {
      if (line.product_id && !validateConnectorSelection(db, body.profile_id, line.product_id)) {
        return res.status(400).json({ error: "INCOMPATIBLE_CONNECTOR", product_id: line.product_id });
      }
    }
    const resolved = body.connectors.map((line) => {
      const connector = line.product_id ? db.prepare("SELECT pc.*,cc.connector_role FROM panel_connector_cache pc JOIN connector_compatibility cc ON cc.product_id=pc.product_id WHERE pc.product_id=?").get(line.product_id) as any : resolveConnector(db, line.role, body.profile_id) as any;
      if (connector && connector.connector_role !== line.role) throw new Error(`ROLE_MISMATCH:${line.role}`);
      return { ...line, connector };
    });
    const missing = resolved.filter((line) => !line.connector).map((line) => line.role);
    const complements = body.complementary_items.map((line) => {
      const product = complementaryLookup.get(line.product_id) as any;
      if (!product) throw new Error(`INVALID_COMPLEMENTARY:${line.product_id}`);
      if (product.unit_type === "PIECE" && !Number.isInteger(line.quantity)) throw new Error(`PIECE_QUANTITY_MUST_BE_INTEGER:${line.product_id}`);
      return { ...line, product };
    });
    db.transaction(() => {
      db.prepare("UPDATE kit_variants SET profile_id=?,status=?,missing_mappings_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(body.profile_id, missing.length ? "INCOMPLETE" : "DRAFT", JSON.stringify(missing), req.params.id);
      db.prepare("DELETE FROM kit_variant_connectors WHERE variant_id=?").run(req.params.id);
      db.prepare("DELETE FROM kit_variant_complementary_items WHERE variant_id=?").run(req.params.id);
      const oldProfile = db.prepare("SELECT id FROM kit_variant_profiles WHERE variant_id=?").get(req.params.id) as any;
      if (oldProfile) db.prepare("DELETE FROM kit_variant_profiles WHERE id=?").run(oldProfile.id);
      const insertConnector = db.prepare(`INSERT INTO kit_variant_connectors (id,variant_id,connector_role,product_id,quantity,purchase_price_snapshot_cents,sale_price_snapshot_cents,product_name_snapshot,sku_snapshot)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const line of resolved) insertConnector.run(crypto.randomUUID(), req.params.id, line.role, line.connector?.product_id ?? null, line.quantity, line.connector?.purchase_cost_cents ?? null, line.connector?.sale_price_cents ?? null, line.connector?.name_tr ?? null, line.connector?.sku ?? null);
      const variantProfileId = crypto.randomUUID();
      db.prepare("INSERT INTO kit_variant_profiles (id,variant_id,profile_id,purchase_price_snapshot_cents,sale_price_snapshot_cents,weight_per_meter_snapshot_kg) VALUES (?,?,?,?,?,?)")
        .run(variantProfileId, req.params.id, profile.id, profile.purchase_price_per_meter_cents, profile.sale_price_per_meter_cents, profile.weight_per_meter_kg);
      const insertCut = db.prepare("INSERT INTO kit_variant_profile_cuts (id,variant_profile_id,quantity,length_mm,label) VALUES (?,?,?,?,?)");
      for (const cut of body.cuts) insertCut.run(crypto.randomUUID(), variantProfileId, cut.quantity, cut.length_mm, cut.label ?? null);
      const insertComplement = db.prepare(`INSERT INTO kit_variant_complementary_items (id,variant_id,complementary_product_id,quantity_milli,purchase_price_snapshot_cents,sale_price_snapshot_cents,product_name_snapshot,unit_type_snapshot)
        VALUES (?,?,?,?,?,?,?,?)`);
      for (const line of complements) insertComplement.run(crypto.randomUUID(), req.params.id, line.product.id, Math.round(line.quantity * 1000), line.product.purchase_unit_price_cents, line.product.sale_unit_price_cents, line.product.name, line.product.unit_type);
      db.prepare("UPDATE kits SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(variant.kit_id);
    })();
    const detail = variantDetail(db, req.params.id)!;
    savePricingSnapshot(db, req.params.id, "BOM_SAVED");
    res.json(detail);
  });

  router.post("/variants/:id/approve", (req, res) => {
    const detail = variantDetail(db, req.params.id);
    if (!detail) return res.status(404).json({ error: "NOT_FOUND" });
    if (detail.status === "INCOMPLETE" || detail.missing_mappings.length) return res.status(409).json({ error: "INCOMPLETE_VARIANT", missing: detail.missing_mappings });
    const pricing = savePricingSnapshot(db, req.params.id, "APPROVED");
    db.transaction(() => {
      const kit = db.prepare("SELECT kit_version FROM kits WHERE id=?").get(detail.kit_id) as any;
      const nextVersion = Number(kit.kit_version) + 1;
      db.prepare("UPDATE kit_variants SET status='APPROVED',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
      db.prepare("UPDATE kits SET kit_version=?,status='ACTIVE',updated_at=CURRENT_TIMESTAMP,updated_by=? WHERE id=?").run(nextVersion, String(req.body?.updated_by || "system"), detail.kit_id);
      db.prepare("INSERT INTO kit_versions (id,kit_id,version,bom_json,pricing_snapshot_json,updated_by) VALUES (?,?,?,?,?,?)")
        .run(crypto.randomUUID(), detail.kit_id, nextVersion, JSON.stringify(detail), JSON.stringify(pricing), String(req.body?.updated_by || "system"));
    })();
    res.json(variantDetail(db, req.params.id));
  });

  router.post("/variants/:id/refresh-prices", (req, res) => {
    const variant = db.prepare("SELECT status FROM kit_variants WHERE id=?").get(req.params.id) as any;
    if (!variant) return res.status(404).json({ error: "NOT_FOUND" });
    if (variant.status === "APPROVED") return res.status(409).json({ error: "APPROVED_VARIANT_REQUIRES_NEW_VERSION" });
    db.prepare(`UPDATE kit_variant_connectors SET purchase_price_snapshot_cents=(SELECT purchase_cost_cents FROM panel_connector_cache WHERE product_id=kit_variant_connectors.product_id),
      sale_price_snapshot_cents=(SELECT sale_price_cents FROM panel_connector_cache WHERE product_id=kit_variant_connectors.product_id)
      WHERE variant_id=? AND product_id IS NOT NULL`).run(req.params.id);
    savePricingSnapshot(db, req.params.id, "PANEL_PRICES_REFRESHED");
    res.json(variantDetail(db, req.params.id));
  });

  router.post("/variants/:id/clone", (req, res) => {
    const body = z.object({ target_profile_id: z.string().min(1), name: z.string().optional() }).parse(req.body);
    const source = variantDetail(db, req.params.id);
    if (!source) return res.status(404).json({ error: "NOT_FOUND" });
    const targetProfile = db.prepare("SELECT p.*,ps.compatibility_group FROM profiles p JOIN profile_specs ps ON ps.id=p.spec_id WHERE p.id=? AND p.active=1").get(body.target_profile_id) as any;
    if (!targetProfile) return res.status(400).json({ error: "INVALID_PROFILE" });
    const newVariantId = crypto.randomUUID();
    const resolved = source.connectors.map((line: any) => ({ line, connector: resolveConnector(db, line.connector_role, body.target_profile_id) as any }));
    const missing = resolved.filter((entry: any) => !entry.connector).map((entry: any) => entry.line.connector_role);
    db.transaction(() => {
      db.prepare("INSERT INTO kit_variants (id,kit_id,name,profile_id,status,missing_mappings_json) VALUES (?,?,?,?,?,?)")
        .run(newVariantId, source.kit_id, body.name || targetProfile.name, targetProfile.id, missing.length ? "INCOMPLETE" : "DRAFT", JSON.stringify(missing));
      const insertConnector = db.prepare(`INSERT INTO kit_variant_connectors (id,variant_id,connector_role,product_id,quantity,purchase_price_snapshot_cents,sale_price_snapshot_cents,product_name_snapshot,sku_snapshot)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const entry of resolved) insertConnector.run(crypto.randomUUID(), newVariantId, entry.line.connector_role, entry.connector?.product_id ?? null, entry.line.quantity, entry.connector?.purchase_cost_cents ?? null, entry.connector?.sale_price_cents ?? null, entry.connector?.name_tr ?? null, entry.connector?.sku ?? null);
      const profileLineId = crypto.randomUUID();
      db.prepare("INSERT INTO kit_variant_profiles (id,variant_id,profile_id,purchase_price_snapshot_cents,sale_price_snapshot_cents,weight_per_meter_snapshot_kg) VALUES (?,?,?,?,?,?)")
        .run(profileLineId, newVariantId, targetProfile.id, targetProfile.purchase_price_per_meter_cents, targetProfile.sale_price_per_meter_cents, targetProfile.weight_per_meter_kg);
      const insertCut = db.prepare("INSERT INTO kit_variant_profile_cuts (id,variant_profile_id,quantity,length_mm,label) VALUES (?,?,?,?,?)");
      for (const cut of source.cuts) insertCut.run(crypto.randomUUID(), profileLineId, cut.quantity, cut.length_mm, cut.label ?? null);
      const insertComplement = db.prepare(`INSERT INTO kit_variant_complementary_items (id,variant_id,complementary_product_id,quantity_milli,purchase_price_snapshot_cents,sale_price_snapshot_cents,product_name_snapshot,unit_type_snapshot)
        VALUES (?,?,?,?,?,?,?,?)`);
      for (const line of source.complementary_items) insertComplement.run(crypto.randomUUID(), newVariantId, line.complementary_product_id, line.quantity_milli, line.purchase_price_snapshot_cents, line.sale_price_snapshot_cents, line.product_name_snapshot, line.unit_type_snapshot);
      db.prepare("UPDATE kits SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(source.kit_id);
    })();
    savePricingSnapshot(db, newVariantId, "VARIANT_CONVERTED");
    res.status(201).json(variantDetail(db, newVariantId));
  });

  router.get("/kits/:id/compare", (req, res) => {
    const kit = db.prepare("SELECT id,name FROM kits WHERE id=?").get(req.params.id) as any;
    if (!kit) return res.status(404).json({ error: "NOT_FOUND" });
    const variants = (db.prepare("SELECT id FROM kit_variants WHERE kit_id=? AND status!='ARCHIVED' ORDER BY created_at").all(req.params.id) as { id: string }[]).map(({ id }) => {
      const detail = variantDetail(db, id)!;
      return { id: detail.id, name: detail.name, profile_name: detail.profile_name, status: detail.status, missing_mappings: detail.missing_mappings, pricing: detail.pricing };
    });
    res.json({ kit, variants });
  });

  return router;
}
