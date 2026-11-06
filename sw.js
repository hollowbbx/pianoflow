// PianoFlow · Service worker: hace que la app abra y funcione sin internet (y sin el servidor local).
// - Archivos de la app: primero la red (para recibir actualizaciones); si no hay, la copia guardada.
// - Sonidos del piano real: se guardan la primera vez y después salen de la copia.
const APP_CACHE = 'pianoflow-app-v7';
const SOUND_CACHE = 'pianoflow-sounds-v1';
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'audio.js',
  'midi-parser.js',
  'songs.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('pianoflow-app-') && k !== APP_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(
      // no-cache: siempre pregunta si hay versión nueva (sin internet, usa la copia)
      fetch(req, { cache: 'no-cache' })
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(APP_CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./')))
    );
    return;
  }

  if (url.hostname === 'tonejs.github.io' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(SOUND_CACHE).then(c =>
        c.match(req).then(
          hit =>
            hit ||
            fetch(req).then(res => {
              if (res.ok) c.put(req, res.clone());
              return res;
            })
        )
      )
    );
  }
});
