import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type Database from "better-sqlite3";
import { createApp } from "../app.js";
import { openDatabase } from "../db/index.js";
import type { PanelAuthClient, PanelUser } from "../services/panelAuthClient.js";

let db: Database.Database; let server: ReturnType<ReturnType<typeof createApp>["listen"]>; let baseUrl = "";
const users: Record<string, PanelUser> = {
  admin: { id: "1", username: "admin", role: "admin", permissions: {}, must_change_password: false },
  readonly: { id: "2", username: "readonly", role: "readonly", permissions: { "kits:view": true }, must_change_password: false },
  forced: { id: "3", username: "forced", role: "user", permissions: { "kits:view": true }, must_change_password: true },
};
const client: PanelAuthClient = {
  async login(username, password) { if (password !== "correct" || !users[username]) throw Object.assign(new Error("invalid"), { status: 401 }); return { token: username, user: users[username] }; },
  async me(token) { if (!users[token]) throw Object.assign(new Error("invalid"), { status: 401 }); return users[token]; },
  async changePassword(token) { users[token] = { ...users[token], must_change_password: false }; return { token: `${token}-replacement`, user: users[token] }; },
  async logout() {},
};

before(async () => {
  db = openDatabase(":memory:"); server = createApp(db, { panelAuthClient: client, loginRateLimit: { maxAttempts: 2, windowMs: 60_000 } }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); db.close(); });

async function login(username: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "correct" }) });
  return { response, cookie: response.headers.get("set-cookie")!.split(";")[0] };
}

test("login stores the Panel JWT only in an HttpOnly SameSite=Lax cookie", async () => {
  const { response, cookie } = await login("admin");
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie")!;
  assert.match(setCookie, /^dsdst_kit_session=admin/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, { headers: { cookie } });
  assert.equal(bootstrap.status, 200);
  assert.equal((await bootstrap.json() as any).user.username, "admin");
});

test("readonly users can read but server rejects mutations", async () => {
  const { cookie } = await login("readonly");
  assert.equal((await fetch(`${baseUrl}/api/bootstrap`, { headers: { cookie } })).status, 200);
  const response = await fetch(`${baseUrl}/api/kits`, { method: "POST", headers: { cookie, origin: "http://localhost:5173", "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 403);
  assert.equal((await response.json() as any).error, "FORBIDDEN");
});

test("must-change-password blocks business APIs but allows the password proxy", async () => {
  const { cookie } = await login("forced");
  assert.equal((await fetch(`${baseUrl}/api/bootstrap`, { headers: { cookie } })).status, 403);
  const changed = await fetch(`${baseUrl}/api/auth/change-password`, { method: "POST", headers: { cookie, origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify({ current_password: "correct", new_password: "new-password" }) });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json() as any).user.must_change_password, false);
});

test("logout revokes the Panel session before clearing the session cookie", async () => {
  const { cookie } = await login("admin");
  const response = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie, origin: "http://localhost:5173" } });
  assert.equal(response.status, 204);
  assert.match(response.headers.get("set-cookie") || "", /dsdst_kit_session=;/);
});

test("cookie-auth unsafe requests fail closed on missing, cross-origin and same-site different Origin", async () => {
  const { cookie } = await login("admin");
  const logout = (origin?: string) => fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { cookie, ...(origin ? { origin } : {}) },
  });

  assert.equal((await logout()).status, 403, "missing Origin");
  assert.equal((await logout("https://attacker.example")).status, 403, "cross-origin");
  assert.equal((await logout("null")).status, 403, "invalid Origin");
  const target = new URL(baseUrl);
  assert.equal((await logout(`${target.protocol}//${target.hostname}:65535`)).status, 403, "same-site different origin");
  assert.equal((await logout("http://localhost:5173")).status, 204, "configured application origin");
});

test("login proxy limits failures by IP and normalized username", async () => {
  const attempt = (username: string) => fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "wrong" }),
  });
  assert.equal((await attempt("Nobody")).status, 401);
  assert.equal((await attempt("nobody")).status, 401);
  const blocked = await attempt("NOBODY");
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json() as any).error, "TOO_MANY_REQUESTS");
  assert.ok(blocked.headers.get("retry-after"));
  assert.equal((await attempt("SomebodyElse")).status, 401);
});
