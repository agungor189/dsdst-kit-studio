# DSDST Kit Studio

DSDST Kit Studio; Panel ürün masterını değiştirmeden bağlantı elemanı, profil ve tamamlayıcı ürünlerden uyumlu kit varyantları üretir. Bağlantı SKU, ad, fiyat ve stok bilgileri yalnız Panel API’den gelir. Kit Studio, Panel SQLite dosyasını hiçbir zaman açmaz.

## Mimari

- React + TypeScript + Vite: desktop-first Kit Builder, canlı fiyat paneli ve varyant karşılaştırması.
- Node.js + Express: tüm business rule’ların zorunlu uygulandığı API.
- SQLite: Kit Studio’ya ait uyumluluk metadatası, profiller, tamamlayıcılar, BOM, versiyon ve fiyat snapshot’ları.
- Panel API: kullanıcı oturumları için `/api/auth/*`; katalog için `GET /api/kit-catalog/connectors` ve `GET /api/kit-catalog/connectors/:id`. Yalnız katalog çağrılarında `kit-catalog:read` izinli sunucu tarafı API key kullanılır.
- Para değerleri integer kuruş, kesirli miktarlar binde bir birim olarak saklanır.

Uyumluluk merkezi bir servis üzerinden `connector_compatibility` ile `profile_specs` alanlarını karşılaştırır. Panel’in yapılandırılmış form, boru tipi ve ölçü alanları birincil kaynaktır. Yalnız bu alanlar eksikse SKU yedek ayrıştırması kullanılır ve kayıt `SKU_FALLBACK` olarak işaretlenir. Resolver `connector_role + profile` girdisini gerçek Panel product UUID/SKU’suna dönüştürür.

## Veri modeli

Ana tablolar: `kits`, `kit_variants`, `connector_roles`, `connector_compatibility`, `panel_connector_cache`, `profile_specs`, `profiles`, `profile_supplier_offers`, `suppliers`, `complementary_products`, `complementary_supplier_offers`, `kit_variant_connectors`, `kit_variant_profiles`, `kit_variant_profile_cuts`, `kit_variant_complementary_items`, `kit_pricing_snapshots`, `kit_versions`, `app_settings` ve `schema_migrations`.

`panel_connector_cache` Panel’den alınan salt-okunur çalışma kopyasıdır; merkezi ürün masterı değildir. Varyant satırları kullanılan fiyatı snapshot olarak taşır. Panel fiyatı değiştiğinde geçmiş analiz değişmez; taslak varyant için fiyat yenileme aksiyonu kullanılabilir.

## Fiyat formülleri

- Profil miktarı: `Σ(adet × kesim_mm) / 1000`
- Grup maliyet/satış: satır miktarı × snapshot birim fiyatı
- Toplam maliyet: bağlantı + profil + tamamlayıcı maliyeti
- KDV hariç satış: üç grubun satış toplamı
- Brüt kâr: KDV hariç satış − toplam maliyet
- Brüt marj: brüt kâr / KDV hariç satış × 100
- KDV: KDV hariç satış × ayarlardaki oran
- KDV dahil satış: KDV hariç satış + KDV

Varsayılan KDV `app_settings.vat_rate_basis_points=2000` (%20) olarak tutulur; hard-code edilmiş bir fiyat kuralı değildir.

## Yerel geliştirme

```bash
cp .env.example .env
npm ci
npm run dev
```

Arayüz `http://localhost:5173`, API `http://localhost:3012` adresindedir. Geliştirme seed’i yalnız production dışı ortamda Square 20×20, Square 40×40, Round 1", MDF, tekerlek ve PVC örneklerini ekler.

```bash
npm run typecheck
npm test
npm run build
```

## Panel hazırlığı

Panel yönetim ekranından yalnız `kit-catalog:read` iznine sahip bir API key oluşturun. Bu anahtarı Kit Studio `.env` dosyasındaki `PANEL_API_KEY` alanına, Panel taban adresini `PANEL_API_URL` alanına yazın. API key yalnız Kit Studio sunucusunda kalır. Kullanıcılar mevcut Panel kullanıcı adı/parolasıyla giriş yapar; Panel JWT’si `HttpOnly`, `SameSite=Lax` ve production’da `Secure` çerezde tutulur ve her API isteğinde Panel `/api/auth/me` ile doğrulanır.

Kit Studio login proxy'si Panel'in limiter'ından bağımsızdır: başarısız denemeleri IP + normalize kullanıcı adı başına 15 dakikada 10 deneme ile sınırlar. Güvenilir tek reverse proxy kullanılıyorsa gerçek istemci IP'si için `TRUST_PROXY_HOPS=1` ayarlanabilir; aksi halde `0` bırakılır.

Panel ile katalog senkronizasyonu oturum çereziyle yapılır:

```bash
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"PANEL_USER","password":"PANEL_PASSWORD"}' \
  http://localhost:3012/api/auth/login
curl -b cookies.txt -X POST http://localhost:3012/api/panel/sync
```

Uygulama açılışta otomatik senkronizasyon dener. Panel erişilemezse son başarılı yerel önbellekle çalışmaya devam eder; arayüz durumu stale/erişilemiyor olarak gösterir. `readonly` kullanıcılar yalnız okuyabilir, `admin` ve `user` kayıt yapabilir; manuel uyumluluk eşlemesi yalnız `admin` rolüne açıktır.

## Docker ile kurulum

```bash
cp .env.example .env
docker network create dsdst-internal # sunucuda yalnız ilk kurulumda
docker compose build
docker compose up -d
docker compose exec kit-studio node dist-server/server/db/migrate-cli.js
curl http://localhost:3012/api/health
```

Güncelleme:

```bash
git pull --ff-only origin main
docker compose build --pull
docker compose up -d --remove-orphans
docker compose exec kit-studio node dist-server/server/db/migrate-cli.js
```

Kalıcı veriler varsayılan olarak `./data` ve `./uploads` altındadır. Sunucuda mutlak dizinler için `KIT_STUDIO_DATA_DIR` ve `KIT_STUDIO_UPLOADS_DIR` kullanılabilir.
Container `node` kullanıcısıyla, salt-okunur root filesystem, `no-new-privileges`, düşürülmüş Linux capability'leri ve sınırlı `/tmp` tmpfs ile çalışır. Bind-mount dizinleri container içindeki node kullanıcısı (UID 1000) tarafından yazılabilir olmalıdır.

## Business rule özeti

- Uyumsuz connector/profile satırı sunucuda reddedilir.
- Panel bağlantı fiyatı client payload’ıyla değiştirilemez.
- `PIECE` miktarı pozitif tam sayı; `METER` ve `M2` pozitif kesirli olabilir.
- Kesim boyu ve adedi pozitiftir.
- Client toplamları kabul edilmez; fiyat her kayıtta sunucuda hesaplanır.
- Varyant dönüşümü roller ve kesimleri korur, hedef profile göre SKU’ları yeniden çözer.
- Eksik rol eşlemesi varyantı `INCOMPLETE` yapar; bu varyant onaylanamaz.
- Onay kritik BOM ve pricing snapshot’ını `kit_versions` içinde korur.

## Upload güvenliği

Tamamlayıcı ürün görselleri en fazla 5 MB olabilir. Yalnız JPEG, PNG ve WebP kabul edilir; MIME başlığına ek olarak dosya imzası kontrol edilir. Dosyalar UUID isimle `/uploads/complementary-products` altında saklanır, DB yalnız yolu tutar.
