/**
 * PilotStation — Step 2: Route Entry & Optimization
 * Auto-proposes optimal direct route with VFR hemispheric altitude rule.
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
        this.altitude = 0; // 0 = auto (VFR hemispheric rule)
        this.altitudeAuto = true;
        // Default ETD to now, rounded to next 15 min (local time)
        const now = new Date();
        now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
        const pad = (n) => String(n).padStart(2, '0');
        this.departureTime = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
        this.legs = [];
        this._proposing = false;
    }

    async render(container, workflowData) {
        this.container = container;

        // Restore from saved data
        if (workflowData.route) {
            const saved = workflowData.route;
            this.departure = saved.departure || '';
            this.destination = saved.destination || '';
            this.waypoints = saved.waypoints || [];
            this.altitude = saved.altitude || 0;
            this.altitudeAuto = saved.altitudeAuto !== false;
            this.departureTime = saved.departureTime || '';
            this.legs = saved.legs || [];
        }

        this._render();
    }

    _render() {
        const totalDist = this.legs.reduce((s, l) => s + (l.dist_nm || 0), 0);
        const totalTime = this.legs.reduce((s, l) => s + (l.ete_min || 0), 0);
        const totalFuel = this.legs.reduce((s, l) => s + (l.fuel_gal || 0), 0);
        const eteStr = `${Math.floor(totalTime / 60)}:${String(Math.round(totalTime % 60)).padStart(2, '0')}`;

        const acData = this.controller.workflowData.aircraft;
        const acName = acData?.aircraft?.name || '';
        const tas = this._getTas(acData, this.altitude || 5500);
        const burnRate = this._getBurnRate(acData);
        const fuelAvail = acData?.loading?.fuel_gal || acData?.aircraft?.fuel?.usable_gal || 0;
        const reserve = fuelAvail - totalFuel;
        const reserveMin = reserve > 0 ? (reserve / burnRate) * 60 : 0;

        // VFR altitude options with hemispheric labels
        const altOptions = [];
        for (let a = 3000; a <= 17500; a += 500) {
            if (a % 1000 === 500) {
                const dir = ((a - 500) / 1000) % 2 === 1 ? 'E (odd+500)' : 'W (even+500)';
                altOptions.push({ val: a, label: `${a.toLocaleString()} ft — ${dir}` });
            } else {
                altOptions.push({ val: a, label: `${a.toLocaleString()} ft` });
            }
        }

        this.container.innerHTML = `
            <div class="route-layout">
                <div class="route-main">
                    <div class="card">
                        <div class="card-title">Route</div>

                        <div class="loading-row mb-sm">
                            <label class="input-label">Departure</label>
                            <input type="text" class="input route-departure"
                                value="${this.departure}" placeholder="ICAO (e.g., KLKR)"
                                maxlength="5" style="text-transform:uppercase;">
                        </div>

                        <!-- Route string input -->
                        <div class="loading-row mb-sm" style="background:color-mix(in srgb, var(--accent) 5%, transparent);padding:10px;border-radius:6px;border:1px dashed var(--border);">
                            <label class="input-label">Route String <span class="text-sm text-muted">(paste from 1800wxbrief or enter manually)</span></label>
                            <div class="flex gap-sm">
                                <input type="text" class="input route-string-input"
                                    value="${this._getRouteString()}" placeholder="e.g. KLKR CAE SAV SSI 7FL6"
                                    style="text-transform:uppercase;flex:1;">
                                <button class="btn btn-primary parse-route-btn" title="Parse route string">Apply</button>
                            </div>
                            <div class="flex gap-sm mt-sm">
                                <button class="btn btn-secondary suggest-route-btn" style="flex:1;">
                                    Suggest Route (1800wxbrief)
                                </button>
                            </div>
                            <div id="routeSuggestStatus" class="text-sm mt-xs" style="display:none;"></div>
                        </div>

                        <!-- Individual waypoints -->
                        <div id="waypointList" class="waypoint-list mb-sm">
                            ${this.waypoints.length > 0 ? `
                                <label class="input-label text-sm text-muted mb-xs">Intermediate Waypoints</label>
                            ` : ''}
                            ${this.waypoints.map((wp, i) => `
                                <div class="waypoint-row flex items-center gap-sm" data-index="${i}">
                                    <span class="text-sm text-muted" style="min-width:32px;">${wp.type === 'airway' ? 'AWY' : 'FIX'}</span>
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
                                value="${this.destination}" placeholder="ICAO (e.g., 7FL6)"
                                maxlength="5" style="text-transform:uppercase;">
                        </div>

                        <div class="loading-row mb-sm flex items-center gap-sm">
                            <label class="input-label" style="margin:0;white-space:nowrap;">ETD</label>
                            <input type="datetime-local" class="input etd-input"
                                value="${this.departureTime}"
                                style="flex:1;">
                        </div>

                        <div class="loading-row mb-sm">
                            <label class="input-label">Cruise Altitude</label>
                            <div class="flex items-center gap-sm">
                                <select class="select altitude-select" style="flex:1;">
                                    <option value="auto" ${this.altitudeAuto ? 'selected' : ''}>Auto (VFR hemispheric rule)</option>
                                    ${altOptions.map(a => `<option value="${a.val}" ${!this.altitudeAuto && a.val === this.altitude ? 'selected' : ''}>${a.label}</option>`).join('')}
                                </select>
                            </div>
                            ${this.altitudeAuto && this.altitude > 0 ? `
                                <div class="text-sm mt-xs" style="color:var(--accent);">
                                    Recommended: <strong>${this.altitude.toLocaleString()} ft</strong>
                                    ${this._getAltitudeRationale()}
                                </div>
                            ` : ''}
                        </div>

                        <div class="flex gap-sm mt-md">
                            <button class="btn btn-primary calc-route-btn" style="flex:1;">
                                ${this._proposing ? '<span class="spinner"></span> Calculating...' : 'Calculate Route'}
                            </button>
                        </div>
                    </div>

                </div>
            </div>

            ${this.legs.length > 0 ? `
            <!-- Summary strip -->
            <div class="card" style="padding:8px 12px;">
                <div class="flex items-center gap-md" style="flex-wrap:wrap;">
                    ${acName ? `<span class="text-sm"><strong>${acData.aircraft.tail_number}</strong> ${acName} TAS ${acData.aircraft.cruise_tas}kt ${(acData.aircraft.fuel_burn_gph || 7).toFixed(1)}gph</span><span class="text-muted">|</span>` : ''}
                    <span class="font-mono">${this.departure || '?'} → ${this.destination || '?'}</span>
                    <span class="text-muted">|</span>
                    <span class="font-mono">${this.altitude > 0 ? this.altitude.toLocaleString() + 'ft' : '—'}</span>
                    <span class="text-muted">|</span>
                    <span class="font-mono">${totalDist > 0 ? Math.round(totalDist) + 'nm' : '—'}</span>
                    <span class="text-muted">|</span>
                    <span class="font-mono">ETE ${totalTime > 0 ? eteStr : '—'}</span>
                    <span class="text-muted">|</span>
                    <span class="font-mono">Fuel ${totalFuel > 0 ? totalFuel.toFixed(1) + 'gal' : '—'}</span>
                    ${fuelAvail > 0 && totalFuel > 0 ? `
                        <span class="text-muted">|</span>
                        <span class="font-mono" style="${reserve < burnRate * 0.75 ? 'color:var(--color-danger);font-weight:700;' : ''}">Rsv ${reserve.toFixed(1)}gal (${Math.round(reserveMin)}min)</span>
                        ${reserve < 0 ? '<span style="color:var(--color-danger);font-weight:700;">INSUFFICIENT FUEL</span>' : ''}
                        ${reserve > 0 && reserveMin < 45 ? '<span style="color:var(--color-warning);font-weight:600;">&lt;45min VFR</span>' : ''}
                    ` : ''}
                </div>
            </div>

            <!-- Legs table — full width -->
            ${this._renderLegsCard(totalDist, eteStr, totalFuel)}
            ` : ''}
        `;

        this._bindEvents();
    }

    _renderLegsCard(totalDist, eteStr, totalFuel) {
        const hasWind = this.legs.some(l => l.wind);
        const winds = this._windsAloft || {};
        const windAtAlt = this._getWindAtAlt(winds, this.altitude);
        const windSource = this._windSource || '';
        const isEstimated = windAtAlt?.estimated;

        return `
            <div class="card">
                <div class="card-title">
                    Route Legs
                    ${hasWind && windAtAlt ? `
                        <span class="text-sm" style="font-weight:normal;margin-left:12px;color:var(--accent);">
                            Wind at ${this.altitude.toLocaleString()}ft: ${windAtAlt.variable ? 'VRB' : windAtAlt.dir + '°'} @ ${windAtAlt.spd}kt
                            ${windAtAlt.temp !== null ? ` / ${windAtAlt.temp}°C` : ''}
                            ${isEstimated ? ' (est.)' : ''}
                        </span>
                        ${windSource ? `<div class="text-sm text-muted" style="font-weight:normal;margin-left:12px;">${windSource}</div>` : ''}
                    ` : ''}
                    ${!hasWind && this._windError ? `<span class="text-sm" style="font-weight:normal;margin-left:12px;color:var(--color-danger,red);">Wind error: ${this._windError}</span>` : ''}
                    ${!hasWind && !this._windError ? '<span class="text-sm text-muted" style="font-weight:normal;margin-left:12px;">(no wind data — using TAS as GS)</span>' : ''}
                </div>
                <table class="route-table w-full" style="border-collapse:collapse;">
                    <thead>
                        <tr class="text-sm text-muted" style="text-align:left;">
                            <th style="padding:4px 8px;">Leg</th>
                            <th style="padding:4px 8px;">Hdg</th>
                            <th style="padding:4px 8px;">Dist</th>
                            <th style="padding:4px 8px;">TAS</th>
                            <th style="padding:4px 8px;">Wind</th>
                            <th style="padding:4px 8px;">GS</th>
                            <th style="padding:4px 8px;">Time</th>
                            <th style="padding:4px 8px;">Fuel</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.legs.map(l => {
                            let windCell = '—';
                            if (l.wind) {
                                const hw = l.wind.headwind;
                                if (hw > 0) windCell = `<span style="color:var(--color-danger,#d00);">${hw}kt HW</span>`;
                                else if (hw < 0) windCell = `<span style="color:var(--color-success,#080);">${Math.abs(hw)}kt TW</span>`;
                                else windCell = 'calm';
                            }
                            return `
                                <tr style="border-top:1px solid var(--border);">
                                    <td style="padding:6px 8px;" class="font-mono">${l.from} → ${l.to}</td>
                                    <td style="padding:6px 8px;" class="font-mono">${l.mag_hdg || '—'}°</td>
                                    <td style="padding:6px 8px;" class="font-mono">${l.dist_nm} nm</td>
                                    <td style="padding:6px 8px;" class="font-mono">${l.tas_kt || '—'}</td>
                                    <td style="padding:6px 8px;" class="font-mono">${windCell}</td>
                                    <td style="padding:6px 8px;" class="font-mono" style="font-weight:600;">${l.gs_kt || '—'}</td>
                                    <td style="padding:6px 8px;" class="font-mono">${RouteStep.formatTime(l.ete_min)}</td>
                                    <td style="padding:6px 8px;" class="font-mono">${l.fuel_gal?.toFixed(1)}g</td>
                                </tr>
                            `;
                        }).join('')}
                        <tr style="border-top:2px solid var(--text-primary);font-weight:700;">
                            <td colspan="2" style="padding:6px 8px;">TOTAL</td>
                            <td style="padding:6px 8px;" class="font-mono">${Math.round(totalDist)} nm</td>
                            <td colspan="3" style="padding:6px 8px;"></td>
                            <td style="padding:6px 8px;" class="font-mono">${eteStr}</td>
                            <td style="padding:6px 8px;" class="font-mono">${totalFuel.toFixed(1)}g</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    /**
     * Build a route string from current departure/waypoints/destination.
     * Standard format: KLKR CAE SAV SSI 7FL6 (no DCT between waypoints)
     */
    _getRouteString() {
        const parts = [];
        if (this.departure) parts.push(this.departure);
        for (const wp of this.waypoints) {
            if (wp.id) parts.push(wp.id);
        }
        if (this.destination) parts.push(this.destination);
        return parts.join(' ');
    }

    _bindEvents() {
        const depInput = this.container.querySelector('.route-departure');
        const destInput = this.container.querySelector('.route-destination');
        const altSelect = this.container.querySelector('.altitude-select');

        // Auto-propose when departure or destination changes
        depInput.addEventListener('change', (e) => {
            this.departure = e.target.value.toUpperCase().trim();
            this._autoPropose();
        });

        destInput.addEventListener('change', (e) => {
            this.destination = e.target.value.toUpperCase().trim();
            this._autoPropose();
        });

        // Route string parsing
        this.container.querySelector('.parse-route-btn').addEventListener('click', () => {
            const input = this.container.querySelector('.route-string-input');
            this._parseAndApplyRoute(input.value);
        });

        // Also parse on Enter key
        this.container.querySelector('.route-string-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this._parseAndApplyRoute(e.target.value);
            }
        });

        // Suggest route from 1800wxbrief
        this.container.querySelector('.suggest-route-btn').addEventListener('click', () => {
            this._suggestRoute();
        });

        const etdInput = this.container.querySelector('.etd-input');
        etdInput.addEventListener('change', (e) => {
            this.departureTime = e.target.value.trim();
            this._notifyChange();
        });

        altSelect.addEventListener('change', (e) => {
            if (e.target.value === 'auto') {
                this.altitudeAuto = true;
                this._autoPropose();
            } else {
                this.altitudeAuto = false;
                this.altitude = parseInt(e.target.value);
                if (this.departure && this.destination) this._calculateRoute();
            }
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
                this._autoPropose();
            });
        });

        this.container.querySelectorAll('.waypoint-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const idx = parseInt(e.target.closest('.waypoint-row').dataset.index);
                this.waypoints[idx].id = e.target.value.toUpperCase().trim();
                this._autoPropose();
            });
        });

        this.container.querySelector('.calc-route-btn').addEventListener('click', () => {
            this._calculateRoute();
        });
    }

    /**
     * Parse a route string and apply it to the form.
     */
    _parseAndApplyRoute(routeStr) {
        const parsed = FlightPlanFiler.parseRouteString(routeStr);
        if (!parsed) {
            alert('Could not parse route string. Use format: KLKR DCT CLT V222 SAV DCT 7FL6');
            return;
        }

        this.departure = parsed.departure;
        this.destination = parsed.destination;
        this.waypoints = parsed.waypoints;
        this._autoPropose();
    }

    /**
     * Request route recommendation from 1800wxbrief via Worker.
     */
    async _suggestRoute() {
        if (!this.departure || !this.destination) {
            alert('Enter departure and destination first.');
            return;
        }

        const statusEl = this.container.querySelector('#routeSuggestStatus');
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--accent)';
        statusEl.textContent = 'Requesting route recommendation from 1800wxbrief...';

        const acData = this.controller.workflowData.aircraft;
        const result = await FlightPlanFiler.requestRouteRecommendation({
            departure: this.departure,
            destination: this.destination,
            altitude: this.altitude || 5500,
            aircraftType: acData?.aircraft?.type_code || '',
            flightRules: 'VFR',
        });

        if (result.success && result.routes && result.routes.length > 0) {
            // Apply the first recommended route
            const rec = result.routes[0];
            const routeStr = rec.route_string || rec.route || '';
            if (routeStr) {
                statusEl.style.color = 'var(--color-success, green)';
                statusEl.textContent = `Recommended: ${routeStr}`;
                // Prepend departure and append destination if not in route string
                let fullRoute = routeStr;
                if (!fullRoute.toUpperCase().startsWith(this.departure)) {
                    fullRoute = this.departure + ' ' + fullRoute;
                }
                if (!fullRoute.toUpperCase().endsWith(this.destination)) {
                    fullRoute = fullRoute + ' ' + this.destination;
                }
                this._parseAndApplyRoute(fullRoute);
            } else {
                statusEl.style.color = 'var(--text-muted)';
                statusEl.textContent = 'No route recommendation available. Using direct route.';
            }
        } else {
            statusEl.style.color = 'var(--color-danger, red)';
            statusEl.textContent = result.error || 'Route recommendation unavailable. Worker not deployed — enter route manually or use direct.';
            // The user can still enter routes manually via the route string input
        }
    }

    /**
     * Auto-propose route when departure and destination are both set.
     * Selects VFR hemispheric altitude and calculates legs.
     */
    async _autoPropose() {
        if (!this.departure || !this.destination) {
            this._notifyChange();
            this._render();
            return;
        }

        // Look up departure and destination to get bearing for altitude rule
        const depCoord = await this._lookupFix(this.departure);
        const destCoord = await this._lookupFix(this.destination);

        if (!depCoord || !destCoord) {
            this._notifyChange();
            this._render();
            return;
        }

        // Calculate magnetic course for hemispheric rule
        const trueCourse = RouteStep.initialBearing(depCoord.lat, depCoord.lon, destCoord.lat, destCoord.lon);
        const magVar = RouteStep.estimateMagVar(depCoord.lat, depCoord.lon);
        const magCourse = (trueCourse - magVar + 360) % 360;

        // VFR hemispheric rule: 0-179° → odd+500, 180-359° → even+500
        if (this.altitudeAuto) {
            this.altitude = RouteStep.vfrAltitude(magCourse, depCoord, destCoord);
        }

        await this._calculateRoute();
    }

    async _calculateRoute() {
        if (!this.departure || !this.destination) return;

        this._proposing = true;
        this._render();

        try {
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

            // Fetch winds aloft for this route
            const winds = await this._fetchWindsForRoute(coords);
            this._windsAloft = winds; // store for display

            // Calculate legs
            const acData = this.controller.workflowData.aircraft;
            const burnRate = this._getBurnRate(acData);
            const tas = this._getTas(acData, this.altitude);

            this.legs = [];
            for (let i = 0; i < coords.length - 1; i++) {
                const from = coords[i];
                const to = coords[i + 1];
                const dist = NasrDB.haversineNm(from.lat, from.lon, to.lat, to.lon);
                const trueBearing = RouteStep.initialBearing(from.lat, from.lon, to.lat, to.lon);
                const magVar = RouteStep.estimateMagVar(from.lat, from.lon);
                const magHdg = Math.round((trueBearing - magVar + 360) % 360);

                // Get wind at cruise altitude for this leg
                const wind = this._getWindAtAlt(winds, this.altitude);
                let gs = tas;
                let windInfo = null;
                if (wind && !wind.variable && wind.spd > 0) {
                    gs = RouteStep.groundSpeed(tas, trueBearing, wind.dir, wind.spd);
                    // Compute head/tailwind component for display
                    const toRad = Math.PI / 180;
                    const hwComp = wind.spd * Math.cos((wind.dir - trueBearing) * toRad);
                    windInfo = {
                        dir: wind.dir,
                        spd: wind.spd,
                        headwind: Math.round(hwComp), // positive = headwind, negative = tailwind
                    };
                }

                const eteMin = (dist / gs) * 60;
                const fuelGal = (eteMin / 60) * burnRate;

                // Determine via
                let via = 'DIR';
                if (i < this.waypoints.length && this.waypoints[i]?.type === 'airway') {
                    via = this.waypoints[i].id;
                }

                this.legs.push({
                    from: from.id,
                    to: to.id,
                    via: via,
                    dist_nm: Math.round(dist),
                    mag_hdg: magHdg,
                    gs_kt: Math.round(gs),
                    tas_kt: Math.round(tas),
                    ete_min: Math.round(eteMin),
                    fuel_gal: parseFloat(fuelGal.toFixed(1)),
                    wind: windInfo,
                });
            }

            this._notifyChange();
        } finally {
            this._proposing = false;
            this._render();
        }
    }

    /**
     * Fetch FD winds aloft for the route corridor.
     */
    async _fetchWindsForRoute(coords) {
        // Use weather step data if available
        const wxData = this.controller.workflowData.weather;
        if (wxData && wxData.winds_aloft && Object.keys(wxData.winds_aloft).length > 0) {
            this._windSource = 'FD forecast (weather step)';
            this._windError = null;
            return wxData.winds_aloft;
        }

        const dep = coords[0];
        const dest = coords[coords.length - 1];
        const midLat = (dep.lat + dest.lat) / 2;
        const midLon = (dep.lon + dest.lon) / 2;

        // Fetch FD winds aloft text from aviationweather.gov
        try {
            // Use local dev server proxy to avoid CORS issues with text/plain FD data
            const url = `${location.origin}/api/windtemp?region=all&level=low&fcst=06`;
            console.log('Fetching FD winds from:', url);
            const resp = await fetch(url, { cache: 'no-store' });
            console.log('FD response status:', resp.status, resp.statusText);

            if (!resp.ok) {
                this._windError = `FD fetch HTTP ${resp.status}`;
                return {};
            }

            const text = await resp.text();
            console.log('FD text length:', text.length, 'first 200 chars:', text.substring(0, 200));

            // Parse all stations
            const allStations = WeatherClient.parseAllWindsAloft(text);
            const stationCount = Object.keys(allStations).length;
            console.log('Parsed FD stations:', stationCount);

            if (stationCount === 0) {
                this._windError = 'FD text parsed but no stations found';
                return {};
            }

            // Find nearest station
            const nearest = WeatherClient.findNearestFdStation(allStations, midLat, midLon);
            console.log('Nearest FD station:', nearest);

            if (nearest && allStations[nearest]) {
                const winds = allStations[nearest];
                const altKeys = Object.keys(winds).map(Number).sort((a, b) => a - b);
                this._windSource = `FD station ${nearest} (${altKeys.length} levels: ${altKeys.join(', ')}ft)`;
                this._windError = null;
                console.log('Using winds from', nearest, ':', winds);
                return winds;
            }

            // If no station in FD_STATIONS lookup, try first available
            const firstKey = Object.keys(allStations)[0];
            if (firstKey) {
                this._windSource = `FD station ${firstKey} (fallback)`;
                this._windError = null;
                return allStations[firstKey];
            }

            this._windError = 'No matching FD station found';
            return {};
        } catch (err) {
            console.error('FD winds fetch error:', err);
            this._windError = err.message || 'Fetch failed';
            return {};
        }
    }

    async _lookupFix(id) {
        const upper = id.toUpperCase();

        // 3-letter codes → try navaid (VOR) first, then K-prefixed airport
        // 4+ letter codes → try airport first, then navaid
        if (upper.length <= 3) {
            const navaid = await this.db.getNavaid(upper);
            if (navaid && navaid.lat && navaid.lon) {
                return { lat: navaid.lat, lon: navaid.lon };
            }
            // Try as airport with K prefix (e.g., "ATL" → "KATL")
            const airport = await this.db.getAirport('K' + upper);
            if (airport && airport.lat && airport.lon) {
                return { lat: airport.lat, lon: airport.lon };
            }
        }

        // Try direct airport lookup (ICAO codes like KLKR, 7FL6)
        const airport = await this.db.getAirport(upper);
        if (airport && airport.lat && airport.lon) {
            return { lat: airport.lat, lon: airport.lon };
        }

        // Try navaid for longer codes
        const navaid = await this.db.getNavaid(upper);
        if (navaid && navaid.lat && navaid.lon) {
            return { lat: navaid.lat, lon: navaid.lon };
        }

        return null;
    }

    _getBurnRate(acData) {
        return acData?.aircraft?.fuel_burn_gph || 7.0;
    }

    _getTas(acData, altitude) {
        // Use profile TAS, adjust for altitude (TAS increases ~2% per 1000ft above sea level)
        const baseTas = acData?.aircraft?.cruise_tas || 130;
        // Aircraft profile TAS is typically specified at a standard cruise altitude (~8000)
        // Apply a small correction for altitude difference
        const refAlt = 8000;
        const correction = ((altitude - refAlt) / 1000) * (baseTas * 0.02);
        return baseTas + correction;
    }

    _getAltitudeRationale() {
        if (this.legs.length === 0) return '';
        const course = this.legs[0].mag_hdg;
        if (course >= 0 && course < 180) {
            return `(eastbound ${course}° magnetic → odd thousands + 500)`;
        }
        return `(westbound ${course}° magnetic → even thousands + 500)`;
    }

    _getWindAtAlt(windsAloft, altitude) {
        const altKeys = Object.keys(windsAloft).map(Number).sort((a, b) => a - b);
        if (altKeys.length === 0) return null;
        let closest = altKeys[0];
        for (const k of altKeys) {
            if (Math.abs(k - altitude) < Math.abs(closest - altitude)) closest = k;
        }
        return windsAloft[closest] || null;
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
            altitudeAuto: this.altitudeAuto,
            departureTime: this.departureTime,
            totalDist: Math.round(totalDist),
            totalEte: Math.round(totalTime),
            totalFuel: parseFloat(totalFuel.toFixed(1)),
        };
    }

    onEnter() {}
    onLeave() {}

    // ========== Navigation Math ==========

    /**
     * Initial bearing from point 1 to point 2 (true, degrees 0-360).
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
     * Estimate magnetic variation at a location (simplified WMM model).
     * Positive = east declination, negative = west.
     * Accurate within ~2° for CONUS.
     */
    static estimateMagVar(lat, lon) {
        // Simplified linear model for CONUS:
        // MagVar ≈ -6.0 + (lon + 90) * -0.12 + (lat - 35) * 0.05
        // Eastern US: ~-7 to -10, Central: ~0 to -5, Western: ~+10 to +15
        return -6.0 + (lon + 90) * -0.12 + (lat - 35) * 0.05;
    }

    /**
     * Select VFR cruising altitude per hemispheric rule (FAR 91.159).
     * Eastbound (0-179° magnetic): odd thousands + 500 (3500, 5500, 7500, ...)
     * Westbound (180-359° magnetic): even thousands + 500 (4500, 6500, 8500, ...)
     *
     * Selects altitude optimizing for terrain clearance and reasonable cruise level.
     */
    static vfrAltitude(magCourse, depCoord, destCoord) {
        const eastbound = magCourse >= 0 && magCourse < 180;

        // Pick a reasonable default altitude based on distance
        const dist = NasrDB.haversineNm(depCoord.lat, depCoord.lon, destCoord.lat, destCoord.lon);

        // Short flight (<50nm): stay low; medium (<150nm): mid-level; long: higher
        let targetAlt;
        if (dist < 50) targetAlt = 4000;
        else if (dist < 150) targetAlt = 6000;
        else if (dist < 300) targetAlt = 8000;
        else targetAlt = 10000;

        // Round to correct VFR altitude
        if (eastbound) {
            // Odd thousands + 500: 3500, 5500, 7500, 9500, 11500
            const thousands = Math.round(targetAlt / 2000) * 2 - 1; // nearest odd
            const alt = thousands * 1000 + 500;
            return Math.max(3500, Math.min(alt, 17500));
        } else {
            // Even thousands + 500: 4500, 6500, 8500, 10500
            const thousands = Math.round(targetAlt / 2000) * 2; // nearest even
            const alt = thousands * 1000 + 500;
            return Math.max(4500, Math.min(alt, 16500));
        }
    }

    /**
     * Calculate groundspeed given TAS, true course, wind direction (from), and wind speed.
     */
    static groundSpeed(tas, course, windDir, windSpeed) {
        const toRad = Math.PI / 180;
        // Wind correction: headwind component
        const wca = (windDir - course) * toRad;
        const headwind = windSpeed * Math.cos(wca);
        const crosswind = windSpeed * Math.sin(wca);
        // More accurate: GS = sqrt(TAS² - crosswind²) - headwind
        const tasSquared = tas * tas;
        const crossSquared = crosswind * crosswind;
        if (crossSquared >= tasSquared) return tas * 0.5; // extreme crosswind guard
        return Math.max(Math.sqrt(tasSquared - crossSquared) - headwind, tas * 0.3);
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
