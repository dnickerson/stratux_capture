/**
 * POST /api/fp/file — File a flight plan via 1800wxbrief (Leidos).
 * Auth: HTTP Basic (LEIDOS_VENDOR_ID:LEIDOS_VENDOR_PASSWORD) from Vercel env vars.
 */
const { proxyRequest } = require('../_proxy');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const vendorId = process.env.LEIDOS_VENDOR_ID;
    const vendorPwd = process.env.LEIDOS_VENDOR_PASSWORD;
    if (!vendorId || !vendorPwd) {
        return res.status(503).json({ error: '1800wxbrief credentials not configured' });
    }

    const basicAuth = 'Basic ' + Buffer.from(`${vendorId}:${vendorPwd}`).toString('base64');
    const targetUrl = 'https://lmfsweb.afss.com/Website/rest/FP/file';

    try {
        const result = await proxyRequest(targetUrl, req, { Authorization: basicAuth });
        res.setHeader('Content-Type', result.contentType);
        return res.status(result.status).send(result.body);
    } catch (err) {
        return res.status(500).json({ error: 'Proxy error', message: err.message });
    }
};
