/**
 * GET /api/wx/{metar|taf|pirep|airsigmet|windtemp}
 * Proxy to aviationweather.gov API — replaces Cloudflare Worker wx routes.
 */
const { proxyRequest } = require('../_proxy');

const AWC_ENDPOINTS = {
    metar: 'https://aviationweather.gov/api/data/metar',
    taf: 'https://aviationweather.gov/api/data/taf',
    pirep: 'https://aviationweather.gov/api/data/pirep',
    airsigmet: 'https://aviationweather.gov/api/data/airsigmet',
    windtemp: 'https://aviationweather.gov/api/data/windtemp',
};

module.exports = async function handler(req, res) {
    const { route, ...queryParams } = req.query;

    const awcBase = AWC_ENDPOINTS[route];
    if (!awcBase) {
        return res.status(404).json({ error: `Unknown wx route: ${route}` });
    }

    const params = new URLSearchParams(queryParams).toString();
    const targetUrl = params ? `${awcBase}?${params}` : awcBase;

    try {
        const result = await proxyRequest(targetUrl, req);
        res.setHeader('Content-Type', result.contentType);
        return res.status(result.status).send(result.body);
    } catch (err) {
        return res.status(500).json({ error: 'Proxy error', message: err.message });
    }
};
