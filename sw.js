// sw.js — Offline-first service worker.
// Strateji:
//   - Uygulama kabuğu (HTML/CSS/JS/CSV/vendor) install'da önbelleğe alınır.
//   - Gezinme (navigation) istekleri: cache-first, ağ yedeği (offline'da açılır).
//   - Diğer GET istekleri: cache-first, ağdan gelince önbelleği güncelle.
// Sürüm artınca (CACHE) eski önbellek temizlenir.

const CACHE = 'saglik-takip-v4';

// GitHub Pages alt yolunda (ör. /repo/) çalışsın diye göreli yollar.
const KABUK = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './vendor/dexie.min.js',
  './js/search.js',
  './js/db.js',
  './js/sync.js',
  './js/seed.js',
  './js/offsearch.js',
  './js/nutrition.js',
  './js/workout.js',
  './js/app.js',
  './data/foods.csv',
  './data/exercises.csv',
  './icons/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(KABUK)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((anahtarlar) =>
        Promise.all(anahtarlar.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Gezinme istekleri: önce cache (index.html), yoksa ağ.
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html').then((c) => c || fetch(req))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((c) => {
      if (c) {
        // Arka planda tazele (stale-while-revalidate hafif sürüm).
        fetch(req)
          .then((yanit) => {
            if (yanit && yanit.status === 200)
              caches.open(CACHE).then((cache) => cache.put(req, yanit.clone()));
          })
          .catch(() => {});
        return c;
      }
      return fetch(req)
        .then((yanit) => {
          if (yanit && yanit.status === 200 && req.url.startsWith(self.location.origin)) {
            const kopya = yanit.clone();
            caches.open(CACHE).then((cache) => cache.put(req, kopya));
          }
          return yanit;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
