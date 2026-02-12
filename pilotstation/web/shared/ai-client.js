/**
 * PilotStation — AI Client (Phase 2)
 * Claude API client for weather analysis, go/no-go reasoning, NOTAM filtering,
 * alternate suggestions, and route optimization.
 * AI-01 through AI-12
 */

class AiClient {
    static WORKER_BASE = 'https://pilotstation-api.pilotstation.workers.dev';
    static MODEL = 'claude-sonnet-4-5-20250929';
    static MAX_TOKENS = 4096;

    /**
     * Advisory disclaimer (AI-10) — must be displayed with all AI-generated content.
     */
    static DISCLAIMER = 'AI-generated advisory only. Not a substitute for official weather briefings, ' +
        'FAA-approved sources, or pilot judgment. Always verify with official sources before flight.';

    /**
     * System prompt for the aviation weather analyst role.
     */
    static SYSTEM_PROMPT = `You are an experienced aviation weather analyst with CFI-I credentials.
You provide concise, actionable weather analysis for VFR and IFR pilots.
Always reference specific METARs, TAFs, and NOTAMs by station identifier.
Use standard aviation terminology and units (knots, feet AGL/MSL, statute miles).
When assessing go/no-go, be conservative and clearly state any risks.
Format responses with clear sections and bullet points.`;

    constructor(db) {
        this.db = db;
        this._available = null;
    }

    /**
     * Check if AI service is available (AI-11).
     */
    async checkAvailability() {
        try {
            const resp = await fetch(`${AiClient.WORKER_BASE}/health`);
            this._available = resp.ok;
        } catch {
            this._available = false;
        }
        return this._available;
    }

    /**
     * Get availability status — returns graceful degradation message if unavailable.
     */
    getStatus() {
        if (this._available === false) {
            return { available: false, message: 'AI service unavailable. Using rules-based analysis only.' };
        }
        return { available: true };
    }

    /**
     * Analyze weather for a route (AI-04).
     */
    async analyzeWeather(weatherData, routeData, aircraftData) {
        const prompt = this._buildWeatherPrompt(weatherData, routeData, aircraftData);
        const result = await this._query(prompt);

        if (result.error) return result;

        // Cache to IndexedDB
        const briefing = {
            type: 'weather_analysis',
            summary: result.text,
            generated_at: new Date().toISOString(),
            route: `${routeData.departure}-${routeData.destination}`,
        };
        await this.db.saveAiBriefing({
            flight_plan_id: `${routeData.departure}-${routeData.destination}`,
            ...briefing,
        });

        return briefing;
    }

    /**
     * Go/No-Go assessment (AI-05).
     */
    async goNoGo(weatherData, routeData, aircraftData) {
        const metarSummary = this._summarizeMetars(weatherData.metars || {});
        const prompt = `Analyze the following flight and provide a GO, CAUTION, or NO-GO recommendation.

FLIGHT: ${routeData.departure} → ${routeData.destination}
ALTITUDE: ${routeData.altitude} ft
DISTANCE: ${routeData.totalDist} nm
ETE: ${Math.round(routeData.totalEte)} min
AIRCRAFT: ${aircraftData?.aircraft?.name || 'Unknown'}

CURRENT WEATHER:
${metarSummary}

WINDS ALOFT:
${this._summarizeWinds(weatherData.winds_aloft || {}, routeData.altitude)}

SIGMETS/AIRMETS: ${(weatherData.sigmets || []).length} active
PIREPS: ${(weatherData.pireps || []).length} recent

Provide:
1. GO / CAUTION / NO-GO recommendation
2. Key weather factors affecting the flight
3. Specific risks to monitor
4. Recommended actions or alternatives`;

        const result = await this._query(prompt);

        if (result.error) return result;

        // Parse go/no-go from response
        let goNogo = 'CAUTION';
        const text = result.text.toUpperCase();
        if (text.includes('NO-GO') || text.includes('NOGO')) goNogo = 'NO-GO';
        else if (text.includes(': GO') || text.startsWith('GO')) goNogo = 'GO';

        return {
            go_nogo: goNogo,
            summary: result.text,
            generated_at: new Date().toISOString(),
        };
    }

    /**
     * Filter and prioritize NOTAMs (AI-06).
     */
    async filterNotams(notams, routeData) {
        if (!notams || notams.length === 0) {
            return { highlights: [], summary: 'No NOTAMs to analyze.' };
        }

        const notamText = notams.slice(0, 20).map((n, i) =>
            `${i + 1}. ${n.raw || n.text || JSON.stringify(n)}`
        ).join('\n');

        const prompt = `Review these NOTAMs for a flight from ${routeData.departure} to ${routeData.destination} at ${routeData.altitude} ft.

NOTAMs:
${notamText}

Identify:
1. Critical NOTAMs that directly affect this flight (runway closures, airspace restrictions, nav aids OTS)
2. NOTAMs that can be safely disregarded (distant, irrelevant, expired)
3. A brief summary of the NOTAM situation for this route`;

        const result = await this._query(prompt);
        if (result.error) return result;

        return {
            highlights: [],
            summary: result.text,
            generated_at: new Date().toISOString(),
        };
    }

    /**
     * Suggest alternate airports (AI-08).
     */
    async suggestAlternates(routeData, weatherData) {
        const prompt = `For a flight from ${routeData.departure} to ${routeData.destination} at ${routeData.altitude} ft:

Current destination weather: ${this._summarizeStation(weatherData.metars?.[routeData.destination])}

Suggest 2-3 alternate airports considering:
1. Proximity to destination (within 50nm preferred)
2. Current and forecast weather at the alternates
3. Runway length and services available
4. Fuel availability

For each alternate, explain why it's a good choice.`;

        const result = await this._query(prompt);
        if (result.error) return result;

        return {
            suggestions: result.text,
            generated_at: new Date().toISOString(),
        };
    }

    /**
     * Route optimization suggestions (AI-07).
     */
    async optimizeRoute(routeData, weatherData) {
        const prompt = `Analyze this route for optimization:

ROUTE: ${routeData.route?.join(' → ') || 'Direct'}
ALTITUDE: ${routeData.altitude} ft
DISTANCE: ${routeData.totalDist} nm
WINDS: ${this._summarizeWinds(weatherData.winds_aloft || {}, routeData.altitude)}

Suggest any improvements considering:
1. Wind-optimal altitude
2. Alternative routing to avoid weather
3. Fuel efficiency
4. Airspace considerations`;

        const result = await this._query(prompt);
        if (result.error) return result;

        return {
            suggestions: result.text,
            generated_at: new Date().toISOString(),
        };
    }

    // ========== Internal ==========

    async _query(userMessage) {
        try {
            const resp = await fetch(`${AiClient.WORKER_BASE}/claude`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: AiClient.MODEL,
                    max_tokens: AiClient.MAX_TOKENS,
                    system: AiClient.SYSTEM_PROMPT,
                    messages: [{ role: 'user', content: userMessage }],
                }),
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                return { error: err.error?.message || `AI request failed (${resp.status})` };
            }

            const data = await resp.json();
            const text = data.content?.[0]?.text || '';
            return { text };
        } catch (err) {
            return { error: `AI service error: ${err.message}` };
        }
    }

    _buildWeatherPrompt(wxData, routeData, acData) {
        const metarSummary = this._summarizeMetars(wxData.metars || {});
        return `Provide a concise weather briefing for this flight:

FLIGHT: ${routeData.departure} → ${routeData.destination}
ROUTE: ${routeData.route?.join(' ') || 'Direct'}
ALTITUDE: ${routeData.altitude} ft
DISTANCE: ${routeData.totalDist} nm
ETE: ${Math.round(routeData.totalEte)} min
AIRCRAFT: ${acData?.aircraft?.name || 'Unknown'}

METARS:
${metarSummary}

WINDS ALOFT:
${this._summarizeWinds(wxData.winds_aloft || {}, routeData.altitude)}

SIGMETs/AIRMETs: ${(wxData.sigmets || []).length} active
PIREPs: ${(wxData.pireps || []).length} recent

Provide:
1. Synopsis of weather conditions along the route
2. Key hazards or concerns
3. Expected turbulence or icing
4. Recommended precautions`;
    }

    _summarizeMetars(metars) {
        return Object.entries(metars).map(([icao, m]) => {
            const d = m.decoded || {};
            return `${icao}: ${d.flight_category || '?'} - Wind ${d.wind_dir || '?'}/${d.wind_speed || '?'}kt ` +
                `Vis ${d.visibility || '?'}SM Ceil ${d.ceiling || 'CLR'} Alt ${d.altimeter?.toFixed(2) || '?'}`;
        }).join('\n') || 'No METARs available';
    }

    _summarizeStation(metar) {
        if (!metar?.decoded) return 'No data';
        const d = metar.decoded;
        return `${d.flight_category} - Wind ${d.wind_dir}/${d.wind_speed}kt Vis ${d.visibility}SM Ceil ${d.ceiling || 'CLR'}`;
    }

    _summarizeWinds(winds, altitude) {
        const entries = Object.entries(winds)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([alt, w]) => `${Number(alt).toLocaleString()}ft: ${w.dir}°/${w.spd}kt${w.temp !== null ? ' ' + w.temp + '°C' : ''}`)
            .join(', ');
        return entries || 'No winds aloft data';
    }
}
