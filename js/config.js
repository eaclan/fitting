// config.js — Supabase bağlantı bilgileri.
// Bu değerler BOŞ olduğu sürece uygulama tamamen yerel/offline çalışır (senkron kapalı).
// Supabase projeni açınca aşağıyı doldur → bulut senkron + giriş devreye girer.
//
// Anon (public) key TARAYICIDA görünür olması NORMALDİR — Supabase bu amaçla verir;
// veriler Row Level Security (RLS) ile korunur. Panelde: Settings → API'den al.

window.APP_CONFIG = {
  SUPABASE_URL: 'https://imevemtssomjldgfiwug.supabase.co',
  // Yeni tür "publishable" key — public olması tasarım gereği (RLS korur).
  SUPABASE_ANON_KEY: 'sb_publishable_3v3h-QSfdwJST3qZFw9NaA_dorkmnkA'
};
