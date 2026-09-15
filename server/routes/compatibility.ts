import type Database from "better-sqlite3";
import express from "express";
import { compatibleConnectorsForProfile, compatibleProfilesForConnector, resolveConnector } from "../services/compatibility.js";

export function createCompatibilityRouter(db: Database.Database) {
  const router = express.Router();

  router.get("/compatibility/profiles/:profileId/connectors", (req, res) => {
    res.json(compatibleConnectorsForProfile(db, req.params.profileId));
  });

  router.get("/compatibility/connectors/:productId/profiles", (req, res) => {
    res.json(compatibleProfilesForConnector(db, req.params.productId));
  });

  router.get("/compatibility/resolve", (req, res) => {
    const role = String(req.query.role || "");
    const profileId = String(req.query.profile_id || "");
    const connector = resolveConnector(db, role, profileId);
    if (!connector) return res.status(404).json({ error: "MAPPING_NOT_FOUND", role, profile_id: profileId });
    res.json(connector);
  });

  return router;
}
