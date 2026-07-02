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

  // ---- Hesap / Bulut senkron -------------------------------------------------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );
  }
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('goster');
    setTimeout(() => t.classList.remove('goster'), 1900);
  }
  function zamanKisa(iso) {
    try {
      return new Date(iso).toLocaleString('tr-TR', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return iso;
    }
  }
  function hataCevir(m) {
    const s = (m || '').toLowerCase();
    if (s.includes('invalid login') || s.includes('credentials')) return 'E-posta veya şifre hatalı.';
    if (s.includes('already registered') || s.includes('already been registered')) return 'Bu e-posta zaten kayıtlı — giriş yap.';
    if (s.includes('email not confirmed')) return 'E-posta onayı gerekli. Supabase\'de "Confirm email" kapatılmalı.';
    if (s.includes('password')) return 'Şifre en az 6 karakter olmalı.';
    if (s.includes('failed to fetch') || s.includes('networkerror')) return 'Bağlantı yok — internet gerekli.';
    return m || 'Bir hata oluştu.';
  }

  async function hesabRenderla() {
    const el = document.getElementById('hesap-kart');
    if (!el) return; // savunmacı: kart DOM'da yoksa sessiz geç
    if (!global.SB || !SB.AKTIF) {
      el.innerHTML =
        '<div class="ayar-baslik">Bulut senkron</div><div class="ayar-not" style="margin:6px 0 0">Yapılandırılmadı — uygulama yalnızca bu cihazda çalışıyor.</div>';
      return;
    }
    if (SB.girisliMi()) {
      const u = SB.kullanici();
      const son = await DB.Meta.get('son_senkron');
      el.innerHTML = `
        <div class="ayar-baslik">Bulut senkron</div>
        <div class="hesap-durum"><span class="hesap-nokta"></span> ${u ? esc(u.email) : 'Giriş yapıldı'}</div>
        <div id="senkron-durum" class="senkron-durum">${son ? 'Son senkron: ' + zamanKisa(son) : 'Henüz senkronlanmadı'}</div>
        <div class="hesap-btnlar">
          <button id="senkron-btn" class="ekle-btn ikincil">↻ Şimdi senkronla</button>
          <button id="cikis-btn" class="hesap-cikis">Çıkış</button>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="ayar-baslik">Giriş & bulut senkron</div>
        <div class="ayar-not" style="margin:6px 0 10px">Giriş yap → verilerin buluta yedeklenir ve tüm cihazlarında aynı olur.</div>
        <input id="h-email" class="hesap-input" type="email" inputmode="email" autocomplete="email" placeholder="E-posta" />
        <input id="h-sifre" class="hesap-input" type="password" autocomplete="current-password" placeholder="Şifre (en az 6 karakter)" />
        <div id="hesap-hata" class="hesap-hata gizli"></div>
        <div class="hesap-btnlar">
          <button id="giris-btn" class="ekle-btn">Giriş yap</button>
          <button id="kayit-btn" class="ekle-btn ikincil">Kayıt ol</button>
        </div>`;
    }
  }

  function hesapHata(msg) {
    const h = document.getElementById('hesap-hata');
    if (h) {
      h.textContent = msg;
      h.classList.remove('gizli');
    }
  }

  async function authDene(kayit) {
    const email = (document.getElementById('h-email').value || '').trim();
    const sifre = document.getElementById('h-sifre').value || '';
    if (!email || sifre.length < 6) return hesapHata('E-posta ve en az 6 karakter şifre gir.');
    const btn = document.getElementById(kayit ? 'kayit-btn' : 'giris-btn');
    const eski = btn.textContent;
    btn.textContent = '…';
    btn.disabled = true;
    try {
      if (kayit) await SB.kayitOl(email, sifre);
      else await SB.girisYap(email, sifre);
      if (!SB.girisliMi()) {
        hesapHata('Hesap oluştu ama giriş için e-posta onayı gerekiyor. Supabase\'de "Confirm email" kapalı olmalı.');
        btn.textContent = eski;
        btn.disabled = false;
        return;
      }
      await hesabRenderla();
      toast('Giriş yapıldı, senkronlanıyor…');
      await Sync.senkronla();
      await tumUIyenile();
      await hesabRenderla();
    } catch (err) {
      hesapHata(hataCevir(err.message));
      btn.textContent = eski;
      btn.disabled = false;
    }
  }

  async function cikisYap() {
    if (!confirm('Çıkış yapılsın mı? (Yerel verilerin bu cihazda kalır)')) return;
    SB.cikis();
    await hesabRenderla();
    toast('Çıkış yapıldı.');
  }

  async function manuelSenkron() {
    const d = await Sync.senkronla();
    if (d.durum === 'tamam') {
      await tumUIyenile();
      await hesabRenderla();
    } else if (d.durum === 'hata') {
      toast('Senkron hatası: ' + hataCevir(d.hata));
    }
  }

  async function tumUIyenile() {
    if (global.Nutrition) await Nutrition.yenile();
    if (document.getElementById('sayfa-antrenman').classList.contains('aktif'))
      Workout.baslat(document.getElementById('sayfa-antrenman'));
  }

  function hesapOlaylari() {
    document.getElementById('hesap-kart').addEventListener('click', (e) => {
      if (e.target.closest('#giris-btn')) return authDene(false);
      if (e.target.closest('#kayit-btn')) return authDene(true);
      if (e.target.closest('#cikis-btn')) return cikisYap();
      if (e.target.closest('#senkron-btn')) return manuelSenkron();
    });
    // Senkron durum bildirimleri
    Sync.dinle((durum, veri) => {
      const el = document.getElementById('senkron-durum');
      if (el) {
        if (durum === 'basladi') el.textContent = 'Senkronlanıyor…';
        else if (durum === 'tamam')
          el.textContent = 'Son senkron: az önce' + (veri.degisti ? ` · ${veri.degisti} değişiklik` : '');
        else if (durum === 'gonderildi') el.textContent = 'Değişiklikler gönderildi';
        else if (durum === 'hata') el.textContent = 'Senkron hatası (tekrar denenecek)';
      }
      if (durum === 'tamam' && veri.degisti > 0) tumUIyenile();
    });
  }

  function senkronBaslat() {
    if (!Sync.aktif()) return;
    Sync.senkronla().then(async (d) => {
      if (d.durum === 'tamam') {
        await tumUIyenile();
        await hesabRenderla();
      }
    });
    // Bekleyen değişiklikleri periyodik gönder + sekmeye dönünce tam senkron
    setInterval(() => {
      if (Sync.aktif() && navigator.onLine) Sync.push().catch(() => {});
    }, 8000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Sync.aktif() && navigator.onLine) manuelSenkron();
    });
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
      await hesabRenderla();
      hesapOlaylari();

      // Sekme navigasyonu
      document.querySelectorAll('.nav-btn').forEach((b) =>
        b.addEventListener('click', () => sekmeGoster(b.dataset.sekme))
      );

      document.getElementById('yukleniyor').classList.add('gizli');

      // Giriş yapılıysa açılışta senkronla + periyodik push
      senkronBaslat();
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
