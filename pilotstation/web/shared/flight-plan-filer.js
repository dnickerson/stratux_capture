/**
 * PilotStation — Flight Plan Filer
 * 1800wxbrief (Leidos) client for filing, amending, cancelling flight plans
 * and requesting official weather briefings.
 * FILE-04 through FILE-11, PLAN-16 through PLAN-18
 */

class FlightPlanFiler {
    static WORKER_BASE = 'https://pilotstation-api.workers.dev';

    /**
     * Equipment suffix lookup table (common suffixes).
     */
    static EQUIPMENT_SUFFIXES = {
        '/U': 'No transponder',
        '/A': 'Transponder, no Mode C',
        '/C': 'Transponder with Mode C, no RNAV',
        '/G': 'GPS with Mode C',
        '/I': 'INS with Mode C',
        '/L': 'DME + RNAV + Mode C',
        '/W': 'RVSM (FL290-FL410)',
    };

    /**
     * File a new flight plan via 1800wxbrief.
     * @param {object} planData - Assembled flight plan data
     * @param {object} pilotInfo - Pilot name, phone, etc.
     * @returns {object} { success, flight_identifier, version_stamp, error }
     */
    static async filePlan(planData, pilotInfo) {
        const body = FlightPlanFiler._buildFilingPayload(planData, pilotInfo);

        const resp = await fetch(`${FlightPlanFiler.WORKER_BASE}/fp/file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
            return { success: false, error: err.error || 'Filing failed' };
        }

        const result = await resp.json();
        return {
            success: true,
            flight_identifier: result.flightIdentifier || result.flight_identifier || null,
            version_stamp: result.versionStamp || result.version_stamp || null,
        };
    }

    /**
     * Amend an existing flight plan.
     * @param {string} planId - Flight identifier from original filing
     * @param {object} amendments - Fields to change
     * @returns {object} { success, version_stamp, error }
     */
    static async amendPlan(planId, amendments) {
        const resp = await fetch(`${FlightPlanFiler.WORKER_BASE}/fp/${planId}/amend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(amendments),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
            return { success: false, error: err.error || 'Amendment failed' };
        }

        const result = await resp.json();
        return {
            success: true,
            version_stamp: result.versionStamp || result.version_stamp || null,
        };
    }

    /**
     * Cancel a filed flight plan.
     * @param {string} planId - Flight identifier
     * @returns {object} { success, error }
     */
    static async cancelPlan(planId) {
        const resp = await fetch(`${FlightPlanFiler.WORKER_BASE}/fp/${planId}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
            return { success: false, error: err.error || 'Cancellation failed' };
        }

        return { success: true };
    }

    /**
     * Close a flight plan (after landing).
     * @param {string} planId - Flight identifier
     * @returns {object} { success, error }
     */
    static async closePlan(planId) {
        const resp = await fetch(`${FlightPlanFiler.WORKER_BASE}/fp/${planId}/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
            return { success: false, error: err.error || 'Close failed' };
        }

        return { success: true };
    }

    /**
     * Request an official weather briefing via 1800wxbrief.
     * @param {object} briefingParams - Route, altitude, departure time, etc.
     * @returns {object} { success, confirmation, briefing_text, error }
     */
    static async requestBriefing(briefingParams) {
        const body = {
            type: briefingParams.type || 'standard',
            departure: briefingParams.departure,
            destination: briefingParams.destination,
            route: briefingParams.route || '',
            altitude: briefingParams.altitude,
            departureTime: briefingParams.departureTime || new Date().toISOString(),
            aircraftType: briefingParams.aircraftType || '',
        };

        const resp = await fetch(`${FlightPlanFiler.WORKER_BASE}/briefing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
            return { success: false, error: err.error || 'Briefing request failed' };
        }

        const result = await resp.json();
        return {
            success: true,
            confirmation: result.confirmationNumber || result.confirmation || null,
            briefing_text: result.briefingText || result.text || null,
        };
    }

    /**
     * Request a route recommendation from 1800wxbrief.
     * Returns suggested route with airways and waypoints.
     * @param {object} params - { departure, destination, altitude, aircraftType, flightRules }
     * @returns {object} { success, routes: [{ route_string, description }], error }
     */
    static async requestRouteRecommendation(params) {
        const body = {
            type: 'route',
            departure: params.departure,
            destination: params.destination,
            altitude: params.altitude || 5500,
            aircraftType: params.aircraftType || '',
            flightRules: params.flightRules || 'VFR',
        };

        try {
            const resp = await fetch(`${FlightPlanFiler.WORKER_BASE}/route/recommend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
                return { success: false, error: err.error || 'Route recommendation failed' };
            }

            const result = await resp.json();
            return {
                success: true,
                routes: result.routes || [],
            };
        } catch (err) {
            return { success: false, error: err.message || 'Network error' };
        }
    }

    /**
     * Parse a route string into waypoints array.
     * Handles formats like: "KLKR DCT CLT V222 SAV DCT 7FL6"
     * or "KLKR..CLT.V222.SAV..7FL6"
     * @param {string} routeStr - Route string from 1800wxbrief or manual entry
     * @returns {{ departure: string, destination: string, waypoints: Array }}
     */
    static parseRouteString(routeStr) {
        if (!routeStr || !routeStr.trim()) return null;

        // Normalize: replace ".." with " DCT ", "." with " ", multiple spaces with single
        let normalized = routeStr.trim().toUpperCase()
            .replace(/\.\./g, ' DCT ')
            .replace(/\./g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const tokens = normalized.split(' ').filter(t => t && t !== 'DCT');
        if (tokens.length < 2) return null;

        const departure = tokens[0];
        const destination = tokens[tokens.length - 1];
        const waypoints = [];

        // Determine which middle tokens are airways vs fixes
        for (let i = 1; i < tokens.length - 1; i++) {
            const token = tokens[i];
            // Airways typically start with V, J, T, Q followed by digits
            const isAirway = /^[VJTQ]\d+$/.test(token);
            waypoints.push({
                type: isAirway ? 'airway' : 'fix',
                id: token,
            });
        }

        return { departure, destination, waypoints };
    }

    // ========== Internal ==========

    /**
     * Build the 1800wxbrief flight plan filing payload.
     * Maps internal model fields to Leidos API format.
     */
    static _buildFilingPayload(planData, pilotInfo) {
        const fp = planData.flight_plan || planData;
        const filed = planData.filed_plan || {};
        const ac = planData.aircraft || {};

        // Build route string from waypoints
        let routeString = '';
        if (fp.route && Array.isArray(fp.route)) {
            // Skip departure and destination (first and last), they go in separate fields
            routeString = fp.route.slice(1, -1).join(' ');
        }

        return {
            flightRules: filed.flight_rules || 'VFR',
            aircraftType: ac.type_code || ac.name || '',
            aircraftId: ac.tail_number || '',
            departurePoint: fp.departure || '',
            destination: fp.destination || '',
            route: routeString,
            cruisingAltitude: fp.altitude || '',
            trueAirspeed: ac.cruise_tas || '130',
            proposedDepartureTime: filed.proposed_departure || '',
            estimatedTimeEnroute: FlightPlanFiler._formatEte(fp.legs),
            fuelOnBoard: FlightPlanFiler._formatFuelEndurance(planData),
            peopleOnBoard: filed.people_on_board || 1,
            alternateAirport: filed.alternate || '',
            pilotName: pilotInfo?.name || '',
            pilotPhone: pilotInfo?.phone || '',
            pilotAddress: pilotInfo?.address || '',
            aircraftColor: ac.color || '',
            remarks: filed.remarks || '',
            equipmentSuffix: filed.equipment_suffix || '/G',
        };
    }

    /**
     * Format ETE from legs array as HH:MM.
     */
    static _formatEte(legs) {
        if (!legs || !Array.isArray(legs)) return '';
        const totalMin = legs.reduce((s, l) => s + (l.ete_min || 0), 0);
        const h = Math.floor(totalMin / 60);
        const m = Math.round(totalMin % 60);
        return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
    }

    /**
     * Format fuel endurance as HH:MM.
     */
    static _formatFuelEndurance(planData) {
        const loading = planData.loading || planData.aircraft?.loading || {};
        const fuelGal = loading.fuel_gal || 0;
        // Rough estimate: fuel_gal / burn_rate_gph
        const burnRate = 8.2; // Default
        const enduranceMin = (fuelGal / burnRate) * 60;
        const h = Math.floor(enduranceMin / 60);
        const m = Math.round(enduranceMin % 60);
        return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
    }
}
