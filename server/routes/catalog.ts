import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { requireAdmin } from "../middleware/appAuth.js";
import { fetchPanelProductImage, getPanelSyncStats, syncPanelConnectors } from "../services/panelClient.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const money = z.number().int().nonnegative();

function profileRows(db: Database.Database) {
  return db.prepare(`SELECT p.*, ps.shape, ps.material, ps.width_mm, ps.height_mm, ps.outside_diameter_mm,
    ps.nominal_size, ps.wall_thickness_mm, ps.compatibility_group, s.name supplier_name
    FROM profiles p JOIN profile_specs ps ON ps.id=p.spec_id
    LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.active=1 ORDER BY p.name`).all();
}

export function validImage(buffer: Buffer, mimetype: string) {
  if (mimetype === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimetype === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === "image/webp") return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  return false;
}

export function createCatalogRouter(db: Database.Database) {
  const router = express.Router();

  router.get("/bootstrap", (req, res) => {
    res.json({
      user: req.user,
      profiles: profileRows(db),
      complementaryProducts: db.prepare("SELECT cp.*, s.name supplier_name FROM complementary_products cp LEFT JOIN suppliers s ON s.id=cp.supplier_id WHERE cp.active=1 ORDER BY cp.name").all(),
      connectors: db.prepare(`SELECT pc.*, cc.connector_role, cc.compatibility_group, cc.profile_shape
        FROM panel_connector_cache pc LEFT JOIN connector_compatibility cc ON cc.product_id=pc.product_id
        WHERE pc.catalog_active=1 ORDER BY pc.compatibility_status, cc.connector_role, pc.sku`).all(),
      suppliers: db.prepare("SELECT * FROM suppliers WHERE active=1 ORDER BY name").all(),
      settings: Object.fromEntries((db.prepare("SELECT key,value FROM app_settings").all() as { key: string; value: string }[]).map((row) => [row.key, row.value])),
      sync: getPanelSyncStats(db),
    });
  });

  router.post("/panel/sync", async (_req, res, next) => {
    try { res.json({ synced: await syncPanelConnectors(db) }); } catch (error) { next(error); }
  });

  router.get("/panel/products/:id/image", async (req, res) => {
    const row = db.prepare("SELECT image FROM panel_connector_cache WHERE product_id=? AND catalog_active=1").get(req.params.id) as { image?: string } | undefined;
    if (!row?.image) return res.status(404).json({ error: "IMAGE_NOT_FOUND" });
    try {
      const image = await fetchPanelProductImage(req.params.id, row.image);
      res.set({ "content-type": image.type, "cache-control": "private, max-age=3600" }).send(image.buffer);
    } catch { res.status(502).json({ error: "PANEL_IMAGE_UNAVAILABLE" }); }
  });

  router.get("/suppliers", (_req, res) => res.json(db.prepare("SELECT * FROM suppliers ORDER BY active DESC,name").all()));
  router.post("/suppliers", (req, res) => {
    const parsed = z.object({ name: z.string().min(2), contact_name: z.string().optional(), phone: z.string().optional(), whatsapp: z.string().optional(), email: z.string().email().optional().or(z.literal("")), website: z.string().url().optional().or(z.literal("")), address: z.string().optional(), notes: z.string().optional() }).parse(req.body);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO suppliers (id,name,contact_name,phone,whatsapp,email,website,address,notes) VALUES (@id,@name,@contact_name,@phone,@whatsapp,@email,@website,@address,@notes)").run({ id, contact_name: null, phone: null, whatsapp: null, email: null, website: null, address: null, notes: null, ...parsed });
    res.status(201).json(db.prepare("SELECT * FROM suppliers WHERE id=?").get(id));
  });

  router.get("/profiles", (_req, res) => res.json(profileRows(db)));
  router.post("/profiles", (req, res) => {
    const parsed = z.object({
      name: z.string().min(2), shape: z.enum(["SQUARE", "ROUND", "RECTANGULAR"]), material: z.string().min(2),
      width_mm: z.number().positive().optional(), height_mm: z.number().positive().optional(), outside_diameter_mm: z.number().positive().optional(), nominal_size: z.string().optional(),
      wall_thickness_mm: z.number().positive(), compatibility_group: z.string().min(2), raw_length_mm: z.number().int().positive().default(6000),
      weight_per_meter_kg: z.number().nonnegative(), purchase_price_per_meter_cents: money, sale_price_per_meter_cents: money,
      supplier_id: z.string().optional(), notes: z.string().optional(),
    }).refine((data) => data.shape === "ROUND" ? Boolean(data.outside_diameter_mm) : Boolean(data.width_mm && data.height_mm), "Profile dimensions do not match shape").parse(req.body);
    const specId = crypto.randomUUID(); const id = crypto.randomUUID();
    db.transaction(() => {
      db.prepare("INSERT INTO profile_specs (id,shape,material,width_mm,height_mm,outside_diameter_mm,nominal_size,wall_thickness_mm,compatibility_group) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(specId, parsed.shape, parsed.material, parsed.width_mm ?? null, parsed.height_mm ?? null, parsed.outside_diameter_mm ?? null, parsed.nominal_size ?? null, parsed.wall_thickness_mm, parsed.compatibility_group);
      db.prepare("INSERT INTO profiles (id,spec_id,name,raw_length_mm,weight_per_meter_kg,purchase_price_per_meter_cents,sale_price_per_meter_cents,supplier_id,notes) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, specId, parsed.name, parsed.raw_length_mm, parsed.weight_per_meter_kg, parsed.purchase_price_per_meter_cents, parsed.sale_price_per_meter_cents, parsed.supplier_id ?? null, parsed.notes ?? null);
    })();
    res.status(201).json(profileRows(db).find((row: any) => row.id === id));
  });

  router.get("/complementary-products", (_req, res) => res.json(db.prepare("SELECT * FROM complementary_products ORDER BY active DESC,name").all()));
  router.post("/complementary-products", (req, res) => {
    const parsed = z.object({ name: z.string().min(2), sku_optional: z.string().optional(), description: z.string().optional(), unit_type: z.enum(["PIECE", "METER", "M2"]), purchase_unit_price_cents: money, sale_unit_price_cents: money, supplier_id: z.string().optional(), website_url_optional: z.string().url().optional().or(z.literal("")), notes: z.string().optional() }).parse(req.body);
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO complementary_products (id,name,sku_optional,description,unit_type,purchase_unit_price_cents,sale_unit_price_cents,supplier_id,website_url_optional,notes)
      VALUES (@id,@name,@sku_optional,@description,@unit_type,@purchase_unit_price_cents,@sale_unit_price_cents,@supplier_id,@website_url_optional,@notes)`)
      .run({ id, sku_optional: null, description: null, supplier_id: null, website_url_optional: null, notes: null, ...parsed });
    res.status(201).json(db.prepare("SELECT * FROM complementary_products WHERE id=?").get(id));
  });

  router.post("/complementary-products/:id/image", upload.single("image"), (req, res) => {
    const file = req.file;
    if (!file || !validImage(file.buffer, file.mimetype)) return res.status(415).json({ error: "INVALID_IMAGE" });
    const extension = file.mimetype === "image/png" ? ".png" : file.mimetype === "image/jpeg" ? ".jpg" : ".webp";
    const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "uploads");
    const directory = path.join(uploadRoot, "complementary-products");
    fs.mkdirSync(directory, { recursive: true });
    const filename = `${crypto.randomUUID()}${extension}`;
    fs.writeFileSync(path.join(directory, filename), file.buffer, { flag: "wx" });
    const imagePath = `/uploads/complementary-products/${filename}`;
    const result = db.prepare("UPDATE complementary_products SET image_path=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(imagePath, req.params.id);
    if (!result.changes) { fs.unlinkSync(path.join(directory, filename)); return res.status(404).json({ error: "NOT_FOUND" }); }
    res.json({ image_path: imagePath });
  });

  router.post("/connector-compatibility", requireAdmin, (req, res) => {
    const parsed = z.object({ product_id: z.string().min(1), connector_role: z.string().min(2), profile_shape: z.enum(["SQUARE", "ROUND", "RECTANGULAR"]), profile_width_mm: z.number().positive().optional(), profile_height_mm: z.number().positive().optional(), outside_diameter_mm: z.number().positive().optional(), nominal_size: z.string().optional(), compatible_material_group: z.string().optional(), wall_min_mm: z.number().positive().optional(), wall_max_mm: z.number().positive().optional(), compatibility_group: z.string().min(2) }).parse(req.body);
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO connector_compatibility (id,product_id,connector_role,profile_shape,profile_width_mm,profile_height_mm,outside_diameter_mm,nominal_size,compatible_material_group,wall_min_mm,wall_max_mm,compatibility_group,mapping_source)
      VALUES (@id,@product_id,@connector_role,@profile_shape,@profile_width_mm,@profile_height_mm,@outside_diameter_mm,@nominal_size,@compatible_material_group,@wall_min_mm,@wall_max_mm,@compatibility_group,'MANUAL')
      ON CONFLICT(product_id) DO UPDATE SET connector_role=excluded.connector_role,profile_shape=excluded.profile_shape,profile_width_mm=excluded.profile_width_mm,profile_height_mm=excluded.profile_height_mm,outside_diameter_mm=excluded.outside_diameter_mm,nominal_size=excluded.nominal_size,compatible_material_group=excluded.compatible_material_group,wall_min_mm=excluded.wall_min_mm,wall_max_mm=excluded.wall_max_mm,compatibility_group=excluded.compatibility_group,mapping_source='MANUAL',active=1,updated_at=CURRENT_TIMESTAMP`)
      .run({ id, profile_width_mm: null, profile_height_mm: null, outside_diameter_mm: null, nominal_size: null, compatible_material_group: null, wall_min_mm: null, wall_max_mm: null, ...parsed });
    db.prepare("UPDATE panel_connector_cache SET compatibility_status='COMPATIBLE',compatibility_source='MANUAL',compatibility_note='Yönetici tarafından eşlendi' WHERE product_id=?").run(parsed.product_id);
    res.status(201).json(db.prepare("SELECT * FROM connector_compatibility WHERE product_id=?").get(parsed.product_id));
  });

  return router;
}
