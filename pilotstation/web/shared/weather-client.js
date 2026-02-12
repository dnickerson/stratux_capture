/**
 * PilotStation — Weather API Client
 * Fetches METARs, TAFs, winds aloft, PIREPs, SIGMETs, NOTAMs, TFRs
 * from the Cloudflare Worker proxy. Decodes METAR and determines flight category.
 */

class WeatherClient {
    static WORKER_BASE = 'https://pilotstation-api.workers.dev';

    constructor(db) {
        this.db = db;
    }

    /**
     * Fetch all weather for a route corridor.
     * @param {string[]} stations - ICAO identifiers along the route
     * @param {number} altitude - Cruise altitude in feet
     * @returns {object} Combined weather data
     */
    async fetchAllForRoute(stations, altitude) {
        const ids = stations.join(',');
        const [metars, tafs, winds, pireps, sigmets] = await Promise.allSettled([
            this.fetchMetars(ids),
            this.fetchTafs(ids),
            this.fetchWindsAloft(stations[0], altitude),
            this.fetchPireps(ids),
            this.fetchSigmets(),
        ]);

        const result = {
            fetched_at: new Date().toISOString(),
            metars: metars.status === 'fulfilled' ? metars.value : {},
            tafs: tafs.status === 'fulfilled' ? tafs.value : {},
            winds_aloft: winds.status === 'fulfilled' ? winds.value : {},
            pireps: pireps.status === 'fulfilled' ? pireps.value : [],
            sigmets: sigmets.status === 'fulfilled' ? sigmets.value : [],
            tfrs: [],
            notams: [],
        };

        // Cache to IndexedDB
        for (const [icao, metar] of Object.entries(result.metars)) {
            await this.db.putWeather(icao, {
                metar: metar,
                taf: result.tafs[icao] || null,
                fetched_at: result.fetched_at,
            });
        }

        return result;
    }

    /**
     * Fetch METARs for comma-separated station IDs.
     */
    async fetchMetars(ids) {
        const url = `${WeatherClient.WORKER_BASE}/wx/metar?ids=${ids}&format=json`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`METAR fetch failed: ${resp.status}`);
        const data = await resp.json();

        // Parse into { ICAO: decoded } map
        const metars = {};
        const items = Array.isArray(data) ? data : (data.data || []);
        for (const item of items) {
            const icao = item.icaoId || item.station_id;
            if (!icao) continue;
            metars[icao] = {
                raw: item.rawOb || item.raw_text || '',
                decoded: WeatherClient.decodeMetar(item),
                fetched_at: new Date().toISOString(),
            };
        }
        return metars;
    }

    /**
     * Fetch TAFs for comma-separated station IDs.
     */
    async fetchTafs(ids) {
        const url = `${WeatherClient.WORKER_BASE}/wx/taf?ids=${ids}&format=json`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`TAF fetch failed: ${resp.status}`);
        const data = await resp.json();

        const tafs = {};
        const items = Array.isArray(data) ? data : (data.data || []);
        for (const item of items) {
            const icao = item.icaoId || item.station_id;
            if (!icao) continue;
            tafs[icao] = {
                raw: item.rawTAF || item.raw_text || '',
                fetched_at: new Date().toISOString(),
            };
        }
        return tafs;
    }

    /**
     * Fetch winds aloft data for a station at various altitudes.
     */
    async fetchWindsAloft(station, altitude) {
        const url = `${WeatherClient.WORKER_BASE}/wx/windtemp?region=all&level=low&fcst=06`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Winds aloft fetch failed: ${resp.status}`);
        const text = await resp.text();

        // Parse winds aloft text format into structured data
        // Format varies; try JSON first, then raw text
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            data = WeatherClient.parseWindsAloftText(text, station);
        }

        // Return as altitude-keyed object: { 3000: { dir, spd, temp }, 6000: ... }
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            return data;
        }
        return {};
    }

    /**
     * Fetch PIREPs near route corridor.
     */
    async fetchPireps(ids) {
        const url = `${WeatherClient.WORKER_BASE}/wx/pirep?id=${ids}&format=json&age=3`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`PIREP fetch failed: ${resp.status}`);
        const data = await resp.json();
        return Array.isArray(data) ? data : (data.data || []);
    }

    /**
     * Fetch active SIGMETs/AIRMETs.
     */
    async fetchSigmets() {
        const url = `${WeatherClient.WORKER_BASE}/wx/airsigmet?format=json`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`SIGMET fetch failed: ${resp.status}`);
        const data = await resp.json();
        return Array.isArray(data) ? data : (data.data || []);
    }

    // ========== METAR Decoding ==========

    /**
     * Decode a METAR from aviationweather.gov JSON into structured format.
     */
    static decodeMetar(item) {
        const decoded = {
            station: item.icaoId || item.station_id || '',
            observed_at: item.reportTime || item.observation_time || '',
            wind_dir: null,
            wind_speed: null,
            wind_gust: null,
            visibility: null,
            ceiling: null,
            sky_condition: [],
            temperature: null,
            dewpoint: null,
            altimeter: null,
            flight_category: null,
            weather: [],
        };

        // Wind
        decoded.wind_dir = item.wdir ?? null;
        decoded.wind_speed = item.wspd ?? null;
        decoded.wind_gust = item.wgst ?? null;

        // Visibility (statute miles)
        decoded.visibility = item.visib ?? null;

        // Sky conditions — extract ceiling
        const clouds = item.clouds || [];
        decoded.sky_condition = clouds.map(c => ({
            cover: c.cover || '',
            base: c.base ?? null,
        }));

        // Ceiling is the lowest BKN or OVC layer
        for (const c of clouds) {
            const cover = (c.cover || '').toUpperCase();
            if (cover === 'BKN' || cover === 'OVC') {
                const base = c.base;
                if (base !== null && base !== undefined) {
                    if (decoded.ceiling === null || base < decoded.ceiling) {
                        decoded.ceiling = base;
                    }
                }
            }
        }

        // Temperature / Dewpoint
        decoded.temperature = item.temp ?? null;
        decoded.dewpoint = item.dewp ?? null;

        // Altimeter
        decoded.altimeter = item.altim ?? null;

        // Weather phenomena
        if (item.wxString) {
            decoded.weather = item.wxString.split(/\s+/).filter(Boolean);
        }

        // Flight category
        decoded.flight_category = WeatherClient.getFlightCategory(
            decoded.ceiling, decoded.visibility
        );

        return decoded;
    }

    /**
     * Determine flight category from ceiling and visibility.
     * @param {number|null} ceiling - AGL feet (null = clear)
     * @param {number|null} visibility - Statute miles (null = unlimited)
     * @returns {string} VFR, MVFR, IFR, or LIFR
     */
    static getFlightCategory(ceiling, visibility) {
        // Default to VFR if no data
        const ceil = ceiling ?? 99999;
        const vis = visibility ?? 99;

        if (ceil < 500 || vis < 1) return 'LIFR';
        if (ceil < 1000 || vis < 3) return 'IFR';
        if (ceil <= 3000 || vis <= 5) return 'MVFR';
        return 'VFR';
    }

    /**
     * Parse winds aloft text format into structured data.
     * This handles the raw FD winds text when JSON isn't available.
     */
    static parseWindsAloftText(text, station) {
        const winds = {};
        const lines = text.split('\n');
        const stationUpper = (station || '').toUpperCase();

        // Standard FD altitude levels
        const altLevels = [3000, 6000, 9000, 12000, 18000, 24000, 30000];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('FD') || trimmed.startsWith('VALID')) continue;

            // Check if line starts with a station identifier
            const parts = trimmed.split(/\s+/);
            if (parts.length < 2) continue;

            const lineStation = parts[0];
            if (stationUpper && lineStation !== stationUpper) continue;

            // Parse wind groups (DDff or DDffTT format)
            for (let i = 1; i < parts.length && i <= altLevels.length; i++) {
                const group = parts[i];
                if (!group || group === '    ') continue;

                const parsed = WeatherClient.parseWindGroup(group);
                if (parsed) {
                    winds[altLevels[i - 1]] = parsed;
                }
            }

            if (Object.keys(winds).length > 0) break;
        }

        return winds;
    }

    /**
     * Parse a single wind group (e.g., "2714" = 270@14kt, "2714+06" = 270@14kt, +6C).
     */
    static parseWindGroup(group) {
        if (!group || group.length < 4) return null;
        // "9900" means light and variable
        if (group.startsWith('9900')) {
            return { dir: 0, spd: 0, temp: null, variable: true };
        }

        const dir = parseInt(group.substring(0, 2)) * 10;
        let spd = parseInt(group.substring(2, 4));

        // If direction >= 51, winds are >= 100kt: subtract 50 from dir, add 100 to speed
        let actualDir = dir;
        if (dir > 360) {
            actualDir = dir - 500;
            spd += 100;
        }

        let temp = null;
        if (group.length >= 6) {
            const tempStr = group.substring(4);
            temp = parseInt(tempStr);
            if (tempStr.startsWith('-') || tempStr.startsWith('+')) {
                temp = parseInt(tempStr);
            }
        }

        return { dir: actualDir, spd, temp };
    }
}
