<p align="center">
  <img src="icons/icon-192.png" width="104" height="104" alt="Sağlık Takip logosu" />
</p>
<h1 align="center">Sağlık Takip</h1>
<p align="center">
  Türkçe beslenme + antrenman takip PWA'sı ·
  <a href="https://eaclan.github.io/fitting/">Canlı demo</a>
</p>

Framework yok — vanilla HTML/CSS/JS. Veriler cihazda IndexedDB'de saklanır (Dexie.js),
çevrimdışı çalışır (service worker), Supabase ile buluta senkronlanır.

## Kapsam (tamamlandı)
- **Veri modeli** (`js/db.js`): `foods`, `food_logs`, `workout_logs`, `exercises`,
  `user_settings`. Kullanıcı kayıtları uuid PK + `updated_at`/`synced`/`deleted`
  alanları taşır (Supabase senkronu için hazır).
- **1.900+ gıda** (`data/foods.csv`: 559 elle küratörlü Türk yemeği + Open Food Facts'ten
  toplu çekilmiş ~1.400 Türk paketli/markalı ürün) + **146 spor hareketi**
  (`data/exercises.csv`). İlk açılışta IndexedDB'ye yüklenir (`js/seed.js`,
  `meta.seed_version` / `exercise_seed_version` ile korunur).
- **Online arama** (`js/offsearch.js`): beslenme aramasında "Open Food Facts'te ara"
  → paketli ürünü canlı çeker (barkodlu veritabanı). Bulunan ürün seçilince yerel
  IndexedDB'ye kaydedilir → kalıcı + sonrasında offline. OFF uçları yoğunlukta 503
  dönebildiği için retry'lı, "best-effort".
- **Beslenme ekranı** (`js/nutrition.js`): Türkçe karakter toleranslı arama,
  sık kullanılanlar, "dünü kopyala", öğün seçimi, günlük kalori + makro göstergesi.
- **Antrenman ekranı** (`js/workout.js`) — set-set kayıt modülü:
  - **Hareket seti:** her hareket bir kart; her set ayrı tekrar/kilo (Hevy/Strong tarzı),
    `+ Set` öncekini kopyalar, canlı hacim (tonaj) hesabı.
  - **Geçmiş:** tarih gezinme (‹ ›), "geçen sefer: 10×45kg" ipucu, `📈` ile hareket
    geçmişi + **SVG ilerleme grafiği**, "önceki antrenmanı kopyala".
  - **Kişisel rekor (PR):** en iyi ağırlık + tahmini 1RM (Epley), rekor kırınca rozet+bildirim.
  - **Program/şablon** (`programs` tablosu): bugünkü antrenmanı program yap, tek dokunuşla yükle.
- **Hızlı kayıt** (< 10 sn): çip/sonuç → dokun → porsiyon + öğün hazır → **Ekle**.

### Porsiyon esnekliği ("herkesin porsiyonu farklı" çözümü)
1. **Kişisel porsiyon hafızası:** her gıda, senin en son kullandığın grama göre açılır
   (`foods.son_gram`). Zamanla "senin porsiyonun" otomatik oluşur.
2. **Gram modu:** panelde porsiyon ↔ gram geçişi; tam gram girişi, makro gram başına
   hesaplanır (CSV'yi değiştirmeden). Doğruluk kaynağı `food_logs.gram`.
3. **Hızlı çarpan/çip:** 0.5× / 1× / 2× hâlâ en hızlı yol.
Aynı mantık antrenmanda da var: bir hareketi seçince son set/tekrar/kilo otomatik gelir
(`exercises.son_set/son_tekrar/son_kilo`).

## Mimari (ileriye dönük)
- `js/db.js` — tek veri erişim katmanı (repository). UI doğrudan IndexedDB'ye dokunmaz.
- `js/sync.js` — senkron placeholder. **Supabase** eklenince sadece bu dosya değişir.
- Göreli yollar + `.nojekyll` → **GitHub Pages** alt yolunda sorunsuz çalışır.
- Statik yapı → **Capacitor** ile Android paketi doğrudan sarılabilir.

## Gıda verisini büyütme (toplu import araçları)
İkisi de `data/foods.csv`'ye ekler (mevcut korunur, tekrar elenir) ve `SEED_VERSION`'ı
otomatik artırır → uygulama açılışta yeni ürünleri yükler. Bir kez, geliştirici
makinesinde çalıştırılır.

**1) Open Food Facts** — paketli/markalı ürünler (ODbL, atıf uygulamada):
```bash
node tools/off-import.mjs 3000    # hedef ürün sayısı
```

**2) TürKomp** — resmi Ulusal Gıda Kompozisyon Veri Tabanı, ~645 laboratuvar-analizli
Türk gıdası (devlet açık erişim, atıf uygulamada). Enerji/protein/karb/yağ 100 g başına:
```bash
node tools/turkomp-import.mjs --dry       # önizleme (yazmaz)
node tools/turkomp-import.mjs             # tümünü çeker + foods.csv'ye ekler (~3-4 dk)
node tools/turkomp-import.mjs --group 2   # tek grup (test)
```
> **Sonraki adım (proje):** TürKomp tam çekimi (~645 gıda) henüz yapılmadı — script
> hazır ve dry-run ile doğrulandı. Veri büyütme ayrı bir iş olarak planlandı.

## Yerelde çalıştırma
`file://` ile açılmaz (service worker + fetch gerekir). Basit sunucu:
```bash
cd saglik-takip
python -m http.server 8123
# tarayıcı: http://localhost:8123
```

## GitHub Pages'e yayınlama
Bu klasörü (`saglik-takip/`) bir reponun köküne koyup Pages'i **root**'tan
yayınla — ya da repo içinde `/docs` altına koyup Pages kaynağını `/docs` seç.
Tüm yollar göreli olduğu için alt dizinde de çalışır.

## Sonraki adımlar (Hafta 2+)
- Supabase adapter'ı (`Sync.adapterAyarla(...)`), auth, çok cihaz senkronu
- Antrenman ekranını zenginleştir (program/şablon, geçmiş grafikleri)
- Capacitor Android build
