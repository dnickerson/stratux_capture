/**
 * PilotStation — Cloudflare Worker Proxy
 * CORS-enabled proxy for weather APIs, 1800wxbrief filing, and Claude AI.
 * ~150 lines. Deployed to pilotstation-api.workers.dev.
 */

// Rate limit state (in-memory, per-isolate)
const rateLimits = new Map();

function checkRateLimit(ip, category, maxPerMin) {
    const key = `${ip}:${category}`;
    const now = Date.now();
    const window = rateLimits.get(key) || [];
    const recent = window.filter(t => now - t < 60000);
    if (recent.length >= maxPerMin) return false;
    recent.push(now);
    rateLimits.set(key, recent);
    return true;
}

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
    };
}

function jsonResponse(data, status = 200, origin = '*') {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
}

async function proxyRequest(targetUrl, request, extraHeaders = {}) {
    const headers = new Headers();
    headers.set('User-Agent', 'PilotStation/1.0');
    for (const [k, v] of Object.entries(extraHeaders)) {
        headers.set(k, v);
    }
    if (request.method === 'POST') {
        headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
    }

    const init = {
        method: request.method,
        headers,
    };
    if (request.method === 'POST') {
        init.body = await request.text();
    }

    const response = await fetch(targetUrl, init);
    const body = await response.text();

    return new Response(body, {
        status: response.status,
        headers: {
            'Content-Type': response.headers.get('Content-Type') || 'application/json',
            ...corsHeaders(request.headers.get('Origin')),
        },
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        const path = url.pathname;

        try {
            // Health check (mode detection probe)
            if (path === '/health') {
                return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() }, 200, origin);
            }

            // Weather routes — proxy to aviationweather.gov
            if (path.startsWith('/wx/')) {
                if (!checkRateLimit(clientIP, 'wx', 60)) {
                    return jsonResponse({ error: 'Rate limited' }, 429, origin);
                }
                const wxPath = path.replace('/wx/', '');
                const params = url.search;

                // Map route to AWC endpoint
                const awcEndpoints = {
                    'metar': 'https://aviationweather.gov/api/data/metar',
                    'taf': 'https://aviationweather.gov/api/data/taf',
                    'pirep': 'https://aviationweather.gov/api/data/pirep',
                    'airsigmet': 'https://aviationweather.gov/api/data/airsigmet',
                    'windtemp': 'https://aviationweather.gov/api/data/windtemp',
                };

                if (wxPath === 'notam') {
                    const targetUrl = `https://notams.aim.faa.gov/notamSearch${params}`;
                    return proxyRequest(targetUrl, request);
                }

                const awcBase = awcEndpoints[wxPath];
                if (!awcBase) {
                    return jsonResponse({ error: `Unknown wx route: ${wxPath}` }, 404, origin);
                }
                return proxyRequest(`${awcBase}${params}`, request);
            }

            // Fuel prices
            if (path === '/fuel-prices') {
                if (!checkRateLimit(clientIP, 'wx', 60)) {
                    return jsonResponse({ error: 'Rate limited' }, 429, origin);
                }
                // Proxy to aviation-fuel-prices.com API
                const targetUrl = `https://www.aviation-fuel-prices.com/api${url.search}`;
                return proxyRequest(targetUrl, request);
            }

            // Flight plan filing routes — proxy to 1800wxbrief (Leidos)
            if (path.startsWith('/fp/') || path === '/briefing') {
                if (!checkRateLimit(clientIP, 'fp', 10)) {
                    return jsonResponse({ error: 'Rate limited' }, 429, origin);
                }

                const vendorId = env.LEIDOS_VENDOR_ID;
                const vendorPwd = env.LEIDOS_VENDOR_PASSWORD;
                if (!vendorId || !vendorPwd) {
                    return jsonResponse({ error: '1800wxbrief credentials not configured' }, 503, origin);
                }

                const basicAuth = 'Basic ' + btoa(`${vendorId}:${vendorPwd}`);
                let targetPath;

                if (path === '/briefing') {
                    targetPath = '/Website/rest/FP/routeBriefing';
                } else {
                    // /fp/file, /fp/{id}/amend, /fp/{id}/cancel, /fp/{id}/close
                    targetPath = '/Website/rest/FP' + path.replace('/fp', '');
                }

                const targetUrl = `https://lmfsweb.afss.com${targetPath}`;
                return proxyRequest(targetUrl, request, { 'Authorization': basicAuth });
            }

            // Claude AI route (Phase 2)
            if (path === '/claude') {
                if (!checkRateLimit(clientIP, 'claude', 20)) {
                    return jsonResponse({ error: 'Rate limited' }, 429, origin);
                }

                const apiKey = env.ANTHROPIC_API_KEY;
                if (!apiKey) {
                    return jsonResponse({ error: 'AI service not configured' }, 503, origin);
                }

                // Validate request
                let body;
                try {
                    body = await request.json();
                } catch {
                    return jsonResponse({ error: 'Invalid JSON body' }, 400, origin);
                }
                if (body.max_tokens && body.max_tokens > 4096) {
                    return jsonResponse({ error: 'max_tokens exceeds limit (4096)' }, 400, origin);
                }

                const targetUrl = 'https://api.anthropic.com/v1/messages';
                const headers = new Headers();
                headers.set('Content-Type', 'application/json');
                headers.set('x-api-key', apiKey);
                headers.set('anthropic-version', '2023-06-01');

                const response = await fetch(targetUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                });

                const responseBody = await response.text();
                return new Response(responseBody, {
                    status: response.status,
                    headers: {
                        'Content-Type': 'application/json',
                        ...corsHeaders(origin),
                    },
                });
            }

            return jsonResponse({ error: 'Not found' }, 404, origin);

        } catch (err) {
            return jsonResponse({ error: 'Internal error', message: err.message }, 500, origin);
        }
    },
};
