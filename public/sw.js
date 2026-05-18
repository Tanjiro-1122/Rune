// Jarvis Service Worker v1
// Handles push notifications and basic offline caching

const CACHE_NAME = 'jarvis-v1';
const OFFLINE_URL = '/';

// Install — cache the shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  // Don't cache API calls
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((r) => r || caches.match(OFFLINE_URL))
    )
  );
});

// Push notification received
self.addEventListener('push', (event) => {
  let data = { title: 'Jarvis', body: 'You have a new briefing.', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'jarvis-briefing',
      renotify: true,
      data: { url: data.url || '/' },
    })
  );
});

// Notification click — open Jarvis
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
