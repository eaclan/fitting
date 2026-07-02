// nutrition.js — Beslenme kayıt ekranı.
// Porsiyon esnekliği (3 katman):
//   1) Kişisel porsiyon hafızası: her gıda son kullanılan grama göre açılır.
//   2) Gram modu: tam gram girişi (tartıyla ölçenler için) — makro gram başına.
//   3) Hızlı çarpan/çip: 0.5× / 1× / 2× (en hızlı yol).
// Hedef: kayıt < 10 sn.

(function (global) {
  'use strict';

  const OGUNLER = [
    { key: 'kahvalti', ad: 'Kahvaltı', ikon: '🌅' },
    { key: 'ogle', ad: 'Öğle', ikon: '🍽️' },
    { key: 'aksam', ad: 'Akşam', ikon: '🌙' },
    { key: 'ara', ad: 'Ara', ikon: '🍎' }
  ];

  function varsayilanOgun() {
    const s = new Date().getHours();
    if (s < 11) return 'kahvalti';
    if (s < 15) return 'ogle';
    if (s < 18) return 'ara';
    return 'aksam';
  }

  // Porsiyon sayısı = gram / bir porsiyonun gramı.
  function porsiyonSayisi(food, gram) {
    return food.gram > 0 ? gram / food.gram : 1;
  }
  function psFormat(p) {
    return Math.abs(p - Math.round(p)) < 0.05 ? String(Math.round(p)) : p.toFixed(1);
  }
  // Okunur porsiyon etiketi: "1 kepçe (250 g)" / "1.5× kepçe (375 g)".
  function porsiyonMetni(food, gram) {
    const p = porsiyonSayisi(food, gram);
    const g = Math.round(gram);
    if (Math.abs(p - 1) < 0.05) return `${food.porsiyon_adi} · ${g} g`;
    const birim = food.porsiyon_adi.replace(/^1\s+/, '');
    return `${psFormat(p)}× ${birim} · ${g} g`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );
  }

  const state = {
    tarih: DB.bugun(),
    foods: [],
    foodMap: new Map(),
    secili: null,
    gram: 0, // panelde seçili miktar (gram) — tek doğruluk kaynağı
    mod: 'porsiyon', // 'porsiyon' | 'gram'
    ogun: varsayilanOgun(),
    ayarlar: null,
    kok: null,
    aramaQ: '',
    onlineMap: new Map() // OFF online arama sonuçları (id → food)
  };

  async function foodlariYukle() {
    state.foods = await DB.Foods.all();
    state.foodMap = new Map(state.foods.map((f) => [f.id, f]));
  }

  // ---- Gün özeti + öğünler ---------------------------------------------------

  async function gunuRenderla() {
    const kayitlar = await DB.FoodLogs.gununKayitlari(state.tarih);
    const toplam = { kalori: 0, protein: 0, karb: 0, yag: 0 };
    const ogunGrup = { kahvalti: [], ogle: [], aksam: [], ara: [] };

    for (const k of kayitlar) {
      const f = state.foodMap.get(k.food_id);
      if (!f) continue;
      const gram = DB.logGrami(k, f);
      const m = DB.gramMakro(f, gram);
      toplam.kalori += m.kalori;
      toplam.protein += m.protein;
      toplam.karb += m.karb;
      toplam.yag += m.yag;
      (ogunGrup[k.ogun] || ogunGrup.ara).push({ log: k, food: f, m, gram });
    }

    renderOzet(toplam);
    renderOgunler(ogunGrup);
    renderTarihBar();
  }

  function renderTarihBar() {
    const el = document.getElementById('tarih-bar');
    const bugun = DB.bugun();
    const dun = DB.tarihEkle(bugun, -1);
    let etiket = state.tarih;
    if (state.tarih === bugun) etiket = 'Bugün';
    else if (state.tarih === dun) etiket = 'Dün';
    else {
      const d = new Date(state.tarih + 'T00:00:00');
      etiket = d.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'long' });
    }
    el.querySelector('#tarih-etiket').textContent = etiket;
    el.querySelector('#ileri-btn').disabled = state.tarih >= bugun;
  }

  function renderOzet(toplam) {
    const ayar = state.ayarlar;
    const hedef = ayar.kalori_hedefi || 2000;
    const oran = ayar.makro_oranlari || { protein: 30, karb: 40, yag: 30 };
    const hedefMakro = {
      protein: Math.round((hedef * oran.protein) / 100 / 4),
      karb: Math.round((hedef * oran.karb) / 100 / 4),
      yag: Math.round((hedef * oran.yag) / 100 / 9)
    };
    const yuzde = Math.min(100, Math.round((toplam.kalori / hedef) * 100));
    const kalan = hedef - toplam.kalori;

    document.getElementById('gun-ozet').innerHTML = `
      <div class="ozet-ust">
        <div class="halka" style="--yuzde:${yuzde}">
          <div class="halka-ic">
            <div class="halka-kalori">${toplam.kalori}</div>
            <div class="halka-alt">/ ${hedef} kcal</div>
          </div>
        </div>
        <div class="ozet-yan">
          <div class="kalan ${kalan < 0 ? 'asildi' : ''}">
            ${kalan >= 0 ? kalan + ' kcal kaldı' : Math.abs(kalan) + ' kcal aşıldı'}
          </div>
          <div class="makro-satir">
            ${makroBar('Protein', toplam.protein, hedefMakro.protein, 'p')}
            ${makroBar('Karb', toplam.karb, hedefMakro.karb, 'k')}
            ${makroBar('Yağ', toplam.yag, hedefMakro.yag, 'y')}
          </div>
        </div>
      </div>`;
  }

  function makroBar(ad, deger, hedef, cls) {
    const y = hedef > 0 ? Math.min(100, Math.round((deger / hedef) * 100)) : 0;
    return `
      <div class="makro ${cls}">
        <div class="makro-bar"><span style="width:${y}%"></span></div>
        <div class="makro-etiket">${ad}</div>
        <div class="makro-deger">${Math.round(deger)}<small>/${hedef}g</small></div>
      </div>`;
  }

  function renderOgunler(grup) {
    document.getElementById('ogunler').innerHTML = OGUNLER.map((o) => {
      const kayitlar = grup[o.key] || [];
      const kal = kayitlar.reduce((s, x) => s + x.m.kalori, 0);
      const satirlar = kayitlar
        .map(
          (x) => `
        <div class="ogun-satir" data-log="${x.log.id}">
          <div class="os-ad">${x.food.ad}
            <span class="os-porsiyon">${porsiyonMetni(x.food, x.gram)}</span>
          </div>
          <div class="os-kal">${x.m.kalori}</div>
          <button class="os-sil" data-sil="${x.log.id}" aria-label="Sil">✕</button>
        </div>`
        )
        .join('');
      return `
        <section class="ogun-kart">
          <header class="ogun-baslik">
            <span>${o.ikon} ${o.ad}</span>
            <span class="ogun-kal">${kal} kcal</span>
          </header>
          <div class="ogun-icerik">${satirlar || '<div class="bos">— henüz kayıt yok —</div>'}</div>
          <button class="ogun-ekle" data-ogun="${o.key}">+ ekle</button>
        </section>`;
    }).join('');
  }

  // ---- Arama + sık kullanılanlar ---------------------------------------------

  async function sikKullanilanlariRenderla() {
    const sik = await DB.Foods.sikKullanilanlar(10);
    const el = document.getElementById('sik-kullanilanlar');
    if (!sik.length) {
      el.innerHTML = '';
      el.classList.add('gizli');
      return;
    }
    el.classList.remove('gizli');
    el.innerHTML =
      '<div class="bolum-baslik">Sık kullanılanlar</div><div class="cipler">' +
      sik
        .map(
          (f) =>
            `<button class="cip" data-food="${f.id}">${f.ad} <small>${f.kalori}</small></button>`
        )
        .join('') +
      '</div>';
  }

  function aramaSonuclariniRenderla(sorgu) {
    const el = document.getElementById('arama-sonuc');
    const q = (sorgu || '').trim();
    state.aramaQ = q;
    if (!q) {
      el.innerHTML = '';
      el.classList.add('gizli');
      return;
    }
    const sonuc = Search.ara(state.foods, q, 40);
    el.classList.remove('gizli');
    const yerel = sonuc.length
      ? sonuc
          .map(
            (f) => `
      <button class="sonuc-satir" data-food="${f.id}">
        <div class="ss-ad">${esc(f.ad)}</div>
        <div class="ss-alt">${esc(f.porsiyon_adi)} · ${f.kalori} kcal</div>
      </button>`
          )
          .join('')
      : '<div class="bos">Yerelde sonuç yok</div>';
    // Online arama (Open Food Facts) — paketli/markalı ürünler için
    const onlineBtn =
      q.length >= 2
        ? `<button class="online-ara-btn" data-online>🌐 “${esc(q)}” için Open Food Facts’te ara</button><div id="online-sonuc"></div>`
        : '';
    el.innerHTML = yerel + onlineBtn;
  }

  // Open Food Facts online arama → sonuçları listenin altına ekle.
  async function onlineArat(q) {
    const kutu = document.getElementById('online-sonuc');
    if (!kutu) return;
    if (!navigator.onLine) {
      kutu.innerHTML = '<div class="bos">Çevrimdışısın — online arama için internet gerekli.</div>';
      return;
    }
    kutu.innerHTML = '<div class="online-durum">🌐 Open Food Facts aranıyor…</div>';
    try {
      const sonuc = await OFF.ara(q);
      state.onlineMap = new Map(sonuc.map((f) => [f.id, f]));
      if (!sonuc.length) {
        kutu.innerHTML = '<div class="bos">Open Food Facts’te sonuç bulunamadı.</div>';
        return;
      }
      kutu.innerHTML =
        '<div class="online-baslik">Open Food Facts sonuçları</div>' +
        sonuc
          .map(
            (f) => `
        <button class="sonuc-satir online" data-off="${esc(f.id)}">
          <div class="ss-ad">${esc(f.ad)} <span class="off-rozet">OFF</span></div>
          <div class="ss-alt">${f.porsiyon_adi} · ${f.kalori} kcal · P${f.protein} K${f.karb} Y${f.yag}</div>
        </button>`
          )
          .join('');
    } catch (e) {
      kutu.innerHTML =
        '<div class="bos">Open Food Facts şu an yanıt vermedi (yoğun olabilir). Tekrar dene.</div>';
    }
  }

  // ---- Alt panel (hızlı ekle) — gram/porsiyon esnek ---------------------------

  function panelAc(foodId, ogun) {
    const f = state.foodMap.get(foodId);
    if (!f) return;
    state.secili = f;
    // Kişisel porsiyon hafızası: son gram varsa onunla aç, yoksa 1 porsiyon.
    state.gram = f.son_gram && f.son_gram > 0 ? f.son_gram : f.gram || 100;
    state.mod = 'porsiyon';
    if (ogun) state.ogun = ogun;
    panelRenderShell();
    document.getElementById('panel').classList.add('acik');
    document.getElementById('perde').classList.add('acik');
  }

  function panelKapat() {
    document.getElementById('panel').classList.remove('acik');
    document.getElementById('perde').classList.remove('acik');
    state.secili = null;
  }

  // Panelin tüm iskeletini (moda göre) basar.
  function panelRenderShell() {
    const f = state.secili;
    if (!f) return;
    const kisisel = f.son_gram && Math.abs(f.son_gram - f.gram) > 1;
    const el = document.getElementById('panel');

    const miktarKumesi =
      state.mod === 'porsiyon'
        ? `
      <div class="carpan-kutu">
        <button class="carpan-btn" data-adim="-0.5">−</button>
        <div class="carpan-goster">
          <div class="carpan-sayi" id="carpan-sayi"></div>
          <div class="carpan-alt">porsiyon</div>
        </div>
        <button class="carpan-btn" data-adim="0.5">+</button>
      </div>
      <div class="hizli-carpan" id="hizli-carpan">
        ${[0.5, 1, 1.5, 2, 3].map((v) => `<button class="hc" data-carp="${v}">${v}×</button>`).join('')}
      </div>`
        : `
      <div class="gram-kutu">
        <button class="carpan-btn" data-gadim="-10">−</button>
        <div class="gram-goster">
          <input id="gram-input" class="gram-input" type="number" inputmode="numeric" min="1" step="5" />
          <div class="carpan-alt">gram</div>
        </div>
        <button class="carpan-btn" data-gadim="10">+</button>
      </div>
      <div class="hizli-carpan" id="hizli-gram">
        ${[50, 100, 150, 200, 250, 300].map((v) => `<button class="hc" data-gset="${v}">${v}g</button>`).join('')}
      </div>`;

    el.innerHTML = `
      <div class="panel-tut"></div>
      <div class="panel-ad">${f.ad}</div>
      <div class="panel-porsiyon" id="panel-porsiyon"></div>
      ${kisisel ? `<div class="kisisel-not" id="kisisel-not">👤 Senin porsiyonun (${f.son_gram} g) hatırlandı</div>` : ''}

      <div class="mod-sec">
        <button class="mod-btn ${state.mod === 'porsiyon' ? 'sec' : ''}" data-mod="porsiyon">Porsiyon</button>
        <button class="mod-btn ${state.mod === 'gram' ? 'sec' : ''}" data-mod="gram">Gram</button>
      </div>

      ${miktarKumesi}

      <div class="panel-makro">
        <div><b id="pm-kalori">0</b><span>kcal</span></div>
        <div><b id="pm-protein">0</b><span>P</span></div>
        <div><b id="pm-karb">0</b><span>K</span></div>
        <div><b id="pm-yag">0</b><span>Y</span></div>
      </div>

      <div class="ogun-sec">
        ${OGUNLER.map((o) => `<button class="os-btn ${o.key === state.ogun ? 'sec' : ''}" data-ogunsec="${o.key}">${o.ikon} ${o.ad}</button>`).join('')}
      </div>

      <button class="ekle-btn" id="kaydet-btn">Ekle</button>`;

    // gram modunda input'a değeri yaz + canlı dinle (kısmi güncelleme, odak korunur).
    if (state.mod === 'gram') {
      const inp = document.getElementById('gram-input');
      inp.value = Math.round(state.gram);
      inp.addEventListener('input', () => {
        const v = parseInt(inp.value, 10);
        state.gram = isNaN(v) ? 0 : v;
        panelGuncelle(true);
      });
    }
    panelGuncelle(false);
  }

  // Sadece dinamik değerleri günceller (iskeleti değil). inputKaynak=true iken
  // gram input'una dokunmaz (yazarken imleç kaybolmasın).
  function panelGuncelle(inputKaynak) {
    const f = state.secili;
    if (!f) return;
    const gram = Math.max(0, state.gram);
    const m = DB.gramMakro(f, gram);
    const p = porsiyonSayisi(f, gram);

    const sub = document.getElementById('panel-porsiyon');
    if (sub) sub.textContent = porsiyonMetni(f, gram);

    const cs = document.getElementById('carpan-sayi');
    if (cs) cs.textContent = psFormat(p);
    if (!inputKaynak) {
      const gi = document.getElementById('gram-input');
      if (gi && document.activeElement !== gi) gi.value = Math.round(gram);
    }

    document.getElementById('pm-kalori').textContent = m.kalori;
    document.getElementById('pm-protein').textContent = m.protein;
    document.getElementById('pm-karb').textContent = m.karb;
    document.getElementById('pm-yag').textContent = m.yag;

    // çip vurguları
    const hc = document.getElementById('hizli-carpan');
    if (hc)
      hc.querySelectorAll('[data-carp]').forEach((b) =>
        b.classList.toggle('sec', Math.abs(parseFloat(b.dataset.carp) - p) < 0.05)
      );
    const hg = document.getElementById('hizli-gram');
    if (hg)
      hg.querySelectorAll('[data-gset]').forEach((b) =>
        b.classList.toggle('sec', parseInt(b.dataset.gset, 10) === Math.round(gram))
      );
  }

  async function kaydet() {
    if (!state.secili) return;
    if (state.gram <= 0) return;
    await DB.FoodLogs.ekle({
      tarih: state.tarih,
      food_id: state.secili.id,
      gram: state.gram,
      ogun: state.ogun
    });
    panelKapat();
    const inp = document.getElementById('arama');
    inp.value = '';
    aramaSonuclariniRenderla('');
    await foodlariYukle();
    await sikKullanilanlariRenderla();
    await gunuRenderla();
    titret();
  }

  function titret() {
    if (navigator.vibrate) navigator.vibrate(15);
  }

  // ---- Dünü kopyala ----------------------------------------------------------

  async function dunuKopyala() {
    const dun = DB.tarihEkle(state.tarih, -1);
    const mevcut = await DB.FoodLogs.gununKayitlari(state.tarih);
    if (mevcut.length) {
      if (!confirm('Bugün zaten kayıt var. Dünün kayıtları üstüne eklensin mi?')) return;
    }
    const adet = await DB.FoodLogs.gunuKopyala(dun, state.tarih);
    if (adet === 0) {
      bildir('Dün için kayıt bulunamadı.');
      return;
    }
    await foodlariYukle();
    await sikKullanilanlariRenderla();
    await gunuRenderla();
    bildir(adet + ' kayıt kopyalandı.');
  }

  function bildir(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('goster');
    setTimeout(() => t.classList.remove('goster'), 1800);
  }

  // ---- Olay bağlama ----------------------------------------------------------

  function olaylariBagla() {
    const kok = state.kok;

    const inp = document.getElementById('arama');
    let zamanlayici;
    inp.addEventListener('input', () => {
      clearTimeout(zamanlayici);
      zamanlayici = setTimeout(() => aramaSonuclariniRenderla(inp.value), 80);
    });

    document.getElementById('geri-btn').addEventListener('click', async () => {
      state.tarih = DB.tarihEkle(state.tarih, -1);
      await gunuRenderla();
    });
    document.getElementById('ileri-btn').addEventListener('click', async () => {
      if (state.tarih >= DB.bugun()) return;
      state.tarih = DB.tarihEkle(state.tarih, 1);
      await gunuRenderla();
    });
    document.getElementById('bugun-btn').addEventListener('click', async () => {
      state.tarih = DB.bugun();
      await gunuRenderla();
    });

    document.getElementById('dunu-kopyala').addEventListener('click', dunuKopyala);

    kok.addEventListener('click', async (e) => {
      // Online arama tetikle
      const onlineBtn = e.target.closest('[data-online]');
      if (onlineBtn) return onlineArat(state.aramaQ);
      // Online sonucu seç → yerel DB'ye kalıcı kaydet + panel aç
      const offBtn = e.target.closest('[data-off]');
      if (offBtn) {
        const f = state.onlineMap.get(offBtn.dataset.off);
        if (f) {
          await DB.Foods.bulkSeed([f]); // kalıcı: sonrasında offline da bulunur
          await foodlariYukle();
          panelAc(f.id);
        }
        return;
      }
      const foodBtn = e.target.closest('[data-food]');
      if (foodBtn) return panelAc(foodBtn.dataset.food);
      const ogunEkle = e.target.closest('[data-ogun]');
      if (ogunEkle) {
        document.getElementById('arama').focus();
        state.ogun = ogunEkle.dataset.ogun;
        return;
      }
      const sil = e.target.closest('[data-sil]');
      if (sil) {
        await DB.FoodLogs.sil(sil.dataset.sil);
        await gunuRenderla();
      }
    });

    const panel = document.getElementById('panel');
    panel.addEventListener('click', (e) => {
      const f = state.secili;
      if (!f) return;
      // porsiyon adım
      const adim = e.target.closest('[data-adim]');
      if (adim) {
        const yeniP = Math.max(0.5, porsiyonSayisi(f, state.gram) + parseFloat(adim.dataset.adim));
        state.gram = Math.round(yeniP * f.gram);
        return panelGuncelle(false);
      }
      // porsiyon çip
      const carp = e.target.closest('[data-carp]');
      if (carp) {
        state.gram = Math.round(parseFloat(carp.dataset.carp) * f.gram);
        return panelGuncelle(false);
      }
      // gram adım
      const gadim = e.target.closest('[data-gadim]');
      if (gadim) {
        state.gram = Math.max(1, Math.round(state.gram + parseInt(gadim.dataset.gadim, 10)));
        return panelGuncelle(false);
      }
      // gram çip
      const gset = e.target.closest('[data-gset]');
      if (gset) {
        state.gram = parseInt(gset.dataset.gset, 10);
        return panelGuncelle(false);
      }
      // mod değiştir
      const mod = e.target.closest('[data-mod]');
      if (mod) {
        state.mod = mod.dataset.mod;
        return panelRenderShell();
      }
      // öğün
      const ogunsec = e.target.closest('[data-ogunsec]');
      if (ogunsec) {
        state.ogun = ogunsec.dataset.ogunsec;
        panel.querySelectorAll('[data-ogunsec]').forEach((b) =>
          b.classList.toggle('sec', b === ogunsec)
        );
        return;
      }
      if (e.target.closest('#kaydet-btn')) kaydet();
    });

    document.getElementById('perde').addEventListener('click', panelKapat);
  }

  async function baslat(kokEl) {
    state.kok = kokEl;
    state.ayarlar = await DB.Settings.get();
    await foodlariYukle();
    state.ogun = varsayilanOgun();
    olaylariBagla();
    await sikKullanilanlariRenderla();
    await gunuRenderla();
  }

  async function yenile() {
    state.ayarlar = await DB.Settings.get();
    await foodlariYukle();
    await sikKullanilanlariRenderla();
    await gunuRenderla();
  }

  global.Nutrition = { baslat, yenile };
})(window);
