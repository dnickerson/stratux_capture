/**
 * GET /api/health — Health check endpoint.
 */
module.exports = async function handler(req, res) {
    return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
};
