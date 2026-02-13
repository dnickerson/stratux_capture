/**
 * GET/POST /api/wx/notam — Proxy to FAA NOTAM search.
 */
const { proxyRequest } = require('../_proxy');

module.exports = async function handler(req, res) {
    const params = new URLSearchParams(req.query).toString();
    const targetUrl = params
        ? `https://notams.aim.faa.gov/notamSearch?${params}`
        : 'https://notams.aim.faa.gov/notamSearch';

    try {
        const result = await proxyRequest(targetUrl, req);
        res.setHeader('Content-Type', result.contentType);
        return res.status(result.status).send(result.body);
    } catch (err) {
        return res.status(500).json({ error: 'Proxy error', message: err.message });
    }
};
