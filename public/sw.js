// IBKR Agent Service Worker v2
// Handles push notifications in background

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(clients.claim()));

self.addEventListener("push", e => {
  let data = { title: "IBKR Agent", body: "New update", icon: "📈" };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch {}

  const options = {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "ibkr-" + (data.data?.type || "general"),
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [200, 100, 200],
    data: data.data || {},
    timestamp: data.timestamp || Date.now(),
  };

  console.log("[SW] Push received:", data.title, data.body);
  e.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", e => {
  console.log("[SW] Notification clicked:", e.notification.tag);
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && "focus" in c) return c.focus();
      }
      return clients.openWindow("/");
    })
  );
});
