// sw.js — 앱 껍데기를 기기에 담아 두어, 설치한 뒤에는 연결이 없어도 열리게 한다.
// 같은 출처의 파일은 "먼저 네트워크, 안 되면 담아 둔 것"으로 받는다(새 버전이 바로 보이도록).
// 네트워크로 받을 때는 서버에 바뀌었는지 물어본다(no-cache). 새 파일과 묵은 파일이 섞여 열리는 일을 막는다.
// 저장소에 올린 사진은 이름에 판이 들어 있어 내용이 바뀌지 않는다. 한 번 받으면 담아 둔다.
// GitHub API와 기록 파일(library.json) 요청에는 끼어들지 않는다.
// 파일 목록을 바꾸면 VERSION도 함께 올린다.

const VERSION = 'v0.2.1';
// 캐시 이름에는 이 앱이 놓인 경로를 넣는다. 같은 주소(<owner>.github.io) 아래의 다른 페이지나
// 이 앱의 다른 사본이 담아 둔 것을 건드리지 않으려는 것이다.
const NS = `dogam${new URL(self.registration.scope).pathname.replace(/[^a-z0-9]+/gi, '-')}`;
const SHELL_CACHE = `${NS}${VERSION}-shell`;
const PHOTO_CACHE = `${NS}photos`;
const LEGACY = /^dogam-(v0\.1\.\d+-shell|photos)$/;       // 0.1.x가 쓰던 이름(경로가 들어가기 전). 이 앱의 것이라 치운다
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
    // 이 앱의 옛 판만 치운다. 이름이 다른 캐시는 남의 것이므로 그대로 둔다.
    .then((keys) => Promise.all(keys.filter((k) => (k.startsWith(NS) || LEGACY.test(k)) && k !== SHELL_CACHE && k !== PHOTO_CACHE).map((k) => caches.delete(k))))
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
  const key = request.url.split('#')[0].split('?')[0];          // 물음표 뒤가 달라도 같은 파일로 담는다(끝없이 쌓이지 않게)
  const stored = async () => (await cache.match(key)) || (request.mode === 'navigate' ? cache.match(new URL('index.html', self.registration.scope).href) : undefined);
  try {
    const fresh = await withTimeout(fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' }), 3500);
    if (fresh && fresh.ok && fresh.type === 'basic') { cache.put(key, fresh.clone()); return fresh; }
    // 서버가 잠깐 오류(5xx)나 없음(404)을 답해도, 담아 둔 것이 있으면 그것을 준다(배포 직후의 빈틈).
    return (await stored()) || fresh;
  } catch {
    return (await stored()) || Response.error();
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
