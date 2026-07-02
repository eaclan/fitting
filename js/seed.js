// seed.js — İlk açılışta data/foods.csv'yi IndexedDB'ye yükler.
// Yalnızca bir kez çalışır (meta.seed_version ile korunur). CSV sürümü artınca
// eksik/yeni gıdalar tekrar yüklenir (mevcut kullanıcı favori/kullanım verisi korunur).

(function (global) {
  'use strict';

  const SEED_VERSION = 4; // foods.csv içeriğini güncelleyince artır.
  const EXERCISE_SEED_VERSION = 1; // exercises.csv içeriğini güncelleyince artır.
  const CSV_URL = 'data/foods.csv';
  const EXERCISE_CSV_URL = 'data/exercises.csv';

  // Küçük ama tırnaklı alanlara dayanıklı CSV ayrıştırıcı.
  function parseCSV(text) {
    const rows = [];
    let satir = [];
    let alan = '';
    let tirnak = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (tirnak) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            alan += '"';
            i++;
          } else {
            tirnak = false;
          }
        } else {
          alan += c;
        }
      } else if (c === '"') {
        tirnak = true;
      } else if (c === ',') {
        satir.push(alan);
        alan = '';
      } else if (c === '\n') {
        satir.push(alan);
        rows.push(satir);
        satir = [];
        alan = '';
      } else if (c === '\r') {
        // yoksay
      } else {
        alan += c;
      }
    }
    if (alan.length || satir.length) {
      satir.push(alan);
      rows.push(satir);
    }
    return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
  }

  function sayi(x) {
    const n = parseFloat(String(x).replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }

  // CSV satırlarını food nesnelerine dönüştürür (arama alanı normalize edilir).
  function satirlariDonustur(rows) {
    const baslik = rows[0].map((h) => h.trim());
    const idx = {};
    baslik.forEach((h, i) => (idx[h] = i));
    const foods = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const id = (r[idx.id] || '').trim();
      const ad = (r[idx.ad] || '').trim();
      if (!id || !ad) continue;
      foods.push({
        id,
        ad,
        arama: global.Search.normalize(ad),
        kategori: (r[idx.kategori] || '').trim(),
        porsiyon_adi: (r[idx.porsiyon_adi] || '').trim(),
        gram: sayi(r[idx.gram]),
        kalori: Math.round(sayi(r[idx.kalori])),
        protein: sayi(r[idx.protein]),
        karb: sayi(r[idx.karb]),
        yag: sayi(r[idx.yag]),
        // kullanıcıya özel alanlar (seed'de sıfır) — favori/kullanım korunur.
        favori: 0,
        kullanim_sayisi: 0,
        son_kullanim: null
      });
    }
    return foods;
  }

  async function metinGetir(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(url + ' yüklenemedi: ' + res.status);
    return res.text();
  }

  // exercises.csv satırlarını egzersiz nesnelerine çevirir.
  function egzersizleriDonustur(rows) {
    const baslik = rows[0].map((h) => h.trim());
    const idx = {};
    baslik.forEach((h, i) => (idx[h] = i));
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const id = (r[idx.id] || '').trim();
      const ad = (r[idx.ad] || '').trim();
      if (!id || !ad) continue;
      out.push({
        id,
        ad,
        arama: global.Search.normalize(ad),
        kas_grubu: (r[idx.kas_grubu] || '').trim(),
        ekipman: (r[idx.ekipman] || '').trim(),
        tip: (r[idx.tip] || '').trim(),
        favori: 0,
        kullanim_sayisi: 0,
        son_kullanim: null,
        son_set: null,
        son_tekrar: null,
        son_kilo: null
      });
    }
    return out;
  }

  // Foods seed (gerekliyse). Kullanıcı verisi (favori/kullanım/son_gram) korunur.
  async function foodSeed() {
    const mevcutSurum = await DB.Meta.get('seed_version');
    const adet = await DB.Foods.count();
    if (mevcutSurum === SEED_VERSION && adet > 0) return { yuklendi: false, adet };

    let text;
    try {
      text = await metinGetir(CSV_URL);
    } catch (e) {
      console.error(e);
      return { yuklendi: false, adet, hata: e.message };
    }
    const yeniFoods = satirlariDonustur(parseCSV(text));
    const mevcut = await DB.Foods.all();
    const mevcutMap = new Map(mevcut.map((f) => [f.id, f]));
    const birlesik = yeniFoods.map((f) => {
      const eski = mevcutMap.get(f.id);
      if (eski) {
        return {
          ...f,
          favori: eski.favori || 0,
          kullanim_sayisi: eski.kullanim_sayisi || 0,
          son_kullanim: eski.son_kullanim || null,
          son_gram: eski.son_gram || null // kişisel porsiyon hafızası korunur
        };
      }
      return f;
    });
    await DB.Foods.bulkSeed(birlesik);
    await DB.Meta.set('seed_version', SEED_VERSION);
    return { yuklendi: true, adet: birlesik.length };
  }

  // Egzersiz seed (gerekliyse). Kullanıcı verisi (favori/kullanım/son değerler) korunur.
  async function egzersizSeed() {
    const mevcutSurum = await DB.Meta.get('exercise_seed_version');
    const adet = await DB.Exercises.count();
    if (mevcutSurum === EXERCISE_SEED_VERSION && adet > 0)
      return { yuklendi: false, adet };

    let text;
    try {
      text = await metinGetir(EXERCISE_CSV_URL);
    } catch (e) {
      console.error(e);
      return { yuklendi: false, adet, hata: e.message };
    }
    const yeni = egzersizleriDonustur(parseCSV(text));
    const mevcut = await DB.Exercises.all();
    const mevcutMap = new Map(mevcut.map((x) => [x.id, x]));
    const birlesik = yeni.map((x) => {
      const eski = mevcutMap.get(x.id);
      if (eski) {
        return {
          ...x,
          favori: eski.favori || 0,
          kullanim_sayisi: eski.kullanim_sayisi || 0,
          son_kullanim: eski.son_kullanim || null,
          son_set: eski.son_set != null ? eski.son_set : null,
          son_tekrar: eski.son_tekrar != null ? eski.son_tekrar : null,
          son_kilo: eski.son_kilo != null ? eski.son_kilo : null
        };
      }
      return x;
    });
    await DB.Exercises.bulkSeed(birlesik);
    await DB.Meta.set('exercise_seed_version', EXERCISE_SEED_VERSION);
    return { yuklendi: true, adet: birlesik.length };
  }

  // Ana giriş: foods + exercises seed'ini gerekliyse yapar.
  async function seedGerekirse() {
    const f = await foodSeed();
    let e = { yuklendi: false, adet: 0 };
    try {
      e = await egzersizSeed();
    } catch (err) {
      console.error(err);
    }
    return {
      yuklendi: f.yuklendi || e.yuklendi,
      adet: f.adet,
      egzersizAdet: e.adet,
      hata: f.hata
    };
  }

  global.Seed = { seedGerekirse, foodSeed, egzersizSeed, SEED_VERSION };
})(window);
