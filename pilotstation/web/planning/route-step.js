/**
 * PilotStation — Step 2: Route Entry & Optimization
 * Departure, waypoints/airways, destination, leg calculations, altitude optimization.
 * FLT-01 through FLT-07, PLAN-05, PLAN-06
 */

class RouteStep {
    constructor({ controller, db }) {
        this.controller = controller;
        this.db = db;
        this.container = null;

        this.departure = '';
        this.destination = '';
        this.waypoints = []; // Array of { type: 'fix'|'airway', id: string, lat?, lon? }
        this.altitude = 8000;
        this.legs = [];
    }

    async render(container, workflowData) {
        this.container = container;

        // Restore from saved data
        if (workflowData.route) {
            const saved = workflowData.route;
            this.departure = saved.departure || '';
            this.destination = saved.destination || '';
            this.waypoints = saved.waypoints || [];
            this.altitude = saved.altitude || 8000;
            this.legs = saved.legs || [];
        }

        this._render();
    }

    _render() {
        const totalDist = this.legs.reduce((s, l) => s + (l.dist_nm || 0), 0);
        const totalTime = this.legs.reduce((s, l) => s + (l.ete_min || 0), 0);
        const totalFuel = this.legs.reduce((s, l) => s + (l.fuel_gal || 0), 0);
        const eteStr = `${Math.floor(totalTime / 60)}:${String(Math.round(totalTime % 60)).padStart(2, '0')}`;

        // Get aircraft performance data for fuel calculations
        const acData = this.controller.workflowData.aircraft;
        const burnRate = 8.2; // Default GPH, could come from aircraft profile

        this.container.innerHTML = `
            <div class="route-layout flex gap-md">
                <div class="route-main" style="flex:1;">
                    <div class="card">
                        <div class="card-title">Route</div>

                        <div class="loading-row mb-sm">
                            <label class="input-label">Departure</label>
                            <input type="text" class="input route-departure"
                                value="${this.departure}" placeholder="ICAO (e.g., KLKR)"
                                maxlength="4" style="text-transform:uppercase;">
                        </div>

                        <div id="waypointList" class="waypoint-list mb-sm">
                            ${this.waypoints.map((wp, i) => `
                                <div class="waypoint-row flex items-center gap-sm" data-index="${i}">
                                    <span class="text-sm text-muted">${wp.type === 'airway' ? 'AWY' : 'FIX'}</span>
                                    <input type="text" class="input waypoint-input"
                                        value="${wp.id}" placeholder="${wp.type === 'airway' ? 'V16' : 'ICAO/FIX'}"
                                        maxlength="6" style="text-transform:uppercase;flex:1;">
                                    <button class="btn btn-secondary remove-wp" data-index="${i}"
                                        style="min-width:36px;min-height:36px;padding:4px;">&#x2715;</button>
                                </div>
                            `).join('')}
                        </div>

                        <div class="flex gap-sm mb-sm">
                            <button class="btn btn-secondary add-waypoint-btn" style="flex:1;">+ Add Waypoint</button>
                            <button class="btn btn-secondary add-airway-btn" style="flex:1;">+ Add Airway</button>
                        </div>

                        <div class="loading-row mb-sm">
                            <label class="input-label">Destination</label>
                            <input type="text" class="input route-destination"
                                value="${this.destination}" placeholder="ICAO (e.g., KLWA)"
                                maxlength="4" style="text-transform:uppercase;">
                        </div>

                        <div class="loading-row">
                            <label class="input-label">Altitude</label>
                            <select class="select altitude-select">
                                ${[3000,4000,5000,6000,7000,8000,9000,10000,11000,12000,13000,14000,15000,16000,17000,18000]
                                    .map(a => `<option value="${a}" ${a === this.altitude ? 'selected' : ''}>${a.toLocaleString()} ft</option>`)
                                    .join('')}
                            </select>
                        </div>

                        <div class="flex gap-sm mt-md">
                            <button class="btn btn-primary calc-route-btn" style="flex:1;">Calculate Route</button>
                            <button class="btn btn-secondary opt-alt-btn">Optimize Altitude</button>
                        </div>
                    </div>

                    ${this.legs.length > 0 ? `
                    <div class="card">
                        <div class="card-title">Route Legs</div>
                        <table class="route-table w-full" style="border-collapse:collapse;">
                            <thead>
                                <tr class="text-sm text-muted" style="text-align:left;">
                                    <th style="padding:4px 8px;">Leg</th>
                                    <th style="padding:4px 8px;">Via</th>
                                    <th style="padding:4px 8px;">Hdg</th>
                                    <th style="padding:4px 8px;">Dist</th>
                                    <th style="padding:4px 8px;">Time</th>
                                    <th style="padding:4px 8px;">Fuel</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.legs.map(l => `
                                    <tr style="border-top:1px solid var(--border);">
                                        <td style="padding:6px 8px;" class="font-mono">${l.from} → ${l.to}</td>
                                        <td style="padding:6px 8px;">${l.via || 'DIR'}</td>
                                        <td style="padding:6px 8px;" class="font-mono">${l.mag_hdg || '—'}°</td>
                                        <td style="padding:6px 8px;" class="font-mono">${l.dist_nm} nm</td>
                                        <td style="padding:6px 8px;" class="font-mono">${RouteStep.formatTime(l.ete_min)}</td>
                                        <td style="padding:6px 8px;" class="font-mono">${l.fuel_gal?.toFixed(1)}g</td>
                                    </tr>
                                `).join('')}
                                <tr style="border-top:2px solid var(--text-primary);font-weight:700;">
                                    <td colspan="3" style="padding:6px 8px;">TOTAL</td>
                                    <td style="padding:6px 8px;" class="font-mono">${Math.round(totalDist)} nm</td>
                                    <td style="padding:6px 8px;" class="font-mono">${eteStr}</td>
                                    <td style="padding:6px 8px;" class="font-mono">${totalFuel.toFixed(1)}g</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    ` : ''}
                </div>

                <div class="route-summary" style="width:280px;">
                    <div class="card">
                        <div class="card-title">Summary</div>
                        <div class="flex flex-col gap-sm">
                            <div class="flex justify-between">
                                <span>Route:</span>
                                <span class="font-mono">${this.departure || '?'} → ${this.destination || '?'}</span>
                            </div>
                            <div class="flex justify-between">
                                <span>Altitude:</span>
                                <span class="font-mono">${this.altitude.toLocaleString()} ft</span>
                            </div>
                            <div class="flex justify-between">
                                <span>Distance:</span>
                                <span class="font-mono">${totalDist > 0 ? Math.round(totalDist) + ' nm' : '—'}</span>
                            </div>
                            <div class="flex justify-between">
                                <span>ETE:</span>
                                <span class="font-mono">${totalTime > 0 ? eteStr : '—'}</span>
                            </div>
                            <div class="flex justify-between">
                                <span>Fuel req:</span>
                                <span class="font-mono">${totalFuel > 0 ? totalFuel.toFixed(1) + ' gal' : '—'}</span>
                            </div>
                            ${acData?.loading?.fuel_gal ? `
                            <div class="flex justify-between">
                                <span>Reserve:</span>
                                <span class="font-mono">${(acData.loading.fuel_gal - totalFuel).toFixed(1)} gal</span>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Event listeners
        this._bindEvents();
    }

    _bindEvents() {
        const depInput = this.container.querySelector('.route-departure');
        const destInput = this.container.querySelector('.route-destination');
        const altSelect = this.container.querySelector('.altitude-select');

        depInput.addEventListener('change', (e) => {
            this.departure = e.target.value.toUpperCase().trim();
            this._notifyChange();
        });

        destInput.addEventListener('change', (e) => {
            this.destination = e.target.value.toUpperCase().trim();
            this._notifyChange();
        });

        altSelect.addEventListener('change', (e) => {
            this.altitude = parseInt(e.target.value);
            if (this.legs.length > 0) this._calculateRoute();
            this._notifyChange();
        });

        this.container.querySelector('.add-waypoint-btn').addEventListener('click', () => {
            this.waypoints.push({ type: 'fix', id: '' });
            this._render();
        });

        this.container.querySelector('.add-airway-btn').addEventListener('click', () => {
            this.waypoints.push({ type: 'airway', id: '' });
            this._render();
        });

        this.container.querySelectorAll('.remove-wp').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                this.waypoints.splice(idx, 1);
                this._render();
                this._notifyChange();
            });
        });

        this.container.querySelectorAll('.waypoint-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const idx = parseInt(e.target.closest('.waypoint-row').dataset.index);
                this.waypoints[idx].id = e.target.value.toUpperCase().trim();
                this._notifyChange();
            });
        });

        this.container.querySelector('.calc-route-btn').addEventListener('click', () => {
            this._calculateRoute();
        });

        this.container.querySelector('.opt-alt-btn').addEventListener('click', () => {
            this._optimizeAltitude();
        });
    }

    async _calculateRoute() {
        if (!this.departure || !this.destination) {
            alert('Enter departure and destination airports.');
            return;
        }

        // Build fix list: departure, waypoint fixes, destination
        const fixes = [this.departure];
        for (const wp of this.waypoints) {
            if (wp.id) fixes.push(wp.id);
        }
        fixes.push(this.destination);

        // Look up coordinates for each fix
        const coords = [];
        for (const fixId of fixes) {
            const coord = await this._lookupFix(fixId);
            if (coord) {
                coords.push({ id: fixId, ...coord });
            } else {
                alert(`Cannot find fix: ${fixId}`);
                return;
            }
        }

        // Calculate legs
        const acData = this.controller.workflowData.aircraft;
        const burnRate = this._getBurnRate(acData);
        const tas = this._getTas(acData, this.altitude);

        this.legs = [];
        for (let i = 0; i < coords.length - 1; i++) {
            const from = coords[i];
            const to = coords[i + 1];
            const dist = NasrDB.haversineNm(from.lat, from.lon, to.lat, to.lon);
            const hdg = RouteStep.initialBearing(from.lat, from.lon, to.lat, to.lon);
            const gs = tas; // Wind correction will come from Step 3 data
            const eteMin = (dist / gs) * 60;
            const fuelGal = (eteMin / 60) * burnRate;

            // Determine via (airway if waypoint is an airway)
            let via = 'DIR';
            if (i < this.waypoints.length && this.waypoints[i]?.type === 'airway') {
                via = this.waypoints[i].id;
            }

            this.legs.push({
                from: from.id,
                to: to.id,
                via: via,
                dist_nm: Math.round(dist),
                mag_hdg: Math.round(hdg),
                ete_min: Math.round(eteMin),
                fuel_gal: parseFloat(fuelGal.toFixed(1)),
            });
        }

        this._render();
        this._notifyChange();
    }

    async _lookupFix(id) {
        // Try airport first, then navaid
        const airport = await this.db.getAirport(id);
        if (airport && airport.lat && airport.lon) {
            return { lat: airport.lat, lon: airport.lon };
        }
        const navaid = await this.db.getNavaid(id);
        if (navaid && navaid.lat && navaid.lon) {
            return { lat: navaid.lat, lon: navaid.lon };
        }
        return null;
    }

    _getBurnRate(acData) {
        // Default burn rate; could be enhanced with aircraft profile power settings
        return 8.2; // GPH at cruise
    }

    _getTas(acData, altitude) {
        // Simplified TAS estimate: ~130kt at sea level, +2kt per 1000ft
        const baseTas = 130;
        return baseTas + (altitude / 1000) * 2;
    }

    async _optimizeAltitude() {
        // Check if we have winds aloft data from weather step
        const wxData = this.controller.workflowData.weather;
        if (!wxData || !wxData.winds_aloft) {
            alert('Fetch weather first (Step 3) for wind optimization.');
            return;
        }

        // Calculate GS at each candidate altitude
        const acData = this.controller.workflowData.aircraft;
        const burnRate = this._getBurnRate(acData);
        const results = [];

        for (let alt = 3000; alt <= 12000; alt += 1000) {
            const tas = this._getTas(acData, alt);
            // Simple wind model: look up closest altitude in winds_aloft
            const windData = this._getWindAtAlt(wxData.winds_aloft, alt);
            const avgCourse = this._getAverageCourse();
            const gs = windData
                ? RouteStep.groundSpeed(tas, avgCourse, windData.dir, windData.spd)
                : tas;

            const totalDist = this.legs.reduce((s, l) => s + (l.dist_nm || 0), 0) || 300;
            const eteMin = (totalDist / gs) * 60;
            const fuelGal = (eteMin / 60) * burnRate;

            results.push({ alt, tas, gs: Math.round(gs), eteMin: Math.round(eteMin), fuelGal: fuelGal.toFixed(1) });
        }

        // Find best (lowest ETE)
        results.sort((a, b) => a.eteMin - b.eteMin);
        const best = results[0];
        const confirm = window.confirm(
            `Optimal altitude: ${best.alt.toLocaleString()} ft\n` +
            `GS: ${best.gs} kt, ETE: ${RouteStep.formatTime(best.eteMin)}, Fuel: ${best.fuelGal} gal\n\n` +
            `Set altitude to ${best.alt.toLocaleString()} ft?`
        );
        if (confirm) {
            this.altitude = best.alt;
            await this._calculateRoute();
        }
    }

    _getWindAtAlt(windsAloft, altitude) {
        // Find closest altitude key
        const altKeys = Object.keys(windsAloft).map(Number).sort((a, b) => a - b);
        let closest = altKeys[0];
        for (const k of altKeys) {
            if (Math.abs(k - altitude) < Math.abs(closest - altitude)) closest = k;
        }
        return windsAloft[closest] || null;
    }

    _getAverageCourse() {
        if (this.legs.length === 0) return 0;
        const sum = this.legs.reduce((s, l) => s + (l.mag_hdg || 0), 0);
        return sum / this.legs.length;
    }

    _notifyChange() {
        this.controller.dataChanged('route', this.getData());
    }

    validate() {
        if (!this.departure || !this.destination) {
            alert('Enter departure and destination airports.');
            return false;
        }
        if (this.legs.length === 0) {
            alert('Calculate the route before proceeding.');
            return false;
        }
        return true;
    }

    getData() {
        const totalDist = this.legs.reduce((s, l) => s + (l.dist_nm || 0), 0);
        const totalTime = this.legs.reduce((s, l) => s + (l.ete_min || 0), 0);
        const totalFuel = this.legs.reduce((s, l) => s + (l.fuel_gal || 0), 0);

        // Build route array for flight plan package
        const route = [this.departure];
        for (const wp of this.waypoints) {
            if (wp.id) route.push(wp.id);
        }
        route.push(this.destination);

        return {
            departure: this.departure,
            destination: this.destination,
            waypoints: [...this.waypoints],
            route: route,
            legs: [...this.legs],
            altitude: this.altitude,
            totalDist: Math.round(totalDist),
            totalEte: Math.round(totalTime),
            totalFuel: parseFloat(totalFuel.toFixed(1)),
        };
    }

    onEnter() {}
    onLeave() {}

    // ========== Navigation Math ==========

    /**
     * Initial bearing from point 1 to point 2 (degrees, 0-360).
     */
    static initialBearing(lat1, lon1, lat2, lon2) {
        const toRad = Math.PI / 180;
        const dLon = (lon2 - lon1) * toRad;
        const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
        const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
            Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
        let brng = Math.atan2(y, x) * 180 / Math.PI;
        return (brng + 360) % 360;
    }

    /**
     * Calculate groundspeed given TAS, course, wind direction, and wind speed.
     * All angles in degrees, speeds in knots.
     */
    static groundSpeed(tas, course, windDir, windSpeed) {
        const toRad = Math.PI / 180;
        // Wind correction angle
        const headwind = windSpeed * Math.cos((windDir - course) * toRad);
        // Simplified: GS = TAS - headwind component
        return Math.max(tas - headwind, tas * 0.5);
    }

    /**
     * Format minutes as H:MM.
     */
    static formatTime(minutes) {
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        return `${h}:${String(m).padStart(2, '0')}`;
    }
}
