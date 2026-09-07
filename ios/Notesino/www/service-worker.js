/* Notesino service worker: makes the app installable and usable offline.
   Everything the app needs (markup/CSS/JS) lives in one index.html file
   with no build step, so the "app shell" here is just that file plus its
   manifest and icons. Strategy is stale-while-revalidate for every GET
   request: serve from cache immediately when available (so it works with
   no network at all), while a fresh copy is fetched in the background and
   cached for next time. Bump CACHE_NAME whenever the shell list below
   changes, so old caches get cleaned up on activate. */
var CACHE_NAME = 'notesino-cache-v2';
var SHELL_URL = 'index.html';
var APP_SHELL = [
  SHELL_URL,
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      /* Fetched one at a time (not Promise.all/cache.addAll) with the
         HTTP cache bypassed -- a burst of simultaneous requests has been
         observed to hand back a truncated body from at least one simple
         static server, which would otherwise get baked into the cache
         and served on every future load. Sequential + no-cache avoids
         that regardless of which server ends up hosting this. */
      return APP_SHELL.reduce(function(chain, url) {
        return chain.then(function() {
          return fetch(url, { cache: 'reload' })
            .then(function(response) { if (response && response.ok) return cache.put(url, response); })
            .catch(function() {});
        });
      }, Promise.resolve());
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); }));
      })
      .then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  /* Navigations may arrive as "/" or "/index.html" depending on how the
     app was launched (typed URL, home-screen icon, a bookmark) -- treat
     both as the same single shell cache entry instead of double-caching
     identical content under two keys. */
  var isNavigation = event.request.mode === 'navigate';
  var cacheKey = isNavigation ? SHELL_URL : event.request;

  event.respondWith(
    caches.match(cacheKey).then(function(cached) {
      var networkFetch = fetch(event.request).then(function(response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(cacheKey, copy); });
        }
        return response;
      }).catch(function() { return cached; });
      return cached || networkFetch;
    })
  );
});
