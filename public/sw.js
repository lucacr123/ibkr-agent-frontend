self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(clients.claim()));
self.addEventListener("push", e => {
  let data = { title: "IBKR Agent", body: "Update ready" };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.title,
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: { url: self.location.origin }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      // Focus existing window if open
      for (const c of list) {
        if (c.url.includes(self.location.origin) && "focus" in c) {
          return c.focus();
        }
      }
      // Otherwise open fresh
      return clients.openWindow(self.location.origin);
    })
  );
});
