import { useEffect, useMemo, useState } from "react";
import { Boxes, CheckCircle2, CircleDollarSign, GitCompareArrows, Layers3, LockKeyhole, PackagePlus, Search, Settings2, Shapes, Wrench } from "lucide-react";
import type { Bootstrap, Connector } from "./types";

const money = (cents: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(cents / 100);

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [profileId, setProfileId] = useState("profile-sq20");
  const [query, setQuery] = useState("");
  const [connectors, setConnectors] = useState<Record<string, number>>({ ELB: 8, TEE: 4, BAS: 4 });
  const [activeLibrary, setActiveLibrary] = useState<"connectors" | "profiles" | "complements">("connectors");
  const [savedVariantId, setSavedVariantId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => { fetch("/api/bootstrap").then((response) => response.json()).then(setData); }, []);
  const profile = data?.profiles.find((item) => item.id === profileId);
  const compatible = useMemo(() => data?.connectors.filter((item) => item.compatibility_group === profile?.compatibility_group) || [], [data, profile]);
  const chosen = Object.entries(connectors).map(([role, quantity]) => ({ connector: compatible.find((item) => item.connector_role === role), quantity })).filter((line): line is { connector: Connector; quantity: number } => Boolean(line.connector));
  const cutMeters = (4 * 1800 + 8 * 1200 + 8 * 600) / 1000;
  const connectorCost = chosen.reduce((sum, line) => sum + line.connector.purchase_cost_cents * line.quantity, 0);
  const connectorSale = chosen.reduce((sum, line) => sum + line.connector.sale_price_cents * line.quantity, 0);
  const profileCost = Math.round((profile?.purchase_price_per_meter_cents || 0) * cutMeters);
  const profileSale = Math.round((profile?.sale_price_per_meter_cents || 0) * cutMeters);
  const complementCost = 19500 * 1.8 + 8500 * 4;
  const complementSale = 28500 * 1.8 + 13500 * 4;
  const cost = connectorCost + profileCost + complementCost;
  const sale = connectorSale + profileSale + complementSale;
  const profit = sale - cost; const vat = Math.round(sale * 0.2);

  async function saveVariant() {
    if (!profile) return;
    setSaving(true); setNotice("");
    try {
      let variantId = savedVariantId;
      if (!variantId) {
        const created = await fetch("/api/kits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "3 Katlı Raf", description: "Modüler üç katlı raf kiti", profile_id: profile.id }) });
        if (!created.ok) throw new Error("Kit oluşturulamadı");
        const kit = await created.json(); variantId = kit.variants[0].id; setSavedVariantId(variantId);
      }
      const response = await fetch(`/api/variants/${variantId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({
        profile_id: profile.id,
        connectors: Object.entries(connectors).map(([role, quantity]) => ({ role, quantity })),
        cuts: [{ quantity: 4, length_mm: 1800 }, { quantity: 8, length_mm: 1200 }, { quantity: 8, length_mm: 600 }],
        complementary_items: [{ product_id: "comp-mdf", quantity: 1.8 }, { product_id: "comp-wheel", quantity: 4 }],
      }) });
      if (!response.ok) throw new Error("Varyant kaydedilemedi");
      setNotice("BOM ve fiyat snapshot’ı kaydedildi");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Kayıt hatası"); }
    finally { setSaving(false); }
  }

  if (!data) return <div className="loading"><span className="spinner" />Katalog hazırlanıyor…</div>;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark"><Wrench size={18} /></div>
      <div><strong>DSDST</strong><span>Kit Studio</span></div>
      <nav><button className="nav-active"><Layers3 size={16}/>Kit Builder</button><button><GitCompareArrows size={16}/>Varyantlar</button><button><Shapes size={16}/>Kataloglar</button></nav>
      <button className="icon-button" aria-label="Ayarlar"><Settings2 size={18}/></button>
    </header>
    <main className="workspace">
      <aside className="library panel">
        <div className="panel-heading"><div><span className="eyebrow">Ürün kütüphanesi</span><h2>Parça seçimi</h2></div><Boxes size={20}/></div>
        <div className="segmented">
          <button className={activeLibrary === "connectors" ? "selected" : ""} onClick={() => setActiveLibrary("connectors")}>Bağlantı</button>
          <button className={activeLibrary === "profiles" ? "selected" : ""} onClick={() => setActiveLibrary("profiles")}>Profil</button>
          <button className={activeLibrary === "complements" ? "selected" : ""} onClick={() => setActiveLibrary("complements")}>Tamamlayıcı</button>
        </div>
        <label className="search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SKU veya ürün ara"/></label>
        <div className="filter-note"><span className="status-dot"/> {profile?.name} ile uyumlu</div>
        <div className="library-list">
          {activeLibrary === "connectors" && compatible.filter((item) => `${item.sku} ${item.name_tr}`.toLowerCase().includes(query.toLowerCase())).map((item) => <article className="library-card" key={item.product_id}>
            <div className="part-icon">{item.connector_role}</div><div className="part-copy"><strong>{item.sku}</strong><span>{item.name_tr}</span><small>{item.central_stock} stok · <LockKeyhole size={11}/> {money(item.sale_price_cents)}</small></div>
            <button onClick={() => setConnectors((current) => ({ ...current, [item.connector_role]: (current[item.connector_role] || 0) + 1 }))} aria-label={`${item.sku} ekle`}><PackagePlus size={17}/></button>
          </article>)}
          {activeLibrary === "profiles" && data.profiles.map((item) => <button className={`library-card profile-option ${profileId === item.id ? "active" : ""}`} key={item.id} onClick={() => setProfileId(item.id)}><div className={`shape-icon ${item.shape.toLowerCase()}`}/><div className="part-copy"><strong>{item.name}</strong><span>{item.compatibility_group}</span><small>{money(item.sale_price_per_meter_cents)} / m</small></div></button>)}
          {activeLibrary === "complements" && data.complementaryProducts.map((item) => <article className="library-card" key={item.id}><div className="part-icon">{item.unit_type}</div><div className="part-copy"><strong>{item.name}</strong><span>{money(item.sale_unit_price_cents)} / {item.unit_type}</span></div><button><PackagePlus size={17}/></button></article>)}
        </div>
      </aside>
      <section className="builder panel">
        <div className="builder-head"><div><span className="eyebrow">3 Katlı Raf / Varyant 01</span><h1>{profile?.name}</h1></div><span className="pill draft">Taslak</span></div>
        <div className="compat-banner"><span className="shield">✓</span><div><strong>Uyumluluk doğrulandı</strong><span>Bu varyanttaki tüm bağlantılar {profile?.compatibility_group} grubuyla eşleşiyor.</span></div></div>
        <section className="bom-section"><div className="section-title"><h3>Profil kesimleri</h3><span>{cutMeters.toFixed(1)} m · {((profile?.weight_per_meter_kg || 0) * cutMeters).toFixed(2)} kg</span></div>
          {[{q:4,l:1800},{q:8,l:1200},{q:8,l:600}].map((cut) => <div className="bom-row" key={cut.l}><div className="cut-visual"/><strong>{cut.q} × {cut.l} mm</strong><span>{(cut.q*cut.l/1000).toFixed(1)} m</span></div>)}
        </section>
        <section className="bom-section"><div className="section-title"><h3>Bağlantılar</h3><span>{chosen.reduce((sum,line)=>sum+line.quantity,0)} adet</span></div>
          {chosen.map(({connector,quantity}) => <div className="bom-row" key={connector.product_id}><div className="role-badge">{connector.connector_role}</div><div><strong>{connector.sku}</strong><small>{connector.name_tr}</small></div><div className="stepper"><button onClick={()=>setConnectors(c=>({...c,[connector.connector_role]:Math.max(1,quantity-1)}))}>−</button><span>{quantity}</span><button onClick={()=>setConnectors(c=>({...c,[connector.connector_role]:quantity+1}))}>+</button></div><span>{money(connector.sale_price_cents*quantity)}</span></div>)}
        </section>
        <section className="bom-section"><div className="section-title"><h3>Tamamlayıcılar</h3><span>2 kalem</span></div>
          <div className="bom-row"><div className="role-badge light">M²</div><div><strong>MDF Tabla</strong><small>1,80 m²</small></div><span>{money(28500*1.8)}</span></div>
          <div className="bom-row"><div className="role-badge light">AD</div><div><strong>Frenli Tekerlek</strong><small>4 adet</small></div><span>{money(13500*4)}</span></div>
        </section>
      </section>
      <aside className="pricing panel">
        <div className="panel-heading"><div><span className="eyebrow">Canlı fiyat analizi</span><h2>Varyant özeti</h2></div><CircleDollarSign size={21}/></div>
        <PriceGroup title="Bağlantılar" cost={connectorCost} sale={connectorSale}/><PriceGroup title="Profiller" cost={profileCost} sale={profileSale}/><PriceGroup title="Tamamlayıcılar" cost={complementCost} sale={complementSale}/>
        <div className="grand-total"><div><span>Toplam maliyet</span><strong>{money(cost)}</strong></div><div><span>KDV hariç satış</span><strong>{money(sale)}</strong></div><div className="profit"><span>Brüt kâr</span><strong>{money(profit)}</strong></div><div><span>Brüt marj</span><strong>%{sale ? (profit/sale*100).toFixed(1) : "0,0"}</strong></div><div><span>KDV · %20</span><strong>{money(vat)}</strong></div><div className="vat-total"><span>KDV dahil satış</span><strong>{money(sale+vat)}</strong></div></div>
        {notice && <div className="save-notice"><CheckCircle2 size={15}/>{notice}</div>}
        <button className="primary-button" disabled={saving} onClick={saveVariant}>{saving ? "Kaydediliyor…" : "Varyantı kaydet"}</button><button className="secondary-button"><GitCompareArrows size={16}/> Varyant oluştur</button>
        <p className="price-note"><LockKeyhole size={13}/> Bağlantı fiyatları Panel kaynağından salt okunur alınır.</p>
      </aside>
    </main>
  </div>;
}

function PriceGroup({title,cost,sale}:{title:string;cost:number;sale:number}) { return <div className="price-group"><h3>{title}</h3><div><span>Maliyet</span><strong>{money(cost)}</strong></div><div><span>Satış</span><strong>{money(sale)}</strong></div></div>; }
