import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Boxes, CheckCircle2, CircleDollarSign, Layers3, LogOut, PackagePlus, RefreshCw, Search, Shapes, Wrench } from "lucide-react";
import type { Bootstrap, Connector, User } from "./types";

const money = (cents: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(cents / 100);
const apiFetch = (url: string, init: RequestInit = {}) => fetch(url, { ...init, credentials: "include", headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) } });

type Cut = { id: string; quantity: number; length_mm: number };
type ManualForm = { product_id: string; connector_role: string; profile_shape: "SQUARE" | "ROUND" | "RECTANGULAR"; width: string; height: string; diameter: string; group: string; material: string; wallMin: string; wallMax: string };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [profileId, setProfileId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedConnectors, setSelectedConnectors] = useState<Record<string, number>>({});
  const [selectedComplements, setSelectedComplements] = useState<Record<string, number>>({});
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [cutQuantity, setCutQuantity] = useState("");
  const [cutLength, setCutLength] = useState("");
  const [kitName, setKitName] = useState("");
  const [activeLibrary, setActiveLibrary] = useState<"connectors" | "profiles" | "complements">("connectors");
  const [view, setView] = useState<"builder" | "catalogs">("builder");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [manual, setManual] = useState<ManualForm | null>(null);

  async function loadBootstrap() {
    const response = await apiFetch("/api/bootstrap");
    if (response.status === 401) { setUser(null); setData(null); return; }
    if (response.status === 403) {
      const body = await response.json().catch(() => ({}));
      if (body.error === "PASSWORD_CHANGE_REQUIRED") setUser((current) => current ? { ...current, must_change_password: true } : current);
      return;
    }
    if (!response.ok) throw new Error("Katalog yüklenemedi");
    const next = await response.json() as Bootstrap;
    setData(next); setUser(next.user);
  }

  useEffect(() => {
    (async () => {
      try {
        const response = await apiFetch("/api/auth/me");
        if (response.ok) {
          const body = await response.json() as { user: User };
          setUser(body.user);
          if (!body.user.must_change_password) await loadBootstrap();
        }
      } catch { setAuthError("Panel kimlik doğrulama servisine ulaşılamadı"); }
      finally { setLoading(false); }
    })();
  }, []);

  const profile = data?.profiles.find((item) => item.id === profileId);
  const resolvedConnectors = useMemo(() => data?.connectors.filter((item) => item.compatibility_status === "COMPATIBLE" && item.connector_role && item.compatibility_group) || [], [data]);
  const chosen = useMemo(() => resolvedConnectors.filter((item) => selectedConnectors[item.product_id]).map((connector) => ({ connector, quantity: selectedConnectors[connector.product_id] })), [resolvedConnectors, selectedConnectors]);
  const allowedGroups = useMemo(() => new Set(chosen.map(({ connector }) => connector.compatibility_group!)), [chosen]);
  const availableProfiles = useMemo(() => data?.profiles.filter((item) => !allowedGroups.size || (allowedGroups.size === 1 && allowedGroups.has(item.compatibility_group))) || [], [data, allowedGroups]);
  const visibleConnectors = useMemo(() => resolvedConnectors.filter((item) => (!profile || item.compatibility_group === profile.compatibility_group) && `${item.sku} ${item.name_tr}`.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr"))), [resolvedConnectors, profile, query]);
  const unresolved = data?.connectors.filter((item) => item.compatibility_status === "UNRESOLVED") || [];
  const cutMeters = cuts.reduce((sum, cut) => sum + cut.quantity * cut.length_mm, 0) / 1000;
  const connectorCost = chosen.reduce((sum, line) => sum + line.connector.purchase_cost_cents * line.quantity, 0);
  const connectorSale = chosen.reduce((sum, line) => sum + line.connector.sale_price_cents * line.quantity, 0);
  const profileCost = Math.round((profile?.purchase_price_per_meter_cents || 0) * cutMeters);
  const profileSale = Math.round((profile?.sale_price_per_meter_cents || 0) * cutMeters);
  const complementLines = (data?.complementaryProducts || []).filter((item) => selectedComplements[item.id]).map((item) => ({ item, quantity: selectedComplements[item.id] }));
  const complementCost = complementLines.reduce((sum, line) => sum + line.item.purchase_unit_price_cents * line.quantity, 0);
  const complementSale = complementLines.reduce((sum, line) => sum + line.item.sale_unit_price_cents * line.quantity, 0);
  const cost = connectorCost + profileCost + complementCost;
  const sale = connectorSale + profileSale + complementSale;
  const profit = sale - cost;
  const vatRate = Number(data?.settings.vat_rate_basis_points || 2000) / 10000;
  const vat = Math.round(sale * vatRate);
  const canWrite = user?.role !== "readonly";

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthError("");
    const form = new FormData(event.currentTarget);
    const response = await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
    if (!response.ok) { setAuthError(response.status === 502 ? "Panel servisine ulaşılamadı" : "Kullanıcı adı veya parola hatalı"); return; }
    const body = await response.json() as { user: User };
    setUser(body.user);
    if (!body.user.must_change_password) await loadBootstrap();
  }

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setUser(null); setData(null); setProfileId(""); setSelectedConnectors({});
  }

  function addCut() {
    const quantity = Number(cutQuantity); const length_mm = Number(cutLength);
    if (!Number.isInteger(quantity) || quantity < 1 || !Number.isInteger(length_mm) || length_mm < 1) { setNotice("Kesim adedi ve uzunluğu pozitif tam sayı olmalı"); return; }
    setCuts((current) => [...current, { id: crypto.randomUUID(), quantity, length_mm }]);
    setCutQuantity(""); setCutLength(""); setNotice("");
  }

  async function saveVariant() {
    if (!profile || !kitName.trim()) { setNotice("Kit adı ve profil seçimi gerekli"); return; }
    setSaving(true); setNotice("");
    try {
      const created = await apiFetch("/api/kits", { method: "POST", body: JSON.stringify({ name: kitName.trim(), profile_id: profile.id }) });
      if (!created.ok) throw new Error("Kit oluşturulamadı");
      const kit = await created.json();
      const response = await apiFetch(`/api/variants/${kit.variants[0].id}`, { method: "PUT", body: JSON.stringify({
        profile_id: profile.id,
        connectors: chosen.map(({ connector, quantity }) => ({ role: connector.connector_role, product_id: connector.product_id, quantity })),
        cuts: cuts.map(({ quantity, length_mm }) => ({ quantity, length_mm })),
        complementary_items: complementLines.map(({ item, quantity }) => ({ product_id: item.id, quantity })),
      }) });
      if (!response.ok) throw new Error("Varyant kaydedilemedi");
      setNotice("Kit ve fiyat snapshot’ı kaydedildi");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Kayıt hatası"); }
    finally { setSaving(false); }
  }

  async function syncPanel() {
    setSaving(true); setNotice("");
    try {
      const response = await apiFetch("/api/panel/sync", { method: "POST" });
      if (!response.ok) throw new Error("Panel senkronizasyonu başarısız");
      await loadBootstrap(); setNotice("Panel kataloğu güncellendi");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Senkronizasyon hatası"); }
    finally { setSaving(false); }
  }

  async function saveManualMapping(event: FormEvent) {
    event.preventDefault(); if (!manual) return;
    const payload = {
      product_id: manual.product_id, connector_role: manual.connector_role, profile_shape: manual.profile_shape,
      profile_width_mm: manual.width ? Number(manual.width) : undefined, profile_height_mm: manual.height ? Number(manual.height) : undefined,
      outside_diameter_mm: manual.diameter ? Number(manual.diameter) : undefined, compatible_material_group: manual.material || undefined,
      wall_min_mm: manual.wallMin ? Number(manual.wallMin) : undefined, wall_max_mm: manual.wallMax ? Number(manual.wallMax) : undefined,
      compatibility_group: manual.group,
    };
    const response = await apiFetch("/api/connector-compatibility", { method: "POST", body: JSON.stringify(payload) });
    if (!response.ok) { setNotice("Manuel eşleme kaydedilemedi"); return; }
    setManual(null); await loadBootstrap(); setNotice("Manuel uyumluluk eşlemesi kaydedildi");
  }

  if (loading) return <div className="loading"><span className="spinner"/>Oturum denetleniyor…</div>;
  if (!user) return <LoginScreen onSubmit={login} error={authError}/>;
  if (user.must_change_password) return <PasswordChange user={user} onChanged={(next) => { setUser(next); void loadBootstrap(); }} onLogout={logout}/>;
  if (!data) return <div className="loading"><span className="spinner"/>Katalog hazırlanıyor…</div>;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark"><Wrench size={18}/></div><div><strong>DSDST</strong><span>Kit Studio</span></div>
      <nav><button className={view === "builder" ? "nav-active" : ""} onClick={() => setView("builder")}><Layers3 size={16}/>Kit Builder</button><button className={view === "catalogs" ? "nav-active" : ""} onClick={() => setView("catalogs")}><Shapes size={16}/>Kataloglar</button></nav>
      <div className="user-chip"><strong>{user.username}</strong><span>{user.role}</span></div><button className="icon-button" onClick={logout} aria-label="Çıkış yap"><LogOut size={18}/></button>
    </header>
    {view === "builder" && <main className="workspace">
      <aside className="library panel">
        <div className="panel-heading"><div><span className="eyebrow">Ürün kütüphanesi</span><h2>Parça seçimi</h2></div><Boxes size={20}/></div>
        <div className="segmented"><button className={activeLibrary === "connectors" ? "selected" : ""} onClick={() => setActiveLibrary("connectors")}>Bağlantı</button><button className={activeLibrary === "profiles" ? "selected" : ""} onClick={() => setActiveLibrary("profiles")}>Profil</button><button className={activeLibrary === "complements" ? "selected" : ""} onClick={() => setActiveLibrary("complements")}>Tamamlayıcı</button></div>
        <label className="search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SKU veya ürün ara"/></label>
        <div className="filter-note"><span className="status-dot"/> {profile ? `${profile.name} ile uyumlu` : chosen.length ? "Bağlantılara uyan profili seçin" : "Tüm uyumlu Panel ürünleri"}</div>
        <div className="library-list">
          {activeLibrary === "connectors" && visibleConnectors.map((item) => <article className="library-card" key={item.product_id}>{item.image ? <img className="part-image" src={`/api/panel/products/${encodeURIComponent(item.product_id)}/image`} alt=""/> : <div className="part-icon">{item.connector_role}</div>}<div className="part-copy"><strong>{item.sku}</strong><span>{item.name_tr}</span><small>{item.central_stock} stok · {money(item.sale_price_cents)} · {item.compatibility_source === "SKU_FALLBACK" ? "SKU fallback" : item.compatibility_source}</small></div><button disabled={!canWrite} onClick={() => setSelectedConnectors((current) => ({ ...current, [item.product_id]: (current[item.product_id] || 0) + 1 }))}><PackagePlus size={17}/></button></article>)}
          {activeLibrary === "profiles" && availableProfiles.map((item) => <button className={`library-card profile-option ${profileId === item.id ? "active" : ""}`} key={item.id} onClick={() => setProfileId(item.id)}><div className={`shape-icon ${item.shape.toLowerCase()}`}/><div className="part-copy"><strong>{item.name}</strong><span>{item.compatibility_group}</span><small>{money(item.sale_price_per_meter_cents)} / m</small></div></button>)}
          {activeLibrary === "complements" && data.complementaryProducts.map((item) => <article className="library-card" key={item.id}><div className="part-icon">{item.unit_type}</div><div className="part-copy"><strong>{item.name}</strong><span>{money(item.sale_unit_price_cents)} / {item.unit_type}</span></div><button disabled={!canWrite} onClick={() => setSelectedComplements((current) => ({ ...current, [item.id]: (current[item.id] || 0) + 1 }))}><PackagePlus size={17}/></button></article>)}
        </div>
      </aside>
      <section className="builder panel">
        <div className="builder-head"><div><span className="eyebrow">Yeni kit</span><h1>{profile?.name || "Boş çalışma alanı"}</h1></div><span className="pill draft">Taslak</span></div>
        <div className={`compat-banner ${profile && (!allowedGroups.size || allowedGroups.has(profile.compatibility_group)) ? "" : "warning"}`}><span className="shield">{profile ? "✓" : "!"}</span><div><strong>{profile ? "Uyumluluk filtresi etkin" : "Profil seçilmedi"}</strong><span>Çözümlenmemiş ürünler Builder’da hiçbir zaman seçilemez.</span></div></div>
        <section className="bom-section"><div className="section-title"><h3>Profil kesimleri</h3><span>{cutMeters.toFixed(2)} m</span></div><div className="inline-form"><input type="number" min="1" value={cutQuantity} onChange={(e) => setCutQuantity(e.target.value)} placeholder="Adet"/><input type="number" min="1" value={cutLength} onChange={(e) => setCutLength(e.target.value)} placeholder="Uzunluk (mm)"/><button disabled={!canWrite} onClick={addCut}>Kesim ekle</button></div>{cuts.length === 0 && <EmptyRow text="Henüz kesim eklenmedi"/>}{cuts.map((cut) => <div className="bom-row" key={cut.id}><div className="cut-visual"/><strong>{cut.quantity} × {cut.length_mm} mm</strong><button className="text-button" onClick={() => setCuts((current) => current.filter((item) => item.id !== cut.id))}>Kaldır</button><span>{(cut.quantity * cut.length_mm / 1000).toFixed(2)} m</span></div>)}</section>
        <section className="bom-section"><div className="section-title"><h3>Bağlantılar</h3><span>{chosen.reduce((sum, line) => sum + line.quantity, 0)} adet</span></div>{chosen.length === 0 && <EmptyRow text="Henüz bağlantı seçilmedi"/>}{chosen.map(({ connector, quantity }) => <BomLine key={connector.product_id} connector={connector} quantity={quantity} onQuantity={(next) => setSelectedConnectors((current) => { const copy = { ...current }; if (next < 1) delete copy[connector.product_id]; else copy[connector.product_id] = next; return copy; })}/>)}</section>
        <section className="bom-section"><div className="section-title"><h3>Tamamlayıcılar</h3><span>{complementLines.length} kalem</span></div>{complementLines.length === 0 && <EmptyRow text="Henüz tamamlayıcı ürün seçilmedi"/>}{complementLines.map(({ item, quantity }) => <div className="bom-row" key={item.id}><div className="role-badge light">{item.unit_type}</div><div><strong>{item.name}</strong><small>{quantity} {item.unit_type}</small></div><div className="stepper"><button onClick={() => setSelectedComplements((c) => ({ ...c, [item.id]: Math.max(0, quantity - 1) }))}>−</button><span>{quantity}</span><button onClick={() => setSelectedComplements((c) => ({ ...c, [item.id]: quantity + 1 }))}>+</button></div><span>{money(item.sale_unit_price_cents * quantity)}</span></div>)}</section>
      </section>
      <aside className="pricing panel"><div className="panel-heading"><div><span className="eyebrow">Canlı fiyat analizi</span><h2>Varyant özeti</h2></div><CircleDollarSign size={21}/></div><PriceGroup title="Bağlantılar" cost={connectorCost} sale={connectorSale}/><PriceGroup title="Profiller" cost={profileCost} sale={profileSale}/><PriceGroup title="Tamamlayıcılar" cost={complementCost} sale={complementSale}/><div className="grand-total"><div><span>Toplam maliyet</span><strong>{money(cost)}</strong></div><div><span>KDV hariç satış</span><strong>{money(sale)}</strong></div><div className="profit"><span>Brüt kâr</span><strong>{money(profit)}</strong></div><div><span>KDV</span><strong>{money(vat)}</strong></div><div className="vat-total"><span>KDV dahil satış</span><strong>{money(sale + vat)}</strong></div></div>{notice && <div className="save-notice"><CheckCircle2 size={15}/>{notice}</div>}<input className="kit-name" value={kitName} onChange={(event) => setKitName(event.target.value)} placeholder="Kit adı"/><button className="primary-button" disabled={!canWrite || saving} onClick={saveVariant}>{canWrite ? (saving ? "Kaydediliyor…" : "Yeni kiti kaydet") : "Salt okunur"}</button><p className="price-note">Bağlantı fiyatları Panel kaynağından salt okunur alınır.</p></aside>
    </main>}
    {view === "catalogs" && <section className="page-view"><div className="page-title"><div><span className="eyebrow">Katalog yönetimi</span><h1>Panel ürün senkronizasyonu</h1></div>{canWrite && <button className="secondary-button compact" disabled={saving} onClick={syncPanel}><RefreshCw size={16}/> Şimdi senkronize et</button>}</div><div className={`sync-banner ${data.sync.panelReachable ? "reachable" : "stale"}`}><strong>{data.sync.panelReachable ? "Panel erişilebilir" : "Panel erişilemiyor — son önbellek kullanılıyor"}</strong><span>Son başarılı: {data.sync.lastSyncedAt ? new Date(data.sync.lastSyncedAt).toLocaleString("tr-TR") : "yok"}</span>{data.sync.lastError && <small>{data.sync.lastError}</small>}</div><div className="catalog-grid"><CatalogStat label="Toplam bağlantı" value={data.sync.connectorCount}/><CatalogStat label="Uyumlu" value={data.sync.compatibleCount}/><CatalogStat label="Uyumluluk bekleyen" value={data.sync.unresolvedCount}/></div><div className="unresolved panel"><div className="panel-heading"><div><span className="eyebrow">İnceleme kuyruğu</span><h2>Uyumluluk Bekleyenler ({unresolved.length})</h2></div></div>{unresolved.length === 0 ? <EmptyRow text="Bekleyen ürün yok"/> : unresolved.map((item) => <div className="unresolved-row" key={item.product_id}><div><strong>{item.sku}</strong><span>{item.name_tr} · {item.size || "ölçü yok"}</span><small>{item.compatibility_note}</small></div>{user.role === "admin" && <button onClick={() => setManual({ product_id: item.product_id, connector_role: "ELB", profile_shape: "SQUARE", width: "", height: "", diameter: "", group: "", material: "", wallMin: "", wallMax: "" })}>Manuel eşle</button>}</div>)}</div>{manual && <ManualMapping form={manual} setForm={setManual} onSubmit={saveManualMapping}/>}</section>}
  </div>;
}

function LoginScreen({ onSubmit, error }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; error: string }) { return <div className="auth-screen"><form onSubmit={onSubmit}><div className="brand-mark"><Wrench size={18}/></div><span className="eyebrow">DSDST Kit Studio</span><h1>Panel hesabınızla giriş yapın</h1><p>Kullanıcı adı ve parola doğrudan Panel sunucusunda doğrulanır.</p><input name="username" autoComplete="username" autoFocus placeholder="Kullanıcı adı"/><input name="password" type="password" autoComplete="current-password" placeholder="Parola"/><button className="primary-button" type="submit">Giriş yap</button>{error && <small>{error}</small>}</form></div>; }

function PasswordChange({ user, onChanged, onLogout }: { user: User; onChanged: (user: User) => void; onLogout: () => void }) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); if (form.get("new") !== form.get("confirm")) { setError("Yeni parolalar eşleşmiyor"); return; } const response = await apiFetch("/api/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: form.get("current"), new_password: form.get("new") }) }); if (!response.ok) { setError("Parola değiştirilemedi"); return; } onChanged((await response.json()).user); }
  return <div className="auth-screen"><form onSubmit={submit}><span className="eyebrow">{user.username}</span><h1>Parolanızı değiştirin</h1><p>Panel hesabınız ilk kullanım parola değişikliği istiyor.</p><input name="current" type="password" placeholder="Mevcut parola"/><input name="new" type="password" minLength={8} placeholder="Yeni parola"/><input name="confirm" type="password" minLength={8} placeholder="Yeni parola tekrar"/><button className="primary-button">Parolayı değiştir</button><button type="button" className="link-button" onClick={onLogout}>Çıkış yap</button>{error && <small>{error}</small>}</form></div>;
}

function BomLine({ connector, quantity, onQuantity }: { connector: Connector; quantity: number; onQuantity: (value: number) => void }) { return <div className="bom-row"><div className="role-badge">{connector.connector_role}</div><div><strong>{connector.sku}</strong><small>{connector.name_tr}</small></div><div className="stepper"><button onClick={() => onQuantity(quantity - 1)}>−</button><span>{quantity}</span><button onClick={() => onQuantity(quantity + 1)}>+</button></div><span>{money(connector.sale_price_cents * quantity)}</span></div>; }
function EmptyRow({ text }: { text: string }) { return <div className="empty-row">{text}</div>; }
function PriceGroup({ title, cost, sale }: { title: string; cost: number; sale: number }) { return <div className="price-group"><h3>{title}</h3><div><span>Maliyet</span><strong>{money(cost)}</strong></div><div><span>Satış</span><strong>{money(sale)}</strong></div></div>; }
function CatalogStat({ label, value }: { label: string; value: number }) { return <article className="catalog-stat"><div><Boxes/></div><span>{label}</span><strong>{value}</strong></article>; }

function ManualMapping({ form, setForm, onSubmit }: { form: ManualForm; setForm: (value: ManualForm | null) => void; onSubmit: (event: FormEvent) => void }) {
  const update = (key: keyof ManualForm, value: string) => setForm({ ...form, [key]: value });
  return <div className="modal-backdrop"><form className="manual-modal" onSubmit={onSubmit}><span className="eyebrow">Yönetici eşlemesi</span><h2>Uyumluluk ata</h2><label>Rol<select value={form.connector_role} onChange={(e) => update("connector_role", e.target.value)}>{["ELB","BAS","TEE","3W","4W","5W","B4W","LTE","CRS","CPL","BCP","45T"].map((role) => <option key={role}>{role}</option>)}</select></label><label>Şekil<select value={form.profile_shape} onChange={(e) => update("profile_shape", e.target.value)}><option value="SQUARE">Kare</option><option value="RECTANGULAR">Dikdörtgen</option><option value="ROUND">Yuvarlak</option></select></label>{form.profile_shape === "ROUND" ? <label>Dış çap (mm)<input required type="number" step="any" value={form.diameter} onChange={(e) => update("diameter", e.target.value)}/></label> : <div className="two-fields"><label>Genişlik<input required type="number" step="any" value={form.width} onChange={(e) => update("width", e.target.value)}/></label><label>Yükseklik<input required type="number" step="any" value={form.height} onChange={(e) => update("height", e.target.value)}/></label></div>}<label>Uyumluluk grubu<input required placeholder="SQ-20X20 veya RD-33.7" value={form.group} onChange={(e) => update("group", e.target.value)}/></label><label>Malzeme grubu<input value={form.material} onChange={(e) => update("material", e.target.value)} placeholder="ALUMINUM"/></label><div className="two-fields"><label>Min. et<input type="number" step="any" value={form.wallMin} onChange={(e) => update("wallMin", e.target.value)}/></label><label>Maks. et<input type="number" step="any" value={form.wallMax} onChange={(e) => update("wallMax", e.target.value)}/></label></div><div className="modal-actions"><button type="button" onClick={() => setForm(null)}>Vazgeç</button><button className="primary-button" type="submit">Kaydet</button></div></form></div>;
}
