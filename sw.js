const CACHE_NAME = 'waste-app-cache-v16';
const CORE_ASSETS = [
  '/waste/',
  '/waste/index.html',
  '/waste/?installed=1',
  '/waste/manifest.json',
  '/waste/js/html2canvas.min.js',
  '/waste/icons/icon-192.png',
  '/waste/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  // Activate new SW immediately without waiting
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache assets individually with Promise.allSettled so one missing item does not break offline storage
      return Promise.allSettled(
        CORE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Pre-caching asset failed, skipping:', url, err);
          })
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting stale cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isNavigation = event.request.mode === 'navigate' ||
                       url.pathname === '/waste/' ||
                       url.pathname === '/waste' ||
                       url.pathname.endsWith('/index.html');

  // NETWORK-FIRST for HTML / App shell navigation with bulletproof offline fallback:
  // If user is online, ALWAYS fetch the fresh HTML and update the cache so updates show immediately.
  // If offline, seamlessly fall back to cached HTML ignoring query parameters (?installed=1).
  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              // Cache across all common navigation entry points
              cache.put(event.request, responseClone);
              cache.put('/waste/', responseClone.clone());
              cache.put('/waste/index.html', responseClone.clone());
              cache.put('/waste/?installed=1', responseClone.clone());
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          // Offline fallback: try matching with ignoreSearch: true
          const cached = await caches.match(event.request, { ignoreSearch: true }) ||
                         await caches.match('/waste/index.html', { ignoreSearch: true }) ||
                         await caches.match('/waste/', { ignoreSearch: true }) ||
                         await caches.match('/waste/?installed=1');
          if (cached) return cached;

          // Search any cache as fallback
          const matchAny = await caches.match('/waste/index.html');
          if (matchAny) return matchAny;

          return new Response(
            '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Offline</title></head><body style="font-family:sans-serif;text-align:center;padding:50px;"><h2>App is Offline</h2><p>Please open the app once while connected to the internet to initialize offline storage.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // CACHE-FIRST with background revalidate for static assets (icons, scripts)
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        return null;
      });
    })
  );
});
