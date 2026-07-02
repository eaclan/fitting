// sync.js — Senkron katmanı (Hafta 1: no-op placeholder).
// İleride Supabase eklendiğinde SADECE bu dosya değişecek. UI ve db.js aynı kalır.
//
// Tasarım: offline-first. Yerel IndexedDB her zaman doğruluk kaynağıdır (source of
// truth). Senkron "eventual consistency" mantığıyla arka planda çalışır:
//   push(): synced=0 olan kayıtları (updated_at damgalı) uzak sunucuya gönderir.
//   pull(): son senkron zamanından sonra değişen uzak kayıtları çeker, updated_at
//           karşılaştırıp (last-write-wins) yerelde birleştirir.
// Soft-delete (deleted=1) sayesinde silmeler de senkronlanabilir.

(function (global) {
  'use strict';

  const adapter = {
    ad: 'none',
    async push() {
      /* Supabase geldiğinde: db.food_logs.where('synced').equals(0) ... upsert */
    },
    async pull() {
      /* Supabase geldiğinde: son senkron sonrası değişenleri çek, merge et */
    },
    aktif() {
      return false;
    }
  };

  async function senkronla() {
    if (!adapter.aktif()) return { durum: 'kapali' };
    await adapter.push();
    await adapter.pull();
    await DB.Meta.set('son_senkron', DB.nowISO());
    return { durum: 'tamam' };
  }

  // Supabase adapter'ı ileride buradan takılacak:
  //   Sync.adapterAyarla(new SupabaseAdapter(url, key))
  function adapterAyarla(yeni) {
    global.Sync._adapter = yeni;
  }

  global.Sync = { _adapter: adapter, senkronla, adapterAyarla };
})(window);
