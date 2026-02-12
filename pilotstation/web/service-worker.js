/**
 * PilotStation — Service Worker
 * Dual-mode caching: cache-first for static, network-first for API.
 */

const CACHE_NAME = 'pilotstation-v1';

const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './manifest.json',
    './app.js',
    './mode-detector.js',
    './planning/workflow.js',
    './planning/aircraft-step.js',
    './planning/route-step.js',
    './planning/weather-step.js',
    './planning/wb-step.js',
    './planning/briefing-step.js',
    './planning/ready-step.js',
    './planning/planning.css',
    './shared/nasr-db.js',
    './shared/flight-plan-model.js',
    './shared/weather-client.js',
    './shared/wb-calculator.js',
    './shared/flight-plan-filer.js',
    './shared/sync-manager.js',
    './shared/ai-client.js',
    './lib/chart.min.js',
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            // Cache each asset individually (don't fail all if one fails)
            for (const asset of STATIC_ASSETS) {
                try {
                    await cache.add(asset);
                } catch (err) {
                    console.warn('SW: Failed to cache', asset, err.message);
                }
            }
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches, claim clients
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: route based on request type
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Pi API calls: network-first with cache fallback
    if (url.hostname === '192.168.10.1' && url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirstWithCache(event.request));
        return;
    }

    // Cloudflare Worker calls: network-only (weather should be fresh)
    if (url.hostname.includes('workers.dev')) {
        event.respondWith(networkOnly(event.request));
        return;
    }

    // Cross-origin non-API: passthrough
    if (url.origin !== self.location.origin) {
        return;
    }

    // Static assets: cache-first with background update (stale-while-revalidate)
    event.respondWith(cacheFirstWithRevalidate(event.request));
});

async function cacheFirstWithRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    // Background revalidation
    const fetchPromise = fetch(request).then((response) => {
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    }).catch(() => null);

    // Return cached immediately if available, otherwise wait for network
    if (cached) {
        return cached;
    }

    const networkResponse = await fetchPromise;
    if (networkResponse) {
        return networkResponse;
    }

    // Offline fallback for navigation requests
    if (request.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
    }

    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

async function networkFirstWithCache(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const response = await fetch(request);
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

async function networkOnly(request) {
    try {
        return await fetch(request);
    } catch {
        return new Response(JSON.stringify({ error: 'network_error' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
