const CACHE_PREFIX = 'domacnost-plus-';
const CACHE_NAME = `${CACHE_PREFIX}v0-1-495`;
const APP_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './icon-assets.css',
  './module-loader.js',
  './supabase.js',
  './utils.js',
  './weather.js',
  './pwa.js',
  './app.js',
  './sw.js',
  './manifest.webmanifest',
  './icons/favicon.ico',
  './icons/apple-touch-icon.png',
  './icons/apple-touch-icon-precomposed.png',
  './icons/domacnost-plus-icon-16.png',
  './icons/domacnost-plus-icon-32.png',
  './icons/domacnost-plus-icon-120.png',
  './icons/domacnost-plus-icon-152.png',
  './icons/domacnost-plus-icon-167.png',
  './icons/domacnost-plus-icon-180.png',
  './icons/domacnost-plus-icon-192.png',
  './icons/domacnost-plus-icon-384.png',
  './icons/domacnost-plus-icon-512.png',
  './icons/domacnost-plus-maskable-192.png',
  './icons/domacnost-plus-maskable-512.png'
];

// Tyto soubory se nestahují při instalaci. Cache-first se stanou až po
// prvním otevření modulu, takže další návštěva funguje i offline.
const LAZY_APP_ASSETS = [
  './shopping.css',
  './shopping-utils.js',
  './shopping-render.js',
  './shopping-actions.js',
  './notes.js',
  './warranty.js',
  './hdo.js',
  './waste.js',
  './finance.js',
  './pool.js',
  './vape.js',
  './contracts.js',
  './subscriptions.js',
  './calendar.js'
];

const CORE_FALLBACKS = {
  '/index.html': './index.html',
  '/app.js': './app.js',
  '/styles.css': './styles.css',
  '/sw.js': './sw.js',
  '/icon-assets.css': './icon-assets.css',
  '/module-loader.js': './module-loader.js',
  '/shopping.css': './shopping.css',
  '/utils.js': './utils.js',
  '/shopping-utils.js': './shopping-utils.js',
  '/shopping-render.js': './shopping-render.js',
  '/shopping-actions.js': './shopping-actions.js'
};

const RUNTIME_CACHE_PATHS = [
  '/icons/icon-themes/',
  '/icons/module-icons/'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) await existing.navigate(targetUrl);
        return existing;
      }
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('activate', (event) => {
  // Prefix filter — smažeme jen NAŠE zastaralé cache klíče. Cizí cache
  // z jiných PWA na stejném originu (např. jiná appka nasazená na
  // stejném Vercel účtu / testovací příklady) musí zůstat nedotčené.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function cacheNetworkResponse(request, response) {
  if (!response || response.status >= 400) return response;
  const clone = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
  return response;
}

function matchCached(request, fallbackKey) {
  return caches.match(request, { ignoreSearch: true }).then((cached) => cached || (fallbackKey ? caches.match(fallbackKey) : null));
}

function isRuntimeStaticAsset(pathname) {
  return RUNTIME_CACHE_PATHS.some((prefix) => pathname.includes(prefix));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== location.origin) return;
  // Lokální vývoj: žádné SW cachování, jinak by cache-first start skrýval
  // čerstvě uložené soubory až do další instalace service workeru.
  if (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1') return;

  const isManifest = requestUrl.pathname.endsWith('/manifest.webmanifest');
  const isInstallIcon = requestUrl.pathname.includes('/icons/') && /apple-touch-icon|favicon|domacnost-plus-icon|maskable/.test(requestUrl.pathname);

  if (isManifest || isInstallIcon) {
    event.respondWith(
      fetch(event.request)
        .then((response) => cacheNetworkResponse(event.request, response))
        .catch(() => matchCached(event.request, null))
    );
    return;
  }

  const isNavigation = event.request.mode === 'navigate' || requestUrl.pathname.endsWith('/');
  const lazyAssetPath = `.${requestUrl.pathname}`;
  const isCoreAppFile = /\/(index\.html|app\.js|module-loader\.js|styles\.css|icon-assets\.css|sw\.js)$/.test(requestUrl.pathname)
    || LAZY_APP_ASSETS.includes(lazyAssetPath);

  // Start appky je cache-first: síť dřív blokovala každé spuštění (na mobilu
  // klidně několik vteřin, než dorazil index.html + app.js + styles.css), i
  // když byla kompletní aktuální verze předcachovaná. Nové verze se dál
  // dostávají ke slovu přes update service workeru (nový CACHE_NAME se při
  // instalaci předcachuje celý najednou a po "Aktualizovat" se atomicky
  // přepne) - takže cache-first nemíchá soubory dvou verzí.
  if (isNavigation) {
    event.respondWith(
      matchCached(event.request, './index.html').then((cached) =>
        cached || fetch(event.request).then((response) => cacheNetworkResponse(event.request, response))
      )
    );
    return;
  }

  if (isCoreAppFile) {
    const fallbackKey = CORE_FALLBACKS[requestUrl.pathname] || `.${requestUrl.pathname}`;
    event.respondWith(
      matchCached(event.request, fallbackKey).then((cached) =>
        cached || fetch(event.request).then((response) => cacheNetworkResponse(event.request, response))
      )
    );
    return;
  }

  if (isRuntimeStaticAsset(requestUrl.pathname)) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => cacheNetworkResponse(event.request, response));
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || fetch(event.request))
  );
});
