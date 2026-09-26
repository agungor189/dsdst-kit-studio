import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import {
  AlertTriangle,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit3,
  ImageOff,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import type {
  Bootstrap,
  Complementary,
  Connector,
  ConversionPreview,
  Kit,
  KitVariant,
  PricingResult,
  Profile,
  User,
} from "./types";
import {
  MATERIAL_LABELS,
  MATERIAL_ORDER,
  connectorsShareSize,
  groupProfiles,
  materialDiffers,
  materialLabel,
  normalizeMaterial,
  profileMatchesConnector,
  profileSearchText,
  profileSizeLabel,
  shapeLabel,
  type CanonicalMaterial,
} from "./compatibility";
import {
  formatLengthFromMm,
  parseLengthToMm,
  type DisplayLengthUnit,
} from "./lengthUnits";
import { AppShell, type StudioView } from "./components/layout/AppShell";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Input, LoadingState, Modal, PageHeader, Select } from "./components/ui";

const money = (cents: number | null | undefined) =>
  cents == null || !Number.isFinite(cents)
    ? "Bilinmiyor"
    : new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
      }).format(cents / 100);
const apiFetch = (url: string, init: RequestInit = {}) =>
  fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...(init.headers || {}),
    },
  });
const json = (method: string, body: unknown) => ({
  method,
  body: JSON.stringify(body),
});
const cents = (value: string) =>
  Math.max(0, Math.round((Number(value) || 0) * 100));
const weight = (grams: number) =>
  grams < 1000
    ? `${Math.round(grams)} g`
    : `${(grams / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} kg`;
const imageFallback = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.onerror = null;
  event.currentTarget.src = "/favicon.svg";
};
const complementImage = (item?: Complementary) =>
  item?.image_path
    ? item.catalog_source === "PANEL" &&
      !item.image_path.startsWith("/uploads/")
      ? `/api/panel/complementary-products/${encodeURIComponent(item.id)}/image`
      : item.image_path
    : undefined;
const searchKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .toUpperCase();
type EditorMode = "create" | "edit" | "view";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [kits, setKits] = useState<Kit[]>([]);
  const [view, setView] = useState<StudioView>("kits");
  const [editor, setEditor] = useState<{ mode: EditorMode; kit?: Kit }>({
    mode: "create",
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadAll() {
    const [bootstrapResponse, kitsResponse] = await Promise.all([
      apiFetch("/api/bootstrap"),
      apiFetch("/api/kits"),
    ]);
    if (bootstrapResponse.status === 401) {
      setUser(null);
      setData(null);
      return;
    }
    if (!bootstrapResponse.ok || !kitsResponse.ok)
      throw new Error("Kit Studio verileri yüklenemedi");
    const bootstrap = (await bootstrapResponse.json()) as Bootstrap;
    setData(bootstrap);
    setUser(bootstrap.user);
    setKits((await kitsResponse.json()) as Kit[]);
  }
  useEffect(() => {
    void (async () => {
      try {
        const response = await apiFetch("/api/auth/me");
        if (response.ok) {
          const body = (await response.json()) as { user: User };
          setUser(body.user);
          if (!body.user.must_change_password) await loadAll();
        } else {
          await loadAll();
        }
      } catch {
        setMessage("Panel kimlik doğrulama servisine ulaşılamadı");
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await apiFetch(
      "/api/auth/login",
      json("POST", {
        username: form.get("username"),
        password: form.get("password"),
      }),
    );
    if (!response.ok) return setMessage("Kullanıcı adı veya parola hatalı");
    const body = (await response.json()) as { user: User };
    setUser(body.user);
    if (!body.user.must_change_password) await loadAll();
  }
  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setData(null);
  }
  const openEditor = (mode: EditorMode, kit?: Kit) => {
    setEditor({ mode, kit });
    setView("editor");
    setMessage("");
  };
  if (loading) return <LoadingState fullScreen label="Oturum denetleniyor…"/>;
  if (!user) return <LoginScreen onSubmit={login} error={message} />;
  if (user.must_change_password)
    return (
      <PasswordChange
        user={user}
        onChanged={(next) => {
          setUser(next);
          void loadAll();
        }}
        onLogout={logout}
      />
    );
  if (!data) return <LoadingState fullScreen label="Katalog hazırlanıyor…"/>;
  const canWrite =
    user.role === "admin" || user.permissions?.["kits:write"] === true;
  const canApprove =
    user.role === "admin" || user.permissions?.["kits:approve"] === true;
  return (
    <AppShell user={user} activeView={view} canWrite={canWrite} notice={message} onNavigate={setView} onCreate={() => openEditor("create")} onLogout={() => void logout()}>
      {view === "kits" && (
        <KitList
          kits={kits}
          canWrite={canWrite}
          onOpen={openEditor}
          onChanged={loadAll}
          setMessage={setMessage}
        />
      )}
      {view === "editor" && (
        <KitEditor
          key={`${editor.mode}-${editor.kit?.id || "new"}`}
          mode={editor.mode}
          initialKit={editor.kit}
          data={data}
          canWrite={canWrite}
          canApprove={canApprove}
          onBack={() => setView("kits")}
          onChanged={async (kit) => {
            await loadAll();
            setEditor({ mode: "edit", kit });
            setMessage("Kit kaydedildi");
          }}
        />
      )}
      {view === "catalogs" && (
        <CatalogManager
          data={data}
          canWrite={canWrite}
          onChanged={async () => {
            await loadAll();
            setMessage("Katalog güncellendi");
          }}
        />
      )}
    </AppShell>
  );
}

export function KitList({
  kits,
  canWrite,
  onOpen,
  onChanged,
  setMessage,
}: {
  kits: Kit[];
  canWrite: boolean;
  onOpen: (mode: EditorMode, kit?: Kit) => void;
  onChanged: () => Promise<void>;
  setMessage: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Kit | null>(null);
  const visible = kits.filter((kit) =>
    `${kit.name} ${kit.sku || ""}`
      .toLocaleLowerCase("tr")
      .includes(query.toLocaleLowerCase("tr")),
  );
  async function copy(kit: Kit) {
    const response = await apiFetch(
      `/api/kits/${kit.id}/copy`,
      json("POST", {}),
    );
    if (!response.ok) return setMessage("Kit kopyalanamadı");
    await onChanged();
    setMessage(`${kit.name} kopyalandı`);
  }
  async function remove(kit: Kit) {
    await apiFetch(`/api/kits/${kit.id}`, { method: "DELETE" });
    await onChanged();
    setPendingDelete(null);
  }
  return (
    <main className="page-view">
      <PageHeader eyebrow="Kit oluşturma merkezi" title="Kitler" description={`${kits.length} kayıt · maliyet, satış ve kârlılık tek görünümde`} actions={canWrite && <Button onClick={() => onOpen("create")}><Plus size={17}/>Yeni Kit</Button>}/>
      <label className="page-search">
        <Search size={17} />
        <Input
          aria-label="Kit ara"
          containerClassName="ui-search-field"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Kit adı veya SKU ara"
        />
      </label>
      {visible.length === 0 ? (
        <EmptyState icon={<Boxes size={34}/>} title="Henüz eşleşen kit yok"/>
      ) : (
        <div className="kit-table-wrap">
          <table className="kit-table">
            <thead>
              <tr>
                <th>Kit</th>
                <th>Maliyet</th>
                <th>KDV dahil satış</th>
                <th>Kâr</th>
                <th>Kâr marjı</th>
                <th>Varyant</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((kit) => (
                <tr key={kit.id}>
                  <td>
                    <div className="kit-identity">
                      {kit.thumbnail ? (
                        <img
                          src={kit.thumbnail}
                          alt=""
                          onError={imageFallback}
                        />
                      ) : (
                        <span className="image-placeholder">
                          <ImageOff size={18} />
                        </span>
                      )}
                      <div>
                        <strong>{kit.name}</strong>
                        <small>{kit.sku || "SKU yok"}</small>
                      </div>
                    </div>
                  </td>
                  <td>{money(kit.summary.total_cost_cents)}</td>
                  <td>{money(kit.summary.sale_price_cents)}</td>
                  <td
                    className={
                      kit.summary.profit_cents >= 0 ? "positive" : "negative"
                    }
                  >
                    {money(kit.summary.profit_cents)}
                  </td>
                  <td>%{kit.summary.margin_percent.toFixed(1)}</td>
                  <td>{kit.variants.length}</td>
                  <td>
                    <div className="row-actions">
                      <Button variant="ghost" size="sm" aria-label={`${kit.name} görüntüle`} onClick={() => onOpen("view", kit)}>
                        <Search size={15} />
                      </Button>
                      {canWrite && (
                        <>
                          <Button variant="ghost" size="sm" aria-label={`${kit.name} düzenle`} onClick={() => onOpen("edit", kit)}>
                            <Edit3 size={15} />
                          </Button>
                          <Button variant="ghost" size="sm" aria-label={`${kit.name} kopyala`} onClick={() => void copy(kit)}>
                            <Copy size={15} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="danger"
                            aria-label={`${kit.name} sil`}
                            onClick={() => setPendingDelete(kit)}
                          >
                            <Trash2 size={15} />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} onConfirm={() => pendingDelete ? remove(pendingDelete) : undefined} title="Kiti silmek istiyor musunuz?" description={pendingDelete ? `“${pendingDelete.name}” kalıcı olarak silinecek.` : undefined} confirmLabel="Kiti sil" destructive/>
    </main>
  );
}

export function KitEditor({
  mode,
  initialKit,
  data,
  canWrite,
  canApprove,
  onBack,
  onChanged,
}: {
  mode: EditorMode;
  initialKit?: Kit;
  data: Bootstrap;
  canWrite: boolean;
  canApprove: boolean;
  onBack: () => void;
  onChanged: (kit: Kit) => Promise<void>;
}) {
  const [kit, setKit] = useState(initialKit);
  const [activeVariantId, setActiveVariantId] = useState(
    initialKit?.variants[0]?.id || "",
  );
  const active =
    kit?.variants.find((variant) => variant.id === activeVariantId) ||
    kit?.variants[0];
  const readOnly = mode === "view" || !canWrite;
  const [name, setName] = useState(kit?.name || "");
  const [sku, setSku] = useState(kit?.sku || "");
  const [description, setDescription] = useState(kit?.description || "");
  const [labor, setLabor] = useState(
    String((kit?.labor_cost_cents || 0) / 100),
  );
  const [packaging, setPackaging] = useState(
    String((kit?.packaging_cost_cents || 0) / 100),
  );
  const [other, setOther] = useState(
    String((kit?.other_cost_cents || 0) / 100),
  );
  const [profileId, setProfileId] = useState(active?.profile_id || "");
  const [connectors, setConnectors] = useState<
    Record<string, { productId: string; quantity: number }>
  >({});
  const [cuts, setCuts] = useState<
    Array<{ id: string; quantity: number; length_mm: number }>
  >([]);
  const [lengthUnit, setLengthUnit] = useState<DisplayLengthUnit>("cm");
  const [complements, setComplements] = useState<Record<string, number>>({});
  const [picker, setPicker] = useState<
    "connector" | "profile" | "complement" | null
  >(null);
  const [compareMode, setCompareMode] = useState<
    "connector" | "profile" | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [quote, setQuote] = useState<PricingResult | null>(
    (active?.pricing as PricingResult | undefined) || null,
  );
  const [finalPrice, setFinalPrice] = useState(
    String(
      (kit?.final_sale_price_minor ?? kit?.summary.sale_price_cents ?? 0) / 100,
    ),
  );
  const [packingVersion, setPackingVersion] = useState(
    kit?.packaging_instruction_version || "packing:v1",
  );
  const [guideVersion, setGuideVersion] = useState(
    kit?.installation_guide_version || "guide:v1",
  );
  const [publicationPreview, setPublicationPreview] = useState<any>(null);
  const [kerfMm, setKerfMm] = useState<number | null>(null);

  useEffect(() => {
    setProfileId(active?.profile_id || "");
    setConnectors(
      Object.fromEntries(
        (active?.connectors || []).map((line: any) => [
          line.connector_role,
          { productId: line.product_id, quantity: line.quantity },
        ]),
      ),
    );
    setCuts(
      (active?.cuts || []).map((cut: any) => ({
        id: cut.id,
        quantity: cut.quantity,
        length_mm: cut.length_mm,
      })),
    );
    setComplements(
      Object.fromEntries(
        (active?.complementary_items || []).map((line: any) => [
          line.complementary_product_id,
          line.quantity_milli / 1000,
        ]),
      ),
    );
  }, [activeVariantId, active?.id]);
  useEffect(() => {
    void (async () => {
      const response = await apiFetch("/api/publication-policy");
      if (response.ok) setKerfMm(Number((await response.json()).kerf_mm));
    })();
  }, []);

  const profile = data.profiles.find((item) => item.id === profileId);
  const connectorLines = Object.entries(connectors)
    .map(([role, line]) => ({
      role,
      quantity: line.quantity,
      item: data.connectors.find((item) => item.product_id === line.productId)!,
    }))
    .filter((line) => line.item);
  const activeConnector = connectorLines[0]?.item;
  const activeCompatibilityGroup =
    profile?.compatibility_group || activeConnector?.compatibility_group;
  const skuGroup =
    activeConnector?.sku.split("-").slice(0, 2).join("-") ||
    "Henüz belirlenmedi";
  const complementLines = Object.entries(complements)
    .map(([id, quantity]) => ({
      quantity,
      item: data.complementaryProducts.find((item) => item.id === id)!,
    }))
    .filter((line) => line.item);
  const usedMm = cuts.reduce(
    (sum, cut) => sum + cut.quantity * cut.length_mm,
    0,
  );
  const optimization = optimizeCuts(cuts, profile?.raw_length_mm || 6000);
  const quoteRequest = {
    profile_id: profile?.id || null,
    connectors: connectorLines.map((line) => ({
      role: line.role,
      product_id: line.item.product_id,
      quantity: line.quantity,
    })),
    cuts: profile
      ? cuts.map(({ quantity, length_mm }) => ({ quantity, length_mm }))
      : [],
    complementary_items: complementLines.map((line) => ({
      product_id: line.item.id,
      quantity: line.quantity,
    })),
    labor_cost_cents: cents(labor),
    packaging_cost_cents: cents(packaging),
    other_cost_cents: cents(other),
  };
  const quoteKey = JSON.stringify(quoteRequest);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        const response = await apiFetch("/api/pricing/quote", {
          ...json("POST", quoteRequest),
          signal: controller.signal,
        });
        if (response.ok) setQuote((await response.json()) as PricingResult);
      })();
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [quoteKey]);
  const warnings = connectorLines
    .filter((line) => profile && materialDiffers(profile, line.item))
    .map(
      (line) => `${line.item.sku}: ölçü uyumlu, farklı materyal kombinasyonu`,
    );

  function addConnector(item: Connector, quantity = 1) {
    const role = item.connector_role || item.form_code || item.form;
    if (!role) return setError(`${item.sku} model kodu otomatik çıkarılamadı`);
    const occupied = connectors[role];
    if (occupied && occupied.productId !== item.product_id)
      return setError(
        `${role} modeli bu konfigürasyonda zaten var. Farklı ölçü/malzeme için “Alternatif varyant oluştur”u kullanın; mevcut ürün korunur.`,
      );
    if (profile && !profileMatchesConnector(profile, item))
      return setError(
        `${item.sku}, seçili ${profileSizeLabel(profile)} profille fiziksel olarak uyumlu değil.`,
      );
    if (
      !profile &&
      activeConnector &&
      !connectorsShareSize(activeConnector, item)
    )
      return setError(
        `${item.sku}, aktif ${activeConnector.compatibility_group || "ölçü"} ile uyumlu değil.`,
      );
    setError("");
    setConnectors((current) => ({
      ...current,
      [role]: {
        productId: item.product_id,
        quantity: (current[role]?.quantity || 0) + quantity,
      },
    }));
  }
  function setConnectorQuantity(item: Connector, quantity: number) {
    const role = item.connector_role || item.form_code || item.form;
    if (!role) return;
    if (quantity <= 0)
      setConnectors((current) => {
        const next = { ...current };
        delete next[role];
        return next;
      });
    else
      setConnectors((current) => ({
        ...current,
        [role]: { productId: item.product_id, quantity },
      }));
  }
  async function refreshKit(id: string, select?: string) {
    const response = await apiFetch(`/api/kits/${id}`);
    const fresh = (await response.json()) as Kit;
    setKit(fresh);
    if (select) setActiveVariantId(select);
    return fresh;
  }
  async function save() {
    if (!name.trim()) return setError("Kit adı gerekli");
    setSaving(true);
    setError("");
    try {
      const metadata = {
        name: name.trim(),
        sku: sku.trim() || null,
        description,
        labor_cost_cents: cents(labor),
        packaging_cost_cents: cents(packaging),
        other_cost_cents: cents(other),
      };
      let working = kit;
      if (!working) {
        const response = await apiFetch(
          "/api/kits",
          json("POST", { ...metadata, profile_id: profile?.id || null }),
        );
        if (!response.ok) throw new Error(await responseMessage(response));
        working = (await response.json()) as Kit;
        setKit(working);
        setActiveVariantId(working.variants[0].id);
      } else {
        const response = await apiFetch(
          `/api/kits/${working.id}`,
          json("PUT", metadata),
        );
        if (!response.ok) throw new Error(await responseMessage(response));
        working = (await response.json()) as Kit;
      }
      const variantId = active?.id || working.variants[0].id;
      const response = await apiFetch(
        `/api/variants/${variantId}`,
        json("PUT", {
          profile_id: profile?.id || null,
          connectors: connectorLines.map((line) => ({
            role: line.role,
            product_id: line.item.product_id,
            quantity: line.quantity,
          })),
          cuts: profile
            ? cuts.map(({ quantity, length_mm }) => ({ quantity, length_mm }))
            : [],
          complementary_items: complementLines.map((line) => ({
            product_id: line.item.id,
            quantity: line.quantity,
          })),
        }),
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      const fresh = await refreshKit(working.id, variantId);
      await onChanged(fresh);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kit kaydedilemedi");
    } finally {
      setSaving(false);
    }
  }
  async function uploadImages(files: FileList | null) {
    if (!kit || !files?.length) return;
    const form = new FormData();
    [...files].forEach((file) => form.append("images", file));
    const response = await apiFetch(`/api/kits/${kit.id}/images`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) return setError("Görseller yüklenemedi");
    const fresh = (await response.json()) as Kit;
    setKit(fresh);
  }
  async function deleteImage(id: string) {
    if (!kit) return;
    await apiFetch(`/api/kits/${kit.id}/images/${id}`, { method: "DELETE" });
    await refreshKit(kit.id);
  }
  const complementaryBaseQuantity = (item: Complementary, quantity: number) => {
    if (["piece", "roll", "package", "box"].includes(item.base_uom_code))
      return quantity;
    if (item.base_uom_code === "square_meter") return quantity * 1_000_000;
    return quantity * 1000;
  };
  async function previewPublication() {
    if (!kit || !active) return setError("Önce kiti kaydedin");
    if (kerfMm === null) return setError("Panel kerf politikası yüklenemedi");
    const packageItems = [
      ...connectorLines.map((line) => ({
        product_id: line.item.product_id,
        quantity_base_int: line.quantity,
      })),
      ...complementLines.map((line) => ({
        product_id: line.item.id,
        quantity_base_int: complementaryBaseQuantity(line.item, line.quantity),
      })),
      ...(profile
        ? [
            {
              product_id: profile.id,
              quantity_base_int: cuts.reduce(
                (sum, cut) => sum + cut.quantity * cut.length_mm,
                0,
              ),
            },
          ]
        : []),
    ];
    if (
      packageItems.some(
        (item) =>
          !Number.isSafeInteger(item.quantity_base_int) ||
          item.quantity_base_int <= 0,
      )
    )
      return setError(
        "Paket miktarları kanonik tam sayı UOM değerlerine dönüşmelidir",
      );
    setSaving(true);
    setError("");
    setPublicationPreview(null);
    try {
      const draft = await apiFetch(
        `/api/variants/${active.id}/publication-draft`,
        json("PUT", {
          final_sale_price_minor: cents(finalPrice),
          packaging_instruction_version: packingVersion,
          installation_guide_version: guideVersion,
          packages: [{ package_number: 1, items: packageItems }],
        }),
      );
      if (!draft.ok) throw new Error(await responseMessage(draft));
      const response = await apiFetch(
        `/api/variants/${active.id}/publication-preview`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      const body = await response.json();
      setPublicationPreview(body.preview);
      await refreshKit(kit.id, active.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Yayın önizlemesi oluşturulamadı",
      );
    } finally {
      setSaving(false);
    }
  }
  async function publishVersion() {
    if (!kit || !active || !publicationPreview) return;
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch(`/api/variants/${active.id}/publish`, {
        ...json("POST", {
          approved_content_hash: publicationPreview.contentHash,
          approved_policy_hash: publicationPreview.corePolicyHash,
        }),
        headers: { "x-operation-id": crypto.randomUUID() },
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const fresh = await refreshKit(kit.id, active.id);
      setPublicationPreview(null);
      await onChanged(fresh);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kit yayınlanamadı");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="editor-page">
      <div className="editor-toolbar">
        <Button variant="secondary" className="back-button" onClick={onBack}>
          <ChevronLeft size={18} />
          Kitler
        </Button>
        <div>
          <span className="eyebrow">
            {mode === "create" ? "Yeni kit" : "Kit konfigürasyonu"}
          </span>
          <h1>{name || "Adsız kit"}</h1>
        </div>
        {!readOnly && (
          <Button
            loading={saving}
            loadingText="Kaydediliyor…"
            onClick={() => void save()}
          >
            <Check size={17} />
            Kaydet
          </Button>
        )}
      </div>
      <section className="active-config">
        <div>
          <span>Aktif bağlantı grubu</span>
          <strong>
            {activeConnector
              ? `${activeConnector.sku.split("-")[0]} • ${activeConnector.profile_shape || ""} • ${activeConnector.sku.split("-")[1] || activeConnector.compatibility_group}`
              : "Henüz bağlantı seçilmedi"}
          </strong>
          <small>
            {activeConnector
              ? skuGroup
              : "Profil seçerseniz bağlantılar ölçüye göre filtrelenir"}
          </small>
        </div>
        <div>
          <span>Aktif profil</span>
          <strong>
            {profile
              ? `${profile.shape} / ${profile.nominal_size || profile.compatibility_group} / ${profile.wall_thickness_mm || 0} mm`
              : "Henüz profil seçilmedi"}
          </strong>
          <small>
            {profile
              ? `${(usedMm / 1000).toFixed(2)} m · ${((profile.weight_per_meter_kg * usedMm) / 1000).toFixed(2)} kg`
              : "Bağlantı seçerseniz profiller ölçüye göre filtrelenir"}
          </small>
        </div>
        <div className="quick-actions">
          <Button variant="ghost" onClick={() => setPicker("connector")} disabled={readOnly}>
            <Plus size={14} />
            Bağlantı Ekle
          </Button>
          <Button variant="ghost" onClick={() => setPicker("profile")} disabled={readOnly}>
            <Plus size={14} />
            Profil Ekle
          </Button>
          <Button variant="ghost" onClick={() => setPicker("complement")} disabled={readOnly}>
            <Plus size={14} />
            Tamamlayıcı Ekle
          </Button>
          <Button variant="ghost"
            onClick={() => setCompareMode("connector")}
            disabled={!kit || !active || !profile}
          >
            <Copy size={14} />
            Kit Dönüştür / Karşılaştır
          </Button>
          <Button variant="ghost"
            onClick={() => setCompareMode("profile")}
            disabled={!kit || !active || !profile}
          >
            <Copy size={14} />
            Profil Değiştir / Karşılaştır
          </Button>
        </div>
      </section>
      {kit && kit.variants.length > 1 && (
        <section className="variant-bar">
          <div className="variant-tabs">
            {kit.variants.map((variant) => (
              <button
                key={variant.id}
                className={variant.id === active?.id ? "active" : ""}
                onClick={() => setActiveVariantId(variant.id)}
              >
                <strong>{variant.name}</strong>
                <small>
                  {variant.configuration?.material} ·{" "}
                  {variant.configuration?.size} ·{" "}
                  {variant.configuration?.wall_thickness_mm || 0} mm
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
      {kit && kit.variants.length > 1 && (
        <VariantComparison variants={kit.variants} />
      )}
      <div className="editor-grid">
        <section className="editor-main">
          <Card>
            <div className="card-title">
              <div>
                <span className="eyebrow">1 · Temel bilgiler</span>
                <h2>Kit tanımı ve görseller</h2>
              </div>
            </div>
            <div className="form-grid">
              <Input label="Kit adı" disabled={readOnly} value={name} onChange={(e) => setName(e.target.value)}/>
              <Input label="SKU" disabled={readOnly} value={sku || ""} onChange={(e) => setSku(e.target.value)}/>
              <label className="span-2">
                Açıklama
                <textarea
                  disabled={readOnly}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </label>
              {!readOnly && (
                <label>
                  Kit görselleri
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    disabled={!kit}
                    onChange={(event) => void uploadImages(event.target.files)}
                  />
                  <small>
                    {kit
                      ? "Birden fazla görsel seçebilirsiniz"
                      : "Görsel eklemek için önce kiti kaydedin"}
                  </small>
                </label>
              )}
            </div>
            {kit?.images && kit.images.length > 0 && (
              <div className="image-strip">
                {kit.images.map((image) => (
                  <div key={image.id}>
                    <img src={image.image_path} alt="Kit" />
                    <button
                      disabled={readOnly}
                      onClick={() => void deleteImage(image.id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <BomSection
            title="Bağlantı Elemanları"
            count={`${connectorLines.reduce((sum, line) => sum + line.quantity, 0)} adet`}
            action={
              !readOnly && (
                <Button variant="secondary" size="sm" onClick={() => setPicker("connector")}>
                  <Plus size={15} />
                  Bağlantı Ekle
                </Button>
              )
            }
            empty={!connectorLines.length}
          >
            {connectorLines.map((line) => (
              <ProductRow
                key={line.role}
                image={
                  line.item.image
                    ? `/api/panel/products/${encodeURIComponent(line.item.product_id)}/image`
                    : undefined
                }
                badge={line.role}
                title={line.item.sku}
                subtitle={`${line.item.name_tr} · Stok ${line.item.central_stock} · Alış ${money(line.item.purchase_cost_cents)} · Satış ${money(line.item.sale_price_cents)}`}
                cost={line.item.purchase_cost_cents * line.quantity}
                quantity={line.quantity}
                readOnly={readOnly}
                onQuantity={(quantity) =>
                  setConnectors((current) => ({
                    ...current,
                    [line.role]: { ...current[line.role], quantity },
                  }))
                }
                onRemove={() =>
                  setConnectors((current) => {
                    const next = { ...current };
                    delete next[line.role];
                    return next;
                  })
                }
              />
            ))}
          </BomSection>
          <BomSection
            title="Profil optimizasyonu"
            count={`${usedMm} mm`}
            action={
              !readOnly && (
                <Button variant="secondary" size="sm" onClick={() => setPicker("profile")}>
                  <Plus size={15} />
                  {profile ? "Profili Değiştir" : "Profil Ekle"}
                </Button>
              )
            }
            empty={!profile}
          >
            {profile && (
              <ProductRow
                image={profile.image_path}
                badge={profile.shape}
                title={profile.name}
                subtitle={`${profile.material} · ${profile.compatibility_group} · Ham boy ${formatLengthFromMm(profile.raw_length_mm, lengthUnit)} ${lengthUnit} (${profile.raw_length_mm} mm) · Alış ${money(profile.purchase_price_per_meter_cents)}/m · Satış ${money(profile.sale_price_per_meter_cents)}/m`}
                cost={quote?.profile_cost_cents || 0}
                readOnly
                quantity={1}
              />
            )}{" "}
            {profile && (
              <>
                <div className="optimization">
                  <span>
                    <strong>{optimization.bars}</strong> ham boy
                  </span>
                  <span>
                    <strong>{optimization.purchasedMm} mm</strong> satın alınan
                  </span>
                  <span>
                    <strong>{optimization.wasteMm} mm</strong> fire (kerf hariç)
                  </span>
                  <span>
                    <strong>{kerfMm === null ? "—" : `${kerfMm} mm`}</strong>{" "}
                    yayın kerfi
                  </span>
                </div>
                <div className="cuts">
                  <div className="cut-head">
                    <strong>Kesim listesi</strong>
                    <label>
                      Giriş birimi
                      <select
                        value={lengthUnit}
                        onChange={(event) =>
                          setLengthUnit(event.target.value as DisplayLengthUnit)
                        }
                      >
                        <option value="mm">mm</option>
                        <option value="cm">cm</option>
                        <option value="m">m</option>
                      </select>
                    </label>
                    {!readOnly && (
                      <button
                        onClick={() =>
                          setCuts((current) => [
                            ...current,
                            {
                              id: crypto.randomUUID(),
                              quantity: 1,
                              length_mm: 1000,
                            },
                          ])
                        }
                      >
                        <Plus size={14} />
                        Kesim
                      </button>
                    )}
                  </div>
                  {cuts.map((cut, index) => (
                    <div className="cut-row" key={cut.id}>
                      <span>{index + 1}</span>
                      <label>
                        Adet
                        <input
                          disabled={readOnly}
                          type="number"
                          min="1"
                          value={cut.quantity}
                          onChange={(e) =>
                            setCuts((current) =>
                              current.map((item) =>
                                item.id === cut.id
                                  ? {
                                      ...item,
                                      quantity: Math.max(
                                        1,
                                        Number(e.target.value),
                                      ),
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Uzunluk
                        <input
                          disabled={readOnly}
                          type="number"
                          min={
                            lengthUnit === "mm"
                              ? "1"
                              : lengthUnit === "cm"
                                ? "0.1"
                                : "0.001"
                          }
                          step="any"
                          max={formatLengthFromMm(
                            profile.raw_length_mm,
                            lengthUnit,
                          )}
                          value={formatLengthFromMm(cut.length_mm, lengthUnit)}
                          onChange={(event) => {
                            const lengthMm = parseLengthToMm(
                              event.target.value,
                              lengthUnit,
                            );
                            if (lengthMm === null)
                              return setError(
                                "Uzunluk tam milimetreye dönüşmelidir; yuvarlama yapılmadı",
                              );
                            if (
                              lengthMm <= 0 ||
                              lengthMm > profile.raw_length_mm
                            )
                              return setError(
                                "Kesim uzunluğu ham profil boyu içinde olmalıdır",
                              );
                            setError("");
                            setCuts((current) =>
                              current.map((item) =>
                                item.id === cut.id
                                  ? { ...item, length_mm: lengthMm }
                                  : item,
                              ),
                            );
                          }}
                        />
                        <small>
                          {lengthUnit} = {cut.length_mm} mm
                        </small>
                      </label>
                      <strong>{cut.quantity * cut.length_mm} mm</strong>
                      {!readOnly && (
                        <button
                          className="remove"
                          onClick={() =>
                            setCuts((current) =>
                              current.filter((item) => item.id !== cut.id),
                            )
                          }
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </BomSection>
          <BomSection
            title="Tamamlayıcı Ürünler"
            count={`${complementLines.length} kalem`}
            action={
              !readOnly && (
                <Button variant="secondary" size="sm" onClick={() => setPicker("complement")}>
                  <Plus size={15} />
                  Ürün Ekle
                </Button>
              )
            }
            empty={!complementLines.length}
          >
            {complementLines.map((line) => (
              <ProductRow
                key={line.item.id}
                image={complementImage(line.item)}
                badge={line.item.unit_type}
                title={line.item.name}
                subtitle={`${line.item.sku_optional || ""} · Alış ${money(line.item.purchase_unit_price_cents)} · %${line.item.markup_basis_points / 100} eklenen · Satış ${money(line.item.sale_unit_price_cents)}`}
                cost={line.item.purchase_unit_price_cents * line.quantity}
                quantity={line.quantity}
                readOnly={readOnly}
                onQuantity={(quantity) =>
                  setComplements((current) => ({
                    ...current,
                    [line.item.id]: quantity,
                  }))
                }
                onRemove={() =>
                  setComplements((current) => {
                    const next = { ...current };
                    delete next[line.item.id];
                    return next;
                  })
                }
              />
            ))}
          </BomSection>
        </section>
        <Card as="aside" className="summary-card">
          <span className="eyebrow">5 · Canlı fiyat özeti</span>
          <h2>Otomatik kit fiyatı</h2>
          <CategoryPricing
            title="Bağlantı elemanları"
            cost={quote?.connector_cost_cents || 0}
            sale={quote?.connector_sale_cents || 0}
            profit={quote?.connector_profit_cents || 0}
          />
          <CategoryPricing
            title="Profiller"
            cost={quote?.profile_cost_cents || 0}
            sale={quote?.profile_sale_cents || 0}
            profit={quote?.profile_profit_cents || 0}
          />
          <CategoryPricing
            title="Tamamlayıcı ürünler"
            cost={quote?.complementary_cost_cents || 0}
            sale={quote?.complementary_sale_cents || 0}
            profit={quote?.complementary_profit_cents || 0}
          />
          <SummaryHeading>Ek maliyetler</SummaryHeading>
          <div className="extras">
            <label>
              İşçilik
              <input
                disabled={readOnly}
                type="number"
                min="0"
                step=".01"
                value={labor}
                onChange={(e) => setLabor(e.target.value)}
              />
            </label>
            <label>
              Paketleme
              <input
                disabled={readOnly}
                type="number"
                min="0"
                step=".01"
                value={packaging}
                onChange={(e) => setPackaging(e.target.value)}
              />
            </label>
            <label>
              Diğer
              <input
                disabled={readOnly}
                type="number"
                min="0"
                step=".01"
                value={other}
                onChange={(e) => setOther(e.target.value)}
              />
            </label>
          </div>
          <SummaryHeading>Genel toplam</SummaryHeading>
          <PriceLine
            label="Toplam ürün maliyeti"
            value={quote?.component_cost_cents || 0}
          />
          <PriceLine
            label="Toplam maliyet"
            value={quote?.total_cost_cents || 0}
          />
          <PriceLine
            label="Toplam satış değeri"
            value={quote?.subtotal_ex_vat_cents || 0}
          />
          <PriceLine
            label="Toplam brüt kâr"
            value={quote?.profit_cents || 0}
            tone={(quote?.profit_cents || 0) >= 0 ? "positive" : "negative"}
          />
          <div className="margin">
            <span>Kâr marjı</span>
            <strong>%{(quote?.margin_percent || 0).toFixed(2)}</strong>
          </div>
          {quote && quote.profit_cents < 0 && (
            <div className="loss-warning">
              <AlertTriangle size={17} />
              <strong>Bu kit mevcut fiyatlandırmayla zarar ediyor.</strong>
            </div>
          )}
          <SummaryHeading>Vergi</SummaryHeading>
          <MetricLine
            label="KDV oranı"
            value={`%${(quote?.vat_rate_basis_points || 0) / 100}`}
          />
          <PriceLine label="KDV tutarı" value={quote?.vat_cents || 0} />
          <PriceLine
            label="KDV dahil satış fiyatı"
            value={quote?.total_inc_vat_cents || 0}
          />
          <SummaryHeading>Ağırlık</SummaryHeading>
          <MetricLine
            label="Bağlantı elemanları"
            value={weight(quote?.connector_weight_grams || 0)}
          />
          <MetricLine
            label="Profil"
            value={weight(quote?.profile_weight_grams || 0)}
          />
          <MetricLine
            label="Tamamlayıcı ürünler"
            value={weight(quote?.complementary_weight_grams || 0)}
          />
          <MetricLine
            label="Toplam kit ağırlığı"
            value={weight(quote?.total_weight_grams || 0)}
          />
          {quote && !quote.weight_complete && (
            <div className="weight-warning">
              <AlertTriangle size={16} />
              <span>
                Hesaplanan ağırlık bilinen ürünleri kapsar.{" "}
                {quote.missing_weight_items.length} ürünün ağırlık bilgisi
                eksik:{" "}
                {quote.missing_weight_items.map((item) => item.name).join(", ")}
                .
              </span>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="warning-box">
              <AlertTriangle size={17} />
              <div>
                {warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            </div>
          )}
          {error && <div className="error-box">{error}</div>}
        </Card>
      </div>
      {kit && active && (
        <Card as="section">
          <div className="card-title">
            <div>
              <span className="eyebrow">6 · Yayınlama</span>
              <h2>Panel kanonik kit sürümü</h2>
            </div>
            <strong>
              {kit.publication_state || "DRAFT"}
              {kit.current_published_version_number
                ? ` · v${kit.current_published_version_number}`
                : ""}
            </strong>
          </div>
          <div className="form-grid">
            <label>
              Final satış (₺)
              <input
                disabled={!canApprove || active.status === "APPROVED"}
                type="number"
                min="0"
                step=".01"
                value={finalPrice}
                onChange={(event) => {
                  setFinalPrice(event.target.value);
                  setPublicationPreview(null);
                }}
              />
            </label>
            <label>
              Paket talimat sürümü
              <input
                disabled={!canApprove || active.status === "APPROVED"}
                value={packingVersion}
                onChange={(event) => {
                  setPackingVersion(event.target.value);
                  setPublicationPreview(null);
                }}
              />
            </label>
            <label>
              Kurulum kılavuzu sürümü
              <input
                disabled={!canApprove || active.status === "APPROVED"}
                value={guideVersion}
                onChange={(event) => {
                  setGuideVersion(event.target.value);
                  setPublicationPreview(null);
                }}
              />
            </label>
            <label>
              Efektif kerf
              <input
                readOnly
                value={
                  kerfMm === null
                    ? "Panel politikası bekleniyor"
                    : `${kerfMm} mm`
                }
              />
            </label>
          </div>
          {publicationPreview && (
            <div className="warning-box">
              <div>
                <strong>Panel kanonik önizleme hazır</strong>
                <span>
                  Maliyet {money(publicationPreview.cost.canonicalCostMinor)} ·
                  Önerilen{" "}
                  {money(publicationPreview.cost.suggestedSalePriceMinor)} ·
                  Kerf {publicationPreview.cutPlan?.effectiveKerfMm ?? kerfMm}{" "}
                  mm
                </span>
              </div>
            </div>
          )}
          {canApprove && active.status !== "APPROVED" && (
            <div className="modal-actions">
              <button
                disabled={saving}
                onClick={() => void previewPublication()}
              >
                Kanonik Önizleme
              </button>
              <button
                className="primary-action"
                disabled={saving || !publicationPreview}
                onClick={() => void publishVersion()}
              >
                Yayınla / Onayla
              </button>
            </div>
          )}
        </Card>
      )}
      {picker && (
        <CatalogPicker
          kind={picker}
          data={data}
          selectedProfile={profile}
          activeConnector={activeConnector}
          activeCompatibilityGroup={activeCompatibilityGroup}
          selectedConnectors={connectors}
          selectedComplements={complements}
          onClose={() => setPicker(null)}
          onConnector={addConnector}
          onSetConnector={setConnectorQuantity}
          onProfile={(item) => {
            setProfileId(item.id);
            setPicker(null);
          }}
          onComplement={(item, quantity) =>
            setComplements((current) => ({
              ...current,
              [item.id]: (current[item.id] || 0) + quantity,
            }))
          }
        />
      )}
      {compareMode && active && kit && (
        <ConversionModal
          mode={compareMode}
          variant={active}
          kit={kit}
          canSave={!readOnly}
          onClose={() => setCompareMode(null)}
          onSaved={async (created) => {
            setCompareMode(null);
            await onChanged(created);
          }}
        />
      )}
    </main>
  );
}

function VariantComparison({ variants }: { variants: KitVariant[] }) {
  return (
    <div className="comparison">
      <div className="comparison-head">
        <strong>Varyant karşılaştırması</strong>
        <span>Malzeme, ölçü ve et kalınlığı bazında</span>
      </div>
      <div className="comparison-grid">
        {variants.map((variant) => {
          const pricing = variant.pricing as PricingResult | undefined;
          return (
            <article key={variant.id}>
              <strong>{variant.name}</strong>
              <small>
                {variant.configuration?.material} ·{" "}
                {variant.configuration?.shape} · {variant.configuration?.size} ·{" "}
                {variant.configuration?.wall_thickness_mm || 0} mm
              </small>
              <PriceLine
                label="Maliyet"
                value={pricing?.total_cost_cents || 0}
              />
              <PriceLine
                label="KDV hariç satış"
                value={pricing?.subtotal_ex_vat_cents || 0}
              />
              <PriceLine label="Kazanç" value={pricing?.profit_cents || 0} />
              <MetricLine
                label="Kâr marjı"
                value={`%${(pricing?.margin_percent || 0).toFixed(2)}`}
              />
              <PriceLine label="KDV" value={pricing?.vat_cents || 0} />
              <PriceLine
                label="KDV dahil satış"
                value={pricing?.total_inc_vat_cents || 0}
              />
              <MetricLine
                label="Bağlantı ağırlığı"
                value={weight(pricing?.connector_weight_grams || 0)}
              />
              <MetricLine
                label="Profil ağırlığı"
                value={weight(pricing?.profile_weight_grams || 0)}
              />
              <MetricLine
                label="Tamamlayıcı ağırlığı"
                value={weight(pricing?.complementary_weight_grams || 0)}
              />
              <MetricLine
                label="Toplam ağırlık"
                value={`${weight(pricing?.total_weight_grams || 0)}${pricing?.weight_complete === false ? " + eksik veri" : ""}`}
              />
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ConversionModal({
  mode,
  variant,
  kit,
  canSave,
  onClose,
  onSaved,
}: {
  mode: "connector" | "profile";
  variant: KitVariant;
  kit: Kit;
  canSave: boolean;
  onClose: () => void;
  onSaved: (kit: Kit) => Promise<void>;
}) {
  const [options, setOptions] = useState<ConversionPreview[]>([]);
  const [selected, setSelected] = useState<ConversionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [derivedName, setDerivedName] = useState(kit.name);
  const [derivedSku, setDerivedSku] = useState("");
  useEffect(() => {
    void (async () => {
      const response = await apiFetch(
        `/api/variants/${variant.id}/conversion-options?mode=${mode}`,
      );
      if (response.ok) {
        const body = (await response.json()) as {
          options: ConversionPreview[];
        };
        setOptions(body.options);
        setSelected(body.options[0] || null);
      } else setError("Alternatifler hesaplanamadı");
      setLoading(false);
    })();
  }, [mode, variant.id]);
  useEffect(() => {
    if (!selected) return;
    const profile = selected.target.profile;
    const suffix =
      mode === "profile"
        ? `${profile.wall_thickness_mm || 0}mm`
        : profile.nominal_size || profile.compatibility_group;
    setDerivedName(`${kit.name} – ${suffix}`);
  }, [selected, mode, kit.name]);
  async function saveDerived() {
    if (!selected) return;
    setSaving(true);
    setError("");
    const response = await apiFetch(
      `/api/variants/${variant.id}/derive`,
      json("POST", {
        target_profile_id: selected.target.profile.id,
        name: derivedName,
        sku: derivedSku.trim() || null,
      }),
    );
    if (!response.ok) setError(await responseMessage(response));
    else await onSaved((await response.json()) as Kit);
    setSaving(false);
  }
  const sourcePricing = variant.pricing as PricingResult;
  return (
    <div className="modal-backdrop">
      <div className="conversion-modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">Salt okunur önizleme</span>
            <h2>
              {mode === "profile"
                ? "Profil Değiştir / Karşılaştır"
                : "Kit Dönüştür / Karşılaştır"}
            </h2>
          </div>
          <button onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {loading ? (
          <div className="empty-row">Alternatifler hesaplanıyor…</div>
        ) : options.length === 0 ? (
          <div className="empty-state compact">
            <AlertTriangle />
            <h2>Dönüştürülebilir alternatif bulunamadı</h2>
            <p>
              Gerekli model ve profil eşleşmelerini katalogdan kontrol edin.
            </p>
          </div>
        ) : (
          <div className="conversion-body">
            <aside className="option-list">
              {options.map((option) => (
                <button
                  key={option.target.profile.id}
                  className={
                    selected?.target.profile.id === option.target.profile.id
                      ? "active"
                      : ""
                  }
                  onClick={() => setSelected(option)}
                >
                  <span
                    className={`compat-status ${option.status.toLowerCase()}`}
                  >
                    {option.status === "FULL"
                      ? "✓ Tam Uyumlu"
                      : "⚠ Kısmi Uyumlu"}
                  </span>
                  <strong>{option.target.profile.name}</strong>
                  <small>
                    {option.target.profile.material} ·{" "}
                    {option.target.profile.compatibility_group} ·{" "}
                    {option.target.profile.wall_thickness_mm || 0} mm et
                  </small>
                  {option.missing_roles.length > 0 && (
                    <em>Eksik: {option.missing_roles.join(", ")}</em>
                  )}
                </button>
              ))}
            </aside>
            {selected && (
              <section className="compare-panel">
                <div className="compare-columns">
                  {[
                    {
                      label: "Mevcut kit",
                      name: variant.configuration?.compatibility_group,
                      detail: variant.profile_name,
                      pricing: sourcePricing,
                    },
                    {
                      label: "Alternatif",
                      name: selected.target.profile.compatibility_group,
                      detail: `${selected.target.profile.name} · ${selected.target.profile.wall_thickness_mm || 0} mm et`,
                      pricing: selected.target.pricing as PricingResult,
                    },
                  ].map((column) => (
                    <article key={column.label}>
                      <span>{column.label}</span>
                      <strong>{column.name}</strong>
                      <small>{column.detail}</small>
                      <PriceLine
                        label="Toplam maliyet"
                        value={column.pricing.total_cost_cents}
                      />
                      <PriceLine
                        label="KDV hariç satış"
                        value={column.pricing.subtotal_ex_vat_cents}
                      />
                      <PriceLine
                        label="Kazanç"
                        value={column.pricing.profit_cents}
                      />
                      <MetricLine
                        label="Kâr marjı"
                        value={`%${column.pricing.margin_percent.toFixed(2)}`}
                      />
                      <PriceLine label="KDV" value={column.pricing.vat_cents} />
                      <PriceLine
                        label="KDV dahil satış"
                        value={column.pricing.total_inc_vat_cents}
                      />
                      <MetricLine
                        label="Bağlantı ağırlığı"
                        value={weight(column.pricing.connector_weight_grams)}
                      />
                      <MetricLine
                        label="Profil ağırlığı"
                        value={weight(column.pricing.profile_weight_grams)}
                      />
                      <MetricLine
                        label="Tamamlayıcı ağırlığı"
                        value={weight(
                          column.pricing.complementary_weight_grams,
                        )}
                      />
                      <MetricLine
                        label="Toplam ağırlık"
                        value={`${weight(column.pricing.total_weight_grams)}${column.pricing.weight_complete ? "" : " + eksik veri"}`}
                      />
                    </article>
                  ))}
                </div>
                <div className="weight-note">
                  Kesim uzunlukları mevcut kitten aynen korunur.
                </div>
                {selected.status === "PARTIAL" && (
                  <div className="warning-box">
                    <AlertTriangle size={17} />
                    <div>
                      <strong>
                        {selected.target.profile.compatibility_group} dönüşümü
                        tam uyumlu değil
                      </strong>
                      <span>
                        Eksik bağlantı elemanı:{" "}
                        {selected.missing_roles.join(", ")}
                      </span>
                    </div>
                  </div>
                )}
                <div className="derive-form">
                  <label>
                    Yeni kit adı
                    <input
                      value={derivedName}
                      onChange={(e) => setDerivedName(e.target.value)}
                    />
                  </label>
                  <label>
                    Yeni SKU (isteğe bağlı)
                    <input
                      value={derivedSku}
                      onChange={(e) => setDerivedSku(e.target.value)}
                    />
                  </label>
                  <button
                    className="primary-action"
                    disabled={
                      !canSave ||
                      selected.status !== "FULL" ||
                      saving ||
                      derivedName.trim().length < 2
                    }
                    onClick={() => void saveDerived()}
                  >
                    <Copy size={16} />
                    {saving ? "Kaydediliyor…" : "Yeni Kit Olarak Kaydet"}
                  </button>
                </div>
                {error && <div className="error-box">{error}</div>}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CatalogPicker({
  kind,
  data,
  selectedProfile,
  activeConnector,
  activeCompatibilityGroup,
  selectedConnectors,
  selectedComplements,
  onClose,
  onConnector,
  onSetConnector,
  onProfile,
  onComplement,
}: {
  kind: "connector" | "profile" | "complement";
  data: Bootstrap;
  selectedProfile?: Profile;
  activeConnector?: Connector;
  activeCompatibilityGroup?: string;
  selectedConnectors: Record<string, { productId: string; quantity: number }>;
  selectedComplements: Record<string, number>;
  onClose: () => void;
  onConnector: (item: Connector, quantity: number) => void;
  onSetConnector: (item: Connector, quantity: number) => void;
  onProfile: (item: Profile) => void;
  onComplement: (item: Complementary, quantity: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [materialFilter, setMaterialFilter] = useState("");
  const [shapeFilter, setShapeFilter] = useState("");
  const [sizeFilter, setSizeFilter] = useState("");
  const compatibleProfiles = data.profiles.filter(
    (item) =>
      !activeConnector || profileMatchesConnector(item, activeConnector),
  );
  const compatibleConnectors = data.connectors.filter(
    (item) =>
      item.compatibility_status === "COMPATIBLE" &&
      (!selectedProfile || profileMatchesConnector(selectedProfile, item)) &&
      (selectedProfile ||
        !activeConnector ||
        connectorsShareSize(activeConnector, item)),
  );
  const source: Array<Connector | Profile | Complementary> =
    kind === "connector"
      ? compatibleConnectors
      : kind === "profile"
        ? compatibleProfiles
        : data.complementaryProducts;
  const profileOptions = kind === "profile" ? compatibleProfiles : [];
  const materials = [
    ...new Set(profileOptions.map((item) => item.material)),
  ].sort((a, b) => a.localeCompare(b, "tr"));
  const shapes = [
    ...new Set(
      profileOptions
        .filter((item) => !materialFilter || item.material === materialFilter)
        .map((item) => item.shape),
    ),
  ].sort();
  const sizes = [
    ...new Set(
      profileOptions
        .filter(
          (item) =>
            (!materialFilter || item.material === materialFilter) &&
            (!shapeFilter || item.shape === shapeFilter),
        )
        .map(profileSizeLabel),
    ),
  ].sort((a, b) => a.localeCompare(b, "tr", { numeric: true }));
  const filtered = source
    .filter((item: any) =>
      JSON.stringify(item)
        .toLocaleLowerCase("tr")
        .includes(query.toLocaleLowerCase("tr")),
    )
    .filter(
      (item) =>
        kind !== "profile" ||
        !materialFilter ||
        (item as Profile).material === materialFilter,
    )
    .filter(
      (item) =>
        kind !== "profile" ||
        !shapeFilter ||
        (item as Profile).shape === shapeFilter,
    )
    .filter(
      (item) =>
        kind !== "profile" ||
        !sizeFilter ||
        profileSizeLabel(item as Profile) === sizeFilter,
    )
    .sort((left, right) =>
      kind === "profile"
        ? `${(left as Profile).material}|${(left as Profile).shape}|${profileSizeLabel(left as Profile)}|${(left as Profile).wall_thickness_mm || 0}|${(left as Profile).supplier_name || ""}`.localeCompare(
            `${(right as Profile).material}|${(right as Profile).shape}|${profileSizeLabel(right as Profile)}|${(right as Profile).wall_thickness_mm || 0}|${(right as Profile).supplier_name || ""}`,
            "tr",
            { numeric: true },
          )
        : 0,
    );
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const visible = filtered.slice(page * 12, page * 12 + 12);
  useEffect(() => setPage(0), [query, materialFilter, shapeFilter, sizeFilter]);
  const dedicatedProfilePicker =
    kind === "profile" ? (
      <ProfilePicker
        data={data}
        selectedProfile={selectedProfile}
        activeConnector={activeConnector}
        activeCompatibilityGroup={activeCompatibilityGroup}
        onClose={onClose}
        onProfile={onProfile}
      />
    ) : null;
  if (dedicatedProfilePicker) return dedicatedProfilePicker;
  return (
    <div className="modal-backdrop">
      <div className="catalog-modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">Hızlı çoklu seçim</span>
            <h2>
              {kind === "connector"
                ? "Uyumlu bağlantılar"
                : kind === "profile"
                  ? "Uyumlu profiller"
                  : "Tamamlayıcı ürünler"}
            </h2>
            {activeCompatibilityGroup && kind !== "complement" && (
              <span className="filter-chip">
                Fiziksel ölçü:{" "}
                {selectedProfile
                  ? profileSizeLabel(selectedProfile)
                  : activeConnector?.sku.split("-")[1] ||
                    activeCompatibilityGroup}
              </span>
            )}
          </div>
          <button onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <div className="picker-tools">
          <label className="modal-search">
            <Search size={16} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SKU, ad, malzeme veya ölçü ara"
            />
          </label>
          {kind === "profile" && (
            <div className="profile-filters">
              <select
                aria-label="Materyal filtresi"
                value={materialFilter}
                onChange={(e) => {
                  setMaterialFilter(e.target.value);
                  setShapeFilter("");
                  setSizeFilter("");
                }}
              >
                <option value="">Tüm materyaller</option>
                {materials.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              <select
                aria-label="Profil formu filtresi"
                value={shapeFilter}
                onChange={(e) => {
                  setShapeFilter(e.target.value);
                  setSizeFilter("");
                }}
              >
                <option value="">Tüm formlar</option>
                {shapes.map((value) => (
                  <option key={value}>
                    {value === "ROUND"
                      ? "Yuvarlak"
                      : value === "SQUARE"
                        ? "Kare"
                        : "Dikdörtgen"}
                  </option>
                ))}
              </select>
              <select
                aria-label="Ölçü filtresi"
                value={sizeFilter}
                onChange={(e) => setSizeFilter(e.target.value)}
              >
                <option value="">Tüm ölçüler</option>
                {sizes.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="catalog-results">
          {visible.map((raw: any) => {
            const connector =
              kind === "connector" ? (raw as Connector) : undefined;
            const profileItem =
              kind === "profile" ? (raw as Profile) : undefined;
            const complement =
              kind === "complement" ? (raw as Complementary) : undefined;
            const id =
              connector?.product_id || profileItem?.id || complement!.id;
            const role = connector?.connector_role || "";
            const selectedLine = connector
              ? selectedConnectors[role]
              : undefined;
            const selected = connector
              ? selectedLine?.productId === connector.product_id
              : complement
                ? Boolean(selectedComplements[id])
                : false;
            const quantity =
              connector && selected ? selectedLine!.quantity : amounts[id] || 1;
            const occupied = connector && selectedLine && !selected;
            const differentMaterial = Boolean(
              profileItem &&
              activeConnector &&
              materialDiffers(profileItem, activeConnector),
            );
            return (
              <div
                className={`catalog-result ${selected ? "selected" : ""}`}
                key={id}
              >
                {connector?.image ? (
                  <img
                    src={`/api/panel/products/${encodeURIComponent(id)}/image`}
                    alt=""
                  />
                ) : profileItem?.image_path ? (
                  <img src={profileItem.image_path} alt="" />
                ) : complementImage(complement) ? (
                  <img src={complementImage(complement)} alt="" />
                ) : (
                  <span className="image-placeholder">
                    <ImageOff size={17} />
                  </span>
                )}
                <div className="catalog-copy">
                  <strong>
                    {connector?.sku || profileItem?.name || complement!.name}
                  </strong>
                  <span>
                    {connector
                      ? `${connector.name_tr} · ${connector.material || ""} · Alış ${money(connector.purchase_cost_cents)} · Satış ${money(connector.sale_price_cents)}`
                      : profileItem
                        ? `${profileItem.material} › ${profileItem.shape === "ROUND" ? "Yuvarlak" : profileItem.shape === "SQUARE" ? "Kare" : "Dikdörtgen"} › ${profileSizeLabel(profileItem)} › ${profileItem.wall_thickness_mm || 0} mm et${profileItem.supplier_name ? ` › ${profileItem.supplier_name}` : ""}`
                        : `${complement!.sku_optional || complement!.unit_type} · Satış ${money(complement!.sale_unit_price_cents)}`}
                  </span>
                  {differentMaterial && (
                    <em>✓ Ölçü uyumlu · ⚠ Farklı materyal</em>
                  )}
                  {occupied && <em>Aynı model zaten farklı ürünle seçili</em>}
                </div>
                {kind === "profile" ? (
                  <button
                    className="mini-add"
                    onClick={() => onProfile(profileItem!)}
                  >
                    Seç
                  </button>
                ) : connector && selected ? (
                  <div className="inline-stepper">
                    <button
                      onClick={() => onSetConnector(connector, quantity - 1)}
                    >
                      −
                    </button>
                    <strong>{quantity}</strong>
                    <button
                      onClick={() => onSetConnector(connector, quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <div className="quick-add">
                    <input
                      type="number"
                      min="0.001"
                      step={
                        connector ||
                        (complement &&
                          ["piece", "roll", "package", "box"].includes(
                            complement.base_uom_code,
                          ))
                          ? 1
                          : 0.001
                      }
                      value={quantity}
                      onChange={(e) =>
                        setAmounts((current) => ({
                          ...current,
                          [id]: Math.max(0.001, Number(e.target.value)),
                        }))
                      }
                    />
                    <button
                      disabled={Boolean(occupied)}
                      onClick={() =>
                        connector
                          ? onConnector(
                              connector,
                              Math.max(1, Math.round(quantity)),
                            )
                          : onComplement(complement!, quantity)
                      }
                    >
                      <PackagePlus size={16} />
                      Ekle
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className="empty-row">
              Bu fiziksel ölçü ve filtrelerle sonuç bulunamadı
            </div>
          )}
        </div>
        <div className="pagination">
          <span>
            {filtered.length} ürün · Materyal, form ve ölçü sırasıyla listelenir
          </span>
          <div>
            <button
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {page + 1}/{pages}
            </span>
            <button
              disabled={page >= pages - 1}
              onClick={() => setPage((value) => value + 1)}
            >
              <ChevronRight size={16} />
            </button>
            <button className="done" onClick={onClose}>
              Tamam
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfilePicker({
  data,
  selectedProfile,
  activeConnector,
  activeCompatibilityGroup,
  onClose,
  onProfile,
}: {
  data: Bootstrap;
  selectedProfile?: Profile;
  activeConnector?: Connector;
  activeCompatibilityGroup?: string;
  onClose: () => void;
  onProfile: (item: Profile) => void;
}) {
  const [query, setQuery] = useState("");
  const [materialFilter, setMaterialFilter] = useState<CanonicalMaterial | "">(
    "",
  );
  const [shapeFilter, setShapeFilter] = useState<Profile["shape"] | "">("");
  const compatible = data.profiles.filter(
    (profile) =>
      !activeConnector || profileMatchesConnector(profile, activeConnector),
  );
  const materialCounts = MATERIAL_ORDER.map((material) => ({
    material,
    count: compatible.filter(
      (profile) => normalizeMaterial(profile.material) === material,
    ).length,
  })).filter((item) => item.count > 0);
  const shapes = [
    ...new Set(
      compatible
        .filter(
          (profile) =>
            !materialFilter ||
            normalizeMaterial(profile.material) === materialFilter,
        )
        .map((profile) => profile.shape),
    ),
  ];
  const filtered = compatible.filter(
    (profile) =>
      (!materialFilter ||
        normalizeMaterial(profile.material) === materialFilter) &&
      (!shapeFilter || profile.shape === shapeFilter) &&
      (!query || profileSearchText(profile).includes(searchKey(query))),
  );
  const physicalLabel = selectedProfile
    ? profileSizeLabel(selectedProfile)
    : activeConnector?.sku.split("-")[1] || activeCompatibilityGroup;

  return (
    <div className="modal-backdrop">
      <div className="catalog-modal profile-picker-modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">Profil kataloğu</span>
            <h2>
              {activeConnector
                ? "Fiziksel ölçüyle uyumlu profiller"
                : "Profil seç"}
            </h2>
            {physicalLabel && (
              <span className="filter-chip">
                Fiziksel ölçü: {physicalLabel}
              </span>
            )}
          </div>
          <button onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <div className="profile-picker-tools">
          <label className="modal-search">
            <Search size={16} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Kod, ölçü, malzeme, et kalınlığı veya tedarikçi ara"
            />
          </label>
          <select
            aria-label="Profil formu filtresi"
            value={shapeFilter}
            onChange={(event) =>
              setShapeFilter(event.target.value as Profile["shape"] | "")
            }
          >
            <option value="">Tüm formlar</option>
            {shapes.map((shape) => (
              <option key={shape} value={shape}>
                {shapeLabel(shape)}
              </option>
            ))}
          </select>
        </div>
        <div className="material-chips">
          <button
            className={!materialFilter ? "active" : ""}
            onClick={() => setMaterialFilter("")}
          >
            Tümü <span>{compatible.length}</span>
          </button>
          {materialCounts.map(({ material, count }) => (
            <button
              key={material}
              className={materialFilter === material ? "active" : ""}
              onClick={() => {
                setMaterialFilter(material);
                setShapeFilter("");
              }}
            >
              {MATERIAL_LABELS[material]} <span>{count}</span>
            </button>
          ))}
        </div>
        <ProfileHierarchy
          profiles={filtered}
          selectedId={selectedProfile?.id}
          activeConnector={activeConnector}
          forceExpanded={Boolean(query)}
          onSelect={onProfile}
        />
        <div className="profile-picker-footer">
          <span>
            {filtered.length} varyant ·{" "}
            {groupProfiles(filtered).reduce(
              (sum, material) =>
                sum +
                material.shapes.reduce(
                  (shapeSum, shape) => shapeSum + shape.families.length,
                  0,
                ),
              0,
            )}{" "}
            ölçü ailesi
          </span>
          <button className="done" onClick={onClose}>
            Tamam
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileHierarchy({
  profiles,
  selectedId,
  activeConnector,
  forceExpanded = false,
  onSelect,
  onEdit,
}: {
  profiles: Profile[];
  selectedId?: string;
  activeConnector?: Connector;
  forceExpanded?: boolean;
  onSelect?: (profile: Profile) => void;
  onEdit?: (profile: Profile) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = groupProfiles(profiles);
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  if (!profiles.length)
    return (
      <div className="empty-row profile-empty">
        Bu fiziksel ölçü ve filtrelerle profil bulunamadı.
      </div>
    );
  return (
    <div className="profile-hierarchy">
      {groups.map((material) => (
        <section className="profile-material-group" key={material.key}>
          <header>
            <strong>{material.label}</strong>
            <span>
              {material.shapes.reduce(
                (sum, shape) =>
                  sum +
                  shape.families.reduce(
                    (familySum, family) => familySum + family.variants.length,
                    0,
                  ),
                0,
              )}{" "}
              varyant
            </span>
          </header>
          {material.shapes.map((shape) => (
            <div className="profile-shape-group" key={shape.shape}>
              <h3>{shape.label}</h3>
              {shape.families.map((family) => {
                const familyId = `${material.key}|${shape.shape}|${family.key}`;
                const isOpen = forceExpanded || expanded.has(familyId);
                const suppliers = new Set(
                  family.variants
                    .map((variant) => variant.supplier_name)
                    .filter(Boolean),
                );
                const purchases = family.variants
                  .map((variant) => variant.purchase_price_per_meter_cents)
                  .filter((value) => value != null);
                const sales = family.variants
                  .map((variant) => variant.sale_price_per_meter_cents)
                  .filter((value) => value != null);
                return (
                  <article
                    className={`profile-family ${isOpen ? "open" : ""}`}
                    key={familyId}
                  >
                    <button
                      className="profile-family-head"
                      onClick={() => toggle(familyId)}
                    >
                      <ChevronRight size={17} />
                      <strong>{family.label}</strong>
                      <span>{family.variants.length} varyant</span>
                      <small>{suppliers.size} tedarikçi</small>
                      <small>
                        Alış {money(Math.min(...purchases))}
                        {Math.min(...purchases) !== Math.max(...purchases)
                          ? ` – ${money(Math.max(...purchases))}`
                          : ""}
                      </small>
                      <small>
                        Satış {money(Math.min(...sales))}
                        {Math.min(...sales) !== Math.max(...sales)
                          ? ` – ${money(Math.max(...sales))}`
                          : ""}
                      </small>
                    </button>
                    {isOpen && (
                      <div className="profile-variants">
                        {family.variants.map((profile) => {
                          const differentMaterial = Boolean(
                            activeConnector &&
                            materialDiffers(profile, activeConnector),
                          );
                          return (
                            <div
                              className={`profile-variant ${selectedId === profile.id ? "selected" : ""}`}
                              key={profile.id}
                            >
                              {profile.image_path ? (
                                <img src={profile.image_path} alt="" />
                              ) : (
                                <span className="image-placeholder">
                                  <ImageOff size={17} />
                                </span>
                              )}
                              <div>
                                <strong>{profile.name}</strong>
                                <span>
                                  {profile.wall_thickness_mm || 0} mm et ·{" "}
                                  {profile.raw_length_mm / 1000} m ham boy
                                  {profile.supplier_name
                                    ? ` · ${profile.supplier_name}`
                                    : ""}
                                </span>
                                <small>
                                  Alış{" "}
                                  {money(
                                    profile.purchase_price_per_meter_cents,
                                  )}
                                  /m · Satış{" "}
                                  {money(profile.sale_price_per_meter_cents)}/m
                                </small>
                                {differentMaterial && (
                                  <em>✓ Ölçü uyumlu · ⚠ Farklı materyal</em>
                                )}
                              </div>
                              <div className="profile-variant-actions">
                                {onEdit && (
                                  <button
                                    className="table-edit"
                                    onClick={() => onEdit(profile)}
                                  >
                                    <Edit3 size={14} />
                                    Düzenle
                                  </button>
                                )}
                                {onSelect && (
                                  <button
                                    className="mini-add"
                                    onClick={() => onSelect(profile)}
                                  >
                                    {selectedId === profile.id
                                      ? "Seçili"
                                      : "Seç"}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function CatalogManager({
  data,
  canWrite,
  onChanged,
}: {
  data: Bootstrap;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"profiles" | "complements" | "sync">(
    "profiles",
  );
  const [busy, setBusy] = useState(false);
  async function sync() {
    setBusy(true);
    await apiFetch("/api/panel/sync", { method: "POST" });
    await onChanged();
    setBusy(false);
  }
  return (
    <main className="page-view">
      <PageHeader eyebrow="Panel katalog görünümü" title="Katalog" description="Canonical ürün, profil ve UOM verileri Panel’den salt okunur sözleşmeyle alınır."/>
      <div className="catalog-tabs">
        <button
          className={tab === "profiles" ? "active" : ""}
          onClick={() => setTab("profiles")}
        >
          Profiller ({data.profiles.length})
        </button>
        <button
          className={tab === "complements" ? "active" : ""}
          onClick={() => setTab("complements")}
        >
          Tamamlayıcılar ({data.complementaryProducts.length})
        </button>
        <button
          className={tab === "sync" ? "active" : ""}
          onClick={() => setTab("sync")}
        >
          Panel senkronizasyonu
        </button>
      </div>
      {tab === "profiles" && <ProfileCatalogView profiles={data.profiles} />}{" "}
      {tab === "complements" && (
        <CatalogTable rows={data.complementaryProducts} kind="complement" />
      )}{" "}
      {tab === "sync" && (
        <>
          <div
            className={`sync-banner ${data.sync.panelReachable ? "reachable" : "stale"}`}
          >
            <strong>
              {data.sync.panelReachable
                ? "Panel erişilebilir"
                : "Panel erişilemiyor — son önbellek korunuyor"}
            </strong>
            <span>
              Son başarılı:{" "}
              {data.sync.lastSyncedAt
                ? new Date(data.sync.lastSyncedAt).toLocaleString("tr-TR")
                : "yok"}
            </span>
          </div>
          <div className="stat-grid">
            <Stat label="Bağlantı" value={data.sync.connectorCount} />
            <Stat
              label="Otomatik sınıflandırılan"
              value={data.sync.compatibleCount}
            />
            <Stat label="Profil" value={data.profiles.length} />
            <Stat
              label="Tamamlayıcı"
              value={data.complementaryProducts.length}
            />
          </div>
          {canWrite && (
            <Button
              className="sync-button"
              loading={busy}
              loadingText="Senkronize ediliyor…"
              onClick={() => void sync()}
            >
              <RefreshCw size={17} />
              Şimdi senkronize et
            </Button>
          )}
          <div className="info-card">
            <strong>Canonical authority Panel</strong>
            <p>
              Kit Studio bu kataloğu yalnızca sürümlü contract üzerinden
              önbellekler; ürün, SKU veya UOM yazmaz.
            </p>
          </div>
        </>
      )}
    </main>
  );
}

function ProfileCatalogView({ profiles }: { profiles: Profile[] }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"category" | "table">("category");
  const visible = profiles.filter(
    (profile) =>
      !query || profileSearchText(profile).includes(searchKey(query)),
  );
  return (
    <>
      <div className="catalog-view-tools">
        <label className="page-search">
          <Search size={16} />
          <Input
            aria-label="Profil ara"
            containerClassName="ui-search-field"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Kod, fiziksel/nominal ölçü, malzeme, et kalınlığı veya tedarikçi ara"
          />
        </label>
        <div className="view-toggle">
          <Button variant="ghost"
            className={view === "category" ? "active" : ""}
            onClick={() => setView("category")}
          >
            Kategoriler
          </Button>
          <Button variant="ghost"
            className={view === "table" ? "active" : ""}
            onClick={() => setView("table")}
          >
            Tablo
          </Button>
        </div>
      </div>
      {view === "category" ? (
        <div className="catalog-profile-tree">
          <ProfileHierarchy profiles={visible} forceExpanded={Boolean(query)} />
        </div>
      ) : (
        <div className="kit-table-wrap">
          <table className="kit-table">
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Malzeme › Form › Fiziksel ölçü › Varyant</th>
                <th>Alış</th>
                <th>Satış</th>
                <th>Kaynak</th>
              </tr>
            </thead>
            <tbody>
              {visible
                .sort((left, right) =>
                  `${normalizeMaterial(left.material)}|${left.shape}|${profileSizeLabel(left)}|${left.wall_thickness_mm || 0}|${left.supplier_name || ""}`.localeCompare(
                    `${normalizeMaterial(right.material)}|${right.shape}|${profileSizeLabel(right)}|${right.wall_thickness_mm || 0}|${right.supplier_name || ""}`,
                    "tr",
                    { numeric: true },
                  ),
                )
                .map((profile) => (
                  <tr key={profile.id}>
                    <td>
                      <div className="kit-identity">
                        {profile.image_path ? (
                          <img src={profile.image_path} alt="" />
                        ) : (
                          <span className="image-placeholder">
                            <ImageOff size={18} />
                          </span>
                        )}
                        <div>
                          <strong>{profile.name}</strong>
                          <small>{profile.compatibility_group}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {materialLabel(profile.material)} ›{" "}
                      {shapeLabel(profile.shape)} › {profileSizeLabel(profile)}{" "}
                      › {profile.wall_thickness_mm || 0} mm et
                      {profile.supplier_name
                        ? ` › ${profile.supplier_name}`
                        : ""}
                    </td>
                    <td>{money(profile.purchase_price_per_meter_cents)}</td>
                    <td>{money(profile.sale_price_per_meter_cents)}</td>
                    <td>{profile.catalog_source || "PANEL"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CatalogTable({
  rows,
  kind,
}: {
  rows: Array<Profile | Complementary>;
  kind: "profile" | "complement";
}) {
  const [query, setQuery] = useState("");
  const visible = rows
    .filter((row) =>
      JSON.stringify(row)
        .toLocaleLowerCase("tr")
        .includes(query.toLocaleLowerCase("tr")),
    )
    .sort((left, right) =>
      kind === "profile"
        ? `${(left as Profile).material}|${(left as Profile).shape}|${profileSizeLabel(left as Profile)}|${(left as Profile).wall_thickness_mm || 0}|${(left as Profile).supplier_name || ""}`.localeCompare(
            `${(right as Profile).material}|${(right as Profile).shape}|${profileSizeLabel(right as Profile)}|${(right as Profile).wall_thickness_mm || 0}|${(right as Profile).supplier_name || ""}`,
            "tr",
            { numeric: true },
          )
        : left.name.localeCompare(right.name, "tr"),
    );
  return (
    <>
      <label className="page-search">
        <Search size={16} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Katalogda ara"
        />
      </label>
      <div className="kit-table-wrap">
        <table className="kit-table">
          <thead>
            <tr>
              <th>Ürün</th>
              <th>
                {kind === "profile"
                  ? "Materyal › Form › Ölçü › Varyant"
                  : "Özellikler"}
              </th>
              <th>Alış</th>
              <th>Satış</th>
              <th>Kaynak</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((raw) => {
              const profile = kind === "profile" ? (raw as Profile) : undefined;
              const complement =
                kind === "complement" ? (raw as Complementary) : undefined;
              return (
                <tr key={raw.id}>
                  <td>
                    <div className="kit-identity">
                      {profile?.image_path || complementImage(complement!) ? (
                        <img
                          src={
                            profile?.image_path || complementImage(complement!)
                          }
                          alt=""
                        />
                      ) : (
                        <span className="image-placeholder">
                          <ImageOff size={18} />
                        </span>
                      )}
                      <div>
                        <strong>{raw.name}</strong>
                        <small>
                          {profile?.compatibility_group ||
                            complement?.sku_optional ||
                            "SKU yok"}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {profile
                      ? `${profile.material} › ${profile.shape === "ROUND" ? "Yuvarlak" : profile.shape === "SQUARE" ? "Kare" : "Dikdörtgen"} › ${profileSizeLabel(profile)} › ${profile.wall_thickness_mm || 0} mm et${profile.supplier_name ? ` › ${profile.supplier_name}` : ""}`
                      : `${complement!.unit_type} · ${complement!.description || ""}`}
                  </td>
                  <td>
                    {money(
                      profile?.purchase_price_per_meter_cents ??
                        complement!.purchase_unit_price_cents,
                    )}
                  </td>
                  <td>
                    {money(
                      profile?.sale_price_per_meter_cents ??
                        complement!.sale_unit_price_cents,
                    )}
                  </td>
                  <td>{raw.catalog_source || "PANEL"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ProfileForm({
  value,
  data,
  onClose,
  onSaved,
}: {
  value?: Profile;
  data: Bootstrap;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [shape, setShape] = useState<Profile["shape"]>(
    value?.shape || "SQUARE",
  );
  const [error, setError] = useState("");
  const [purchase, setPurchase] = useState(
    (value?.purchase_price_per_meter_cents || 0) / 100,
  );
  const [markup, setMarkup] = useState((value?.markup_basis_points || 0) / 100);
  const initialMaterial = value
    ? normalizeMaterial(value.material)
    : "ALUMINUM";
  const [materialChoice, setMaterialChoice] =
    useState<CanonicalMaterial>(initialMaterial);
  const [customMaterial, setCustomMaterial] = useState(
    initialMaterial === "OTHER" ? value?.material || "" : "",
  );
  const [rawLengthUnit, setRawLengthUnit] =
    useState<DisplayLengthUnit>("m");
  const [rawLengthText, setRawLengthText] = useState(
    formatLengthFromMm(value?.raw_length_mm || 6000, "m"),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const number = (key: string) => Number(form.get(key) || 0);
    const width = number("width_mm");
    const height = number("height_mm");
    const diameter = number("outside_diameter_mm");
    const group =
      shape === "ROUND" ? `RD-${diameter}` : `SQ-${width}X${height}`;
    const rawLengthMm = parseLengthToMm(
      String(form.get("raw_length") || ""),
      rawLengthUnit,
    );
    if (rawLengthMm === null || rawLengthMm <= 0) {
      return setError(
        "Ham boy tam milimetreye dönüşmelidir; değer yuvarlanmadı.",
      );
    }
    const payload = {
      name: form.get("name"),
      shape,
      material:
        materialChoice === "OTHER" ? customMaterial.trim() : materialChoice,
      width_mm: shape === "ROUND" ? undefined : width,
      height_mm: shape === "ROUND" ? undefined : height,
      outside_diameter_mm: shape === "ROUND" ? diameter : undefined,
      nominal_size: String(form.get("nominal_size") || "") || undefined,
      wall_thickness_mm: number("wall_thickness_mm"),
      compatibility_group: group,
      raw_length_mm: rawLengthMm,
      weight_per_meter_kg: number("weight_per_meter_kg"),
      purchase_price_per_meter_cents: Math.round(purchase * 100),
      markup_basis_points: Math.round(markup * 100),
      supplier_id: String(form.get("supplier_id") || "") || null,
      notes: String(form.get("notes") || ""),
    };
    const response = await apiFetch(
      value ? `/api/profiles/${value.id}` : "/api/profiles",
      json(value ? "PUT" : "POST", payload),
    );
    if (!response.ok) return setError(await responseMessage(response));
    const saved = (await response.json()) as Profile;
    const image = form.get("image") as File;
    if (image?.size) {
      const body = new FormData();
      body.append("image", image);
      await apiFetch(`/api/profiles/${saved.id}/image`, {
        method: "POST",
        body,
      });
    }
    await onSaved();
  }
  return (
    <Modal open onClose={onClose} title={value ? "Profili düzenle" : "Yeni profil"} description="Profil kataloğu" className="form-modal" size="lg">
      <form onSubmit={submit}>
        <div className="modal-form">
          <label>
            Ürün adı
            <input name="name" required defaultValue={value?.name} />
          </label>
          <Select label="Malzeme" value={materialChoice} onChange={(event) => setMaterialChoice(event.target.value as CanonicalMaterial)}>
              {MATERIAL_ORDER.map((material) => (
                <option key={material} value={material}>
                  {MATERIAL_LABELS[material]}
                </option>
              ))}
          </Select>
          {materialChoice === "OTHER" && (
            <label className="span-2">
              Özel malzeme adı
              <input
                required
                value={customMaterial}
                onChange={(event) => setCustomMaterial(event.target.value)}
                placeholder="Malzeme adını yazın"
              />
            </label>
          )}
          <Select label="Profil şekli" value={shape} onChange={(e) => setShape(e.target.value as Profile["shape"])}>
              <option value="SQUARE">Kare</option>
              <option value="RECTANGULAR">Dikdörtgen</option>
              <option value="ROUND">Yuvarlak</option>
          </Select>
          {shape === "ROUND" ? (
            <label>
              Dış çap (mm)
              <input
                name="outside_diameter_mm"
                required
                type="number"
                step=".01"
                defaultValue={value?.outside_diameter_mm}
              />
            </label>
          ) : (
            <>
              <label>
                Genişlik (mm)
                <input
                  name="width_mm"
                  required
                  type="number"
                  step=".01"
                  defaultValue={value?.width_mm}
                />
              </label>
              <label>
                Yükseklik (mm)
                <input
                  name="height_mm"
                  required
                  type="number"
                  step=".01"
                  defaultValue={value?.height_mm}
                />
              </label>
            </>
          )}
          <label>
            Nominal ölçü
            <input name="nominal_size" defaultValue={value?.nominal_size} />
          </label>
          <label>
            Et kalınlığı (mm)
            <input
              name="wall_thickness_mm"
              required
              type="number"
              min="0"
              step=".01"
              defaultValue={value?.wall_thickness_mm}
            />
          </label>
          <label>
            Ham boy
            <input
              name="raw_length"
              required
              type="number"
              step="any"
              value={rawLengthText}
              onChange={(event) => setRawLengthText(event.target.value)}
            />
            <select
              value={rawLengthUnit}
              onChange={(event) => {
                const next = event.target.value as DisplayLengthUnit;
                const millimeters = parseLengthToMm(
                  rawLengthText,
                  rawLengthUnit,
                );
                setRawLengthUnit(next);
                if (millimeters !== null)
                  setRawLengthText(formatLengthFromMm(millimeters, next));
              }}
            >
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="m">m</option>
            </select>
          </label>
          <label>
            Ağırlık (kg/m)
            <input
              name="weight_per_meter_kg"
              required
              type="number"
              min="0"
              step=".001"
              defaultValue={value?.weight_per_meter_kg || 0}
            />
          </label>
          <label>
            Tedarikçi
            <select name="supplier_id" defaultValue={value?.supplier_id || ""}>
              <option value="">—</option>
              {data.suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Alış (₺/m)
            <input
              required
              type="number"
              min="0"
              step=".01"
              value={purchase}
              onChange={(event) => setPurchase(Number(event.target.value))}
            />
          </label>
          <label>
            Eklenen yüzde (%)
            <input
              required
              type="number"
              min="0"
              step=".01"
              value={markup}
              onChange={(event) => setMarkup(Number(event.target.value))}
            />
          </label>
          <label>
            Hesaplanan satış (₺/m)
            <input
              readOnly
              value={(purchase * (1 + markup / 100)).toFixed(2)}
            />
          </label>
          <label>
            Görsel
            <input
              name="image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
            />
          </label>
          <label className="span-2">
            Not
            <textarea name="notes" defaultValue={value?.notes} />
          </label>
          {error && <div className="error-box span-2">{error}</div>}
          <div className="modal-actions span-2">
            <Button variant="secondary" type="button" onClick={onClose}>
              Vazgeç
            </Button>
            <Button type="submit"
              disabled={materialChoice === "OTHER" && !customMaterial.trim()}
            >
              Kaydet
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function ComplementForm({
  value,
  data,
  onClose,
  onSaved,
}: {
  value?: Complementary;
  data: Bootstrap;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [unit, setUnit] = useState<Complementary["unit_type"]>(
    value?.unit_type || "piece",
  );
  const [purchase, setPurchase] = useState(
    (value?.purchase_unit_price_cents || 0) / 100,
  );
  const [markup, setMarkup] = useState((value?.markup_basis_points || 0) / 100);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get("name"),
      sku_optional: String(form.get("sku") || ""),
      description: String(form.get("description") || ""),
      unit_type: unit,
      purchase_unit_price_cents: Math.round(purchase * 100),
      markup_basis_points: Math.round(markup * 100),
      weight_per_unit_grams: Number(form.get("weight") || 0) || null,
      supplier_id: String(form.get("supplier_id") || "") || null,
      website_url_optional: String(form.get("website") || ""),
      notes: String(form.get("notes") || ""),
    };
    const response = await apiFetch(
      value
        ? `/api/complementary-products/${value.id}`
        : "/api/complementary-products",
      json(value ? "PUT" : "POST", payload),
    );
    if (!response.ok) return setError(await responseMessage(response));
    const saved = (await response.json()) as Complementary;
    const image = form.get("image") as File;
    if (image?.size) {
      const body = new FormData();
      body.append("image", image);
      await apiFetch(`/api/complementary-products/${saved.id}/image`, {
        method: "POST",
        body,
      });
    }
    await onSaved();
  }
  const unitLabel =
    unit === "piece"
      ? "g/adet"
      : unit === "meter"
        ? "g/metre"
        : unit === "square_meter"
          ? "g/m²"
          : `g/${unit}`;
  return (
    <Modal open onClose={onClose} title={value ? "Ürünü düzenle" : "Yeni tamamlayıcı ürün"} description="Tamamlayıcı katalog" className="form-modal" size="lg">
      <form onSubmit={submit}>
        <div className="modal-form">
          <label>
            Ürün adı
            <input name="name" required defaultValue={value?.name} />
          </label>
          <label>
            SKU
            <input name="sku" defaultValue={value?.sku_optional} />
          </label>
          <label>
            Birim
            <select
              value={unit}
              onChange={(event) =>
                setUnit(event.target.value as Complementary["unit_type"])
              }
            >
              <option value="piece">Adet</option>
              <option value="meter">Metre</option>
              <option value="square_meter">m²</option>
              <option value="kg">kg</option>
              <option value="roll">Rulo</option>
              <option value="package">Paket</option>
              <option value="box">Kutu</option>
            </select>
          </label>
          <label>
            Tedarikçi
            <select name="supplier_id" defaultValue={value?.supplier_id || ""}>
              <option value="">—</option>
              {data.suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Alış fiyatı (₺)
            <input
              required
              type="number"
              min="0"
              step=".01"
              value={purchase}
              onChange={(event) => setPurchase(Number(event.target.value))}
            />
          </label>
          <label>
            Eklenen yüzde (%)
            <input
              required
              type="number"
              min="0"
              step=".01"
              value={markup}
              onChange={(event) => setMarkup(Number(event.target.value))}
            />
          </label>
          <label>
            Hesaplanan satış (₺)
            <input
              readOnly
              value={(purchase * (1 + markup / 100)).toFixed(2)}
            />
          </label>
          <label>
            Birim ağırlık ({unitLabel})
            <input
              name="weight"
              type="number"
              min="0"
              step=".01"
              defaultValue={value?.weight_per_unit_grams || ""}
            />
          </label>
          <label>
            Web sitesi
            <input
              name="website"
              type="url"
              defaultValue={value?.website_url_optional}
            />
          </label>
          <label>
            Görsel
            <input
              name="image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
            />
          </label>
          <label className="span-2">
            Açıklama
            <textarea name="description" defaultValue={value?.description} />
          </label>
          <label className="span-2">
            Not
            <textarea name="notes" defaultValue={value?.notes} />
          </label>
          {error && <div className="error-box span-2">{error}</div>}
          <div className="modal-actions span-2">
            <Button variant="secondary" type="button" onClick={onClose}>
              Vazgeç
            </Button>
            <Button type="submit">Kaydet</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function BomSection({
  title,
  count,
  action,
  empty,
  children,
}: {
  title: string;
  count: string;
  action?: ReactNode;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="card-title">
        <div>
          <h2>{title}</h2>
          <Badge>{count}</Badge>
        </div>
        {action}
      </div>
      {empty ? <div className="empty-row">Henüz ürün eklenmedi</div> : children}
    </Card>
  );
}
function ProductRow({
  image,
  badge,
  title,
  subtitle,
  cost,
  quantity = 1,
  readOnly,
  onQuantity,
  onRemove,
}: {
  image?: string;
  badge: string;
  title: string;
  subtitle: string;
  cost: number;
  quantity?: number;
  readOnly: boolean;
  onQuantity?: (value: number) => void;
  onRemove?: () => void;
}) {
  const costLabel = subtitle.includes("Bilinmiyor")
    ? "Bilinmiyor"
    : money(cost);
  return (
    <div className="product-row">
      {image ? (
        <img src={image} alt="" onError={imageFallback} />
      ) : (
        <span className="row-badge">{badge}</span>
      )}
      <div className="product-copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {onQuantity && (
        <div className="stepper">
          <button
            disabled={readOnly}
            onClick={() => onQuantity(Math.max(1, quantity - 1))}
          >
            −
          </button>
          <input
            disabled={readOnly}
            type="number"
            min="1"
            value={quantity}
            onChange={(e) =>
              onQuantity(Math.max(0.001, Number(e.target.value)))
            }
          />
          <button disabled={readOnly} onClick={() => onQuantity(quantity + 1)}>
            +
          </button>
        </div>
      )}
      <strong className="row-cost">{costLabel}</strong>
      {onRemove && !readOnly && (
        <button className="remove" onClick={onRemove}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}
function SummaryHeading({ children }: { children: ReactNode }) {
  return <h3 className="summary-heading">{children}</h3>;
}
function CategoryPricing({
  title,
  cost,
  sale,
  profit,
}: {
  title: string;
  cost: number;
  sale: number;
  profit: number;
}) {
  return (
    <section className="category-pricing">
      <strong>{title}</strong>
      <PriceLine label="Alış maliyeti" value={cost} />
      <PriceLine label="Satış fiyatı" value={sale} />
      <PriceLine
        label="Kâr"
        value={profit}
        tone={profit >= 0 ? "positive" : "negative"}
      />
      {sale === 0 && <small>Satış fiyatı bilinmiyor veya 0.</small>}
    </section>
  );
}
function PriceLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className={`price-line ${tone || ""}`}>
      <span>{label}</span>
      <strong>{money(value)}</strong>
    </div>
  );
}
function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="price-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card as="article" className="stat">
      <Boxes />
      <span>{label}</span>
      <strong>{value}</strong>
    </Card>
  );
}
function LoginScreen({
  onSubmit,
  error,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  error: string;
}) {
  return (
    <div className="auth-screen">
      <Card as="form" onSubmit={onSubmit}>
        <div className="brand-mark">
          <Wrench size={18} />
        </div>
        <h1>Panel hesabınızla giriş yapın</h1>
        <Input name="username" autoComplete="username" placeholder="Kullanıcı adı" />
        <Input name="password" type="password" autoComplete="current-password" placeholder="Parola" />
        <Button type="submit" className="full">Giriş yap</Button>
        {error && <small>{error}</small>}
      </Card>
    </div>
  );
}
function PasswordChange({
  user,
  onChanged,
  onLogout,
}: {
  user: User;
  onChanged: (user: User) => void;
  onLogout: () => void;
}) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("new") !== form.get("confirm"))
      return setError("Yeni parolalar eşleşmiyor");
    const response = await apiFetch(
      "/api/auth/change-password",
      json("POST", {
        current_password: form.get("current"),
        new_password: form.get("new"),
      }),
    );
    if (!response.ok) return setError("Parola değiştirilemedi");
    onChanged((await response.json()).user);
  }
  return (
    <div className="auth-screen">
      <Card as="form" onSubmit={submit}>
        <h1>Parolanızı değiştirin</h1>
        <Input name="current" type="password" autoComplete="current-password" placeholder="Mevcut parola" />
        <Input
          name="new"
          type="password"
          autoComplete="new-password"
          minLength={8}
          placeholder="Yeni parola"
        />
        <Input
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          placeholder="Yeni parola tekrar"
        />
        <Button type="submit" className="full">Parolayı değiştir</Button>
        <Button variant="ghost" type="button" className="link-button" onClick={onLogout}>
          Çıkış yap
        </Button>
        {error && <small>{error}</small>}
      </Card>
    </div>
  );
}
function optimizeCuts(
  cuts: Array<{ quantity: number; length_mm: number }>,
  raw: number,
) {
  const pieces = cuts
    .flatMap((cut) => Array.from({ length: cut.quantity }, () => cut.length_mm))
    .sort((a, b) => b - a);
  const bars: number[][] = [];
  for (const piece of pieces) {
    const target = bars.find(
      (bar) => bar.reduce((sum, item) => sum + item, 0) + piece <= raw,
    );
    if (target) target.push(piece);
    else bars.push([piece]);
  }
  const used = pieces.reduce((sum, item) => sum + item, 0);
  const purchasedMm = bars.length * raw;
  return {
    bars: bars.length,
    purchasedMm,
    wasteMm: Math.max(0, purchasedMm - used),
    utilization: purchasedMm ? (used / purchasedMm) * 100 : 0,
  };
}
async function responseMessage(response: Response) {
  const body = await response.json().catch(() => ({}));
  return body.error === "DUPLICATE_SKU"
    ? "Bu SKU başka bir kitte kullanılıyor"
    : body.error || "İşlem tamamlanamadı";
}
