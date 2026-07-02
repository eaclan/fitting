#!/usr/bin/env node
// turkomp-import.mjs — TürKomp (Ulusal Gıda Kompozisyon Veri Tabanı,
// turkomp.tarimorman.gov.tr) laboratuvar-analizli Türk gıdalarını çeker ve
// data/foods.csv'ye ekler. Devlet açık-erişim kaynağı (atıf ile kullanılır).
//
// Kullanım:
//   node tools/turkomp-import.mjs           → tüm gruplar, foods.csv'ye ekler
//   node tools/turkomp-import.mjs --dry      → sadece çek+ayrıştır, örnek yazdır (yazmaz)
//   node tools/turkomp-import.mjs --group 2  → tek grup (test)
//
// Site jQuery/DataTables tabanlı; oturum çerezi (JSESSIONID) gerektirir.
// Gıdalar 14 grupta: database?type=foods&group=1..14 → food-<slug>-<id> detayları.
// Makro kodları (100 g başına): ENERC(kcal), PROT(protein), FAT(yağ), CHO(karb).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KOK = path.resolve(__dirname, '..');
const CSV = path.join(KOK, 'data', 'foods.csv');
const SEED = path.join(KOK, 'js', 'seed.js');
const HOST = 'https://turkomp.tarimorman.gov.tr';
const UA = 'Mozilla/5.0 (SaglikTakip; TurKomp import)';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const tekGrupIdx = argv.indexOf('--group');
const TEK_GRUP = tekGrupIdx >= 0 ? parseInt(argv[tekGrupIdx + 1], 10) : null;
const GRUPLAR = TEK_GRUP ? [TEK_GRUP] : Array.from({ length: 14 }, (_, i) => i + 1);

// ---- Türkçe normalize / slug (uygulamayla uyumlu) ----
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
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52);
}
function temizAd(s) {
  // CSV için virgül/yeni satır kaldır, boşlukları sadeleştir, ilk harf büyük.
  let a = String(s || '').replace(/[",\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (a) a = a[0].toLocaleUpperCase('tr-TR') + a.slice(1);
  return a.slice(0, 60);
}
function say(x) {
  const n = parseFloat(String(x).replace(',', '.'));
  return isNaN(n) ? null : n;
}
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Oturum (PHPSESSID + F5 BIGipServer çerezi) ----
const cerezler = new Map(); // ad → değer
let COOKIE = '';
function cerezYakala(r) {
  let sc = [];
  try {
    sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  } catch {}
  if (!sc.length) {
    const tek = r.headers.get('set-cookie');
    if (tek) sc = tek.split(/,(?=[^ ;]+=)/); // birden çok çerezi ayır
  }
  for (const c of sc) {
    const ilk = c.split(';')[0].trim();
    const eq = ilk.indexOf('=');
    if (eq > 0) cerezler.set(ilk.slice(0, eq), ilk.slice(eq + 1));
  }
  COOKIE = [...cerezler].map(([k, v]) => `${k}=${v}`).join('; ');
}
async function oturumAc() {
  // Yönlendirmeleri manuel izle, her adımda çerezi yakala (JSESSIONID redirect'te gelir)
  let url = HOST + '/main';
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: COOKIE }, redirect: 'manual' });
    cerezYakala(r);
    const loc = r.headers.get('location');
    if ((r.status === 301 || r.status === 302) && loc) {
      url = loc.startsWith('http') ? loc : HOST + (loc.startsWith('/') ? loc : '/' + loc);
      continue;
    }
    break;
  }
}
async function getir(url) {
  for (let d = 1; d <= 3; d++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: COOKIE } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (d === 3) throw e;
      await bekle(600 * d);
    }
  }
}

// ---- Harvest: grup sayfalarından (ad, url) ----
async function grubunGidalari(g) {
  const h = await getir(`${HOST}/database?type=foods&group=${g}`);
  const out = [];
  const re = /href="(food-[a-z0-9-]+-\d+)"[^>]*>\s*([^<]+?)\s*<\/a>/gi;
  let m;
  while ((m = re.exec(h))) out.push({ url: m[1], ad: m[2] });
  return out;
}

// ---- Detay: makroları ayrıştır ----
function makroCek(html) {
  const kod = (k) => {
    const m = html.match(new RegExp('\\?comp=' + k + '"\\s*>\\s*([0-9]+(?:[.,][0-9]+)?)'));
    return m ? say(m[1]) : null;
  };
  return { kalori: kod('ENERC'), protein: kod('PROT'), yag: kod('FAT'), karb: kod('CHO') };
}

// ---- Mevcut foods.csv (dedupe) ----
const csvMetin = fs.readFileSync(CSV, 'utf8');
const csvSatir = csvMetin.split(/\r?\n/).filter((l) => l.trim());
const mevcutId = new Set();
const mevcutAd = new Set();
for (let i = 1; i < csvSatir.length; i++) {
  const p = csvSatir[i].split(',');
  if (p[0]) mevcutId.add(p[0].trim());
  if (p[1]) mevcutAd.add(normalize(p[1]));
}

async function main() {
  console.log(`TürKomp import ${DRY ? '(DRY-RUN)' : ''} — mevcut foods.csv: ${csvSatir.length - 1} ürün`);
  await oturumAc();
  if (!COOKIE) console.warn('Uyarı: oturum çerezi alınamadı, yine de denenecek.');

  // 1) Tüm (ad, url) topla
  const hepsi = [];
  for (const g of GRUPLAR) {
    try {
      const liste = await grubunGidalari(g);
      hepsi.push(...liste);
      process.stdout.write(`\r  grup ${g}/${GRUPLAR.length} · toplam gıda ${hepsi.length}   `);
    } catch (e) {
      console.warn(`\n  grup ${g} alınamadı: ${e.message}`);
    }
    await bekle(300);
  }
  console.log('');
  // url'e göre tekilleştir
  const gorulen = new Set();
  const gidalar = hepsi.filter((x) => (gorulen.has(x.url) ? false : gorulen.add(x.url)));
  console.log(`  Benzersiz gıda sayfası: ${gidalar.length}`);

  // 2) Detayları çek + satır üret
  const yeni = [];
  let elenen = 0;
  for (let i = 0; i < gidalar.length; i++) {
    const g = gidalar[i];
    let html;
    try {
      html = await getir(`${HOST}/${g.url}`);
    } catch (e) {
      elenen++;
      continue;
    }
    const m = makroCek(html);
    const ad = temizAd(g.ad);
    // Geçerlilik: kalori + en az bir makro olmalı, mantıklı aralık
    if (!ad || m.kalori == null || m.kalori < 1 || m.kalori > 900 ||
        m.protein == null || m.karb == null || m.yag == null) {
      elenen++;
    } else {
      const nad = normalize(ad);
      const idNo = (g.url.match(/-(\d+)$/) || [])[1] || '';
      let id = slug(ad) || 'turkomp-' + idNo;
      if (mevcutId.has(id)) id = id + '-tk' + idNo;
      if (!mevcutAd.has(nad) && !mevcutId.has(id)) {
        mevcutId.add(id);
        mevcutAd.add(nad);
        yeni.push(`${id},${ad},100 g,100,${Math.round(m.kalori)},${r1(m.protein)},${r1(m.karb)},${r1(m.yag)}`);
      } else {
        elenen++;
      }
    }
    if (i % 25 === 0 || i === gidalar.length - 1)
      process.stdout.write(`\r  detay ${i + 1}/${gidalar.length} · kabul ${yeni.length} · elenen ${elenen}   `);
    await bekle(250);
  }
  console.log('');

  if (DRY) {
    console.log(`DRY-RUN: ${yeni.length} yeni satır üretildi (yazılmadı). Örnekler:`);
    yeni.slice(0, 12).forEach((l) => console.log('  ' + l));
    return;
  }
  if (!yeni.length) {
    console.log('Eklenecek yeni ürün yok.');
    return;
  }
  const ek = (csvMetin.endsWith('\n') ? '' : '\n') + yeni.join('\n') + '\n';
  fs.appendFileSync(CSV, ek, 'utf8');
  console.log(`✓ ${yeni.length} TürKomp gıdası eklendi → toplam ${csvSatir.length - 1 + yeni.length}.`);
  try {
    let s = fs.readFileSync(SEED, 'utf8');
    s = s.replace(/(const SEED_VERSION = )(\d+)(;)/, (mm, a, v, c) => a + (parseInt(v, 10) + 1) + c);
    fs.writeFileSync(SEED, s, 'utf8');
    console.log('✓ seed.js SEED_VERSION artırıldı.');
  } catch (e) {
    console.warn('seed.js güncellenemedi:', e.message);
  }
}
function r1(x) {
  return Math.round(x * 10) / 10;
}

main().catch((e) => {
  console.error('Hata:', e);
  process.exit(1);
});
