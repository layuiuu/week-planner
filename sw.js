// Service Worker:缓存应用外壳,让「添加到主屏幕」后能离线打开。
// 数据本来就在本地,离线也能完整使用(导入/导出文件也不依赖网络)。

const CACHE = 'weekplanner-v3';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/ui.js',
  './js/store.js',
  './js/dates.js',
  './js/blocks.js',
  './js/parse.js',
  './js/xlsx-lite.js',
  './js/importers.js',
  './js/sample.js',
  './js/views/calendar.js',
  './js/views/board.js',
  './js/views/review.js',
  './js/views/settings.js',
  './js/views/editors.js',
  './js/views/importPreview.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('预缓存失败(不影响使用)', err)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 联网优先,而且明确要求「向后端校验」而不是吃浏览器 HTTP 缓存:
  // GitHub Pages 给静态文件设了 Cache-Control: max-age=600,如果直接用缓存,
  // 网页更新后最长 10 分钟你还看到旧版。带 ETag 校验时没变就返回 304,几乎不额外花流量。
  // 没网时回退到缓存,所以加进主屏幕后离线照样能用。
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return new Response('离线,且这个文件没有缓存', { status: 503, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
      }),
  );
});
