// supabase.js — Küçük Supabase istemcisi (SDK yok, sade fetch).
// Auth (kayıt/giriş/token yenileme) + REST (PostgREST upsert/okuma). Vanilla,
// bağımlılıksız — offline-first ve GitHub Pages'e uygun. config.js'ten URL+anon key.

(function (global) {
  'use strict';

  const cfg = global.APP_CONFIG || {};
  const URL = (cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  const KEY = cfg.SUPABASE_ANON_KEY || '';
  const AKTIF = !!(URL && KEY);
  const SKEY = 'sb_session';

  let session = null; // {access_token, refresh_token, user, expires_at?}
  try {
    session = JSON.parse(localStorage.getItem(SKEY) || 'null');
  } catch {
    session = null;
  }
  function sessionKaydet(s) {
    session = s || null;
    if (s) localStorage.setItem(SKEY, JSON.stringify(s));
    else localStorage.removeItem(SKEY);
  }

  function girisliMi() {
    return !!(session && session.access_token);
  }
  function kullanici() {
    return session ? session.user : null;
  }
  function token() {
    return session ? session.access_token : KEY;
  }

  // ---- Auth ----
  async function authPost(path, body, grant) {
    const url = URL + '/auth/v1/' + path + (grant ? '?grant_type=' + grant : '');
    const r = await fetch(url, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
      throw new Error(data.error_description || data.msg || data.error || data.message || 'HTTP ' + r.status);
    return data;
  }

  async function kayitOl(email, password) {
    const d = await authPost('signup', { email, password });
    // E-posta onayı kapalıysa signup doğrudan session döndürür.
    if (d.access_token) sessionKaydet(d);
    return d;
  }
  async function girisYap(email, password) {
    const d = await authPost('token', { email, password }, 'password');
    sessionKaydet(d);
    return d;
  }
  async function tokenYenile() {
    if (!session || !session.refresh_token) return null;
    try {
      const d = await authPost('token', { refresh_token: session.refresh_token }, 'refresh_token');
      sessionKaydet(d);
      return d;
    } catch (e) {
      sessionKaydet(null); // refresh geçersiz → çıkış
      return null;
    }
  }
  function cikis() {
    sessionKaydet(null);
  }

  // ---- REST (PostgREST) ----
  function restBaslik(ekstra) {
    return {
      apikey: KEY,
      Authorization: 'Bearer ' + token(),
      'Content-Type': 'application/json',
      ...(ekstra || {})
    };
  }
  // 401'de bir kez token yenileyip tekrar dener.
  async function restFetch(url, opts) {
    let r = await fetch(url, opts);
    if (r.status === 401 && session) {
      const y = await tokenYenile();
      if (y) {
        opts.headers = { ...opts.headers, Authorization: 'Bearer ' + token() };
        r = await fetch(url, opts);
      }
    }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('REST ' + r.status + ': ' + t.slice(0, 300));
    }
    return r;
  }

  // rows: nesne dizisi. onConflict: birincil anahtar sütun(lar)ı ("id" veya "user_id,id")
  async function upsert(tablo, rows, onConflict) {
    if (!rows || !rows.length) return;
    let url = URL + '/rest/v1/' + tablo;
    if (onConflict) url += '?on_conflict=' + encodeURIComponent(onConflict);
    await restFetch(url, {
      method: 'POST',
      headers: restBaslik({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows)
    });
  }

  // Verilen zamandan sonra değişen satırları çeker (RLS ile sadece kendi verisi).
  async function degisenler(tablo, sinceISO) {
    let url = URL + '/rest/v1/' + tablo + '?select=*&order=updated_at.asc';
    if (sinceISO) url += '&updated_at=gt.' + encodeURIComponent(sinceISO);
    const r = await restFetch(url, { headers: restBaslik() });
    return r.json();
  }

  global.SB = {
    AKTIF,
    URL,
    girisliMi,
    kullanici,
    kayitOl,
    girisYap,
    tokenYenile,
    cikis,
    upsert,
    degisenler
  };
})(window);
