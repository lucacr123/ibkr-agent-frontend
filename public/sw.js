self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(clients.claim()));

self.addEventListener("push", e => {
  let data = { title: "IBKR Agent", body: "Update ready" };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "ibkr-" + Date.now(),
    renotify: true,
    vibrate: [200, 100, 200],
    data: { title: data.title, body: data.body }
  }));
});

self.addEventListener("notificationclick", e => {
  const { title, body } = e.notification.data || {};
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const msg = { type: "NOTIFICATION_CLICK", title, body };
      // Send message to open windows
      for (const c of list) {
        if (c.url.includes(self.location.origin)) {
          c.postMessage(msg);
          return c.focus();
        }
      }
      // Open new window with message in URL
      return clients.openWindow(
        self.location.origin + "?notif=" + encodeURIComponent(JSON.stringify(msg))
      );
    })
  );
});
