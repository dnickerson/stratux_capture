/**
 * POST /api/claude — Proxy to Anthropic Claude API.
 * Auth: ANTHROPIC_API_KEY from Vercel env vars.
 * Validates max_tokens <= 4096.
 */
module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(503).json({ error: 'AI service not configured' });
    }

    const body = req.body;
    if (!body) {
        return res.status(400).json({ error: 'Invalid JSON body' });
    }
    if (body.max_tokens && body.max_tokens > 4096) {
        return res.status(400).json({ error: 'max_tokens exceeds limit (4096)' });
    }

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
        });

        const responseBody = await response.text();
        res.setHeader('Content-Type', 'application/json');
        return res.status(response.status).send(responseBody);
    } catch (err) {
        return res.status(500).json({ error: 'AI service error', message: err.message });
    }
};
