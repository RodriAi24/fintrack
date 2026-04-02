const CACHE_NAME = 'fintrack-v9';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './favicon.png'
];

// Install: pre-cache assets
self.addEventListener('install', event => {
  self.skipWaiting(); // Activate immediately, don't wait for old SW to die
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
});

// Activate: delete all old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim()) // Take control of all pages immediately
  );
});

// Fetch: NETWORK FIRST, fallback to cache
// This ensures users always get the latest version when online
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API calls (DolarApi, CoinGecko) - don't cache these
  const url = new URL(event.request.url);
  if (url.hostname !== location.hostname) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Got a fresh response from network - update cache
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        // Network failed - serve from cache (offline mode)
        return caches.match(event.request);
      })
  );
});
