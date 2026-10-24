const CACHE_NAME = 'waste-app-cache-v18';
// Dynamically resolve base scope path (e.g. '/waste/' or '/waste-app/')
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/?$/, '/');

const CORE_ASSETS = [
  SCOPE_PATH,
  SCOPE_PATH + 'index.html',
  SCOPE_PATH + '?installed=1',
  SCOPE_PATH + 'manifest.json',
  SCOPE_PATH + 'js/html2canvas.min.js',
  SCOPE_PATH + 'icons/icon-192.png',
  SCOPE_PATH + 'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
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
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isNavigation = event.request.mode === 'navigate' ||
                       url.pathname === SCOPE_PATH ||
                       url.pathname === SCOPE_PATH.slice(0, -1) ||
                       url.pathname.endsWith('/index.html');

  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
              cache.put(SCOPE_PATH, responseClone.clone());
              cache.put(SCOPE_PATH + 'index.html', responseClone.clone());
              cache.put(SCOPE_PATH + '?installed=1', responseClone.clone());
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(event.request, { ignoreSearch: true }) ||
                         await caches.match(SCOPE_PATH + 'index.html', { ignoreSearch: true }) ||
                         await caches.match(SCOPE_PATH, { ignoreSearch: true }) ||
                         await caches.match(SCOPE_PATH + '?installed=1');
          if (cached) return cached;

          const matchAny = await caches.match(SCOPE_PATH + 'index.html') || await caches.match('/waste/index.html');
          if (matchAny) return matchAny;

          return new Response(
            '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Offline</title></head><body style="font-family:sans-serif;text-align:center;padding:50px;"><h2>App is Offline</h2><p>Please open the app once while connected to the internet to initialize offline storage.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // CACHE-FIRST with background revalidate for static assets
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
