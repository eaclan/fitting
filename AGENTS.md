# AGENTS.md — Sağlık Takip

Türkçe beslenme + antrenman takip **PWA**'sı. Bu dosya kod ajanları (Codex, Claude Code
vb.) için proje rehberidir.

## Stack (kesin — değiştirme)
- Vanilla HTML/CSS/JS, **framework yok**, build adımı yok. Mobile-first.
- Veri: IndexedDB (Dexie.js, `vendor/dexie.min.js` yerel).
- Bulut senkron + giriş: **Supabase** (SDK yok, sade fetch — `js/supabase.js`).
- Offline-first: service worker (`sw.js`). Dağıtım: **GitHub Pages** (repo: eaclan/fitting).

## Yapı
- `index.html` — tek sayfa, sekmeler: Beslenme / Antrenman / Ayarlar.
- `js/db.js` — TÜM veri erişimi buradan (repository katmanı). UI doğrudan IndexedDB'ye dokunmaz.
- `js/search.js` — Türkçe karakter toleranslı arama (çorba↔corba).
- `js/seed.js` — ilk açılışta CSV'leri IndexedDB'ye yükler (`SEED_VERSION` korumalı).
- `js/nutrition.js`, `js/workout.js` — ekran mantıkları.
- `js/offsearch.js` — Open Food Facts online arama.
- `js/sync.js` + `js/supabase.js` + `js/config.js` — bulut senkron (push/pull, last-write-wins).
- `data/foods.csv` (~1943), `data/exercises.csv` (146) — seed verisi.
- `tools/*.mjs` — Node veri içe aktarma scriptleri (OFF, TürKomp).
- `supabase/schema.sql` — bulut tabloları + RLS.

## Kurallar / dikkat
- Yorumlar ve değişken adları **Türkçe**. Mevcut stile uy.
- `data/*.csv` üretilmiş dosyalar — elle rastgele düzenleme. Değiştirirsen `js/seed.js`
  içindeki `SEED_VERSION`'ı artır (yoksa uygulama yeni veriyi yüklemez).
- `sw.js` tarafından cache'lenen bir dosyayı değiştirince `CACHE` sürümünü artır (v6 → v7).
- Senkron alanları: kullanıcı kayıtları `id`(uuid) + `updated_at` + `synced` + `deleted` taşır.
- Supabase `anon`/publishable key public'tir (RLS korur) — `js/config.js`'te olması normaldir.

## Çalıştırma / test
- Yerel sunucu (kök dizinden): `python -m http.server 8123 --directory .`  → http://localhost:8123
  (`file://` ile açılmaz; service worker + fetch gerekir.)
- Veri içe aktarma: `node tools/off-import.mjs 2000` · `node tools/turkomp-import.mjs --dry`
- Dağıtım: `git push origin main` → GitHub Pages otomatik yayınlar (~1-2 dk).

## Yapma
- Framework/bundler ekleme, TypeScript'e çevirme.
- Gizli anahtar (Supabase `service_role`) commit etme — sadece publishable/anon key public.
