/**
 * PilotStation — Shared proxy helper for Vercel API routes.
 * Replaces the Cloudflare Worker proxyRequest() function.
 */

async function proxyRequest(targetUrl, req, extraHeaders = {}) {
    const fetchOptions = {
        method: req.method,
        headers: {
            'User-Agent': 'PilotStation/1.0',
            ...extraHeaders,
        },
    };

    if (req.method === 'POST') {
        fetchOptions.headers['Content-Type'] = req.headers['content-type'] || 'application/json';
        fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const body = await response.text();

    return {
        status: response.status,
        body,
        contentType: response.headers.get('content-type') || 'application/json',
    };
}

module.exports = { proxyRequest };
