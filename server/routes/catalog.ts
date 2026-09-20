import crypto from "node:crypto";
import type Database from "better-sqlite3";
import express from "express";
import sharp from "sharp";
import { z } from "zod";
import { fetchPanelProductImage, getPanelSyncStats, syncPanelConnectors } from "../services/panelClient.js";

function profileRows(db: Database.Database) {
  return db.prepare(`SELECT p.*, ps.shape, ps.material, ps.width_mm, ps.height_mm, ps.outside_diameter_mm,
    ps.nominal_size, ps.wall_thickness_mm, COALESCE(ps.size_compatibility_group,ps.compatibility_group) compatibility_group, s.name supplier_name
    FROM profiles p JOIN profile_specs ps ON ps.id=p.spec_id
    LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.active=1 AND COALESCE(p.catalog_active,1)=1 ORDER BY p.name`).all();
}

export async function validImage(buffer: Buffer, mimetype: string) {
  const expected = mimetype === "image/jpeg" ? "jpeg" : mimetype === "image/png" ? "png" : mimetype === "image/webp" ? "webp" : null;
  if (!expected) return false;
  try {
    const image = sharp(buffer, { failOn: "error", limitInputPixels: 25_000_000, sequentialRead: true });
    const metadata = await image.metadata();
    if (metadata.format !== expected || !metadata.width || !metadata.height) return false;
    if (metadata.width * metadata.height > 25_000_000 || Number(metadata.pages || 1) !== 1) return false;
    await image.clone().raw().toBuffer();
    return true;
  } catch {
    return false;
  }
}

export function createCatalogRouter(db: Database.Database) {
  const router = express.Router();

  router.use((req, res, next) => {
    const isCatalogMutation = !["GET", "HEAD", "OPTIONS"].includes(req.method)
      && (/^\/profiles(?:\/|$)/.test(req.path) || /^\/complementary-products(?:\/|$)/.test(req.path));
    if (!isCatalogMutation) return next();
    return res.status(410).json({
      error: "CATALOG_READ_ONLY",
      message: "Kit Studio catalog is a read-only projection of Panel catalog v1.",
    });
  });

  router.get("/bootstrap", (req, res) => {
    res.json({
      user: req.user,
      profiles: profileRows(db),
      complementaryProducts: db.prepare("SELECT cp.*, s.name supplier_name FROM complementary_products cp LEFT JOIN suppliers s ON s.id=cp.supplier_id WHERE cp.active=1 AND COALESCE(cp.catalog_active,1)=1 ORDER BY cp.name").all(),
      connectors: db.prepare(`SELECT pc.*, cc.connector_role, cc.compatibility_group, cc.profile_shape,cc.compatible_material_group,
        cc.profile_width_mm,cc.profile_height_mm,cc.outside_diameter_mm,cc.nominal_size,cc.wall_min_mm,cc.wall_max_mm
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

  router.get("/complementary-products", (_req, res) => res.json(db.prepare("SELECT * FROM complementary_products WHERE COALESCE(catalog_active,1)=1 ORDER BY active DESC,name").all()));

  return router;
}
