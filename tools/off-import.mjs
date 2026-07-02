#!/usr/bin/env node
// off-import.mjs — Open Food Facts'ten Türkiye paketli ürünlerini toplu çeker ve
// data/foods.csv'ye ekler. Sunucu tarafı (Node) çalıştığı için search-a-licious'ın
// (CORS'suz ama güvenilir) uçları kullanılabilir.
//
// Kullanım:  node tools/off-import.mjs [maksimum_urun]     (varsayılan 2000)
//
// Notlar:
//  - Makrolar 100 g başınadır → porsiyon "100 g", gram 100 olarak eklenir.
//    (Uygulamadaki gram modu ile kullanıcı kendi porsiyonunu girebilir.)
//  - Eksik/mantıksız makrolu ürünler ve ad/​id tekrarları elenir.
//  - Bittiğinde js/seed.js içindeki SEED_VERSION otomatik artırılır (uygulama
//    açılışta yeni ürünleri IndexedDB'ye yükler; kişisel veri korunur).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KOK = path.resolve(__dirname, '..');
const CSV = path.join(KOK, 'data', 'foods.csv');
const SEED = path.join(KOK, 'js', 'seed.js');

const MAX = parseInt(process.argv[2], 10) || 2000;
const PAGE_SIZE = 100;
const UA = 'SaglikTakip/1.0 (beslenme uygulamasi; toplu import)';
const BASE = 'https://search.openfoodfacts.org/search';
const SORGU = 'countries_tags:"en:turkey"';

// ---- Türkçe normalize (uygulamadaki Search.normalize ile aynı mantık) ----
function normalize(s) {
  return String(s == null ? '' : s)
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/İ/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
    .replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}
function slug(s) {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}
// CSV alanı temizle: virgül/yeni satır kaldır, boşlukları sadeleştir.
function temiz(s) {
  return String(s == null ? '' : s).replace(/[",\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function say(x) {
  const n = parseFloat(x);
  return isNaN(n) ? null : n;
}
// product_name string, dizi ya da çok dilli nesne olabilir → tek metne indir.
function adSec(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v[0] || '';
  if (typeof v === 'object') return v.tr || v.en || Object.values(v)[0] || '';
  return String(v);
}

// ---- Mevcut foods.csv'yi oku (dedupe için) ----
const csvMetin = fs.readFileSync(CSV, 'utf8');
const satirlar = csvMetin.split(/\r?\n/).filter((l) => l.trim());
const mevcutId = new Set();
const mevcutAd = new Set();
for (let i = 1; i < satirlar.length; i++) {
  const p = satirlar[i].split(',');
  if (p[0]) mevcutId.add(p[0].trim());
  if (p[1]) mevcutAd.add(normalize(p[1]));
}
console.log(`Mevcut foods.csv: ${satirlar.length - 1} ürün.`);

async function sayfaGetir(page) {
  const url = `${BASE}?q=${encodeURIComponent(SORGU)}&page=${page}&page_size=${PAGE_SIZE}` +
    `&sort_by=-unique_scans_n&fields=code,product_name,product_name_tr,brands,nutriments`;
  for (let deneme = 1; deneme <= 3; deneme++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (deneme === 3) throw e;
      await new Promise((res) => setTimeout(res, 800 * deneme));
    }
  }
}

function urunuIsle(p) {
  const n = p.nutriments || {};
  const kcal = say(n['energy-kcal_100g']);
  const prot = say(n['proteins_100g']);
  const karb = say(n['carbohydrates_100g']);
  const yag = say(n['fat_100g']);
  // Eksik/mantıksız makro elemesi
  if (kcal == null || kcal < 5 || kcal > 900) return null;
  if (prot == null || karb == null || yag == null) return null;
  if (prot < 0 || karb < 0 || yag < 0 || prot > 100 || karb > 100 || yag > 100) return null;

  const adTr = temiz(adSec(p.product_name_tr)) || temiz(adSec(p.product_name));
  if (!adTr) return null;
  const markaHam = Array.isArray(p.brands) ? p.brands[0] : String(p.brands || '').split(',')[0];
  const marka = temiz(markaHam);
  // Marka adı adın içinde değilse ekle (aynı adlı ürünleri ayırmak için)
  let ad = adTr;
  if (marka && !normalize(adTr).includes(normalize(marka))) ad = `${adTr} ${marka}`;
  ad = ad.slice(0, 60);

  const nad = normalize(ad);
  if (mevcutAd.has(nad)) return null; // ad tekrarı

  let id = slug(ad) || ('off-' + p.code);
  if (mevcutId.has(id)) id = id + '-' + String(p.code).slice(-5);
  if (mevcutId.has(id)) return null;

  mevcutId.add(id);
  mevcutAd.add(nad);
  return `${id},${ad},100 g,100,${Math.round(kcal)},${round1(prot)},${round1(karb)},${round1(yag)}`;
}
function round1(x) {
  return Math.round(x * 10) / 10;
}

async function main() {
  const yeniSatirlar = [];
  let page = 1;
  let toplamHam = 0;
  const maxSayfa = 80;
  console.log(`Open Food Facts — Türkiye ürünleri çekiliyor (hedef: ${MAX})…`);
  while (yeniSatirlar.length < MAX && page <= maxSayfa) {
    let d;
    try {
      d = await sayfaGetir(page);
    } catch (e) {
      console.warn(`  sayfa ${page} alınamadı (${e.message}), duruluyor.`);
      break;
    }
    const hits = d.hits || [];
    if (!hits.length) break;
    toplamHam += hits.length;
    for (const p of hits) {
      const satir = urunuIsle(p);
      if (satir) yeniSatirlar.push(satir);
      if (yeniSatirlar.length >= MAX) break;
    }
    process.stdout.write(`\r  sayfa ${page} · ham ${toplamHam} · kabul ${yeniSatirlar.length}   `);
    page++;
    await new Promise((res) => setTimeout(res, 400)); // nazik hız sınırı
  }
  console.log('');

  if (!yeniSatirlar.length) {
    console.log('Eklenecek yeni ürün bulunamadı.');
    return;
  }
  // foods.csv'ye ekle (mevcut korunur)
  const ek = (csvMetin.endsWith('\n') ? '' : '\n') + yeniSatirlar.join('\n') + '\n';
  fs.appendFileSync(CSV, ek, 'utf8');
  console.log(`✓ ${yeniSatirlar.length} yeni ürün eklendi → toplam ${satirlar.length - 1 + yeniSatirlar.length}.`);

  // seed.js SEED_VERSION'ı artır (uygulama yeni ürünleri yüklesin)
  try {
    let s = fs.readFileSync(SEED, 'utf8');
    s = s.replace(/(const SEED_VERSION = )(\d+)(;)/, (m, a, v, c) => a + (parseInt(v, 10) + 1) + c);
    fs.writeFileSync(SEED, s, 'utf8');
    console.log('✓ seed.js SEED_VERSION artırıldı (uygulama açılışta yeniden yükleyecek).');
  } catch (e) {
    console.warn('seed.js güncellenemedi, elle SEED_VERSION artır:', e.message);
  }
}

main().catch((e) => {
  console.error('Hata:', e);
  process.exit(1);
});
