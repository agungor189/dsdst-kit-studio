import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { validImage } from "./catalog.js";
import { canonicalSizeKey, isCompatible, resolveConnector } from "../services/compatibility.js";
import { conversionOptions, deriveKit, previewVariantConversion } from "../services/conversionService.js";
import { quoteCatalogSelection, savePricingSnapshot, variantDetail } from "../services/variantService.js";
import { ensureOwnedUploadDirectory, removeOwnedUploadFile, removeOwnedUploadReference } from "../services/fileContainment.js";
import { assertKnownCatalogEconomics } from "../services/catalogEconomics.js";

const connectorInput = z.object({ role: z.string().min(2), quantity: z.number().int().positive(), product_id: z.string().optional() });
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 8 } });
const cutInput = z.object({ quantity: z.number().int().positive(), length_mm: z.number().int().positive(), label: z.string().optional() });
const complementaryInput = z.object({ product_id: z.string().min(1), quantity: z.number().positive() });
const variantBaseInput = z.object({ profile_id: z.string().min(1).nullable().optional(), connectors: z.array(connectorInput), cuts: z.array(cutInput), complementary_items: z.array(complementaryInput) });
const variantInput = variantBaseInput.superRefine((value, context) => {
  const roles = value.connectors.map((line) => line.role);
  if (new Set(roles).size !== roles.length) context.addIssue({ code: "custom", path: ["connectors"], message: "Connector roles must be unique inside one configuration" });
});
const kitMetaInput = z.object({
  name: z.string().min(2), sku: z.string().trim().min(1).nullable().optional(), description: z.string().optional(),
  sale_price_cents: z.number().int().nonnegative().optional(), labor_cost_cents: z.number().int().nonnegative().default(0),
  packaging_cost_cents: z.number().int().nonnegative().default(0), other_cost_cents: z.number().int().nonnegative().default(0),
});

export function kitDetail(db: Database.Database, kitId: string) {
  const kit = db.prepare("SELECT * FROM kits WHERE id=? AND deleted_at IS NULL").get(kitId) as any;
  if (!kit) return null;
  kit.variants = (db.prepare("SELECT id FROM kit_variants WHERE kit_id=? ORDER BY created_at").all(kitId) as { id: string }[]).map((row) => variantDetail(db, row.id));
  kit.images = db.prepare("SELECT * FROM kit_images WHERE kit_id=? ORDER BY sort_order,created_at").all(kitId);
  const variant = kit.variants[0];
  kit.summary = variant?.summary || { product_cost_cents: 0, extra_cost_cents: Number(kit.labor_cost_cents || 0) + Number(kit.packaging_cost_cents || 0) + Number(kit.other_cost_cents || 0), total_cost_cents: 0, sale_price_cents: Number(kit.sale_price_cents || 0), profit_cents: Number(kit.sale_price_cents || 0), margin_percent: 0 };
  kit.thumbnail = kit.images[0]?.image_path || (variant?.connectors.find((line: any) => line.current_image)?.product_id
    ? `/api/panel/products/${encodeURIComponent(variant.connectors.find((line: any) => line.current_image).product_id)}/image`
    : variant?.profile?.current_image
      ? variant.profile.current_image
    : variant?.complementary_items.find((line: any) => line.current_image)?.complementary_product_id
      ? (variant.complementary_items.find((line: any) => line.current_image).catalog_source === "PANEL"
          ? `/api/panel/complementary-products/${encodeURIComponent(variant.complementary_items.find((line: any) => line.current_image).complementary_product_id)}/image`
          : variant.complementary_items.find((line: any) => line.current_image).current_image)
      : null);
  return kit;
}

export function createKitsRouter(db: Database.Database) {
  const router = express.Router();

  router.get("/kits", (_req, res) => res.json((db.prepare("SELECT id FROM kits WHERE deleted_at IS NULL ORDER BY updated_at DESC").all() as { id: string }[]).map((row) => kitDetail(db, row.id))));
  router.get("/kits/:id", (req, res) => { const kit = kitDetail(db, req.params.id); return kit ? res.json(kit) : res.status(404).json({ error: "NOT_FOUND" }); });

  router.post("/pricing/quote", (req, res) => {
    const body = variantBaseInput.extend({ labor_cost_cents: z.number().int().nonnegative().default(0), packaging_cost_cents: z.number().int().nonnegative().default(0), other_cost_cents: z.number().int().nonnegative().default(0) }).parse(req.body);
    if (body.connectors.some((line) => !line.product_id)) return res.status(400).json({ error: "CONNECTOR_PRODUCT_REQUIRED" });
    try {
      res.json(quoteCatalogSelection(db, { profile_id: body.profile_id, connectors: body.connectors.map(({ product_id, quantity }) => ({ product_id: String(product_id), quantity })), cuts: body.cuts, complementary_items: body.complementary_items, labor_cost_cents: body.labor_cost_cents, packaging_cost_cents: body.packaging_cost_cents, other_cost_cents: body.other_cost_cents }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "INVALID_QUOTE";
      if (message.startsWith("INVALID_")) return res.status(400).json({ error: message });
      if (message.startsWith("CATALOG_ECONOMICS_UNKNOWN")) return res.status(409).json({ error: "CATALOG_ECONOMICS_UNKNOWN", detail: message });
      if (message.startsWith("PIECE_QUANTITY_MUST_BE_INTEGER")) return res.status(400).json({ error: "PIECE_QUANTITY_MUST_BE_INTEGER", detail: message });
      throw error;
    }
  });

  router.get("/variants/:id/conversion-options", (req, res) => {
    const mode = req.query.mode === "profile" ? "profile" : "connector";
    const options = conversionOptions(db, req.params.id, mode);
    return options ? res.json({ mode, options }) : res.status(404).json({ error: "NOT_FOUND" });
  });

  router.post("/variants/:id/conversion-preview", (req, res) => {
    const body = z.object({ target_profile_id: z.string().min(1) }).parse(req.body);
    const preview = previewVariantConversion(db, req.params.id, body.target_profile_id);
    return preview ? res.json(preview) : res.status(404).json({ error: "NOT_FOUND" });
  });

  router.post("/variants/:id/derive", (req, res) => {
    const body = z.object({ target_profile_id: z.string().min(1), name: z.string().min(2), sku: z.string().trim().min(1).nullable().optional() }).parse(req.body);
    if (body.sku && db.prepare("SELECT 1 FROM kits WHERE sku=? COLLATE NOCASE AND deleted_at IS NULL").get(body.sku)) return res.status(409).json({ error: "DUPLICATE_SKU" });
    const result = deriveKit(db, req.params.id, body.target_profile_id, body);
    if ("error" in result) return res.status(result.error === "NOT_FOUND" ? 404 : 409).json({ error: result.error, missing: result.missing });
    res.status(201).json(kitDetail(db, result.kitId));
  });

  router.post("/kits/:id/images", imageUpload.array("images", 8), async (req, res, next) => {
    try {
      const kitId = String(req.params.id);
      if (!db.prepare("SELECT 1 FROM kits WHERE id=? AND deleted_at IS NULL").get(kitId)) return res.status(404).json({ error: "NOT_FOUND" });
      const files = (req.files || []) as Express.Multer.File[];
      if (!files.length || (await Promise.all(files.map((file) => validImage(file.buffer, file.mimetype)))).some((valid) => !valid)) {
        return res.status(415).json({ error: "INVALID_IMAGE" });
      }
      const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "uploads");
      const directory = ensureOwnedUploadDirectory(uploadRoot, ["kits", kitId]);
      const currentOrder = Number((db.prepare("SELECT MAX(sort_order) value FROM kit_images WHERE kit_id=?").get(kitId) as any)?.value ?? -1) + 1;
      const written: string[] = [];
      try {
        db.transaction(() => files.forEach((file, index) => {
          const extension = file.mimetype === "image/png" ? ".png" : file.mimetype === "image/jpeg" ? ".jpg" : ".webp";
          const filename = `${crypto.randomUUID()}${extension}`;
          const imagePath = `/uploads/kits/${kitId}/${filename}`;
          fs.writeFileSync(path.join(directory, filename), file.buffer, { flag: "wx", mode: 0o600 });
          written.push(imagePath);
          db.prepare("INSERT INTO kit_images (id,kit_id,image_path,sort_order) VALUES (?,?,?,?)").run(crypto.randomUUID(), kitId, imagePath, currentOrder + index);
        }))();
      } catch (error) {
        for (const storedPath of written) removeOwnedUploadFile(uploadRoot, storedPath);
        throw error;
      }
      return res.status(201).json(kitDetail(db, kitId));
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/kits/:kitId/images/:imageId", (req, res) => {
    const image = db.prepare("SELECT image_path FROM kit_images WHERE id=? AND kit_id=?").get(req.params.imageId, req.params.kitId) as { image_path: string } | undefined;
    if (!image) return res.status(404).json({ error: "NOT_FOUND" });
    const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "uploads");
    const removal = removeOwnedUploadReference(uploadRoot, image.image_path, () => {
      db.prepare("DELETE FROM kit_images WHERE id=?").run(req.params.imageId);
    });
    if (removal === "rejected") return res.json({ success: true, file_removed: false });
    if (removal === "cleanup_pending") return res.json({ success: true, file_removed: false, cleanup_pending: true });
    res.json({ success: true });
  });

  router.post("/kits", (req, res) => {
    const body = kitMetaInput.extend({ profile_id: z.string().min(1).nullable().optional(), variant_name: z.string().optional() }).parse(req.body);
    if (body.sku && db.prepare("SELECT 1 FROM kits WHERE sku=? COLLATE NOCASE AND deleted_at IS NULL").get(body.sku)) return res.status(409).json({ error: "DUPLICATE_SKU" });
    const profile = body.profile_id ? db.prepare("SELECT id,name FROM profiles WHERE id=? AND active=1 AND catalog_source='PANEL' AND catalog_active=1 AND catalog_version_ref IS NOT NULL").get(body.profile_id) as any : null;
    if (body.profile_id && !profile) return res.status(400).json({ error: "INVALID_PROFILE" });
    const kitId = crypto.randomUUID(); const variantId = crypto.randomUUID();
    db.transaction(() => {
      db.prepare("INSERT INTO kits (id,name,sku,description,sale_price_cents,labor_cost_cents,packaging_cost_cents,other_cost_cents) VALUES (?,?,?,?,?,?,?,?)")
        .run(kitId, body.name, body.sku || null, body.description ?? null, 0, body.labor_cost_cents, body.packaging_cost_cents, body.other_cost_cents);
      db.prepare("INSERT INTO kit_variants (id,kit_id,name,profile_id) VALUES (?,?,?,?)").run(variantId, kitId, body.variant_name || profile?.name || "Ana varyant", profile?.id || null);
    })();
    res.status(201).json(kitDetail(db, kitId));
  });

  router.put("/kits/:id", (req, res) => {
    const body = kitMetaInput.parse(req.body);
    const duplicate = body.sku ? db.prepare("SELECT id FROM kits WHERE sku=? COLLATE NOCASE AND id!=? AND deleted_at IS NULL").get(body.sku, req.params.id) : null;
    if (duplicate) return res.status(409).json({ error: "DUPLICATE_SKU" });
    const result = db.prepare(`UPDATE kits SET name=?,sku=?,description=?,labor_cost_cents=?,packaging_cost_cents=?,other_cost_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL`)
      .run(body.name, body.sku || null, body.description ?? null, body.labor_cost_cents, body.packaging_cost_cents, body.other_cost_cents, req.params.id);
    return result.changes ? res.json(kitDetail(db, req.params.id)) : res.status(404).json({ error: "NOT_FOUND" });
  });

  router.put("/variants/:id", (req, res) => {
    if (Array.isArray(req.body?.connectors) && req.body.connectors.some((item: any) => "sale_price" in item || "sale_price_cents" in item || "purchase_cost" in item || "purchase_price_snapshot_cents" in item)) {
      return res.status(400).json({ error: "CONNECTOR_PRICE_OVERRIDE_FORBIDDEN" });
    }
    const body = variantInput.parse(req.body);
    const variant = db.prepare("SELECT id,kit_id,status FROM kit_variants WHERE id=?").get(req.params.id) as any;
    if (!variant) return res.status(404).json({ error: "NOT_FOUND" });
    if (variant.status === "APPROVED") return res.status(409).json({ error: "APPROVED_VARIANT_REQUIRES_NEW_VERSION" });
    const profile = body.profile_id ? db.prepare("SELECT * FROM profiles WHERE id=? AND active=1 AND catalog_source='PANEL' AND catalog_active=1 AND catalog_version_ref IS NOT NULL").get(body.profile_id) as any : null;
    if (body.profile_id && !profile) return res.status(400).json({ error: "INVALID_PROFILE" });
    if (!profile && body.cuts.length) return res.status(400).json({ error: "PROFILE_REQUIRED_FOR_CUTS" });
    if (profile && body.cuts.some((cut) => cut.length_mm > Number(profile.raw_length_mm))) return res.status(400).json({ error: "CUT_LONGER_THAN_RAW_PROFILE" });
    if (profile) assertKnownCatalogEconomics(profile, "PROFILE");
    const complementaryLookup = db.prepare("SELECT * FROM complementary_products WHERE id=? AND active=1 AND catalog_source='PANEL' AND catalog_active=1 AND catalog_version_ref IS NOT NULL");
    const resolved = body.connectors.map((line) => {
      const connector = line.product_id ? db.prepare("SELECT pc.*,cc.connector_role,cc.compatibility_group,cc.profile_shape,cc.profile_width_mm,cc.profile_height_mm,cc.outside_diameter_mm,cc.nominal_size,cc.compatible_material_group,cc.wall_min_mm,cc.wall_max_mm FROM panel_connector_cache pc LEFT JOIN connector_compatibility cc ON cc.product_id=pc.product_id WHERE pc.product_id=? AND pc.catalog_active=1 AND pc.catalog_version_ref IS NOT NULL").get(line.product_id) as any : body.profile_id ? resolveConnector(db, line.role, body.profile_id) as any : null;
      if (line.product_id && !connector) throw new Error(`INVALID_CONNECTOR:${line.product_id}`);
      if (connector?.connector_role && connector.connector_role !== line.role) throw new Error(`ROLE_MISMATCH:${line.role}`);
      if (connector && !connector.connector_role) connector.connector_role = line.role;
      if (connector) assertKnownCatalogEconomics(connector, "CONNECTOR");
      return { ...line, connector };
    });
    const missing = resolved.filter((line) => !line.connector).map((line) => line.role);
    const profileSpec = body.profile_id ? db.prepare("SELECT ps.shape,ps.material,ps.width_mm,ps.height_mm,ps.outside_diameter_mm,ps.nominal_size,ps.wall_thickness_mm,COALESCE(ps.size_compatibility_group,ps.compatibility_group) compatibility_group FROM profiles p JOIN profile_specs ps ON ps.id=p.spec_id WHERE p.id=?").get(body.profile_id) as any : null;
    const connectorAnchor = resolved.find((line) => line.connector)?.connector;
    const compatibilityWarnings = resolved.flatMap((line) => {
      if (!line.connector) return [`${line.role}: uygun ürün eşlemesi bulunamadı`];
      if (!profileSpec) return connectorAnchor && canonicalSizeKey(line.connector) !== canonicalSizeKey(connectorAnchor) ? [`${line.connector.sku}: seçili bağlantı ölçüleri birbiriyle uyumlu değil`] : [];
      if (!line.connector.compatibility_group) return [`${line.connector.sku}: uyumluluk bilgisi eksik`];
      return isCompatible(line.connector, profileSpec) ? [] : [`${line.connector.sku}: ${line.connector.compatibility_group}, profil ${profileSpec.compatibility_group}`];
    });
    if (compatibilityWarnings.length) return res.status(409).json({ error: "INCOMPATIBLE_CONNECTOR", warnings: compatibilityWarnings });
    const complements = body.complementary_items.map((line) => {
      const product = complementaryLookup.get(line.product_id) as any;
      if (!product) throw new Error(`INVALID_COMPLEMENTARY:${line.product_id}`);
      assertKnownCatalogEconomics(product, "COMPLEMENTARY");
      if (product.base_uom_code === "piece" && !Number.isInteger(line.quantity)) throw new Error(`PIECE_QUANTITY_MUST_BE_INTEGER:${line.product_id}`);
      return { ...line, product };
    });
    db.transaction(() => {
      db.prepare("UPDATE kit_variants SET profile_id=?,status=?,missing_mappings_json=?,compatibility_warnings_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(profile?.id || null, missing.length ? "INCOMPLETE" : "DRAFT", JSON.stringify(missing), JSON.stringify(compatibilityWarnings), req.params.id);
      db.prepare("DELETE FROM kit_variant_connectors WHERE variant_id=?").run(req.params.id);
      db.prepare("DELETE FROM kit_variant_complementary_items WHERE variant_id=?").run(req.params.id);
      const oldProfile = db.prepare("SELECT id FROM kit_variant_profiles WHERE variant_id=?").get(req.params.id) as any;
      if (oldProfile) db.prepare("DELETE FROM kit_variant_profiles WHERE id=?").run(oldProfile.id);
      const insertConnector = db.prepare(`INSERT INTO kit_variant_connectors (id,variant_id,connector_role,product_id,quantity,purchase_price_snapshot_cents,sale_price_snapshot_cents,unit_weight_snapshot_grams,product_name_snapshot,sku_snapshot)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const line of resolved) insertConnector.run(crypto.randomUUID(), req.params.id, line.role, line.connector?.product_id ?? null, line.quantity, line.connector?.purchase_cost_cents ?? null, line.connector?.sale_price_cents ?? null, line.connector?.unit_weight_grams ?? null, line.connector?.name_tr ?? null, line.connector?.sku ?? null);
      if (profile) {
        const variantProfileId = crypto.randomUUID();
        db.prepare("INSERT INTO kit_variant_profiles (id,variant_id,profile_id,purchase_price_snapshot_cents,sale_price_snapshot_cents,markup_basis_points_snapshot,weight_per_meter_snapshot_kg) VALUES (?,?,?,?,?,?,?)")
          .run(variantProfileId, req.params.id, profile.id, profile.purchase_price_per_meter_cents, profile.sale_price_per_meter_cents, profile.markup_basis_points, profile.weight_per_meter_kg);
        const insertCut = db.prepare("INSERT INTO kit_variant_profile_cuts (id,variant_profile_id,quantity,length_mm,label) VALUES (?,?,?,?,?)");
        for (const cut of body.cuts) insertCut.run(crypto.randomUUID(), variantProfileId, cut.quantity, cut.length_mm, cut.label ?? null);
      }
      const insertComplement = db.prepare(`INSERT INTO kit_variant_complementary_items (id,variant_id,complementary_product_id,quantity_milli,purchase_price_snapshot_cents,sale_price_snapshot_cents,markup_basis_points_snapshot,weight_per_unit_snapshot_grams,product_name_snapshot,unit_type_snapshot)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const line of complements) insertComplement.run(crypto.randomUUID(), req.params.id, line.product.id, Math.round(line.quantity * 1000), line.product.purchase_unit_price_cents, line.product.sale_unit_price_cents, line.product.markup_basis_points, line.product.weight_per_unit_grams, line.product.name, line.product.unit_type);
      db.prepare("UPDATE kits SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(variant.kit_id);
    })();
    const detail = variantDetail(db, req.params.id)!;
    db.prepare("UPDATE kits SET sale_price_cents=? WHERE id=?").run(detail.pricing.total_inc_vat_cents, variant.kit_id);
    savePricingSnapshot(db, req.params.id, "BOM_SAVED");
    res.json(detail);
  });

  router.post("/kits/:id/copy", (req, res) => {
    const source = kitDetail(db, req.params.id);
    if (!source || !source.variants[0]) return res.status(404).json({ error: "NOT_FOUND" });
    const input = z.object({ name: z.string().min(2).optional(), sku: z.string().trim().min(1).nullable().optional() }).parse(req.body || {});
    if (input.sku && db.prepare("SELECT 1 FROM kits WHERE sku=? COLLATE NOCASE AND deleted_at IS NULL").get(input.sku)) return res.status(409).json({ error: "DUPLICATE_SKU" });
    let copySku = input.sku || null;
    if (!copySku && source.sku) {
      let sequence = 1;
      do { copySku = `${source.sku}-COPY${sequence}`; sequence++; }
      while (db.prepare("SELECT 1 FROM kits WHERE sku=? COLLATE NOCASE AND deleted_at IS NULL").get(copySku));
    }
    const sourceVariant = source.variants[0];
    const kitId = crypto.randomUUID(); const variantId = crypto.randomUUID();
    db.transaction(() => {
      db.prepare(`INSERT INTO kits (id,name,sku,description,status,sale_price_cents,labor_cost_cents,packaging_cost_cents,other_cost_cents)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(kitId, input.name || `${source.name} - Kopya`, copySku, source.description, "DRAFT", source.sale_price_cents, source.labor_cost_cents, source.packaging_cost_cents, source.other_cost_cents);
      db.prepare(`INSERT INTO kit_variants (id,kit_id,name,profile_id,status,missing_mappings_json,compatibility_warnings_json)
        VALUES (?,?,?,?,?,?,?)`).run(variantId, kitId, sourceVariant.name, sourceVariant.profile_id, "DRAFT", sourceVariant.missing_mappings_json, sourceVariant.compatibility_warnings_json);
      const addConnector = db.prepare(`INSERT INTO kit_variant_connectors (id,variant_id,connector_role,product_id,quantity,purchase_price_snapshot_cents,sale_price_snapshot_cents,unit_weight_snapshot_grams,product_name_snapshot,sku_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const line of sourceVariant.connectors) addConnector.run(crypto.randomUUID(), variantId, line.connector_role, line.product_id, line.quantity, line.purchase_price_snapshot_cents, line.sale_price_snapshot_cents, line.unit_weight_snapshot_grams, line.product_name_snapshot, line.sku_snapshot);
      if (sourceVariant.profile) {
        const profileLineId = crypto.randomUUID();
        db.prepare(`INSERT INTO kit_variant_profiles (id,variant_id,profile_id,purchase_price_snapshot_cents,sale_price_snapshot_cents,markup_basis_points_snapshot,weight_per_meter_snapshot_kg) VALUES (?,?,?,?,?,?,?)`)
          .run(profileLineId, variantId, sourceVariant.profile.profile_id, sourceVariant.profile.purchase_price_snapshot_cents, sourceVariant.profile.sale_price_snapshot_cents, sourceVariant.profile.markup_basis_points_snapshot, sourceVariant.profile.weight_per_meter_snapshot_kg);
        const addCut = db.prepare("INSERT INTO kit_variant_profile_cuts (id,variant_profile_id,quantity,length_mm,label) VALUES (?,?,?,?,?)");
        for (const cut of sourceVariant.cuts) addCut.run(crypto.randomUUID(), profileLineId, cut.quantity, cut.length_mm, cut.label);
      }
      const addComplement = db.prepare(`INSERT INTO kit_variant_complementary_items (id,variant_id,complementary_product_id,quantity_milli,purchase_price_snapshot_cents,sale_price_snapshot_cents,markup_basis_points_snapshot,weight_per_unit_snapshot_grams,product_name_snapshot,unit_type_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const line of sourceVariant.complementary_items) addComplement.run(crypto.randomUUID(), variantId, line.complementary_product_id, line.quantity_milli, line.purchase_price_snapshot_cents, line.sale_price_snapshot_cents, line.markup_basis_points_snapshot, line.weight_per_unit_snapshot_grams, line.product_name_snapshot, line.unit_type_snapshot);
    })();
    savePricingSnapshot(db, variantId, "KIT_COPIED");
    res.status(201).json(kitDetail(db, kitId));
  });

  router.delete("/kits/:id", (req, res) => {
    const result = db.prepare("UPDATE kits SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL").run(req.params.id);
    return result.changes ? res.json({ success: true }) : res.status(404).json({ error: "NOT_FOUND" });
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
    const variant = db.prepare("SELECT status,kit_id FROM kit_variants WHERE id=?").get(req.params.id) as any;
    if (!variant) return res.status(404).json({ error: "NOT_FOUND" });
    if (variant.status === "APPROVED") return res.status(409).json({ error: "APPROVED_VARIANT_REQUIRES_NEW_VERSION" });
    const unknown = db.prepare(`SELECT 1 FROM (
      SELECT pc.cost_status,pc.sale_price_status FROM kit_variant_connectors line JOIN panel_connector_cache pc ON pc.product_id=line.product_id WHERE line.variant_id=?
      UNION ALL SELECT p.cost_status,p.sale_price_status FROM kit_variant_profiles line JOIN profiles p ON p.id=line.profile_id WHERE line.variant_id=?
      UNION ALL SELECT cp.cost_status,cp.sale_price_status FROM kit_variant_complementary_items line JOIN complementary_products cp ON cp.id=line.complementary_product_id WHERE line.variant_id=?
    ) WHERE cost_status!='KNOWN' OR sale_price_status!='KNOWN' LIMIT 1`).get(req.params.id, req.params.id, req.params.id);
    if (unknown) return res.status(409).json({ error: "CATALOG_ECONOMICS_UNKNOWN" });
    db.prepare(`UPDATE kit_variant_connectors SET purchase_price_snapshot_cents=(SELECT purchase_cost_cents FROM panel_connector_cache WHERE product_id=kit_variant_connectors.product_id),
      sale_price_snapshot_cents=(SELECT sale_price_cents FROM panel_connector_cache WHERE product_id=kit_variant_connectors.product_id),
      unit_weight_snapshot_grams=(SELECT unit_weight_grams FROM panel_connector_cache WHERE product_id=kit_variant_connectors.product_id)
      WHERE variant_id=? AND product_id IS NOT NULL`).run(req.params.id);
    db.prepare(`UPDATE kit_variant_profiles SET
      purchase_price_snapshot_cents=(SELECT purchase_price_per_meter_cents FROM profiles WHERE id=kit_variant_profiles.profile_id),
      sale_price_snapshot_cents=(SELECT sale_price_per_meter_cents FROM profiles WHERE id=kit_variant_profiles.profile_id),
      markup_basis_points_snapshot=(SELECT markup_basis_points FROM profiles WHERE id=kit_variant_profiles.profile_id),
      weight_per_meter_snapshot_kg=(SELECT weight_per_meter_kg FROM profiles WHERE id=kit_variant_profiles.profile_id)
      WHERE variant_id=?`).run(req.params.id);
    db.prepare(`UPDATE kit_variant_complementary_items SET
      purchase_price_snapshot_cents=(SELECT purchase_unit_price_cents FROM complementary_products WHERE id=kit_variant_complementary_items.complementary_product_id),
      sale_price_snapshot_cents=(SELECT sale_unit_price_cents FROM complementary_products WHERE id=kit_variant_complementary_items.complementary_product_id),
      markup_basis_points_snapshot=(SELECT markup_basis_points FROM complementary_products WHERE id=kit_variant_complementary_items.complementary_product_id),
      weight_per_unit_snapshot_grams=(SELECT weight_per_unit_grams FROM complementary_products WHERE id=kit_variant_complementary_items.complementary_product_id)
      WHERE variant_id=?`).run(req.params.id);
    const pricing = savePricingSnapshot(db, req.params.id, "CATALOG_PRICES_REFRESHED");
    db.prepare("UPDATE kits SET sale_price_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(pricing.total_inc_vat_cents, variant.kit_id);
    res.json(variantDetail(db, req.params.id));
  });

  router.post("/variants/:id/clone", (req, res) => {
    const body = z.object({ target_profile_id: z.string().min(1), name: z.string().optional() }).parse(req.body);
    const source = variantDetail(db, req.params.id);
    if (!source) return res.status(404).json({ error: "NOT_FOUND" });
    const targetProfile = db.prepare("SELECT p.*,COALESCE(ps.size_compatibility_group,ps.compatibility_group) compatibility_group FROM profiles p JOIN profile_specs ps ON ps.id=p.spec_id WHERE p.id=? AND p.active=1 AND p.catalog_source='PANEL' AND p.catalog_active=1 AND p.catalog_version_ref IS NOT NULL").get(body.target_profile_id) as any;
    if (!targetProfile) return res.status(400).json({ error: "INVALID_PROFILE" });
    const newVariantId = crypto.randomUUID();
    const resolved = source.connectors.map((line: any) => ({ line, connector: resolveConnector(db, line.connector_role, body.target_profile_id) as any }));
    const missing = resolved.filter((entry: any) => !entry.connector).map((entry: any) => entry.line.connector_role);
    db.transaction(() => {
      db.prepare("INSERT INTO kit_variants (id,kit_id,name,profile_id,status,missing_mappings_json) VALUES (?,?,?,?,?,?)")
        .run(newVariantId, source.kit_id, body.name || targetProfile.name, targetProfile.id, missing.length ? "INCOMPLETE" : "DRAFT", JSON.stringify(missing));
      const insertConnector = db.prepare(`INSERT INTO kit_variant_connectors (id,variant_id,connector_role,product_id,quantity,purchase_price_snapshot_cents,sale_price_snapshot_cents,unit_weight_snapshot_grams,product_name_snapshot,sku_snapshot)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const entry of resolved) insertConnector.run(crypto.randomUUID(), newVariantId, entry.line.connector_role, entry.connector?.product_id ?? null, entry.line.quantity, entry.connector?.purchase_cost_cents ?? null, entry.connector?.sale_price_cents ?? null, entry.connector?.unit_weight_grams ?? null, entry.connector?.name_tr ?? null, entry.connector?.sku ?? null);
      const profileLineId = crypto.randomUUID();
      db.prepare("INSERT INTO kit_variant_profiles (id,variant_id,profile_id,purchase_price_snapshot_cents,sale_price_snapshot_cents,markup_basis_points_snapshot,weight_per_meter_snapshot_kg) VALUES (?,?,?,?,?,?,?)")
        .run(profileLineId, newVariantId, targetProfile.id, targetProfile.purchase_price_per_meter_cents, targetProfile.sale_price_per_meter_cents, targetProfile.markup_basis_points, targetProfile.weight_per_meter_kg);
      const insertCut = db.prepare("INSERT INTO kit_variant_profile_cuts (id,variant_profile_id,quantity,length_mm,label) VALUES (?,?,?,?,?)");
      for (const cut of source.cuts) insertCut.run(crypto.randomUUID(), profileLineId, cut.quantity, cut.length_mm, cut.label ?? null);
      const insertComplement = db.prepare(`INSERT INTO kit_variant_complementary_items (id,variant_id,complementary_product_id,quantity_milli,purchase_price_snapshot_cents,sale_price_snapshot_cents,markup_basis_points_snapshot,weight_per_unit_snapshot_grams,product_name_snapshot,unit_type_snapshot)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const line of source.complementary_items) insertComplement.run(crypto.randomUUID(), newVariantId, line.complementary_product_id, line.quantity_milli, line.purchase_price_snapshot_cents, line.sale_price_snapshot_cents, line.markup_basis_points_snapshot, line.weight_per_unit_snapshot_grams, line.product_name_snapshot, line.unit_type_snapshot);
      db.prepare("UPDATE kits SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(source.kit_id);
    })();
    if (!missing.length) savePricingSnapshot(db, newVariantId, "VARIANT_CONVERTED");
    res.status(201).json(variantDetail(db, newVariantId));
  });

  router.get("/kits/:id/compare", (req, res) => {
    const kit = db.prepare("SELECT id,name FROM kits WHERE id=?").get(req.params.id) as any;
    if (!kit) return res.status(404).json({ error: "NOT_FOUND" });
    const variants = (db.prepare("SELECT id FROM kit_variants WHERE kit_id=? AND status!='ARCHIVED' ORDER BY created_at").all(req.params.id) as { id: string }[]).map(({ id }) => {
      const detail = variantDetail(db, id)!;
      return { id: detail.id, name: detail.name, profile_name: detail.profile_name, status: detail.status, missing_mappings: detail.missing_mappings, configuration: detail.configuration, pricing: detail.pricing, summary: detail.summary };
    });
    res.json({ kit, variants });
  });

  return router;
}
