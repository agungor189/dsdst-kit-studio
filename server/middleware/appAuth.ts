import type { NextFunction, Request, Response } from "express";

export function appAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.KIT_STUDIO_API_TOKEN;
  if (!expected) return next();
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (token !== expected) return res.status(401).json({ error: "UNAUTHORIZED" });
  next();
}
