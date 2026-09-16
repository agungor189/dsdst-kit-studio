import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { fetchPanelProductImage, getPanelSyncStats, syncPanelConnectors } from "../services/panelClient.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const money = z.number().int().nonnegative();
const profileInput = z.object({
  name: z.string().min(2), shape: z.enum(["SQUARE", "ROUND", "RECTANGULAR"]), material: z.string().min(2),
  width_mm: z.number().positive().optional(), height_mm: z.number().positive().optional(), outside_diameter_mm: z.number().positive().optional(), nominal_size: z.string().optional(),
  wall_thickness_mm: z.number().nonnegative(), compatibility_group: z.string().min(2), raw_length_mm: z.number().int().positive().default(6000),
  weight_per_meter_kg: z.number().nonnegative(), purchase_price_per_meter_cents: money, sale_price_per_meter_cents: money,
  supplier_id: z.string().optional().nullable(), notes: z.string().optional(),
}).refine((data) => data.shape === "ROUND" ? Boolean(data.outside_diameter_mm) : Boolean(data.width_mm && data.height_mm), "Profile dimensions do not match shape");
const complementInput = z.object({ name: z.string().min(2), sku_optional: z.string().optional(), description: z.string().optional(), unit_type: z.enum(["PIECE", "METER", "M2"]), purchase_unit_price_cents: money, sale_unit_price_cents: money, supplier_id: z.string().optional().nullable(), website_url_optional: z.string().url().optional().or(z.literal("")), notes: z.string().optional() });

function profileRows(db: Database.Database) {
  return db.prepare(`SELECT p.*, ps.shape, ps.material, ps.width_mm, ps.height_mm, ps.outside_diameter_mm,
    ps.nominal_size, ps.wall_thickness_mm, COALESCE(ps.size_compatibility_group,ps.compatibility_group) compatibility_group, s.name supplier_name
    FROM profiles p JOIN profile_specs ps ON ps.id=p.spec_id
    LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.active=1 AND COALESCE(p.catalog_active,1)=1 ORDER BY p.name`).all();
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
      complementaryProducts: db.prepare("SELECT cp.*, s.name supplier_name FROM complementary_products cp LEFT JOIN suppliers s ON s.id=cp.supplier_id WHERE cp.active=1 AND COALESCE(cp.catalog_active,1)=1 ORDER BY cp.name").all(),
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

  router.get("/panel/complementary-products/:id/image", async (req, res) => {
    const row = db.prepare("SELECT image_path image FROM complementary_products WHERE id=? AND catalog_source='PANEL' AND catalog_active=1").get(req.params.id) as { image?: string } | undefined;
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
    const parsed = profileInput.parse(req.body);
    const specId = crypto.randomUUID(); const id = crypto.randomUUID();
    db.transaction(() => {
      db.prepare("INSERT INTO profile_specs (id,shape,material,width_mm,height_mm,outside_diameter_mm,nominal_size,wall_thickness_mm,compatibility_group,size_compatibility_group) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(specId, parsed.shape, parsed.material, parsed.width_mm ?? null, parsed.height_mm ?? null, parsed.outside_diameter_mm ?? null, parsed.nominal_size ?? null, parsed.wall_thickness_mm, `${parsed.compatibility_group}|${specId}`, parsed.compatibility_group);
      db.prepare("INSERT INTO profiles (id,spec_id,name,raw_length_mm,weight_per_meter_kg,purchase_price_per_meter_cents,sale_price_per_meter_cents,supplier_id,notes) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, specId, parsed.name, parsed.raw_length_mm, parsed.weight_per_meter_kg, parsed.purchase_price_per_meter_cents, parsed.sale_price_per_meter_cents, parsed.supplier_id ?? null, parsed.notes ?? null);
    })();
    res.status(201).json(profileRows(db).find((row: any) => row.id === id));
  });

  router.put("/profiles/:id", (req, res) => {
    const parsed = profileInput.parse(req.body);
    const current = db.prepare("SELECT spec_id FROM profiles WHERE id=? AND active=1").get(req.params.id) as { spec_id: string } | undefined;
    if (!current) return res.status(404).json({ error: "NOT_FOUND" });
    try {
      db.transaction(() => {
        db.prepare(`UPDATE profile_specs SET shape=?,material=?,width_mm=?,height_mm=?,outside_diameter_mm=?,nominal_size=?,wall_thickness_mm=?,compatibility_group=?,size_compatibility_group=? WHERE id=?`)
          .run(parsed.shape, parsed.material, parsed.width_mm ?? null, parsed.height_mm ?? null, parsed.outside_diameter_mm ?? null, parsed.nominal_size ?? null, parsed.wall_thickness_mm, `${parsed.compatibility_group}|${current.spec_id}`, parsed.compatibility_group, current.spec_id);
        db.prepare(`UPDATE profiles SET name=?,raw_length_mm=?,weight_per_meter_kg=?,purchase_price_per_meter_cents=?,sale_price_per_meter_cents=?,supplier_id=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(parsed.name, parsed.raw_length_mm, parsed.weight_per_meter_kg, parsed.purchase_price_per_meter_cents, parsed.sale_price_per_meter_cents, parsed.supplier_id || null, parsed.notes || null, req.params.id);
      })();
    } catch (error: any) {
      if (String(error?.code).includes("SQLITE_CONSTRAINT_UNIQUE")) return res.status(409).json({ error: "DUPLICATE_COMPATIBILITY_GROUP" });
      throw error;
    }
    res.json(profileRows(db).find((row: any) => row.id === req.params.id));
  });

  router.get("/complementary-products", (_req, res) => res.json(db.prepare("SELECT * FROM complementary_products WHERE COALESCE(catalog_active,1)=1 ORDER BY active DESC,name").all()));
  router.post("/complementary-products", (req, res) => {
    const parsed = complementInput.parse(req.body);
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO complementary_products (id,name,sku_optional,description,unit_type,purchase_unit_price_cents,sale_unit_price_cents,supplier_id,website_url_optional,notes)
      VALUES (@id,@name,@sku_optional,@description,@unit_type,@purchase_unit_price_cents,@sale_unit_price_cents,@supplier_id,@website_url_optional,@notes)`)
      .run({ id, sku_optional: null, description: null, supplier_id: null, website_url_optional: null, notes: null, ...parsed });
    res.status(201).json(db.prepare("SELECT * FROM complementary_products WHERE id=?").get(id));
  });

  router.put("/complementary-products/:id", (req, res) => {
    const parsed = complementInput.parse(req.body);
    const result = db.prepare(`UPDATE complementary_products SET name=@name,sku_optional=@sku_optional,description=@description,unit_type=@unit_type,
      purchase_unit_price_cents=@purchase_unit_price_cents,sale_unit_price_cents=@sale_unit_price_cents,supplier_id=@supplier_id,
      website_url_optional=@website_url_optional,notes=@notes,updated_at=CURRENT_TIMESTAMP WHERE id=@id AND active=1`)
      .run({ id: req.params.id, sku_optional: null, description: null, supplier_id: null, website_url_optional: null, notes: null, ...parsed });
    return result.changes ? res.json(db.prepare("SELECT * FROM complementary_products WHERE id=?").get(req.params.id)) : res.status(404).json({ error: "NOT_FOUND" });
  });

  function saveImage(table: "profiles" | "complementary_products", folder: string) {
    return (req: express.Request, res: express.Response) => {
      const file = req.file;
      if (!file || !validImage(file.buffer, file.mimetype)) return res.status(415).json({ error: "INVALID_IMAGE" });
      const extension = file.mimetype === "image/png" ? ".png" : file.mimetype === "image/jpeg" ? ".jpg" : ".webp";
      const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "uploads");
      const directory = path.join(uploadRoot, folder); fs.mkdirSync(directory, { recursive: true });
      const filename = `${crypto.randomUUID()}${extension}`; fs.writeFileSync(path.join(directory, filename), file.buffer, { flag: "wx" });
      const imagePath = `/uploads/${folder}/${filename}`;
      const result = db.prepare(`UPDATE ${table} SET image_path=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(imagePath, req.params.id);
      if (!result.changes) { fs.unlinkSync(path.join(directory, filename)); return res.status(404).json({ error: "NOT_FOUND" }); }
      return res.json({ image_path: imagePath });
    };
  }

  router.post("/profiles/:id/image", upload.single("image"), saveImage("profiles", "profiles"));

  router.post("/complementary-products/:id/image", upload.single("image"), saveImage("complementary_products", "complementary-products"));

  return router;
}
