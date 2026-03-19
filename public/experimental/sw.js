/**
 * Birdcam Motion Lab — Service Worker
 * Handles Web Push notifications for motion detection events.
 */

const CACHE_NAME = 'birdcam-motion-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

/**
 * Handle incoming push notifications from the server.
 * Payload is JSON: { title, body, icon, url }
 */
self.addEventListener('push', (event) => {
  let data = {
    title: 'Motion Detected',
    body: 'Movement detected by Birdcam.',
    icon: '/favicon.png',
    badge: '/favicon.png',
    url: '/experimental/',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch (_) {
      data.body = event.data.text() || data.body;
    }
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    tag: 'motion-alert',          // Replace previous notification
    renotify: true,               // Vibrate/sound even if replacing
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: { url: data.url },
    timestamp: Date.now(),
    actions: [
      { action: 'view', title: 'View camera' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

/**
 * Handle notification click — open or focus the experimental page.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && event.notification.data.url) || '/experimental/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If tab already open, focus it
      for (const client of windowClients) {
        if (client.url.includes('/experimental/') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new tab
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
