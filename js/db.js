// db.js — Veri katmanı. Dexie (IndexedDB) şeması + repository fonksiyonları.
// Mimari not: Tüm veri erişimi buradaki repo fonksiyonlarından geçer. UI doğrudan
// Dexie'ye dokunmaz. Böylece ileride Supabase senkronu (sync.js) ve Capacitor
// paketi eklenince UI'ye dokunmadan bu katman değiştirilebilir.
//
// Senkron hazırlığı: Kullanıcı üretimi tüm kayıtlar (food_logs, workout_logs)
// string `id` (uuid) birincil anahtar kullanır — Supabase/Postgres uuid PK ile
// birebir eşleşir. Her kayıtta `updated_at` (ISO) ve `synced` (0/1) alanı vardır;
// `deleted` ile soft-delete yapılır. sync.js bu alanlara göre push/pull yapacak.

(function (global) {
  'use strict';

  const db = new Dexie('saglikTakip');

  // v1 şema. İleride alan eklerken db.version(2).stores({...}).upgrade(...) kullan.
  db.version(1).stores({
    // foods: statik/seed veri + kullanıcı favorileri ve kullanım sayacı.
    //   arama: Türkçe-normalize edilmiş ad (indeksli aramada kullanılır)
    foods: 'id, ad, arama, kategori, favori, kullanim_sayisi, son_kullanim',
    // food_logs: beslenme kayıtları. [tarih+ogun] bileşik indeks gün+öğün sorgusu için.
    food_logs: 'id, tarih, food_id, ogun, [tarih+ogun], updated_at, synced',
    // workout_logs: antrenman kayıtları.
    workout_logs: 'id, tarih, hareket, [tarih+hareket], updated_at, synced',
    // user_settings & meta: anahtar-değer.
    user_settings: 'key',
    meta: 'key'
  });

  // v2: egzersiz kütüphanesi eklendi. foods.son_gram ve food_logs.gram indekssiz
  // alanlar olduğu için şema string'inde belirtilmelerine gerek yok (Dexie serbest
  // biçimli alanlara izin verir). Yalnızca yeni tablo için sürüm artırıldı.
  db.version(2).stores({
    foods: 'id, ad, arama, kategori, favori, kullanim_sayisi, son_kullanim',
    food_logs: 'id, tarih, food_id, ogun, [tarih+ogun], updated_at, synced',
    workout_logs: 'id, tarih, hareket, exercise_id, [tarih+hareket], updated_at, synced',
    // exercises: spor hareketleri kütüphanesi + kullanıcı favori/kullanım/son değerleri
    exercises: 'id, ad, arama, kas_grubu, favori, kullanim_sayisi, son_kullanim',
    user_settings: 'key',
    meta: 'key'
  });

  // v3: Antrenman modülü v2 — workout_logs artık "set başına bir satır" tutar
  // (set_no, tekrar, kilo, tamam). Böylece her set ayrı ağırlık/tekrar taşır ve
  // bağımsız senkronlanır. Ayrıca `programs` (antrenman şablonları) tablosu eklendi.
  db.version(3)
    .stores({
      foods: 'id, ad, arama, kategori, favori, kullanim_sayisi, son_kullanim',
      food_logs: 'id, tarih, food_id, ogun, [tarih+ogun], updated_at, synced',
      // grup anahtarı: [tarih+exercise_id] ve serbest hareketler için [tarih+hareket]
      workout_logs:
        'id, tarih, exercise_id, hareket, [tarih+exercise_id], [tarih+hareket], updated_at, synced',
      exercises: 'id, ad, arama, kas_grubu, favori, kullanim_sayisi, son_kullanim',
      programs: 'id, ad, updated_at, synced',
      user_settings: 'key',
      meta: 'key'
    })
    .upgrade(async (tx) => {
      // Eski tek-satır kayıtları (set=adet) set başına satırlara genişlet.
      const eski = await tx.table('workout_logs').toArray();
      const yeni = [];
      for (const r of eski) {
        const adet = Math.max(1, Number(r.set) || 1);
        for (let i = 1; i <= adet; i++) {
          yeni.push({
            id: uuid(),
            tarih: r.tarih,
            exercise_id: r.exercise_id || null,
            hareket: r.hareket,
            set_no: i,
            tekrar: Number(r.tekrar) || 0,
            kilo: Number(r.kilo) || 0,
            tamam: 0,
            deleted: r.deleted ? 1 : 0,
            synced: 0,
            updated_at: r.updated_at || nowISO()
          });
        }
      }
      await tx.table('workout_logs').clear();
      if (yeni.length) await tx.table('workout_logs').bulkAdd(yeni);
    });

  // ---- Yardımcılar -----------------------------------------------------------

  // Basit uuid v4 (crypto tabanlı). Capacitor/tarayıcı ortamlarında mevcut.
  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    // Yedek: crypto.getRandomValues
    const b = global.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
  }

  function nowISO() {
    return new Date().toISOString();
  }

  // YYYY-MM-DD (yerel saat). Tarih anahtarı olarak kullanılır.
  function bugun() {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }

  function tarihEkle(tarih, gun) {
    const d = new Date(tarih + 'T00:00:00');
    d.setDate(d.getDate() + gun);
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }

  // Bir logun gerçek gram miktarı. Yeni kayıtlar `gram` alanını doğruluk kaynağı
  // olarak tutar; eski (legacy) kayıtlar yalnızca `porsiyon_carpani` taşır — o
  // durumda food.gram ile çarpılır. Böylece porsiyon ve gram modu tek yerde birleşir.
  function logGrami(log, food) {
    if (log.gram != null && !isNaN(log.gram)) return Number(log.gram);
    const c = Number(log.porsiyon_carpani) || 1;
    return (food ? food.gram : 0) * c;
  }

  // Tahmini 1 tekrar maksimum (Epley formülü). PR/ilerleme için ortak metrik.
  function est1RM(kilo, tekrar) {
    const k = Number(kilo) || 0;
    const t = Number(tekrar) || 0;
    if (k <= 0 || t <= 0) return 0;
    if (t === 1) return Math.round(k);
    return Math.round(k * (1 + t / 30));
  }

  // Gram cinsinden makro hesabı (gram başına orandan). food.gram > 0 varsayılır.
  function gramMakro(food, gram) {
    const g = Number(gram) || 0;
    const oran = food.gram > 0 ? g / food.gram : 0;
    return {
      gram: Math.round(g),
      kalori: Math.round(food.kalori * oran),
      protein: +(food.protein * oran).toFixed(1),
      karb: +(food.karb * oran).toFixed(1),
      yag: +(food.yag * oran).toFixed(1)
    };
  }

  // ---- foods repo ------------------------------------------------------------

  const Foods = {
    async count() {
      return db.foods.count();
    },
    // Toplu seed (ilk açılış). items: normalize edilmiş food nesneleri.
    async bulkSeed(items) {
      return db.foods.bulkPut(items);
    },
    async get(id) {
      return db.foods.get(id);
    },
    async all() {
      return db.foods.toArray();
    },
    // Sık kullanılanlar: kullanım sayısına ve son kullanıma göre.
    async sikKullanilanlar(limit = 12) {
      const arr = await db.foods
        .where('kullanim_sayisi')
        .above(0)
        .toArray();
      arr.sort((a, b) => {
        if (b.kullanim_sayisi !== a.kullanim_sayisi)
          return b.kullanim_sayisi - a.kullanim_sayisi;
        return (b.son_kullanim || '').localeCompare(a.son_kullanim || '');
      });
      return arr.slice(0, limit);
    },
    // Kullanım sayacını artır + kişisel porsiyon hafızası (son_gram).
    // Bir gıda her loglandığında kullanıcının kullandığı gram kaydedilir; panel
    // bir sonraki açılışta bu değeri varsayılan yapar → "senin porsiyonun".
    async kullanildi(foodId, gram) {
      const f = await db.foods.get(foodId);
      if (!f) return;
      const yama = {
        kullanim_sayisi: (f.kullanim_sayisi || 0) + 1,
        son_kullanim: nowISO()
      };
      if (gram != null && !isNaN(gram) && gram > 0) yama.son_gram = Math.round(gram);
      await db.foods.update(foodId, yama);
    }
  };

  // ---- food_logs repo --------------------------------------------------------

  const FoodLogs = {
    // Yeni beslenme kaydı. rec: {tarih, food_id, gram, ogun}
    //   gram: gerçek tüketilen miktar (doğruluk kaynağı). porsiyon_carpani
    //   okunabilirlik/uyumluluk için gram/food.gram olarak da saklanır.
    async ekle(rec) {
      const food = await db.foods.get(rec.food_id);
      let gram = Number(rec.gram);
      if (isNaN(gram) || gram <= 0) {
        // gram verilmediyse porsiyon_carpani'ndan türet (geri uyum).
        const c = Number(rec.porsiyon_carpani) || 1;
        gram = (food ? food.gram : 0) * c;
      }
      const carpan = food && food.gram > 0 ? +(gram / food.gram).toFixed(3) : 1;
      const row = {
        id: uuid(),
        tarih: rec.tarih || bugun(),
        food_id: rec.food_id,
        gram: Math.round(gram),
        porsiyon_carpani: carpan,
        ogun: rec.ogun,
        deleted: 0,
        synced: 0,
        updated_at: nowISO()
      };
      await db.food_logs.add(row);
      await Foods.kullanildi(rec.food_id, gram);
      return row;
    },
    async sil(id) {
      // Soft delete — senkron için iz bırakır.
      await db.food_logs.update(id, {
        deleted: 1,
        synced: 0,
        updated_at: nowISO()
      });
    },
    async guncelleCarpan(id, carpan) {
      await db.food_logs.update(id, {
        porsiyon_carpani: Number(carpan) || 1,
        synced: 0,
        updated_at: nowISO()
      });
    },
    // Bir günün tüm kayıtları (silinmemiş).
    async gununKayitlari(tarih) {
      const arr = await db.food_logs.where('tarih').equals(tarih).toArray();
      return arr.filter((r) => !r.deleted);
    },
    // "Dünü kopyala": kaynak günün kayıtlarını hedef güne kopyalar.
    async gunuKopyala(kaynakTarih, hedefTarih) {
      const kayitlar = await this.gununKayitlari(kaynakTarih);
      const yeni = kayitlar.map((r) => ({
        id: uuid(),
        tarih: hedefTarih,
        food_id: r.food_id,
        gram: r.gram != null ? r.gram : undefined,
        porsiyon_carpani: r.porsiyon_carpani,
        ogun: r.ogun,
        deleted: 0,
        synced: 0,
        updated_at: nowISO()
      }));
      if (yeni.length) await db.food_logs.bulkAdd(yeni);
      return yeni.length;
    }
  };

  // ---- exercises repo (spor hareketleri kütüphanesi) -------------------------

  const Exercises = {
    async count() {
      return db.exercises.count();
    },
    async bulkSeed(items) {
      return db.exercises.bulkPut(items);
    },
    async all() {
      return db.exercises.toArray();
    },
    async get(id) {
      return db.exercises.get(id);
    },
    async sikKullanilanlar(limit = 8) {
      const arr = await db.exercises.where('kullanim_sayisi').above(0).toArray();
      arr.sort((a, b) => {
        if (b.kullanim_sayisi !== a.kullanim_sayisi)
          return b.kullanim_sayisi - a.kullanim_sayisi;
        return (b.son_kullanim || '').localeCompare(a.son_kullanim || '');
      });
      return arr.slice(0, limit);
    },
    // Kullanım sayacını artır (bir hareket antrenmana ilk eklenince). Kişisel
    // set/tekrar/kilo hafızası ve PR, WorkoutLogs.exStatGuncelle tarafından işlenir.
    async kullanildi(id) {
      const e = await db.exercises.get(id);
      if (!e) return;
      await db.exercises.update(id, {
        kullanim_sayisi: (e.kullanim_sayisi || 0) + 1,
        son_kullanim: nowISO()
      });
    }
  };

  // ---- workout_logs repo (set başına bir satır) ------------------------------

  // Bir setin ait olduğu hareketin grup anahtarı. Kütüphane hareketi → id;
  // serbest yazılan hareket → normalize edilmiş ad.
  function grupAnahtari(row) {
    return row.exercise_id ? 'ex:' + row.exercise_id : 'ad:' + Search.normalize(row.hareket || '');
  }

  // Bir gün+hareket için set listesinden özet (hacim, en iyi kilo, tahmini 1RM).
  function sessionOzet(tarih, setler) {
    setler.sort((a, b) => a.set_no - b.set_no);
    let hacim = 0;
    let enIyiKilo = 0;
    let en1rm = 0;
    for (const s of setler) {
      hacim += (Number(s.tekrar) || 0) * (Number(s.kilo) || 0);
      if (s.kilo > enIyiKilo) enIyiKilo = s.kilo;
      const r = est1RM(s.kilo, s.tekrar);
      if (r > en1rm) en1rm = r;
    }
    const ilk = setler[0] || {};
    return {
      tarih,
      exercise_id: ilk.exercise_id || null,
      hareket: ilk.hareket || '',
      setler,
      toplamSet: setler.length,
      hacim: Math.round(hacim),
      enIyiKilo,
      en1rm
    };
  }

  const WorkoutLogs = {
    // Kişisel hafıza + PR güncelle. Dönüş: yeni PR bilgisi (varsa) veya null.
    async exStatGuncelle(exercise_id, tarih) {
      if (!exercise_id) return null;
      const e = await db.exercises.get(exercise_id);
      if (!e) return null;
      const gunSet = (await this.gununKayitlari(tarih)).filter(
        (s) => s.exercise_id === exercise_id
      );
      const yama = { son_kullanim: nowISO() };
      if (gunSet.length) {
        const son = gunSet[gunSet.length - 1];
        yama.son_set = gunSet.length;
        yama.son_tekrar = son.tekrar;
        yama.son_kilo = son.kilo;
      }
      let pr = null;
      const bestKilo = gunSet.reduce((m, s) => Math.max(m, s.kilo || 0), 0);
      const best1rm = gunSet.reduce((m, s) => Math.max(m, est1RM(s.kilo, s.tekrar)), 0);
      if (bestKilo > (e.pr_kilo || 0)) {
        yama.pr_kilo = bestKilo;
        pr = { tur: 'kilo', deger: bestKilo };
      }
      if (best1rm > (e.pr_1rm || 0)) {
        yama.pr_1rm = best1rm;
        if (!pr) pr = { tur: '1rm', deger: best1rm };
      }
      await db.exercises.update(exercise_id, yama);
      return pr;
    },

    // Tek set ekle. Dönüş: {row, pr}. pr yeni rekor kırıldıysa doludur.
    async setEkle(rec) {
      const row = {
        id: uuid(),
        tarih: rec.tarih || bugun(),
        exercise_id: rec.exercise_id || null,
        hareket: rec.hareket,
        set_no: Number(rec.set_no) || 1,
        tekrar: Number(rec.tekrar) || 0,
        kilo: Number(rec.kilo) || 0,
        tamam: rec.tamam ? 1 : 0,
        deleted: 0,
        synced: 0,
        updated_at: nowISO()
      };
      await db.workout_logs.add(row);
      const pr = await this.exStatGuncelle(row.exercise_id, row.tarih);
      return { row, pr };
    },

    async setGuncelle(id, yama) {
      const row = await db.workout_logs.get(id);
      if (!row) return null;
      await db.workout_logs.update(id, {
        ...yama,
        synced: 0,
        updated_at: nowISO()
      });
      return this.exStatGuncelle(row.exercise_id, row.tarih);
    },

    async sil(id) {
      const row = await db.workout_logs.get(id);
      await db.workout_logs.update(id, { deleted: 1, synced: 0, updated_at: nowISO() });
      if (row) await this.exStatGuncelle(row.exercise_id, row.tarih);
    },

    // Bir günün tüm setleri (silinmemiş).
    async gununKayitlari(tarih) {
      const arr = await db.workout_logs.where('tarih').equals(tarih).toArray();
      return arr.filter((r) => !r.deleted);
    },

    // Günü harekete göre grupla → egzersiz kartları için.
    async gunuGrupla(tarih) {
      const setler = await this.gununKayitlari(tarih);
      const gruplar = new Map();
      for (const s of setler) {
        const k = grupAnahtari(s);
        if (!gruplar.has(k)) gruplar.set(k, { anahtar: k, ilkZaman: s.updated_at, setler: [] });
        const g = gruplar.get(k);
        g.setler.push(s);
        if ((s.updated_at || '') < g.ilkZaman) g.ilkZaman = s.updated_at;
      }
      const cikti = [...gruplar.values()].map((g) => {
        const o = sessionOzet(tarih, g.setler);
        o.anahtar = g.anahtar;
        o.ilkZaman = g.ilkZaman;
        return o;
      });
      cikti.sort((a, b) => (a.ilkZaman || '').localeCompare(b.ilkZaman || ''));
      return cikti;
    },

    // Gün özeti: toplam set, toplam hacim (tonaj), çalışılan kas grupları.
    async gunOzeti(tarih, exMap) {
      const gruplar = await this.gunuGrupla(tarih);
      let toplamSet = 0;
      let hacim = 0;
      const kaslar = new Set();
      for (const g of gruplar) {
        toplamSet += g.toplamSet;
        hacim += g.hacim;
        const ex = g.exercise_id && exMap ? exMap.get(g.exercise_id) : null;
        if (ex && ex.kas_grubu) kaslar.add(ex.kas_grubu);
      }
      return { hareket: gruplar.length, toplamSet, hacim, kaslar: [...kaslar] };
    },

    // Bir hareketin bir gündeki tüm setlerini sil.
    async hareketiSil(tarih, anahtar) {
      const setler = (await this.gununKayitlari(tarih)).filter(
        (s) => grupAnahtari(s) === anahtar
      );
      for (const s of setler)
        await db.workout_logs.update(s.id, { deleted: 1, synced: 0, updated_at: nowISO() });
      const ex = setler[0] && setler[0].exercise_id;
      if (ex) await this.exStatGuncelle(ex, tarih);
    },

    // Bir hareketin geçmiş seansları (tarihe göre gruplu, yeni → eski).
    async hareketGecmisi(exercise_id, hareket, limit = 20) {
      let arr;
      if (exercise_id) {
        arr = await db.workout_logs.where('exercise_id').equals(exercise_id).toArray();
      } else {
        arr = (await db.workout_logs.toArray()).filter(
          (r) => !r.exercise_id && Search.normalize(r.hareket) === Search.normalize(hareket)
        );
      }
      arr = arr.filter((r) => !r.deleted);
      const map = new Map();
      for (const s of arr) {
        if (!map.has(s.tarih)) map.set(s.tarih, []);
        map.get(s.tarih).push(s);
      }
      const sessions = [...map.entries()].map(([t, s]) => sessionOzet(t, s));
      sessions.sort((a, b) => b.tarih.localeCompare(a.tarih));
      return sessions.slice(0, limit);
    },

    // Bir hareketin, verilen tarihten ÖNCEki en son seansı ("geçen sefer").
    async sonSession(exercise_id, hareket, oncesiTarih) {
      const g = await this.hareketGecmisi(exercise_id, hareket, 50);
      return g.find((s) => s.tarih < oncesiTarih) || null;
    },

    // Verilen tarihten önceki en son antrenman günü (herhangi bir hareket).
    async sonAntrenmanTarihi(oncesiTarih) {
      const arr = (await db.workout_logs.toArray()).filter(
        (r) => !r.deleted && r.tarih < oncesiTarih
      );
      if (!arr.length) return null;
      return arr.map((r) => r.tarih).sort().pop();
    },

    // Bir günün tüm antrenmanını başka güne kopyala.
    async gunKopyala(kaynak, hedef) {
      const setler = await this.gununKayitlari(kaynak);
      if (!setler.length) return 0;
      const yeni = setler.map((s) => ({
        id: uuid(),
        tarih: hedef,
        exercise_id: s.exercise_id || null,
        hareket: s.hareket,
        set_no: s.set_no,
        tekrar: s.tekrar,
        kilo: s.kilo,
        tamam: 0,
        deleted: 0,
        synced: 0,
        updated_at: nowISO()
      }));
      await db.workout_logs.bulkAdd(yeni);
      const exler = [...new Set(yeni.map((s) => s.exercise_id).filter(Boolean))];
      for (const ex of exler) await this.exStatGuncelle(ex, hedef);
      return yeni.length;
    }
  };

  // ---- programs repo (antrenman şablonları) ----------------------------------

  const Programs = {
    async all() {
      const arr = await db.programs.toArray();
      return arr.filter((p) => !p.deleted).sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
    },
    async get(id) {
      return db.programs.get(id);
    },
    // prog: {id?, ad, hareketler:[{exercise_id, hareket, kas_grubu, hedef_set, hedef_tekrar, hedef_kilo}]}
    async kaydet(prog) {
      const row = {
        id: prog.id || uuid(),
        ad: prog.ad,
        hareketler: prog.hareketler || [],
        deleted: 0,
        synced: 0,
        updated_at: nowISO()
      };
      await db.programs.put(row);
      return row;
    },
    async sil(id) {
      await db.programs.update(id, { deleted: 1, synced: 0, updated_at: nowISO() });
    }
  };

  // ---- user_settings repo ----------------------------------------------------

  const VARSAYILAN_AYARLAR = {
    kalori_hedefi: 2000,
    // makro oranları (yüzde). protein/karb/yag toplamı 100 olmalı.
    makro_oranlari: { protein: 30, karb: 40, yag: 30 }
  };

  const Settings = {
    async get() {
      const row = await db.user_settings.get('main');
      return row ? row.value : { ...VARSAYILAN_AYARLAR };
    },
    async set(value) {
      await db.user_settings.put({ key: 'main', value, updated_at: nowISO(), synced: 0 });
      return value;
    },
    async ensure() {
      const row = await db.user_settings.get('main');
      if (!row) await this.set({ ...VARSAYILAN_AYARLAR });
    },
    // ---- senkron ----
    async rawGet() {
      return db.user_settings.get('main');
    },
    async isaretle() {
      const row = await db.user_settings.get('main');
      if (row) await db.user_settings.put({ ...row, synced: 1 });
    },
    // Uzaktan gelen ayarı uygula (LWW). Dönüş: uygulandı mı?
    async uzaktanUygula(value, updated_at) {
      const row = await db.user_settings.get('main');
      const ly = row ? Date.parse(row.updated_at) || 0 : -1;
      const ry = Date.parse(updated_at) || 0;
      if (!row || ly < ry) {
        await db.user_settings.put({ key: 'main', value, updated_at, synced: 1 });
        return true;
      }
      return false;
    }
  };

  // ---- meta repo (seed sürümü vb.) -------------------------------------------

  const Meta = {
    async get(key) {
      const r = await db.meta.get(key);
      return r ? r.value : undefined;
    },
    async set(key, value) {
      await db.meta.put({ key, value });
    }
  };

  // ---- Senkron yardımcıları (Supabase köprüsü) -------------------------------
  // Yerel tablo ↔ uzak tablo eşlemesi. foods'ta yalnızca kullanıcı gıdaları
  // (kaynak dolu: online/özel) senkronlanır; seed katalog senkronlanmaz.
  function sec(obj, anahtarlar) {
    const o = {};
    for (const k of anahtarlar) if (obj[k] !== undefined) o[k] = obj[k];
    return o;
  }
  const SENKRON_TANIM = [
    {
      yerel: 'food_logs', uzak: 'food_logs', pk: 'id',
      alanlar: ['id', 'tarih', 'food_id', 'gram', 'porsiyon_carpani', 'ogun', 'deleted', 'updated_at']
    },
    {
      yerel: 'workout_logs', uzak: 'workout_logs', pk: 'id',
      alanlar: ['id', 'tarih', 'exercise_id', 'hareket', 'set_no', 'tekrar', 'kilo', 'tamam', 'deleted', 'updated_at']
    },
    {
      yerel: 'programs', uzak: 'programs', pk: 'id',
      alanlar: ['id', 'ad', 'hareketler', 'deleted', 'updated_at']
    },
    {
      yerel: 'foods', uzak: 'user_foods', pk: 'user_id,id', sadeceKullanici: true,
      alanlar: ['id', 'ad', 'arama', 'kategori', 'porsiyon_adi', 'gram', 'kalori', 'protein', 'karb', 'yag', 'kaynak', 'deleted', 'updated_at']
    }
  ];

  const Senkron = {
    tanimlar: SENKRON_TANIM,
    async bekleyenler(t) {
      let arr = await db[t.yerel].toArray();
      if (t.sadeceKullanici) arr = arr.filter((r) => r.kaynak);
      return arr.filter((r) => r.synced === 0);
    },
    disariAktar(t, satirlar, userId) {
      return satirlar.map((r) => ({ ...sec(r, t.alanlar), user_id: userId }));
    },
    async isaretle(t, idler) {
      for (const id of idler) await db[t.yerel].update(id, { synced: 1 });
    },
    // Uzak satırları yerelde birleştir (last-write-wins). Dönüş: uygulanan sayısı.
    // Karşılaştırma epoch (ms) üzerinden — yerel "...Z" ile Supabase "...+00:00"
    // formatlarını string olarak yanlış sıralamamak için.
    async iceriAl(t, uzakSatirlar) {
      let n = 0;
      for (const u of uzakSatirlar || []) {
        const temiz = sec(u, t.alanlar);
        if (!temiz.id) continue;
        const yerel = await db[t.yerel].get(temiz.id);
        const ly = yerel ? Date.parse(yerel.updated_at) || 0 : -1;
        const ry = Date.parse(temiz.updated_at) || 0;
        if (!yerel || ly < ry) {
          await db[t.yerel].put({ ...(yerel || {}), ...temiz, synced: 1 });
          n++;
        }
      }
      return n;
    }
  };

  global.DB = {
    db,
    uuid,
    nowISO,
    bugun,
    tarihEkle,
    logGrami,
    gramMakro,
    est1RM,
    grupAnahtari,
    Foods,
    FoodLogs,
    Exercises,
    WorkoutLogs,
    Programs,
    Settings,
    Meta,
    Senkron,
    VARSAYILAN_AYARLAR
  };
})(window);
