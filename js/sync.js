// sync.js — Supabase senkron motoru (offline-first, last-write-wins).
// Yerel IndexedDB doğruluk kaynağıdır. push(): synced=0 satırları buluta gönderir.
// pull(): buluttaki satırları çekip updated_at'e göre birleştirir. Çakışmada son
// yazan kazanır. Silmeler deleted=1 ile senkronlanır. Config/oturum yoksa no-op.

(function (global) {
  'use strict';

  function aktif() {
    return !!(global.SB && SB.AKTIF && SB.girisliMi());
  }

  async function push() {
    if (!aktif()) return;
    const u = SB.kullanici();
    if (!u) return;
    const uid = u.id;
    for (const t of DB.Senkron.tanimlar) {
      const bekleyen = await DB.Senkron.bekleyenler(t);
      if (!bekleyen.length) continue;
      const rows = DB.Senkron.disariAktar(t, bekleyen, uid);
      await SB.upsert(t.uzak, rows, t.pk);
      await DB.Senkron.isaretle(t, bekleyen.map((r) => r.id));
    }
    // ayarlar (tek satır)
    const ayar = await DB.Settings.rawGet();
    if (ayar && ayar.synced === 0) {
      await SB.upsert(
        'user_settings',
        [
          {
            user_id: uid,
            kalori_hedefi: ayar.value.kalori_hedefi,
            makro_oranlari: ayar.value.makro_oranlari,
            updated_at: ayar.updated_at
          }
        ],
        'user_id'
      );
      await DB.Settings.isaretle();
    }
  }

  async function pull() {
    if (!aktif()) return 0;
    let degisti = 0;
    for (const t of DB.Senkron.tanimlar) {
      const uzak = await SB.degisenler(t.uzak);
      degisti += await DB.Senkron.iceriAl(t, uzak);
    }
    const uzakAyar = await SB.degisenler('user_settings');
    if (uzakAyar && uzakAyar.length) {
      const a = uzakAyar[0];
      const uygulandi = await DB.Settings.uzaktanUygula(
        { kalori_hedefi: a.kalori_hedefi, makro_oranlari: a.makro_oranlari },
        a.updated_at
      );
      if (uygulandi) degisti++;
    }
    return degisti;
  }

  let calisiyor = false;
  // Tam senkron: önce gönder, sonra çek. Dönüş: {durum, degisti?}
  async function senkronla() {
    if (!aktif()) return { durum: 'kapali' };
    if (calisiyor) return { durum: 'mesgul' };
    calisiyor = true;
    uyar('basladi');
    try {
      await push();
      const degisti = await pull();
      await DB.Meta.set('son_senkron', DB.nowISO());
      uyar('tamam', { degisti });
      return { durum: 'tamam', degisti };
    } catch (e) {
      console.error('Senkron hatası:', e);
      uyar('hata', { mesaj: e.message });
      return { durum: 'hata', hata: e.message };
    } finally {
      calisiyor = false;
    }
  }

  // Sadece gönderme (mutasyon sonrası, hafif). Ağ yoksa/kapalıysa sessiz geçer.
  let pushZaman;
  async function planla() {
    if (!aktif() || !navigator.onLine) return;
    clearTimeout(pushZaman);
    pushZaman = setTimeout(() => {
      if (aktif() && navigator.onLine) push().then(() => uyar('gonderildi')).catch(() => {});
    }, 2500);
  }

  // ---- dinleyiciler (UI durum güncellemesi) ----
  const dinleyiciler = [];
  function dinle(fn) {
    dinleyiciler.push(fn);
  }
  function uyar(durum, veri) {
    for (const f of dinleyiciler) {
      try {
        f(durum, veri || {});
      } catch {}
    }
  }

  // Çevrimiçi olunca otomatik senkron
  if (global.addEventListener) {
    global.addEventListener('online', () => {
      if (aktif()) senkronla();
    });
  }

  global.Sync = { aktif, senkronla, push, pull, planla, dinle };
})(window);
