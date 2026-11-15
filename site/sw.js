// Service worker: makes the app start instantly and work without a connection.
//
//  - The shell (html, js, css, data.json – about 70 kB compressed) is stored as a whole on
//    install. When anything changes, sw.js gets a new version, the browser fetches
//    a new shell in the background and it is used from the next start.
//  - Images are stored the first time they are shown. File names contain a hash,
//    so they never change.
//  - Map tiles are stored as the user looks at the map.
//
// The version and the file list below are filled in by build.mjs.

const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const SHELL_CACHE = 'shell-' + VERSION;
const IMAGE_CACHE = 'images';
const TILE_CACHE = 'tiles';
const MAX_TILES = 3000;

// The preview site lives in a subfolder and must always be fresh, so leave it alone.
const PREVIEW_PATH = new URL('preview/', self.registration.scope).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      // cache: 'reload' bypasses the browser's HTTP cache so we are sure to get the latest files
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(cleanUp().then(() => self.clients.claim()));
});

// Removes old shells and images that are no longer used.
async function cleanUp() {
  for (const key of await caches.keys()) {
    if (key.startsWith('shell-') && key !== SHELL_CACHE) await caches.delete(key);
  }
  const res = await (await caches.open(SHELL_CACHE)).match('data.json');
  if (!res) return;
  const data = await res.json();
  const keep = new Set(data.places.flatMap((p) => [...p.images, p.markerImage].filter(Boolean).flatMap((img) =>
    img.widths.map((w) => new URL(`${img.base}-${w}.webp`, self.registration.scope).href))));
  const cache = await caches.open(IMAGE_CACHE);
  for (const req of await cache.keys()) {
    if (!keep.has(req.url)) await cache.delete(req);
  }
}

// Answers from the cache if the file is there, otherwise fetches and stores it.
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const stored = await cache.match(req);
  if (stored) return stored;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// Keeps the tile cache at MAX_TILES at most by deleting the oldest ones.
// The browser stops and restarts the service worker all the time (it only lives while
// there is work to do), so trimming once per start is often enough.
let tilesTrimmed = false;
async function trimTilesOnce() {
  if (tilesTrimmed) return;
  tilesTrimmed = true;
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys(); // oldest first
  const excess = keys.length - MAX_TILES;
  for (const key of keys.slice(0, Math.max(0, excess))) await cache.delete(key);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith(PREVIEW_PATH)) return;
    if (url.pathname.includes('/img/')) {
      e.respondWith(cacheFirst(req, IMAGE_CACHE));
    } else {
      e.respondWith(
        caches.open(SHELL_CACHE)
          .then((c) => c.match(req, { ignoreSearch: true }))
          .then((stored) => stored || fetch(req))
      );
    }
  } else if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(cacheFirst(req, TILE_CACHE));
    e.waitUntil(trimTilesOnce());
  }
});
