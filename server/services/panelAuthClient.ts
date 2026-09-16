export type PanelUser = {
  id: string;
  username: string;
  role: "admin" | "user" | "readonly";
  permissions: string[];
  must_change_password: boolean;
};

export type PanelAuthClient = {
  login(username: string, password: string): Promise<{ token: string; user: PanelUser }>;
  me(token: string): Promise<PanelUser>;
  changePassword(token: string, currentPassword: string, newPassword: string): Promise<PanelUser>;
};

function panelBaseUrl() {
  const value = process.env.PANEL_API_URL?.replace(/\/$/, "");
  if (!value) throw new Error("PANEL_API_URL is required for authentication");
  return value;
}

async function panelRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${panelBaseUrl()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok || body?.success === false) {
    const error = new Error(body?.error?.message || body?.message || `Panel request failed (${response.status})`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body;
}

function normalizeUser(value: any): PanelUser {
  const role = value?.role === "admin" || value?.role === "readonly" ? value.role : "user";
  return {
    id: String(value?.id || ""), username: String(value?.username || ""), role,
    permissions: Array.isArray(value?.permissions) ? value.permissions.map(String) : [],
    must_change_password: Boolean(value?.must_change_password),
  };
}

export const defaultPanelAuthClient: PanelAuthClient = {
  async login(username, password) {
    const body = await panelRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    if (!body.token) throw new Error("Panel login response did not include a token");
    const token = String(body.token);
    const user = await this.me(token).catch(() => normalizeUser(body.user));
    return { token, user };
  },
  async me(token) {
    const body = await panelRequest("/api/auth/me", { headers: { authorization: `Bearer ${token}` } });
    return normalizeUser(body.user);
  },
  async changePassword(token, currentPassword, newPassword) {
    await panelRequest("/api/auth/change-password", {
      method: "POST", headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    return this.me(token);
  },
};
