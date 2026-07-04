const CACHE_NAME = 'passintel-ai-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((response) => {
        // Check if we received a valid response
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        
        // Cache the newly fetched asset dynamically (only for GET requests of app origin or common fonts)
        const isGet = e.request.method === 'GET';
        const isSameOrigin = e.request.url.startsWith(self.location.origin);
        const isGoogleFont = e.request.url.includes('fonts.googleapis.com') || e.request.url.includes('fonts.gstatic.com');
        
        if (isGet && (isSameOrigin || isGoogleFont)) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return response;
      }).catch(() => {
        // Offline fallback if request fails (e.g. navigation)
        if (e.request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});
