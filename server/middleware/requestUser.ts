import type { PanelUser } from "../services/panelAuthClient.js";

declare global {
  namespace Express {
    interface Request {
      user?: PanelUser;
      panelJwt?: string;
    }
  }
}

export {};
