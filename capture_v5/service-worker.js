/**
 * Service Worker for Stratux PWA Apps
 * Provides offline caching for the engine monitor and fuel planner
 */

const CACHE_NAME = 'stratux-app-v1';

// Core files required for offline operation
const CORE_ASSETS = [
    './',
    './index.html',
    './fuel-planner.html',
    './fuel-planner.js',
    './fuel-planner.css',
    './manifest.json',
    './engine-monitor-manifest.json',
    './static/chart.min.js',
    './help'
];

// Install event - cache core assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                // Cache core assets - fail if any are missing
                return cache.addAll(CORE_ASSETS);
            })
            .then(() => self.skipWaiting())
            .catch(err => {
                console.error('Service worker install failed:', err);
                // Still skip waiting so we can try again
                return self.skipWaiting();
            })
    );
});

// Activate event - clean up old caches and claim clients
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// Fetch event - cache-first for static assets, network-first for API
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Only handle same-origin requests
    if (url.origin !== location.origin) {
        return;
    }

    // Network-first for API calls
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Cache successful API responses
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, clone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Return cached API response if available
                    return caches.match(event.request);
                })
        );
        return;
    }

    // Cache-first for static assets
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }

                // Not in cache, try network
                return fetch(event.request)
                    .then(networkResponse => {
                        // Cache successful responses
                        if (networkResponse.ok) {
                            const clone = networkResponse.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(event.request, clone);
                            });
                        }
                        return networkResponse;
                    })
                    .catch(() => {
                        // Offline and not cached - return cached version of the requested page
                        if (event.request.mode === 'navigate') {
                            // Try to match the specific page, fall back to root
                            if (url.pathname.includes('fuel-planner')) {
                                return caches.match('./fuel-planner.html');
                            }
                            return caches.match('./');
                        }
                        // Return empty response for other requests
                        return new Response('', { status: 503, statusText: 'Offline' });
                    });
            })
    );
});
