const CACHE_NAME = 'loud-brands-v6';
const RUNTIME_CACHE = 'loud-brands-runtime-v6';

// Assets to cache immediately on install
const STATIC_ASSETS = [
  '/',
  '/loud-styles',
  '/offline',
  '/logo-mini.png',
  '/loud-brands-logo.png',
  '/manifest.json',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.log('Cache install failed:', err);
      });
    })
  );
  self.skipWaiting(); // Activate immediately
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  return self.clients.claim(); // Take control immediately
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Allow Cloudinary, Backend API, and your own origin
  const allowedOrigins = [
    self.location.origin,
    'https://res.cloudinary.com',
    'https://loudbrands-backend-eu-abfa65dd1df6.herokuapp.com'
  ];

  if (!allowedOrigins.includes(url.origin)) {
    return;
  }

  // Products and categories APIs: never cache so images/URLs are always fresh (avoids grey images on first load)
  if (url.pathname.startsWith('/api/products') || url.pathname.startsWith('/api/categories')) {
    event.respondWith(fetch(request));
    return;
  }

  // Other API routes: Network First with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseToCache = response.clone();
          if (response.status === 200 && response.status !== 206) {
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, responseToCache).catch((err) => console.warn('Cache put failed:', err));
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            return new Response(
              JSON.stringify({ error: 'Offline', cached: true }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
    return;
  }

  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/images/') ||
    url.pathname.startsWith('/logos/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.svg')
  ) {
    // Static assets: Cache First
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then((response) => {
          // Don't cache if not successful or if partial response (206)
          if (!response || response.status !== 200 || response.status === 206) {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache).catch((err) => {
              // Silently fail if caching fails (e.g., 206 partial response)
              console.warn('Cache put failed:', err);
            });
          });

          return response;
        });
      })
    );
  } else {
    // HTML pages: Network First with cache fallback
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only cache successful, non-partial responses
          if (response && response.status === 200 && response.status !== 206) {
            const responseToCache = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, responseToCache).catch((err) => {
                // Silently fail if caching fails (e.g., 206 partial response)
                console.warn('Cache put failed:', err);
              });
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Fallback to offline page
            return caches.match('/offline');
          });
        })
    );
  }
});

// Push notification handler
self.addEventListener('push', function (event) {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: '/logo-mini.png',
      badge: '/logo-mini.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: '2',
        url: data.url || '/'
      },
      actions: [
        {
          action: 'explore',
          title: 'View Order'
        },
        {
          action: 'close',
          title: 'Close'
        },
      ]
    };
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Notification click handler
self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      const urlToOpen = event.notification.data.url;

      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
