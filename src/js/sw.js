// Offline support: caches the app shell and the CDN libraries so the app opens without internet.
const V = 'agrolineage-v1';
const SHELL = ['./', 'index.html', 'src/css/style.css', 'src/js/config.js', 'src/js/app.js', 'manifest.webmanifest', 'src/icon.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => 0)))).then(() => self.skipWaiting())) });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())) });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('google.com') || u.hostname.endsWith('gstatic.com')) return; // never cache Google API / sign-in
  e.respondWith(fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(V).then(x => x.put(r, c)) } return res })
    .catch(() => caches.match(r).then(m => m || caches.match('index.html'))));
});
