// Cache only the public app shell. Supabase responses contain private farm data and
// must always be fetched with the current user's authenticated session.
const V = 'agrolineage-v2';
const SHELL = ['./', 'index.html', 'src/css/style.css', 'src/js/config.js', 'src/js/app.js', 'src/js/access.js', 'src/js/core.js', 'manifest.webmanifest', 'src/icon.svg',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(V).then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => 0)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== V).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request=event.request, url=new URL(request.url);
  if(request.method!=='GET'||url.hostname.endsWith('.supabase.co'))return;
  if(url.hostname.endsWith('googleapis.com')||url.hostname.endsWith('google.com')||url.hostname.endsWith('gstatic.com'))return;
  event.respondWith(fetch(request).then(response=>{
    if(response.ok)caches.open(V).then(cache=>cache.put(request,response.clone()));
    return response;
  }).catch(()=>caches.match(request).then(cached=>cached||caches.match('index.html'))));
});
