/**
 * PilotStation — Step 5: Briefing
 * Smart briefing (rules-based), go/no-go assessment, official briefing request.
 * WX-36, FILE-10, FILE-11, PLAN-16, WX-30–WX-35
 */

class BriefingStep {
    constructor({ controller, db }) {
        this.controller = controller;
        this.db = db;
        this.container = null;
        this.officialBriefing = null;
        this.requesting = false;
    }

    async render(container, workflowData) {
        this.container = container;

        // Restore official briefing from saved data
        if (workflowData.briefing?.officialBriefing) {
            this.officialBriefing = workflowData.briefing.officialBriefing;
        }

        this._render();
    }

    _render() {
        if (!this.container) return;

        const wxData = this.controller.workflowData.weather;
        const routeData = this.controller.workflowData.route;
        const acData = this.controller.workflowData.aircraft;

        if (!routeData || !routeData.departure) {
            this.container.innerHTML = `
                <div class="card">
                    <div class="card-title">Briefing</div>
                    <p class="text-muted">Complete Route and Weather steps first.</p>
                </div>
            `;
            return;
        }

        const smartBriefing = this._generateSmartBriefing(wxData, routeData, acData);
        const goNogo = this._assessGoNogo(wxData, routeData, acData);

        this.container.innerHTML = `
            <!-- Go/No-Go Assessment -->
            <div class="card">
                <div class="card-title">Go / No-Go Assessment</div>
                <div class="go-nogo-badge ${goNogo.status.toLowerCase()}" style="font-size:16px;padding:8px 20px;margin-bottom:12px;">
                    ${goNogo.status}
                </div>
                <div class="briefing-weather-passage">
                    ${goNogo.reasons.map(r => `
                        <div class="flex items-center gap-sm mb-sm">
                            <span class="indicator ${r.severity === 'ok' ? 'indicator-ok' : r.severity === 'caution' ? 'indicator-warn' : 'indicator-error'}">
                                ${r.severity === 'ok' ? '&#x2713;' : r.severity === 'caution' ? '&#x26A0;' : '&#x2717;'}
                            </span>
                            <span>${r.message}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Smart Briefing: Weather at Time of Passage -->
            <div class="card">
                <div class="card-title">Smart Briefing — Weather at Time of Passage</div>
                <div class="briefing-weather-passage">
                    ${smartBriefing.passages.length > 0 ? smartBriefing.passages.map(p => `
                        <div class="waypoint-weather">
                            <span class="cat-dot ${(p.category || 'vfr').toLowerCase()}"></span>
                            <span class="waypoint-name">${p.station}</span>
                            <span class="waypoint-eta">${p.eta || ''}</span>
                            <div class="text-sm mt-sm">
                                ${p.conditions || 'No data'}
                            </div>
                        </div>
                    `).join('') : `
                        <p class="text-muted">Fetch weather (Step 3) to see time-of-passage analysis.</p>
                    `}
                </div>
            </div>

            <!-- PIREPs & SIGMETs Summary -->
            ${this._renderHazards(wxData)}

            <!-- Official Briefing -->
            <div class="card">
                <div class="card-title">Official Weather Briefing (1800wxbrief)</div>
                ${this.officialBriefing ? `
                    <div class="official-briefing">
                        <div class="flex items-center gap-sm mb-sm">
                            <span class="indicator indicator-ok">&#x2713;</span>
                            <span><strong>Briefing obtained</strong></span>
                        </div>
                        <div class="flex justify-between mb-sm">
                            <span>Confirmation #:</span>
                            <span class="confirmation-number">${this.officialBriefing.confirmation || '—'}</span>
                        </div>
                        <div class="text-sm text-muted">
                            Obtained: ${this.officialBriefing.obtained_at
                                ? new Date(this.officialBriefing.obtained_at).toLocaleString()
                                : '—'}
                        </div>
                    </div>
                ` : `
                    <p class="text-muted mb-sm">
                        Request an official FAA weather briefing. This will be logged by Leidos Flight Service.
                    </p>
                    <button class="btn btn-primary request-briefing-btn" ${this.requesting ? 'disabled' : ''}>
                        ${this.requesting ? '<span class="spinner"></span> Requesting...' : 'Request Official Briefing'}
                    </button>
                `}
            </div>

            <!-- AI Copilot Panel (Phase 2 placeholder) -->
            <div class="card ai-panel" style="opacity:0.6;">
                <div class="ai-panel-header">
                    <span class="card-title" style="margin-bottom:0;">AI Weather Analysis</span>
                    <span class="text-sm text-muted">Phase 2</span>
                </div>
                <p class="text-muted text-sm">
                    AI-powered weather analysis, NOTAM filtering, and alternate suggestions
                    will be available in a future update.
                </p>
            </div>
        `;

        // Event listeners
        const briefingBtn = this.container.querySelector('.request-briefing-btn');
        if (briefingBtn) {
            briefingBtn.addEventListener('click', () => this._requestOfficialBriefing());
        }
    }

    /**
     * Generate smart briefing: weather at time of passage for each waypoint.
     */
    _generateSmartBriefing(wxData, routeData, acData) {
        const passages = [];
        if (!wxData || !routeData?.legs) return { passages };

        const metars = wxData.metars || {};
        const tafs = wxData.tafs || {};

        // Calculate cumulative ETE for each waypoint
        let cumulativeMin = 0;
        const now = new Date();

        // Departure
        const depMetar = metars[routeData.departure];
        passages.push({
            station: routeData.departure,
            eta: 'Departure',
            category: depMetar?.decoded?.flight_category || 'VFR',
            conditions: this._formatConditions(depMetar?.decoded),
        });

        // Each leg endpoint
        for (const leg of routeData.legs) {
            cumulativeMin += leg.ete_min || 0;
            const etaTime = new Date(now.getTime() + cumulativeMin * 60000);
            const etaStr = `+${Math.round(cumulativeMin)} min (${etaTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;

            const metar = metars[leg.to];
            passages.push({
                station: leg.to,
                eta: etaStr,
                category: metar?.decoded?.flight_category || 'VFR',
                conditions: this._formatConditions(metar?.decoded),
            });
        }

        return { passages };
    }

    _formatConditions(decoded) {
        if (!decoded) return 'No weather data available';

        const parts = [];
        if (decoded.wind_dir !== null) {
            parts.push(`Wind ${decoded.wind_dir}°@${decoded.wind_speed}kt${decoded.wind_gust ? ' G' + decoded.wind_gust : ''}`);
        }
        if (decoded.visibility !== null) {
            parts.push(`Vis ${decoded.visibility}SM`);
        }
        if (decoded.ceiling !== null) {
            parts.push(`Ceil ${decoded.ceiling} AGL`);
        } else {
            parts.push('CLR');
        }
        if (decoded.weather && decoded.weather.length > 0) {
            parts.push(decoded.weather.join(' '));
        }
        return parts.join(' | ');
    }

    /**
     * Rules-based go/no-go assessment against personal minimums.
     */
    _assessGoNogo(wxData, routeData, acData) {
        const reasons = [];
        let worstStatus = 'GO';

        // Check if we have weather
        if (!wxData) {
            return { status: 'CAUTION', reasons: [{ severity: 'caution', message: 'Weather not yet fetched' }] };
        }

        const metars = wxData.metars || {};
        const profile = acData?.aircraft;

        // Personal minimums (from aircraft profile or defaults)
        const minimums = profile?.personal_minimums || {
            ceiling_min: 3000,
            visibility_min: 5,
            crosswind_max: 15,
            wind_gust_max: 25,
        };

        // Check departure and destination weather
        for (const station of [routeData.departure, routeData.destination]) {
            const metar = metars[station];
            if (!metar?.decoded) {
                reasons.push({ severity: 'caution', message: `${station}: No METAR available` });
                if (worstStatus === 'GO') worstStatus = 'CAUTION';
                continue;
            }

            const d = metar.decoded;

            // Flight category
            if (d.flight_category === 'LIFR') {
                reasons.push({ severity: 'nogo', message: `${station}: LIFR conditions` });
                worstStatus = 'NO-GO';
            } else if (d.flight_category === 'IFR') {
                reasons.push({ severity: 'nogo', message: `${station}: IFR conditions` });
                worstStatus = 'NO-GO';
            } else if (d.flight_category === 'MVFR') {
                reasons.push({ severity: 'caution', message: `${station}: MVFR conditions` });
                if (worstStatus === 'GO') worstStatus = 'CAUTION';
            } else {
                reasons.push({ severity: 'ok', message: `${station}: VFR` });
            }

            // Ceiling check
            if (d.ceiling !== null && d.ceiling < minimums.ceiling_min) {
                reasons.push({ severity: 'nogo', message: `${station}: Ceiling ${d.ceiling} AGL below minimum ${minimums.ceiling_min}` });
                worstStatus = 'NO-GO';
            }

            // Visibility check
            if (d.visibility !== null && d.visibility < minimums.visibility_min) {
                reasons.push({ severity: 'nogo', message: `${station}: Visibility ${d.visibility}SM below minimum ${minimums.visibility_min}` });
                worstStatus = 'NO-GO';
            }

            // Wind gust check
            if (d.wind_gust && d.wind_gust > minimums.wind_gust_max) {
                reasons.push({ severity: 'caution', message: `${station}: Gusts ${d.wind_gust}kt exceed ${minimums.wind_gust_max}kt limit` });
                if (worstStatus === 'GO') worstStatus = 'CAUTION';
            }
        }

        // W&B check
        const wbData = this.controller.workflowData.wb;
        if (wbData) {
            if (wbData.in_envelope) {
                reasons.push({ severity: 'ok', message: 'W&B within envelope' });
            } else {
                reasons.push({ severity: 'nogo', message: 'W&B out of envelope or over max gross' });
                worstStatus = 'NO-GO';
            }
        }

        // Fuel check
        if (routeData.totalFuel && acData?.loading?.fuel_gal) {
            const reserve = acData.loading.fuel_gal - routeData.totalFuel;
            const reserveMin = (reserve / 8.2) * 60; // minutes
            if (reserve < 0) {
                reasons.push({ severity: 'nogo', message: `Insufficient fuel: need ${routeData.totalFuel.toFixed(1)} gal, have ${acData.loading.fuel_gal.toFixed(1)} gal` });
                worstStatus = 'NO-GO';
            } else if (reserveMin < 45) {
                reasons.push({ severity: 'caution', message: `Low fuel reserve: ${Math.round(reserveMin)} min (VFR requires 30 min day / 45 min night)` });
                if (worstStatus === 'GO') worstStatus = 'CAUTION';
            } else {
                reasons.push({ severity: 'ok', message: `Fuel reserve: ${reserve.toFixed(1)} gal (${Math.round(reserveMin)} min)` });
            }
        }

        // SIGMET check
        const sigmets = wxData.sigmets || [];
        if (sigmets.length > 0) {
            reasons.push({ severity: 'caution', message: `${sigmets.length} active SIGMET(s)/AIRMET(s) — review before flight` });
            if (worstStatus === 'GO') worstStatus = 'CAUTION';
        }

        return { status: worstStatus, reasons };
    }

    _renderHazards(wxData) {
        if (!wxData) return '';

        const pireps = wxData.pireps || [];
        const sigmets = wxData.sigmets || [];

        if (pireps.length === 0 && sigmets.length === 0) {
            return `
                <div class="card">
                    <div class="card-title">Hazards</div>
                    <p class="text-muted">No PIREPs or SIGMETs/AIRMETs in route corridor.</p>
                </div>
            `;
        }

        return `
            <div class="card">
                <div class="card-title">Hazards & Advisories</div>
                ${sigmets.length > 0 ? `
                    <div class="weather-section">
                        <div class="weather-section-title">
                            SIGMETs/AIRMETs <span class="count">${sigmets.length}</span>
                        </div>
                        ${sigmets.slice(0, 5).map(s => `
                            <div class="weather-raw mb-sm" style="padding:6px;border:1px solid var(--color-caution);border-radius:4px;">
                                ${s.rawAirSigmet || s.raw_text || JSON.stringify(s)}
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                ${pireps.length > 0 ? `
                    <div class="weather-section mt-sm">
                        <div class="weather-section-title">
                            PIREPs <span class="count">${pireps.length}</span>
                        </div>
                        ${pireps.slice(0, 5).map(p => `
                            <div class="weather-raw mb-sm">${p.rawOb || p.raw_text || JSON.stringify(p)}</div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    async _requestOfficialBriefing() {
        const routeData = this.controller.workflowData.route;
        if (!routeData) return;

        this.requesting = true;
        this._render();

        try {
            const result = await FlightPlanFiler.requestBriefing({
                type: 'standard',
                departure: routeData.departure,
                destination: routeData.destination,
                route: routeData.route?.join(' ') || '',
                altitude: routeData.altitude,
                aircraftType: this.controller.workflowData.aircraft?.aircraft?.type_code || '',
            });

            if (result.success) {
                this.officialBriefing = {
                    confirmation: result.confirmation,
                    obtained_at: new Date().toISOString(),
                    text: result.briefing_text,
                };
                this._notifyChange();
            } else {
                alert(`Briefing request failed: ${result.error}`);
            }
        } catch (err) {
            alert(`Briefing request error: ${err.message}`);
        } finally {
            this.requesting = false;
            this._render();
        }
    }

    _notifyChange() {
        this.controller.dataChanged('briefing', this.getData());
    }

    validate() {
        // Don't require official briefing, but warn
        if (!this.officialBriefing) {
            const proceed = confirm(
                'You have not obtained an official weather briefing.\n\n' +
                'FAR 91.103 requires pilots to become familiar with all available information ' +
                'concerning the flight. An official briefing provides a record with Leidos Flight Service.\n\n' +
                'Proceed without official briefing?'
            );
            return proceed;
        }
        return true;
    }

    getData() {
        return {
            officialBriefing: this.officialBriefing,
            smartBriefing: this._generateSmartBriefing(
                this.controller.workflowData.weather,
                this.controller.workflowData.route,
                this.controller.workflowData.aircraft
            ),
            goNogo: this._assessGoNogo(
                this.controller.workflowData.weather,
                this.controller.workflowData.route,
                this.controller.workflowData.aircraft
            ),
        };
    }

    onEnter() {}
    onLeave() {}
}
