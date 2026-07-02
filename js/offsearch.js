// offsearch.js — Open Food Facts online arama (tarayıcıdan).
// world.openfoodfacts.org v2 arama ucu CORS izinli (Access-Control-Allow-Origin: *)
// ama zaman zaman hız-sınırından 503 döner → retry/backoff ile "best-effort".
// Bulunan ürün seçilince yerel IndexedDB'ye kaydedilir → kalıcı + sonrasında offline.

(function (global) {
  'use strict';

  // cgi/search.pl: CORS izinli (ACAO *) ve v2'ye göre daha kararlı yanıt veriyor.
  const BASE = 'https://world.openfoodfacts.org/cgi/search.pl';

  function adSec(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v[0] || '';
    if (typeof v === 'object') return v.tr || v.en || Object.values(v)[0] || '';
    return String(v);
  }
  function temiz(s) {
    return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function say(x) {
    const n = parseFloat(x);
    return isNaN(n) ? null : n;
  }

  // OFF ürününü uygulama food nesnesine indirger (100 g porsiyon). Geçersizse null.
  function esle(p) {
    const n = p.nutriments || {};
    const kcal = say(n['energy-kcal_100g']);
    const prot = say(n['proteins_100g']);
    const karb = say(n['carbohydrates_100g']);
    const yag = say(n['fat_100g']);
    if (kcal == null || kcal < 5 || kcal > 900) return null;
    if (prot == null || karb == null || yag == null) return null;
    if (prot < 0 || karb < 0 || yag < 0 || prot > 100 || karb > 100 || yag > 100) return null;

    let ad = temiz(adSec(p.product_name_tr)) || temiz(adSec(p.product_name));
    if (!ad) return null;
    const markaHam = Array.isArray(p.brands) ? p.brands[0] : String(p.brands || '').split(',')[0];
    const marka = temiz(markaHam);
    if (marka && !global.Search.normalize(ad).includes(global.Search.normalize(marka)))
      ad = `${ad} ${marka}`;
    ad = ad.slice(0, 60);

    return {
      id: 'off-' + (p.code || global.DB.uuid()),
      ad,
      arama: global.Search.normalize(ad),
      kategori: 'Open Food Facts',
      porsiyon_adi: '100 g',
      gram: 100,
      kalori: Math.round(kcal),
      protein: Math.round(prot * 10) / 10,
      karb: Math.round(karb * 10) / 10,
      yag: Math.round(yag * 10) / 10,
      favori: 0,
      kullanim_sayisi: 0,
      son_kullanim: null,
      son_gram: null,
      kaynak: 'off'
    };
  }

  // Online arama. Dönüş: food nesneleri dizisi. Hata → exception (çağıran yakalar).
  // OFF uçları yoğunlukta 503/HTML dönebildiği için 4 deneme + backoff; JSON
  // gelmezse (rate-limit HTML sayfası) yeniden dener.
  async function ara(sorgu) {
    const q = (sorgu || '').trim();
    if (!q) return [];
    const url =
      BASE +
      '?search_terms=' +
      encodeURIComponent(q) +
      '&search_simple=1&action=process&json=1&page_size=20' +
      '&fields=code,product_name,product_name_tr,brands,nutriments&sort_by=unique_scans_n';

    // OFF uçları tekil isteklerde ~%50 503/HTML dönebiliyor (genel yoğunluk).
    // 6 deneme → başarı ~%98. 503'ler anında döndüğü için kısa sabit bekleme yeter.
    const DENEME = 6;
    let sonHata;
    for (let deneme = 1; deneme <= DENEME; deneme++) {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const tip = r.headers.get('content-type') || '';
        if (!tip.includes('json')) throw new Error('JSON değil (yoğunluk)');
        const data = await r.json();
        const map = new Map();
        for (const p of data.products || []) {
          const f = esle(p);
          if (f && !map.has(f.id)) map.set(f.id, f);
        }
        return [...map.values()];
      } catch (e) {
        sonHata = e;
        if (deneme < DENEME) await new Promise((res) => setTimeout(res, 450));
      }
    }
    throw sonHata || new Error('Bilinmeyen hata');
  }

  global.OFF = { ara, esle };
})(window);
