// app.js — Uygulama girişi: init sırası, sekme yönlendirme, ayarlar, SW kaydı.

(function (global) {
  'use strict';

  const sekmeler = ['beslenme', 'antrenman', 'ayarlar'];

  function sekmeGoster(ad) {
    for (const s of sekmeler) {
      document.getElementById('sayfa-' + s).classList.toggle('aktif', s === ad);
      document
        .querySelector(`.nav-btn[data-sekme="${s}"]`)
        .classList.toggle('aktif', s === ad);
    }
    if (ad === 'antrenman') Workout.baslat(document.getElementById('sayfa-antrenman'));
  }

  // ---- Ayarlar ekranı --------------------------------------------------------

  async function ayarlariRenderla() {
    const a = await DB.Settings.get();
    document.getElementById('s-kalori').value = a.kalori_hedefi;
    document.getElementById('s-protein').value = a.makro_oranlari.protein;
    document.getElementById('s-karb').value = a.makro_oranlari.karb;
    document.getElementById('s-yag').value = a.makro_oranlari.yag;
    ayarToplamGoster();
  }

  function ayarToplamGoster() {
    const p = +document.getElementById('s-protein').value || 0;
    const k = +document.getElementById('s-karb').value || 0;
    const y = +document.getElementById('s-yag').value || 0;
    const t = p + k + y;
    const el = document.getElementById('s-toplam');
    el.textContent = 'Makro toplamı: %' + t;
    el.classList.toggle('hata', t !== 100);
  }

  async function ayarlariKaydet() {
    const p = +document.getElementById('s-protein').value || 0;
    const k = +document.getElementById('s-karb').value || 0;
    const y = +document.getElementById('s-yag').value || 0;
    if (p + k + y !== 100) {
      alert('Makro oranları toplamı %100 olmalı (şu an %' + (p + k + y) + ').');
      return;
    }
    await DB.Settings.set({
      kalori_hedefi: +document.getElementById('s-kalori').value || 2000,
      makro_oranlari: { protein: p, karb: k, yag: y }
    });
    await Nutrition.yenile();
    const t = document.getElementById('toast');
    t.textContent = 'Ayarlar kaydedildi.';
    t.classList.add('goster');
    setTimeout(() => t.classList.remove('goster'), 1600);
  }

  function ayarOlaylari() {
    ['s-protein', 's-karb', 's-yag'].forEach((id) =>
      document.getElementById(id).addEventListener('input', ayarToplamGoster)
    );
    document.getElementById('s-kaydet').addEventListener('click', ayarlariKaydet);
  }

  // ---- Init ------------------------------------------------------------------

  async function init() {
    const durum = document.getElementById('yukleniyor-durum');
    try {
      await DB.Settings.ensure();
      durum.textContent = 'Gıda listesi hazırlanıyor…';
      const r = await Seed.seedGerekirse();
      if (r.hata) durum.textContent = 'Uyarı: gıda listesi yüklenemedi.';

      await Nutrition.baslat(document.getElementById('sayfa-beslenme'));
      await ayarlariRenderla();
      ayarOlaylari();

      // Sekme navigasyonu
      document.querySelectorAll('.nav-btn').forEach((b) =>
        b.addEventListener('click', () => sekmeGoster(b.dataset.sekme))
      );

      document.getElementById('yukleniyor').classList.add('gizli');
    } catch (e) {
      console.error(e);
      durum.textContent = 'Hata: ' + e.message;
    }
  }

  // Service worker (offline-first). GitHub Pages alt yolunda çalışsın diye göreli.
  function swKaydet() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW:', e));
      });
    }
  }

  swKaydet();
  document.addEventListener('DOMContentLoaded', init);
})(window);
