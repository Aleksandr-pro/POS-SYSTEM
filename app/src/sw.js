/* POS Контроль — service worker: офлайн-кеш оболочки приложения (в т.ч. для iOS) */
var CACHE_NAME = 'pos-kontrol-v3.4.12';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './xlsx.js',
  './import-data.js',
  './core.js',
  './api.js',
  './ui.js',
  './pages-auth.js',
  './pages-dashboard.js',
  './pages-cash.js',
  './pages-products.js',
  './pages-stock.js',
  './pages-points.js',
  './pages-time.js',
  './pages-analytics.js',
  './pages-manual.js',
  './pages-changes.js',
  './pages-help.js',
  './pages-settings.js',
  './main.js',
  './sw.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

/** Основные файлы приложения: для них важна свежесть при обновлении */
var CORE = /\.(js|css|html)$/i;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // кешируем по одному, чтобы один сбой не оставил приложение без офлайна
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(url).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // переходы по приложению: сначала сеть, при обрыве — кеш (важно, чтобы обновления приходили)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put('./index.html', copy).catch(function () {}); });
        return response;
      }).catch(function () {
        return caches.match('./index.html').then(function (cached) {
          return cached || new Response('Нет сети. Откройте приложение, когда связь появится.', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
    );
    return;
  }

  // статика: сначала кеш, затем сеть с докешированием
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) {
        if (CORE.test(url.pathname)) {
          // фоном обновляем, чтобы новая версия подхватилась без потери офлайна
          fetch(request).then(function (response) {
            if (response && response.status === 200) {
              caches.open(CACHE_NAME).then(function (cache) { cache.put(request, response.clone()).catch(function () {}); });
            }
          }).catch(function () {});
        }
        return cached;
      }
      return fetch(request).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy).catch(function () { /* quota */ });
          });
        }
        return response;
      }).catch(function () {
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
