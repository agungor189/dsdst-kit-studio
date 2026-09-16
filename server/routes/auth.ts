import express from "express";
import { z } from "zod";
import { clearSessionCookieOptions, createAppAuth, SESSION_COOKIE, sessionCookieOptions } from "../middleware/appAuth.js";
import type { PanelAuthClient } from "../services/panelAuthClient.js";

function authFailure(res: express.Response, error: unknown) {
  const status = Number((error as any)?.status || 0);
  if (status === 401 || status === 403) return res.status(401).json({ error: "INVALID_CREDENTIALS" });
  return res.status(502).json({ error: "PANEL_AUTH_UNAVAILABLE" });
}

export function createAuthRouter(client: PanelAuthClient) {
  const router = express.Router();
  const authenticated = createAppAuth(client);
  router.post("/login", async (req, res) => {
    const parsed = z.object({ username: z.string().min(1), password: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", issues: parsed.error.issues });
    const { username, password } = parsed.data;
    try {
      const result = await client.login(username, password);
      res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions());
      res.json({ user: result.user });
    } catch (error) { authFailure(res, error); }
  });
  router.get("/me", authenticated, (req, res) => res.json({ user: req.user }));
  router.post("/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, clearSessionCookieOptions());
    res.status(204).end();
  });
  router.post("/change-password", authenticated, async (req, res) => {
    const parsed = z.object({ current_password: z.string().min(1), new_password: z.string().min(8) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", issues: parsed.error.issues });
    const body = parsed.data;
    try {
      const user = await client.changePassword(req.panelJwt!, body.current_password, body.new_password);
      res.json({ user });
    } catch (error) { authFailure(res, error); }
  });
  return router;
}
