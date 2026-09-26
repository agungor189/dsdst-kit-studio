import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KitEditor, KitList } from "../src/App";
import { ButtonPrimitive, ConfirmDialog, Input, Modal, Select } from "../src/components/ui";
import type { Bootstrap } from "../src/types";

const user: Bootstrap["user"] = { id: "user-1", username: "operator", role: "admin", permissions: { "kits:write": true }, must_change_password: false };
const bootstrap: Bootstrap = {
  user,
  profiles: [],
  connectors: [],
  complementaryProducts: [],
  suppliers: [],
  settings: {},
  sync: { lastSyncedAt: null, lastAttemptAt: null, panelReachable: true, lastError: null, connectorCount: 0, compatibleCount: 0, unresolvedCount: 0, profileCount: 0, complementCount: 0 },
};

test("ana kit ekranı ortak header ve empty state ile render olur", () => {
  const html = renderToStaticMarkup(createElement(KitList, {
    kits: [], canWrite: true, onOpen: () => undefined, onChanged: async () => undefined, setMessage: () => undefined,
  }));
  assert.match(html, /Kit oluşturma merkezi/);
  assert.match(html, /Henüz eşleşen kit yok/);
  assert.match(html, /Yeni Kit/);
});

test("yeni kit formu BOM ve maliyet alanlarını değiştirmeden render eder", () => {
  const html = renderToStaticMarkup(createElement(KitEditor, {
    mode: "create", data: bootstrap, canWrite: true, canApprove: true,
    onBack: () => undefined, onChanged: async () => undefined,
  }));
  assert.match(html, /Yeni kit/);
  assert.match(html, /Kit adı/);
  assert.match(html, /Bağlantı Elemanları/);
  assert.match(html, /Profil optimizasyonu/);
  assert.match(html, /Tamamlayıcı Ürünler/);
  assert.match(html, /Otomatik kit fiyatı/);
});

test("modal, confirm ve form kontrolleri merkezi bileşenlerden render olur", () => {
  const modal = renderToStaticMarkup(createElement(Modal, { open: true, onClose: () => undefined, title: "Ürün seç", children: "İçerik" }));
  const confirm = renderToStaticMarkup(createElement(ConfirmDialog, { open: true, onClose: () => undefined, onConfirm: () => undefined, title: "Kiti sil", destructive: true }));
  const fields = renderToStaticMarkup(createElement("div", null,
    createElement(Input, { label: "Kit adı", disabled: true }),
    createElement(Select, { label: "Profil", children: createElement("option", null, "Kare") }),
  ));
  assert.match(modal, /role="dialog"/);
  assert.match(confirm, /Kiti sil/);
  assert.match(fields, /Kit adı/);
  assert.match(fields, /disabled=""/);
});

test("Button temel callback ve loading wiring'ini korur", () => {
  let calls = 0;
  const onClick = () => { calls += 1; };
  const button = ButtonPrimitive({ children: "Kaydet", onClick }, null);
  button.props.onClick?.({} as never);
  assert.equal(calls, 1);
  const loading = ButtonPrimitive({ children: "Kaydet", loading: true }, null);
  assert.equal(loading.props.disabled, true);
  assert.equal(loading.props["aria-busy"], true);
});
