// sw.js — 앱 껍데기를 기기에 담아 두어, 설치한 뒤에는 연결이 없어도 열리게 한다.
// 같은 출처의 파일은 "먼저 네트워크, 안 되면 담아 둔 것"으로 받는다(새 버전이 바로 보이도록).
// 네트워크로 받을 때는 서버에 바뀌었는지 물어본다(no-cache). 새 파일과 묵은 파일이 섞여 열리는 일을 막는다.
// 저장소에 올린 사진은 이름에 판이 들어 있어 내용이 바뀌지 않는다. 한 번 받으면 담아 둔다.
// GitHub API와 기록 파일(library.json) 요청에는 끼어들지 않는다.
// 파일 목록을 바꾸면 VERSION도 함께 올린다.

const VERSION = 'dogam-v0.1.1';
const SHELL_CACHE = `${VERSION}-shell`;
const PHOTO_CACHE = 'dogam-photos';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/base.css',
  'css/views.css',
  'css/notion.css',
  'js/app.js',
  'js/config.js',
  'js/dom.js',
  'js/db.js',
  'js/store.js',
  'js/sync.js',
  'js/photos.js',
  'js/seed.js',
  'js/me-data.js',
  'js/me.js',
  'js/reading.js',
  'js/review.js',
  'js/history.js',
  'js/analyze.js',
  'js/insight.js',
  'js/settings.js',
  'fonts/PretendardVariable.subset.woff2',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE)
    .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== PHOTO_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await withTimeout(fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' }), 3500);
    if (fresh && fresh.ok && fresh.type === 'basic') cache.put(request.url, fresh.clone());
    return fresh;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const page = await cache.match('index.html');
      if (page) return page;
    }
    return Response.error();
  }
}

// 사진: 담아 둔 것이 있으면 그것을 준다. 내용을 읽을 수 있는 응답(CORS)만 담는다.
// 같은 자리(책·사진 칸)의 옛 판은 새 판을 담을 때 치운다.
async function cacheFirstPhoto(request) {
  const cache = await caches.open(PHOTO_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok && res.type === 'cors') {
    const slot = request.url.replace(/-\d+\.jpg$/, '-');
    cache.put(request.url, res.clone()).then(async () => {
      for (const key of await cache.keys()) {
        if (key.url !== request.url && key.url.startsWith(slot)) cache.delete(key);
      }
    }).catch(() => { /* 담지 못해도 사진은 보인다 */ });
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'raw.githubusercontent.com' && /\/photos\/[^/]+\/[a-z]+-\d+\.jpg$/.test(url.pathname)) {
    event.respondWith(cacheFirstPhoto(request));
  }
});
