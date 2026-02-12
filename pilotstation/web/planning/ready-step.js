/**
 * PilotStation — Step 6: Ready / Filing
 * Summary checklist, flight plan filing form, upload to Pi.
 * PLAN-09, PLAN-17, PLAN-18, FILE-04 through FILE-08
 */

class ReadyStep {
    constructor({ controller, db }) {
        this.controller = controller;
        this.db = db;
        this.container = null;

        // Filing form state
        this.flightRules = 'VFR';
        this.departureTime = '';
        this.alternate = '';
        this.equipmentSuffix = '/G';
        this.remarks = '';
        this.pilotName = '';
        this.pilotPhone = '';

        // Filing status
        this.filedPlan = null;
        this.filing = false;
        this.uploading = false;
        this.uploadProgress = 0;
    }

    async render(container, workflowData) {
        this.container = container;

        // Restore saved filing data
        if (workflowData.ready) {
            const saved = workflowData.ready;
            this.flightRules = saved.flightRules || 'VFR';
            this.departureTime = saved.departureTime || '';
            this.alternate = saved.alternate || '';
            this.equipmentSuffix = saved.equipmentSuffix || '/G';
            this.remarks = saved.remarks || '';
            this.pilotName = saved.pilotName || '';
            this.pilotPhone = saved.pilotPhone || '';
            this.filedPlan = saved.filedPlan || null;
        }

        // Pre-fill from previous steps
        this._prefill(workflowData);

        // Load saved pilot info from meta
        if (!this.pilotName) {
            const pilotInfo = await this.db.getMeta('pilot_info');
            if (pilotInfo) {
                this.pilotName = pilotInfo.name || '';
                this.pilotPhone = pilotInfo.phone || '';
            }
        }

        this._render();
    }

    /**
     * Pre-fill filing form fields from previous step data.
     */
    _prefill(wd) {
        // Departure time from route step (convert local datetime to UTC HHMM)
        if (!this.departureTime && wd.route?.departureTime) {
            const dt = new Date(wd.route.departureTime);
            if (!isNaN(dt)) {
                const hh = String(dt.getUTCHours()).padStart(2, '0');
                const mm = String(dt.getUTCMinutes()).padStart(2, '0');
                this.departureTime = hh + mm;
            }
        }
    }

    _render() {
        if (!this.container) return;

        const wd = this.controller.workflowData;
        const checklist = this._buildChecklist(wd);
        const pob = wd.aircraft?.loading?.total_pax || 1;
        const route = wd.route || {};
        const ac = wd.aircraft || {};
        const acProfile = ac.aircraft || {};
        const wb = wd.wb || {};
        const eteStr = route.totalEte
            ? `${Math.floor(route.totalEte / 60)}:${String(Math.round(route.totalEte % 60)).padStart(2, '0')}`
            : '—';
        const fuelOnBoard = ac.loading?.fuel_gal || 0;
        const reserve = fuelOnBoard - (route.totalFuel || 0);
        const burnRate = acProfile.fuel_burn_gph || 7;
        const reserveMin = reserve > 0 ? (reserve / burnRate) * 60 : 0;

        this.container.innerHTML = `
            <!-- Flight Summary (read-only from previous steps) -->
            <div class="card" style="padding:8px 12px;">
                <div class="flex items-center gap-md" style="flex-wrap:wrap;">
                    <strong>${acProfile.tail_number || '?'}</strong>
                    <span class="font-mono">${route.departure || '?'} → ${route.route?.slice(1, -1).join(' ') || ''} → ${route.destination || '?'}</span>
                    <span class="text-muted">|</span>
                    <span class="font-mono">${route.altitude ? route.altitude.toLocaleString() + 'ft' : '—'}</span>
                    <span class="text-muted">|</span>
                    <span class="font-mono">${route.totalDist || '—'}nm</span>
                    <span class="text-muted">|</span>
                    <span class="font-mono">ETE ${eteStr}</span>
                    <span class="text-muted">|</span>
                    <span class="font-mono">Fuel ${(route.totalFuel || 0).toFixed(1)}/${fuelOnBoard.toFixed(1)}gal</span>
                    <span class="text-muted">|</span>
                    <span class="font-mono" style="${reserveMin < 45 ? 'color:var(--color-warning);font-weight:600;' : ''}">Rsv ${reserve.toFixed(1)}gal (${Math.round(reserveMin)}min)</span>
                    ${wb.takeoff_weight ? `<span class="text-muted">|</span><span class="font-mono">${wb.takeoff_weight}lb ${wb.in_envelope ? 'IN ENV' : '<span style="color:var(--color-danger);">OUT OF ENV</span>'}</span>` : ''}
                </div>
            </div>

            <!-- Pre-Flight Checklist -->
            <div class="card" style="padding:8px 12px;">
                <div class="flex items-center gap-md" style="flex-wrap:wrap;">
                    ${checklist.map(item => `
                        <span style="color:${item.ok ? 'var(--color-success,green)' : 'var(--color-danger,red)'};">
                            ${item.ok ? '&#x2713;' : '&#x2717;'} ${item.label}
                            ${item.detail ? `<span class="text-sm text-muted">(${item.detail})</span>` : ''}
                        </span>
                    `).join('<span class="text-muted">|</span>')}
                </div>
            </div>

            <!-- Flight Plan Filing -->
            <div class="card">
                <div class="card-title">File Flight Plan</div>

                ${this.filedPlan ? `
                    <div class="filing-status filed mb-md">
                        <span>&#x2713;</span>
                        <div>
                            <div>Flight Plan Filed</div>
                            <div class="plan-id">${this.filedPlan.flight_identifier || '—'}</div>
                            <div class="text-sm text-muted">${this.filedPlan.filed_at ? new Date(this.filedPlan.filed_at).toLocaleString() : ''}</div>
                        </div>
                    </div>
                    <div class="flex gap-sm mb-md">
                        <button class="btn btn-secondary amend-btn">Amend</button>
                        <button class="btn btn-danger cancel-btn">Cancel Plan</button>
                    </div>
                ` : ''}

                <!-- Pre-filled read-only fields from route -->
                <div class="filing-form" style="gap:6px;">
                    <div class="flex items-center gap-sm" style="grid-column:1/-1;background:var(--bg-surface);padding:6px 10px;border-radius:4px;">
                        <span class="text-sm text-muted" style="min-width:100px;">Aircraft</span>
                        <span class="font-mono">${acProfile.type_code || '?'} / ${acProfile.tail_number || '?'} — TAS ${acProfile.cruise_tas || '?'}kt</span>
                    </div>
                    <div class="flex items-center gap-sm" style="grid-column:1/-1;background:var(--bg-surface);padding:6px 10px;border-radius:4px;">
                        <span class="text-sm text-muted" style="min-width:100px;">Route</span>
                        <span class="font-mono">${route.departure || '?'} ${route.route?.slice(1, -1).join(' ') || 'DCT'} ${route.destination || '?'}</span>
                    </div>
                    <div class="flex items-center gap-sm" style="grid-column:1/-1;background:var(--bg-surface);padding:6px 10px;border-radius:4px;">
                        <span class="text-sm text-muted" style="min-width:100px;">Altitude</span>
                        <span class="font-mono">${route.altitude ? route.altitude.toLocaleString() + ' ft' : '—'}</span>
                        <span class="text-muted" style="margin-left:24px;">ETE</span>
                        <span class="font-mono">${eteStr}</span>
                        <span class="text-muted" style="margin-left:24px;">Fuel endurance</span>
                        <span class="font-mono">${fuelOnBoard > 0 && burnRate > 0 ? `${Math.floor(fuelOnBoard/burnRate)}:${String(Math.round((fuelOnBoard/burnRate % 1)*60)).padStart(2,'0')}` : '—'}</span>
                    </div>

                    <!-- Editable filing fields -->
                    <div>
                        <label class="input-label">Flight Rules</label>
                        <div class="toggle-group">
                            <button class="toggle-btn flight-rules-btn ${this.flightRules === 'VFR' ? 'active' : ''}" data-rules="VFR">VFR</button>
                            <button class="toggle-btn flight-rules-btn ${this.flightRules === 'IFR' ? 'active' : ''}" data-rules="IFR">IFR</button>
                        </div>
                    </div>
                    <div>
                        <label class="input-label">Departure (UTC)</label>
                        <input type="text" class="input departure-time-input"
                            value="${this.departureTime}" placeholder="HHMM (e.g., 1430)"
                            maxlength="4" inputmode="numeric">
                    </div>
                    <div>
                        <label class="input-label">Equipment Suffix</label>
                        <select class="select equip-suffix-select">
                            ${Object.entries(FlightPlanFiler.EQUIPMENT_SUFFIXES).map(([k, v]) =>
                                `<option value="${k}" ${k === this.equipmentSuffix ? 'selected' : ''}>${k} — ${v}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="input-label">Alternate Airport</label>
                        <input type="text" class="input alternate-input"
                            value="${this.alternate}" placeholder="ICAO (optional)"
                            maxlength="5" style="text-transform:uppercase;">
                    </div>
                    <div>
                        <label class="input-label">People on Board</label>
                        <input type="number" class="input pob-input"
                            value="${pob}" min="1" max="20" inputmode="numeric">
                    </div>
                    <div>
                        <label class="input-label">Pilot Name</label>
                        <input type="text" class="input pilot-name-input"
                            value="${this.pilotName}" placeholder="Last, First">
                    </div>
                    <div>
                        <label class="input-label">Pilot Phone</label>
                        <input type="tel" class="input pilot-phone-input"
                            value="${this.pilotPhone}" placeholder="555-123-4567">
                    </div>
                    <div class="full-width">
                        <label class="input-label">Remarks</label>
                        <input type="text" class="input remarks-input"
                            value="${this.remarks}" placeholder="Optional remarks">
                    </div>
                </div>

                ${!this.filedPlan ? `
                    <button class="btn btn-primary file-btn mt-md w-full" ${this.filing ? 'disabled' : ''}>
                        ${this.filing ? '<span class="spinner"></span> Filing...' : 'File Flight Plan via 1800wxbrief'}
                    </button>
                ` : ''}
            </div>

            <!-- Upload to PilotStation (Pi) -->
            <div class="card">
                <div class="card-title">Upload to PilotStation</div>
                <p class="text-sm text-muted mb-sm">
                    Upload the complete flight plan package to the Stratux Pi for use in cockpit mode.
                    Requires Stratux WiFi connection.
                </p>
                <button class="btn btn-primary upload-btn" ${this.uploading ? 'disabled' : ''}>
                    ${this.uploading ? '<span class="spinner"></span> Uploading...' : 'Upload to PilotStation'}
                </button>
                ${this.uploading ? `
                    <div class="progress-bar mt-sm">
                        <div class="progress-bar-fill" style="width:${this.uploadProgress}%;"></div>
                    </div>
                ` : ''}
            </div>
        `;

        this._bindEvents();
    }

    _bindEvents() {
        // Flight rules toggle
        this.container.querySelectorAll('.flight-rules-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.flightRules = e.target.dataset.rules;
                this.container.querySelectorAll('.flight-rules-btn').forEach(b =>
                    b.classList.toggle('active', b.dataset.rules === this.flightRules));
                this._notifyChange();
            });
        });

        // Text inputs
        const bindInput = (selector, field) => {
            const input = this.container.querySelector(selector);
            if (input) {
                input.addEventListener('change', (e) => {
                    this[field] = e.target.value;
                    this._notifyChange();
                });
            }
        };

        bindInput('.departure-time-input', 'departureTime');
        bindInput('.alternate-input', 'alternate');
        bindInput('.remarks-input', 'remarks');
        bindInput('.pilot-name-input', 'pilotName');
        bindInput('.pilot-phone-input', 'pilotPhone');

        const equipSelect = this.container.querySelector('.equip-suffix-select');
        if (equipSelect) {
            equipSelect.addEventListener('change', (e) => {
                this.equipmentSuffix = e.target.value;
                this._notifyChange();
            });
        }

        // File button
        const fileBtn = this.container.querySelector('.file-btn');
        if (fileBtn) {
            fileBtn.addEventListener('click', () => this._filePlan());
        }

        // Amend / Cancel buttons
        const amendBtn = this.container.querySelector('.amend-btn');
        if (amendBtn) {
            amendBtn.addEventListener('click', () => this._amendPlan());
        }

        const cancelBtn = this.container.querySelector('.cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this._cancelPlan());
        }

        // Upload button
        const uploadBtn = this.container.querySelector('.upload-btn');
        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => this._uploadToPi());
        }
    }

    _buildChecklist(wd) {
        const items = [];

        // Aircraft
        items.push({
            label: 'Aircraft selected',
            ok: !!wd.aircraft?.aircraft,
            detail: wd.aircraft?.aircraft?.name || '',
        });

        // Route
        items.push({
            label: 'Route calculated',
            ok: !!wd.route?.legs?.length,
            detail: wd.route ? `${wd.route.departure} → ${wd.route.destination}` : '',
        });

        // Weather
        items.push({
            label: 'Weather fetched',
            ok: !!wd.weather?.fetched_at,
            detail: wd.weather?.fetched_at
                ? new Date(wd.weather.fetched_at).toLocaleTimeString()
                : '',
        });

        // W&B
        items.push({
            label: 'W&B in envelope',
            ok: wd.wb?.in_envelope === true,
            detail: wd.wb ? `${wd.wb.takeoff_weight} lb` : '',
        });

        // Fuel
        const fuelOk = wd.route?.totalFuel && wd.aircraft?.loading?.fuel_gal
            && wd.aircraft.loading.fuel_gal >= wd.route.totalFuel;
        items.push({
            label: 'Fuel sufficient',
            ok: fuelOk,
            detail: wd.route?.totalFuel ? `${wd.route.totalFuel.toFixed(1)} gal needed` : '',
        });

        // Briefing
        items.push({
            label: 'Briefing reviewed',
            ok: !!wd.briefing,
            detail: wd.briefing?.officialBriefing?.confirmation
                ? `#${wd.briefing.officialBriefing.confirmation}`
                : '',
        });

        return items;
    }

    _renderSummary(wd) {
        const route = wd.route;
        const ac = wd.aircraft;
        if (!route) return '<p class="text-muted">No route data</p>';

        const eteStr = route.totalEte
            ? `${Math.floor(route.totalEte / 60)}:${String(Math.round(route.totalEte % 60)).padStart(2, '0')}`
            : '—';

        return `
            <div class="flex flex-col gap-sm">
                <div class="flex justify-between">
                    <span>Route:</span>
                    <span class="font-mono">${route.departure || '?'} → ${route.destination || '?'}</span>
                </div>
                <div class="flex justify-between">
                    <span>Via:</span>
                    <span class="font-mono text-sm">${route.route?.join(' ') || 'Direct'}</span>
                </div>
                <div class="flex justify-between">
                    <span>Altitude:</span>
                    <span class="font-mono">${route.altitude?.toLocaleString() || '?'} ft</span>
                </div>
                <div class="flex justify-between">
                    <span>Distance:</span>
                    <span class="font-mono">${route.totalDist || '?'} nm</span>
                </div>
                <div class="flex justify-between">
                    <span>ETE:</span>
                    <span class="font-mono">${eteStr}</span>
                </div>
                <div class="flex justify-between">
                    <span>Fuel Required:</span>
                    <span class="font-mono">${route.totalFuel?.toFixed(1) || '?'} gal</span>
                </div>
                ${ac?.loading ? `
                <div class="flex justify-between">
                    <span>Fuel On Board:</span>
                    <span class="font-mono">${ac.loading.fuel_gal?.toFixed(1) || '?'} gal</span>
                </div>
                <div class="flex justify-between">
                    <span>Reserve:</span>
                    <span class="font-mono">${((ac.loading.fuel_gal || 0) - (route.totalFuel || 0)).toFixed(1)} gal</span>
                </div>
                ` : ''}
                <div class="flex justify-between">
                    <span>Aircraft:</span>
                    <span class="font-mono">${ac?.aircraft?.name || '?'} ${ac?.aircraft?.tail_number || ''}</span>
                </div>
            </div>
        `;
    }

    async _filePlan() {
        const wd = this.controller.workflowData;

        // Validate minimum fields
        if (!this.departureTime) {
            alert('Enter a proposed departure time (UTC HHMM).');
            return;
        }
        if (!this.pilotName) {
            alert('Enter pilot name.');
            return;
        }

        this.filing = true;
        this._render();

        try {
            // Save pilot info for future use
            await this.db.setMeta('pilot_info', {
                name: this.pilotName,
                phone: this.pilotPhone,
            });

            // Build plan data
            const planData = {
                flight_plan: wd.route,
                aircraft: wd.aircraft?.aircraft || {},
                loading: wd.aircraft?.loading || {},
                filed_plan: {
                    flight_rules: this.flightRules,
                    proposed_departure: this.departureTime,
                    people_on_board: this.container.querySelector('.pob-input')?.value || 1,
                    equipment_suffix: this.equipmentSuffix,
                    alternate: this.alternate.toUpperCase(),
                    remarks: this.remarks,
                },
            };

            const result = await FlightPlanFiler.filePlan(planData, {
                name: this.pilotName,
                phone: this.pilotPhone,
            });

            if (result.success) {
                this.filedPlan = {
                    flight_identifier: result.flight_identifier,
                    version_stamp: result.version_stamp,
                    filed_at: new Date().toISOString(),
                    status: 'filed',
                };
                this._notifyChange();
            } else {
                alert(`Filing failed: ${result.error}`);
            }
        } catch (err) {
            alert(`Filing error: ${err.message}`);
        } finally {
            this.filing = false;
            this._render();
        }
    }

    async _amendPlan() {
        if (!this.filedPlan?.flight_identifier) return;
        const reason = prompt('Reason for amendment:');
        if (!reason) return;

        try {
            const result = await FlightPlanFiler.amendPlan(
                this.filedPlan.flight_identifier,
                { remarks: reason }
            );
            if (result.success) {
                this.filedPlan.version_stamp = result.version_stamp;
                alert('Flight plan amended successfully.');
                this._notifyChange();
                this._render();
            } else {
                alert(`Amendment failed: ${result.error}`);
            }
        } catch (err) {
            alert(`Amendment error: ${err.message}`);
        }
    }

    async _cancelPlan() {
        if (!this.filedPlan?.flight_identifier) return;
        if (!confirm('Cancel this flight plan?')) return;

        try {
            const result = await FlightPlanFiler.cancelPlan(this.filedPlan.flight_identifier);
            if (result.success) {
                this.filedPlan.status = 'cancelled';
                this.filedPlan = null;
                alert('Flight plan cancelled.');
                this._notifyChange();
                this._render();
            } else {
                alert(`Cancellation failed: ${result.error}`);
            }
        } catch (err) {
            alert(`Cancellation error: ${err.message}`);
        }
    }

    async _uploadToPi() {
        this.uploading = true;
        this.uploadProgress = 0;
        this._render();

        try {
            // Assemble full package
            const pkg = new FlightPlanPackage();
            const wd = this.controller.workflowData;

            if (wd.aircraft?.aircraft) pkg.setAircraft(wd.aircraft.aircraft);
            if (wd.route) {
                pkg.setRoute(
                    wd.route.departure,
                    wd.route.destination,
                    wd.route.route,
                    wd.route.legs,
                    wd.route.altitude
                );
            }
            if (wd.weather) pkg.setWeather(wd.weather);
            if (wd.wb) pkg.setWeightBalance(wd.wb);
            if (wd.briefing?.officialBriefing) {
                pkg.setOfficialBriefing(wd.briefing.officialBriefing.confirmation);
            }
            if (this.filedPlan) {
                pkg.setFiledPlan({
                    ...this.filedPlan,
                    flight_rules: this.flightRules,
                    proposed_departure: this.departureTime,
                    equipment_suffix: this.equipmentSuffix,
                    alternate: this.alternate,
                    remarks: this.remarks,
                });
            }

            // Save to IndexedDB
            this.uploadProgress = 30;
            this._updateProgress();
            await this.db.saveFlightPlan(pkg.toJSON());

            // Upload to Pi
            this.uploadProgress = 60;
            this._updateProgress();

            const resp = await fetch('http://192.168.10.1/api/plan/upload-package', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pkg.toJSON()),
            });

            this.uploadProgress = 100;
            this._updateProgress();

            if (resp.ok) {
                alert('Flight plan uploaded to PilotStation successfully!');
            } else {
                const errText = await resp.text();
                alert(`Upload failed (${resp.status}): ${errText}`);
            }
        } catch (err) {
            if (err.name === 'TypeError' && err.message.includes('fetch')) {
                alert('Cannot connect to PilotStation Pi.\nMake sure you are connected to Stratux WiFi.');
            } else {
                alert(`Upload error: ${err.message}`);
            }
        } finally {
            this.uploading = false;
            this._render();
        }
    }

    _updateProgress() {
        const fill = this.container?.querySelector('.progress-bar-fill');
        if (fill) fill.style.width = `${this.uploadProgress}%`;
    }

    _notifyChange() {
        this.controller.dataChanged('ready', this.getData());
    }

    validate() {
        return true; // Final step — always valid
    }

    getData() {
        return {
            flightRules: this.flightRules,
            departureTime: this.departureTime,
            alternate: this.alternate,
            equipmentSuffix: this.equipmentSuffix,
            remarks: this.remarks,
            pilotName: this.pilotName,
            pilotPhone: this.pilotPhone,
            filedPlan: this.filedPlan,
        };
    }

    onEnter() {}
    onLeave() {
        this._notifyChange();
    }
}
