// workout.js — Antrenman modülü v2.
// Set-set kayıt (her set ayrı ağırlık/tekrar), tarih gezinme + geçmiş,
// hareket bazlı ilerleme grafiği, kişisel rekor (PR), program/şablon.

(function (global) {
  'use strict';

  const state = {
    tarih: DB.bugun(),
    exercises: [],
    exMap: new Map(),
    kok: null,
    bagli: false,
    timers: new Map() // input debounce (set:id:alan → timeout)
  };

  async function exYukle() {
    state.exercises = await DB.Exercises.all();
    state.exMap = new Map(state.exercises.map((e) => [e.id, e]));
  }

  // ---- Yardımcılar -----------------------------------------------------------

  function grupNesne(g) {
    // g: gunuGrupla çıktısı; ek: kütüphane bilgisi
    const ex = g.exercise_id ? state.exMap.get(g.exercise_id) : null;
    return { ...g, ex };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );
  }

  // ---- Üst: tarih + özet -----------------------------------------------------

  function renderTarihBar() {
    const bugun = DB.bugun();
    const dun = DB.tarihEkle(bugun, -1);
    let etiket = state.tarih;
    if (state.tarih === bugun) etiket = 'Bugün';
    else if (state.tarih === dun) etiket = 'Dün';
    else {
      const d = new Date(state.tarih + 'T00:00:00');
      etiket = d.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'long' });
    }
    document.getElementById('w-tarih-etiket').textContent = etiket;
    document.getElementById('w-ileri').disabled = state.tarih >= bugun;
  }

  async function renderOzet() {
    const o = await DB.WorkoutLogs.gunOzeti(state.tarih, state.exMap);
    const el = document.getElementById('w-ozet-kart');
    if (!o.hareket) {
      el.innerHTML = '<div class="w-ozet-bos">Bu güne henüz hareket eklenmedi.</div>';
      return;
    }
    const kaslar = o.kaslar.map((k) => `<span class="w-kas-etiket">${esc(k)}</span>`).join('');
    el.innerHTML = `
      <div class="w-ozet-say">
        <div><b>${o.hareket}</b><span>hareket</span></div>
        <div><b>${o.toplamSet}</b><span>set</span></div>
        <div><b>${o.hacim.toLocaleString('tr-TR')}</b><span>kg hacim</span></div>
      </div>
      <div class="w-kaslar">${kaslar}</div>`;
  }

  // ---- Sık yapılanlar --------------------------------------------------------

  async function renderSik() {
    const sik = await DB.Exercises.sikKullanilanlar(8);
    const el = document.getElementById('w-sik');
    if (!sik.length) {
      el.innerHTML = '';
      el.classList.add('gizli');
      return;
    }
    el.classList.remove('gizli');
    el.innerHTML =
      '<div class="bolum-baslik">Sık yapılanlar</div><div class="cipler">' +
      sik.map((e) => `<button class="cip" data-ex="${e.id}">${esc(e.ad)}</button>`).join('') +
      '</div>';
  }

  // ---- Arama -----------------------------------------------------------------

  function renderArama(sorgu) {
    const el = document.getElementById('w-arama-sonuc');
    const q = (sorgu || '').trim();
    if (!q) {
      el.innerHTML = '';
      el.classList.add('gizli');
      return;
    }
    const sonuc = Search.ara(state.exercises, q, 30);
    el.classList.remove('gizli');
    if (!sonuc.length) {
      el.innerHTML =
        '<button class="sonuc-satir" data-serbest="1"><div class="ss-ad">“' +
        esc(q) +
        '” ekle</div><div class="ss-alt">Kütüphanede yok — serbest hareket olarak ekle</div></button>';
      return;
    }
    el.innerHTML = sonuc
      .map(
        (e) => `
      <button class="sonuc-satir" data-ex="${e.id}">
        <div class="ss-ad">${esc(e.ad)}</div>
        <div class="ss-alt">${esc(e.kas_grubu)} · ${esc(e.ekipman)}</div>
      </button>`
      )
      .join('');
  }

  function aramaTemizle() {
    const inp = document.getElementById('w-arama');
    inp.value = '';
    renderArama('');
  }

  // ---- Hareket / set ekleme --------------------------------------------------

  // Bir hareketi güne ekle (yeni kart) veya yeni set olarak ekle.
  async function hareketEkle(exId, serbestAd) {
    let ex = null;
    let hareket;
    if (exId) {
      ex = state.exMap.get(exId);
      if (!ex) return;
      hareket = ex.ad;
    } else {
      hareket = (serbestAd || '').trim();
      if (!hareket) return;
    }

    const gruplar = await DB.WorkoutLogs.gunuGrupla(state.tarih);
    const anahtar = DB.grupAnahtari({ exercise_id: exId || null, hareket });
    const mevcut = gruplar.find((g) => g.anahtar === anahtar);

    let tekrar = 10;
    let kilo = 0;
    let set_no = 1;

    if (mevcut) {
      const son = mevcut.setler[mevcut.setler.length - 1];
      set_no = mevcut.toplamSet + 1;
      tekrar = son.tekrar;
      kilo = son.kilo;
    } else {
      const gecen = await DB.WorkoutLogs.sonSession(exId || null, hareket, state.tarih);
      if (gecen && gecen.setler.length) {
        tekrar = gecen.setler[0].tekrar;
        kilo = gecen.setler[0].kilo;
      } else if (ex) {
        if (ex.son_tekrar != null) tekrar = ex.son_tekrar;
        if (ex.son_kilo != null) kilo = ex.son_kilo;
      }
      if (exId) await DB.Exercises.kullanildi(exId);
    }

    const { pr } = await DB.WorkoutLogs.setEkle({
      tarih: state.tarih,
      exercise_id: exId || null,
      hareket,
      set_no,
      tekrar,
      kilo
    });
    aramaTemizle();
    await exYukle();
    await tumunuRenderla();
    if (pr) prBildir(hareket, pr);
    // yeni eklenen karta kaydır
    const kartEl = document.querySelector(`.w-kart[data-anahtar="${cssKac(anahtar)}"]`);
    if (kartEl) kartEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function cssKac(s) {
    return s.replace(/["\\]/g, '\\$&');
  }

  async function setEkleKart(anahtar) {
    const grup = (await DB.WorkoutLogs.gunuGrupla(state.tarih)).find((g) => g.anahtar === anahtar);
    if (!grup) return;
    const son = grup.setler[grup.setler.length - 1];
    await DB.WorkoutLogs.setEkle({
      tarih: state.tarih,
      exercise_id: grup.exercise_id,
      hareket: grup.hareket,
      set_no: grup.toplamSet + 1,
      tekrar: son.tekrar,
      kilo: son.kilo
    });
    await tumunuRenderla();
  }

  // ---- Egzersiz kartları -----------------------------------------------------

  async function renderKartlar() {
    const gruplar = await DB.WorkoutLogs.gunuGrupla(state.tarih);
    const kok = document.getElementById('w-kartlar');
    if (!gruplar.length) {
      kok.innerHTML =
        '<div class="w-ipucu">Yukarıdan hareket ara ve ekle. Her hareket için set set ağırlık/tekrar girebilirsin.</div>';
      return;
    }
    // Her kart için "geçen sefer" bilgisi
    const parcalar = [];
    for (const gRaw of gruplar) {
      const g = grupNesne(gRaw);
      const gecen = await DB.WorkoutLogs.sonSession(g.exercise_id, g.hareket, state.tarih);
      parcalar.push(kartHTML(g, gecen));
    }
    kok.innerHTML = parcalar.join('');
  }

  function kartHTML(g, gecen) {
    const ex = g.ex;
    const grup = ex ? `<span class="w-grup">${esc(ex.kas_grubu)}</span>` : '';
    const pr =
      ex && ex.pr_kilo
        ? `<span class="pr-rozet" title="Rekor: ${ex.pr_kilo} kg / 1RM ${ex.pr_1rm || '-'}">🏆 ${ex.pr_kilo}kg</span>`
        : '';
    const gecenMetni = gecen
      ? `<div class="w-gecen">Geçen sefer (${kisaTarih(gecen.tarih)}): ${ozetMetni(gecen)}</div>`
      : '';

    const setSatirlari = g.setler
      .map(
        (s) => `
      <div class="w-set ${s.tamam ? 'tamam' : ''}" data-set="${s.id}">
        <span class="w-setno">${s.set_no}</span>
        <input class="w-in" data-f="tekrar" type="number" inputmode="numeric" min="0" value="${s.tekrar}" aria-label="Tekrar" />
        <span class="w-x">×</span>
        <input class="w-in" data-f="kilo" type="number" inputmode="decimal" min="0" step="0.5" value="${s.kilo}" aria-label="Kilo" />
        <span class="w-kg">kg</span>
        <button class="w-set-ok" data-tamam="${s.id}" aria-label="Tamam">✓</button>
        <button class="w-set-sil" data-ssil="${s.id}" aria-label="Set sil">✕</button>
      </div>`
      )
      .join('');

    return `
      <section class="w-kart" data-anahtar="${esc(g.anahtar)}" data-ex="${esc(g.exercise_id || '')}" data-hareket="${esc(g.hareket)}">
        <header class="w-kart-bas">
          <div class="w-kart-ad">${esc(g.hareket)} ${grup} ${pr}</div>
          <div class="w-kart-aksiyon">
            <button class="w-mini" data-gecmis="${esc(g.anahtar)}" aria-label="Geçmiş & grafik">📈</button>
            <button class="w-mini w-sil-h" data-hsil="${esc(g.anahtar)}" aria-label="Hareketi sil">🗑</button>
          </div>
        </header>
        ${gecenMetni}
        <div class="w-setler">${setSatirlari}</div>
        <div class="w-kart-alt">
          <button class="w-set-ekle" data-setekle="${esc(g.anahtar)}">+ Set</button>
          <span class="w-hacim">${g.hacim.toLocaleString('tr-TR')} kg · ${g.toplamSet} set</span>
        </div>
      </section>`;
  }

  function ozetMetni(session) {
    // "3 set · en iyi 80kg" ya da set kırılımı
    const s = session.setler;
    if (s.length <= 3) return s.map((x) => `${x.tekrar}×${x.kilo}kg`).join(', ');
    return `${session.toplamSet} set · en iyi ${session.enIyiKilo}kg`;
  }

  function kisaTarih(t) {
    const bugun = DB.bugun();
    if (t === DB.tarihEkle(bugun, -1)) return 'dün';
    const d = new Date(t + 'T00:00:00');
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  }

  // Bir kartın hacmini DOM'daki güncel input değerlerinden yeniden hesapla.
  function guncelleKartHacim(kartEl) {
    let hacim = 0;
    let setSay = 0;
    kartEl.querySelectorAll('.w-set').forEach((row) => {
      const t = parseFloat(row.querySelector('[data-f="tekrar"]').value) || 0;
      const k = parseFloat(row.querySelector('[data-f="kilo"]').value) || 0;
      hacim += t * k;
      setSay++;
    });
    kartEl.querySelector('.w-hacim').textContent =
      Math.round(hacim).toLocaleString('tr-TR') + ' kg · ' + setSay + ' set';
  }

  function prBildir(hareket, pr) {
    const metin =
      pr.tur === 'kilo'
        ? `🏆 Yeni rekor! ${esc(hareket)} — ${pr.deger} kg`
        : `🏆 Yeni 1RM rekoru! ${esc(hareket)} — ${pr.deger} kg`;
    bildir(metin);
    if (navigator.vibrate) navigator.vibrate([15, 40, 15]);
  }

  // ---- Önceki antrenmanı kopyala ---------------------------------------------

  async function oncekiKopyala() {
    const kaynak = await DB.WorkoutLogs.sonAntrenmanTarihi(state.tarih);
    if (!kaynak) {
      bildir('Kopyalanacak önceki antrenman bulunamadı.');
      return;
    }
    const mevcut = await DB.WorkoutLogs.gununKayitlari(state.tarih);
    if (mevcut.length && !confirm('Bu güne setler eklenecek. Devam edilsin mi?')) return;
    const adet = await DB.WorkoutLogs.gunKopyala(kaynak, state.tarih);
    await exYukle();
    await tumunuRenderla();
    bildir(`${kisaTarih(kaynak)} antrenmanı kopyalandı (${adet} set).`);
  }

  // ---- Program / şablon ------------------------------------------------------

  async function programPaneliAc() {
    const programlar = await DB.Programs.all();
    const gruplar = await DB.WorkoutLogs.gunuGrupla(state.tarih);
    const liste =
      programlar.length === 0
        ? '<div class="bos">Henüz program yok.</div>'
        : programlar
            .map(
              (p) => `
        <div class="w-prog-satir">
          <div class="w-prog-bilgi">
            <div class="w-prog-ad">${esc(p.ad)}</div>
            <div class="w-prog-alt">${p.hareketler.length} hareket</div>
          </div>
          <button class="w-prog-yukle" data-progyukle="${esc(p.id)}">Yükle</button>
          <button class="w-set-sil" data-progsil="${esc(p.id)}" aria-label="Sil">✕</button>
        </div>`
            )
            .join('');

    const kaydetBtn =
      gruplar.length > 0
        ? `<button class="ekle-btn ikincil" id="w-prog-kaydet">＋ Bugünkü antrenmanı program yap</button>`
        : `<div class="ipucu-kucuk">Bir programı kaydetmek için önce bugüne hareket ekle.</div>`;

    modalAc(`
      <div class="panel-tut"></div>
      <div class="panel-ad">Programlar</div>
      <div class="w-prog-liste">${liste}</div>
      ${kaydetBtn}`);
  }

  async function programYukle(id) {
    const p = await DB.Programs.get(id);
    if (!p) return;
    const mevcut = await DB.WorkoutLogs.gununKayitlari(state.tarih);
    if (mevcut.length && !confirm('“' + p.ad + '” bu güne eklenecek. Devam edilsin mi?')) return;
    for (const h of p.hareketler) {
      const adet = Math.max(1, h.hedef_set || 1);
      for (let i = 1; i <= adet; i++) {
        await DB.WorkoutLogs.setEkle({
          tarih: state.tarih,
          exercise_id: h.exercise_id || null,
          hareket: h.hareket,
          set_no: i,
          tekrar: h.hedef_tekrar || 0,
          kilo: h.hedef_kilo || 0
        });
      }
      if (h.exercise_id) await DB.Exercises.kullanildi(h.exercise_id);
    }
    modalKapat();
    await exYukle();
    await tumunuRenderla();
    bildir('“' + p.ad + '” yüklendi.');
  }

  async function bugunuProgramYap() {
    const ad = prompt('Program adı (ör. İtiş Günü):');
    if (!ad || !ad.trim()) return;
    const gruplar = await DB.WorkoutLogs.gunuGrupla(state.tarih);
    const hareketler = gruplar.map((g) => {
      const son = g.setler[g.setler.length - 1];
      return {
        exercise_id: g.exercise_id || null,
        hareket: g.hareket,
        kas_grubu: g.ex ? g.ex.kas_grubu : (state.exMap.get(g.exercise_id) || {}).kas_grubu || '',
        hedef_set: g.toplamSet,
        hedef_tekrar: son.tekrar,
        hedef_kilo: son.kilo
      };
    });
    await DB.Programs.kaydet({ ad: ad.trim(), hareketler });
    modalKapat();
    bildir('Program kaydedildi: ' + ad.trim());
  }

  // ---- Geçmiş + grafik modalı ------------------------------------------------

  async function gecmisModaliAc(anahtar) {
    const grup = (await DB.WorkoutLogs.gunuGrupla(state.tarih)).find((g) => g.anahtar === anahtar);
    if (!grup) return;
    const g = grupNesne(grup);
    const gecmis = await DB.WorkoutLogs.hareketGecmisi(g.exercise_id, g.hareket, 20);
    const ex = g.ex;

    const prSatir = ex
      ? `<div class="w-pr-kutu">
           <div><b>${ex.pr_kilo || '-'}</b><span>en iyi kg</span></div>
           <div><b>${ex.pr_1rm || '-'}</b><span>tahmini 1RM</span></div>
         </div>`
      : '';

    // Grafik: en iyi kilo (eski → yeni)
    const kronolojik = [...gecmis].reverse();
    const grafik = svgGrafik(
      kronolojik.map((s) => ({ tarih: s.tarih, deger: s.enIyiKilo }))
    );

    const seansListe = gecmis.length
      ? gecmis
          .map(
            (s) => `
        <div class="w-gecmis-satir">
          <div class="w-gecmis-tarih">${uzunTarih(s.tarih)}</div>
          <div class="w-gecmis-detay">
            ${s.setler.map((x) => `<span>${x.tekrar}×${x.kilo}kg</span>`).join('')}
          </div>
          <div class="w-gecmis-hacim">${s.hacim.toLocaleString('tr-TR')} kg</div>
        </div>`
          )
          .join('')
      : '<div class="bos">Henüz geçmiş kayıt yok.</div>';

    modalAc(`
      <div class="panel-tut"></div>
      <div class="panel-ad">${esc(g.hareket)}</div>
      <div class="panel-porsiyon">${ex ? esc(ex.kas_grubu) + ' · ' + esc(ex.ekipman) : 'Serbest hareket'}</div>
      ${prSatir}
      <div class="w-grafik-baslik">En iyi ağırlık gelişimi</div>
      <div class="w-grafik-kutu">${grafik}</div>
      <div class="w-grafik-baslik">Geçmiş seanslar</div>
      <div class="w-gecmis-liste">${seansListe}</div>`);
  }

  // Basit SVG çizgi grafiği.
  function svgGrafik(veri) {
    if (veri.length < 2)
      return '<div class="bos">Grafik için en az 2 seans gerekir.</div>';
    const W = 320;
    const H = 120;
    const p = 12;
    const degerler = veri.map((d) => d.deger);
    const maxV = Math.max(...degerler);
    const minV = Math.min(...degerler);
    const rng = maxV - minV || 1;
    const n = veri.length;
    const x = (i) => p + (i * (W - 2 * p)) / (n - 1);
    const y = (v) => H - p - ((v - minV) / rng) * (H - 2 * p);
    const pts = veri.map((d, i) => `${x(i).toFixed(1)},${y(d.deger).toFixed(1)}`).join(' ');
    const nokta = veri
      .map(
        (d, i) =>
          `<circle cx="${x(i).toFixed(1)}" cy="${y(d.deger).toFixed(1)}" r="3.5"><title>${d.tarih}: ${d.deger}kg</title></circle>`
      )
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="w-grafik" preserveAspectRatio="none">
      <polyline points="${pts}" fill="none" class="w-grafik-cizgi" />
      ${nokta}
      <text x="${p}" y="12" class="w-grafik-max">${maxV}kg</text>
      <text x="${p}" y="${H - 2}" class="w-grafik-min">${minV}kg</text>
    </svg>`;
  }

  function uzunTarih(t) {
    const d = new Date(t + 'T00:00:00');
    return d.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'long' });
  }

  // ---- Modal altyapısı -------------------------------------------------------

  function modalAc(html) {
    const m = document.getElementById('w-modal');
    m.innerHTML = html;
    m.classList.add('acik');
    document.getElementById('w-perde').classList.add('acik');
  }
  function modalKapat() {
    document.getElementById('w-modal').classList.remove('acik');
    document.getElementById('w-perde').classList.remove('acik');
  }

  function bildir(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('goster');
    setTimeout(() => t.classList.remove('goster'), 2000);
  }

  // ---- Render toplu ----------------------------------------------------------

  async function tumunuRenderla() {
    renderTarihBar();
    await renderOzet();
    await renderSik();
    await renderKartlar();
  }

  // ---- Olay bağlama ----------------------------------------------------------

  function bagla() {
    if (state.bagli) return;
    state.bagli = true;

    // Arama
    const arama = document.getElementById('w-arama');
    let zaman;
    arama.addEventListener('input', () => {
      clearTimeout(zaman);
      zaman = setTimeout(() => renderArama(arama.value), 80);
    });

    // Tarih gezinme
    document.getElementById('w-geri').addEventListener('click', async () => {
      state.tarih = DB.tarihEkle(state.tarih, -1);
      await tumunuRenderla();
    });
    document.getElementById('w-ileri').addEventListener('click', async () => {
      if (state.tarih >= DB.bugun()) return;
      state.tarih = DB.tarihEkle(state.tarih, 1);
      await tumunuRenderla();
    });
    document.getElementById('w-bugun').addEventListener('click', async () => {
      state.tarih = DB.bugun();
      await tumunuRenderla();
    });

    document.getElementById('w-kopyala-btn').addEventListener('click', oncekiKopyala);
    document.getElementById('w-program-btn').addEventListener('click', programPaneliAc);

    // Sayfa geneli tıklama (arama sonucu, çipler, kart aksiyonları)
    state.kok.addEventListener('click', async (e) => {
      const serbest = e.target.closest('[data-serbest]');
      if (serbest) return hareketEkle(null, document.getElementById('w-arama').value);
      const exBtn = e.target.closest('[data-ex]');
      if (exBtn && exBtn.dataset.ex) {
        // Kartın kendisi de data-ex taşıyor; sadece buton/çip/sonuç tıklanınca ekle
        if (exBtn.classList.contains('cip') || exBtn.classList.contains('sonuc-satir'))
          return hareketEkle(exBtn.dataset.ex);
      }
      const setekle = e.target.closest('[data-setekle]');
      if (setekle) return setEkleKart(setekle.dataset.setekle);
      const ssil = e.target.closest('[data-ssil]');
      if (ssil) {
        await DB.WorkoutLogs.sil(ssil.dataset.ssil);
        await exYukle();
        await tumunuRenderla();
        return;
      }
      const tamam = e.target.closest('[data-tamam]');
      if (tamam) {
        const row = tamam.closest('.w-set');
        const yeni = row.classList.contains('tamam') ? 0 : 1;
        row.classList.toggle('tamam', !!yeni);
        await DB.WorkoutLogs.setGuncelle(tamam.dataset.tamam, { tamam: yeni });
        return;
      }
      const hsil = e.target.closest('[data-hsil]');
      if (hsil) {
        if (!confirm('Bu hareket ve tüm setleri silinsin mi?')) return;
        await DB.WorkoutLogs.hareketiSil(state.tarih, hsil.dataset.hsil);
        await exYukle();
        await tumunuRenderla();
        return;
      }
      const gecmis = e.target.closest('[data-gecmis]');
      if (gecmis) return gecmisModaliAc(gecmis.dataset.gecmis);
    });

    // Set input canlı güncelleme + kalıcı kayıt (debounce)
    document.getElementById('w-kartlar').addEventListener('input', (e) => {
      const inp = e.target.closest('.w-in');
      if (!inp) return;
      const row = inp.closest('[data-set]');
      const id = row.dataset.set;
      const f = inp.dataset.f;
      const val = parseFloat(inp.value) || 0;
      guncelleKartHacim(inp.closest('.w-kart'));
      const key = id + ':' + f;
      clearTimeout(state.timers.get(key));
      state.timers.set(
        key,
        setTimeout(async () => {
          const yama = {};
          yama[f] = val;
          const pr = await DB.WorkoutLogs.setGuncelle(id, yama);
          await exYukle();
          await renderOzet();
          const kartEl = row.closest('.w-kart');
          if (pr && kartEl) prBildir(kartEl.dataset.hareket, pr);
        }, 450)
      );
    });

    // Modal olayları
    const modal = document.getElementById('w-modal');
    modal.addEventListener('click', async (e) => {
      const yukle = e.target.closest('[data-progyukle]');
      if (yukle) return programYukle(yukle.dataset.progyukle);
      const sil = e.target.closest('[data-progsil]');
      if (sil) {
        if (!confirm('Program silinsin mi?')) return;
        await DB.Programs.sil(sil.dataset.progsil);
        return programPaneliAc();
      }
      if (e.target.closest('#w-prog-kaydet')) return bugunuProgramYap();
    });
    document.getElementById('w-perde').addEventListener('click', modalKapat);
  }

  async function baslat(kokEl) {
    state.kok = kokEl;
    await exYukle();
    bagla();
    await tumunuRenderla();
  }

  global.Workout = { baslat };
})(window);
