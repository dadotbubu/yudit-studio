const CACHE_VERSION = 'v11';
const CACHE_NAME = `yudit-studio-${CACHE_VERSION}`;

// 캐시할 파일 목록
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './tailwind.css'
];

// 설치 시 캐시
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // 즉시 활성화
});

// 활성화 시 이전 캐시 삭제
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim(); // 즉시 제어
});

// 네트워크 우선, 실패 시 캐시
self.addEventListener('fetch', (e) => {
  // Supabase API는 항상 네트워크
  if (e.request.url.includes('supabase')) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // 성공하면 캐시 업데이트
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request)) // 실패 시 캐시
  );
});
