/**
 * PilotStation — Flight Plan Filer
 * 1800wxbrief (Leidos) client for filing, amending, cancelling flight plans
 * and requesting official weather briefings.
 * FILE-04 through FILE-11, PLAN-16 through PLAN-18
 *
 * Leidos REST API docs: https://lmfswebservices.atlassian.net/wiki/spaces/WSS/overview
 * Base URL: https://lmfsweb.afss.com/Website/rest/FP/...
 * Auth: HTTP Basic (Vendor_ID:Vendor_Password) — proxied via Vercel API routes
 */

class FlightPlanFiler {
    static WORKER_BASE = '/api';

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
            return { success: false, error: err.returnMessage || err.error || 'Filing failed' };
        }

        const result = await resp.json();
        if (result.returnStatus === false) {
            return { success: false, error: result.returnMessage || 'Filing rejected by Leidos' };
        }

        return {
            success: true,
            flight_identifier: result.flightIdentifier || null,
            version_stamp: result.versionStamp || null,
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
            return { success: false, error: err.returnMessage || err.error || 'Amendment failed' };
        }

        const result = await resp.json();
        if (result.returnStatus === false) {
            return { success: false, error: result.returnMessage || 'Amendment rejected' };
        }

        return {
            success: true,
            version_stamp: result.versionStamp || null,
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
            return { success: false, error: err.returnMessage || err.error || 'Cancellation failed' };
        }

        const result = await resp.json();
        if (result.returnStatus === false) {
            return { success: false, error: result.returnMessage || 'Cancellation rejected' };
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
            return { success: false, error: err.returnMessage || err.error || 'Close failed' };
        }

        const result = await resp.json();
        if (result.returnStatus === false) {
            return { success: false, error: result.returnMessage || 'Close rejected' };
        }

        return { success: true };
    }

    /**
     * Request an official weather briefing via 1800wxbrief routeBriefing endpoint.
     * Returns a logged FAA weather briefing with confirmation number.
     * @param {object} briefingParams - Route, altitude, departure time, etc.
     * @returns {object} { success, confirmation, briefing_text, error }
     */
    static async requestBriefing(briefingParams) {
        // Build a NAS flight plan block for the briefing request
        const nasFlightPlan = {
            type: briefingParams.flightRules || 'VFR',
            aircraftIdentification: briefingParams.aircraftId || '',
            aircraftType: briefingParams.aircraftType || '',
            trueAirspeed: String(briefingParams.trueAirspeed || '130'),
            departurePoint: briefingParams.departure,
            departureTime: briefingParams.departureTime || '',
            cruisingAltitude: FlightPlanFiler._formatAltitude(briefingParams.altitude),
            route: briefingParams.route || '',
            destination: briefingParams.destination,
        };

        const body = {
            type: 'DOMESTIC',
            notABriefing: false,
            briefingType: (briefingParams.type || 'STANDARD').toUpperCase(),
            briefingResultFormat: 'NGBV2',
            routeCorridorWidth: '25',
            nasFlightPlan,
        };

        const resp = await fetch(`${FlightPlanFiler.WORKER_BASE}/briefing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
            return { success: false, error: err.returnMessage || err.error || 'Briefing request failed' };
        }

        const result = await resp.json();
        if (result.returnStatus === false) {
            return { success: false, error: result.returnMessage || 'Briefing request rejected' };
        }

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
     * Build the 1800wxbrief NAS (domestic) flight plan filing payload.
     * Maps internal model fields to Leidos REST API schema.
     */
    static _buildFilingPayload(planData, pilotInfo) {
        const fp = planData.flight_plan || planData;
        const filed = planData.filed_plan || {};
        const ac = planData.aircraft || {};
        const loading = planData.loading || {};

        // Build route string from waypoints (skip departure/destination)
        let routeString = '';
        if (fp.route && Array.isArray(fp.route)) {
            routeString = fp.route.slice(1, -1).join(' ');
        }

        // Combine aircraft type with equipment suffix (e.g., "C172/G")
        const typeCode = ac.type_code || ac.name || '';
        const suffix = filed.equipment_suffix || '/G';
        const aircraftType = typeCode + suffix;

        return {
            type: 'DOMESTIC',
            nasFlightPlan: {
                type: filed.flight_rules || 'VFR',
                aircraftIdentification: ac.tail_number || '',
                aircraftType: aircraftType,
                trueAirspeed: String(ac.cruise_tas || '130'),
                departurePoint: fp.departure || '',
                departureTime: filed.proposed_departure || '',
                cruisingAltitude: FlightPlanFiler._formatAltitude(fp.altitude),
                route: routeString || 'DCT',
                destination: fp.destination || '',
                estimatedTimeEnroute: FlightPlanFiler._formatEte(fp.legs),
                remarks: filed.remarks || '',
                fuelOnBoard: FlightPlanFiler._formatFuelEndurance(loading, ac),
                alternate: filed.alternate || '',
                pilotInCommand: pilotInfo?.name || '',
                numberAboard: String(filed.people_on_board || 1),
                colorOfAircraft: ac.color || '',
                contactPhone: pilotInfo?.phone || '',
            },
        };
    }

    /**
     * Format altitude for filing: hundreds of feet, 3 digits (e.g., 5500 → "055").
     */
    static _formatAltitude(altFt) {
        if (!altFt) return '';
        const hundreds = Math.round(altFt / 100);
        return String(hundreds).padStart(3, '0');
    }

    /**
     * Format ETE from legs array as HHMM.
     */
    static _formatEte(legs) {
        if (!legs || !Array.isArray(legs)) return '';
        const totalMin = legs.reduce((s, l) => s + (l.ete_min || 0), 0);
        const h = Math.floor(totalMin / 60);
        const m = Math.round(totalMin % 60);
        return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
    }

    /**
     * Format fuel endurance as HHMM.
     * Uses aircraft profile burn rate when available.
     */
    static _formatFuelEndurance(loading, aircraft) {
        const fuelGal = loading.fuel_gal || 0;
        const burnRate = aircraft.fuel_burn_gph || 8.0;
        if (fuelGal <= 0 || burnRate <= 0) return '';
        const enduranceMin = (fuelGal / burnRate) * 60;
        const h = Math.floor(enduranceMin / 60);
        const m = Math.round(enduranceMin % 60);
        return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
    }
}
