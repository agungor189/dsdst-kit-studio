import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import { ZodError } from "zod";
import { createAppAuth, createTestAuth, requireBusinessAccess, requireWriteAccess } from "./middleware/appAuth.js";
import { createAuthRouter } from "./routes/auth.js";
import { createCatalogRouter } from "./routes/catalog.js";
import { createCompatibilityRouter } from "./routes/compatibility.js";
import { createKitsRouter } from "./routes/kits.js";
import { defaultPanelAuthClient, type PanelAuthClient, type PanelUser } from "./services/panelAuthClient.js";
import { ensureOwnedUploadRoot } from "./services/fileContainment.js";
import type { LoginRateLimitOptions } from "./middleware/loginRateLimit.js";

type AppOptions = { authDisabled?: boolean; testUser?: PanelUser; panelAuthClient?: PanelAuthClient; loginRateLimit?: LoginRateLimitOptions };

export function createApp(db: Database.Database, options: AppOptions = {}) {
  const app = express();
  const uploadRoot = ensureOwnedUploadRoot(process.env.UPLOAD_DIR || "uploads");
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) app.set("trust proxy", trustProxyHops);
  const panelAuthClient = options.panelAuthClient || defaultPanelAuthClient;
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:3012").split(",").map((value) => value.trim());
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)), credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/uploads", express.static(uploadRoot, { fallthrough: false, dotfiles: "deny", immutable: true, maxAge: "1d" }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/auth", createAuthRouter(panelAuthClient, options.loginRateLimit));
  const authenticated = options.authDisabled ? createTestAuth(options.testUser) : createAppAuth(panelAuthClient);
  app.use("/api", authenticated, requireBusinessAccess, requireWriteAccess, createCatalogRouter(db), createCompatibilityRouter(db), createKitsRouter(db));

  const dist = path.resolve("dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) return res.status(400).json({ error: "VALIDATION_ERROR", issues: error.issues });
    if (error instanceof multer.MulterError) return res.status(400).json({ error: "UPLOAD_ERROR", message: error.message });
    console.error(error);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  });
  return app;
}
