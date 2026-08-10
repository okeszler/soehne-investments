self.addEventListener('push', (event) => {
  let data = { title: 'Dein Kapital', body: 'Du hast eine neue Nachricht.' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // ignore, use defaults
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
