import type { NextFunction, Request, Response } from "express";
import type { PanelAuthClient, PanelUser } from "../services/panelAuthClient.js";

export const SESSION_COOKIE = "dsdst_kit_session";

function readCookie(req: Request, name: string) {
  const source = req.headers.cookie || "";
  for (const entry of source.split(";")) {
    const [key, ...rest] = entry.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function sessionCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 60 * 60 * 1000 };
}

export function clearSessionCookieOptions() {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions();
  return options;
}

export function createAppAuth(client: PanelAuthClient) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return res.status(401).json({ error: "UNAUTHORIZED" });
    try {
      req.user = await client.me(token);
      req.panelJwt = token;
      next();
    } catch {
      res.clearCookie(SESSION_COOKIE, clearSessionCookieOptions());
      res.status(401).json({ error: "UNAUTHORIZED" });
    }
  };
}

export function createTestAuth(user: PanelUser = { id: "test-admin", username: "test-admin", role: "admin", permissions: {}, must_change_password: false }) {
  return (req: Request, _res: Response, next: NextFunction) => { req.user = user; next(); };
}

export function requireBusinessAccess(req: Request, res: Response, next: NextFunction) {
  if (req.user?.must_change_password) return res.status(403).json({ error: "PASSWORD_CHANGE_REQUIRED" });
  next();
}

export function userHasKitCapability(user: PanelUser | undefined, capability: "kits:view" | "kits:write" | "kits:approve") {
  return Boolean(user && (user.role === "admin" || user.permissions?.[capability] === true));
}

export function requireKitAccess(req: Request, res: Response, next: NextFunction) {
  const safe = req.method === "GET" || req.method === "HEAD";
  const capability = safe ? "kits:view" : /^\/variants\/[^/]+\/approve$/.test(req.path) ? "kits:approve" : "kits:write";
  if (!userHasKitCapability(req.user, capability)) return res.status(403).json({ error: "FORBIDDEN", required: capability });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "ADMIN_REQUIRED" });
  next();
}
