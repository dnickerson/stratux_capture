/**
 * PilotStation — Step 1: Aircraft Selection & Loading
 * Select aircraft profile, enter passengers, baggage, and fuel.
 */

class AircraftStep {
    constructor({ controller, db }) {
        this.controller = controller;
        this.db = db;
        this.container = null;
        this.profiles = [];
        this.selectedProfile = null;
        this.stationWeights = {};
        this.fuelGal = 0;
        this.passengers = 0;
        this.leftTic = 0;
        this.rightTic = 0;
        this.latestEdm = null;
    }

    async render(container, workflowData) {
        this.container = container;

        // Load aircraft profiles from IndexedDB
        this.profiles = await this.db.getAircraftProfiles();

        // Restore from saved data
        if (workflowData.aircraft) {
            const saved = workflowData.aircraft;
            this.selectedProfile = this.profiles.find(p => p.id === saved.aircraft?.id) || null;
            if (saved.loading) {
                this.stationWeights = saved.loading.stationWeights || {};
                this.fuelGal = saved.loading.fuel_gal || 0;
                this.passengers = saved.loading.total_pax || 0;
            }
            if (saved.ticLeft != null) this.leftTic = saved.ticLeft;
            if (saved.ticRight != null) this.rightTic = saved.ticRight;
        }

        // Load latest EDM reading for tic mark comparison
        if (this.selectedProfile?.tic_polynomial) {
            this.latestEdm = await this.db.getLatestEdmReading(this.selectedProfile.id);
        }

        this._render();
    }

    _render() {
        if (!this.container) return;

        if (this.profiles.length === 0) {
            this.container.innerHTML = `
                <div class="card">
                    <div class="card-title">Aircraft Selection</div>
                    <p class="text-muted">No aircraft profiles found.</p>
                    <p class="mt-sm text-muted text-sm">
                        Connect to Stratux WiFi to sync aircraft profiles from the Pi,
                        or profiles will be loaded when NASR data is synced.
                    </p>
                </div>
            `;
            return;
        }

        // If no selection, default to first active or first profile
        if (!this.selectedProfile) {
            this.selectedProfile = this.profiles.find(p => p.active) || this.profiles[0];
            this.fuelGal = this.selectedProfile.fuel?.usable_gal || 0;
        }

        const ac = this.selectedProfile;
        const stations = (ac.stations || []).filter(s => !s.fuel);
        const fuelStation = (ac.stations || []).find(s => s.fuel);

        this.container.innerHTML = `
            <div class="card">
                <div class="card-title">Aircraft Selection</div>
                <div class="aircraft-list">
                    ${this.profiles.map(p => `
                        <label class="aircraft-option ${p.id === ac.id ? 'selected' : ''}">
                            <input type="radio" name="aircraft" value="${p.id}"
                                ${p.id === ac.id ? 'checked' : ''}>
                            <span class="aircraft-name">${p.name}</span>
                            <span class="aircraft-tail text-muted text-sm">${p.tail_number || ''}</span>
                        </label>
                    `).join('')}
                </div>
            </div>

            <div class="card">
                <div class="card-title">Loading — ${ac.name} ${ac.tail_number || ''}</div>
                <div class="loading-form">
                    ${stations.map((s, i) => `
                        <div class="loading-row">
                            <label class="input-label">${s.name} (arm ${s.arm}")</label>
                            <div class="flex items-center gap-sm">
                                <input type="number" class="input station-weight"
                                    data-index="${i}" data-arm="${s.arm}"
                                    value="${this.stationWeights[i] || 0}"
                                    min="${s.min || 0}" max="${s.max || 999}"
                                    step="1" inputmode="numeric">
                                <span class="text-sm text-muted">lb (max ${s.max})</span>
                            </div>
                        </div>
                    `).join('')}

                    ${fuelStation ? `
                        <div class="loading-row">
                            <label class="input-label">Fuel (arm ${fuelStation.arm}")</label>
                            <div class="flex items-center gap-sm">
                                <input type="number" class="input fuel-input"
                                    value="${this.fuelGal}"
                                    min="0" max="${ac.fuel?.capacity_gal || 50}"
                                    step="0.5" inputmode="decimal">
                                <span class="text-sm text-muted">
                                    gal (usable ${ac.fuel?.usable_gal || '?'},
                                    max ${ac.fuel?.capacity_gal || '?'})
                                </span>
                            </div>
                            <div class="text-sm text-muted mt-sm">
                                = <span class="fuel-weight">${(this.fuelGal * (fuelStation.gal_to_lbs || 6)).toFixed(0)}</span> lb
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>

            ${this._renderTicSection(ac)}

            <div class="card">
                <div class="card-title">Fuel Phases — ${ac.fuel_phases?.source === 'actual_data' ? 'Engine Monitor Data' : 'Lycoming O-360-A1A Chart'}</div>
                ${this._renderFuelPhases(ac)}
            </div>

            <div class="card">
                <div class="card-title">Weight Preview</div>
                <div class="weight-preview">
                    <div class="flex justify-between">
                        <span>Empty weight:</span>
                        <span class="font-mono">${ac.empty_weight} lb</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Payload + fuel:</span>
                        <span class="font-mono" id="payloadWeight">—</span>
                    </div>
                    <div class="flex justify-between" style="border-top:1px solid var(--border);padding-top:8px;margin-top:8px;">
                        <span><strong>Estimated takeoff:</strong></span>
                        <span class="font-mono" id="takeoffWeight">—</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Max gross:</span>
                        <span class="font-mono text-muted">${ac.max_gross_weight} lb</span>
                    </div>
                    <div id="weightWarning" class="mt-sm" hidden></div>
                </div>
            </div>
        `;

        // Event listeners
        this.container.querySelectorAll('input[name="aircraft"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.selectedProfile = this.profiles.find(p => p.id === e.target.value);
                this.stationWeights = {};
                this.fuelGal = this.selectedProfile.fuel?.usable_gal || 0;
                this._render();
                this._notifyChange();
            });
        });

        this.container.querySelectorAll('.station-weight').forEach(input => {
            input.addEventListener('input', (e) => {
                this.stationWeights[e.target.dataset.index] = parseFloat(e.target.value) || 0;
                this._updatePreview();
                this._notifyChange();
            });
        });

        const fuelInput = this.container.querySelector('.fuel-input');
        if (fuelInput) {
            fuelInput.addEventListener('input', (e) => {
                this.fuelGal = parseFloat(e.target.value) || 0;
                const fuelStn = (ac.stations || []).find(s => s.fuel);
                const weightEl = this.container.querySelector('.fuel-weight');
                if (weightEl && fuelStn) {
                    weightEl.textContent = (this.fuelGal * (fuelStn.gal_to_lbs || 6)).toFixed(0);
                }
                this._updatePreview();
                this._notifyChange();
            });
        }

        // Fuel phase inputs
        this.container.querySelectorAll('.phase-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const phase = e.target.dataset.phase;
                const field = e.target.dataset.field;
                const val = parseFloat(e.target.value) || 0;
                this._updatePhaseValue(phase, field, val);
            });
        });

        // Cruise IAS input (stored on the profile, not in fuel_phases)
        const cruiseIasInput = this.container.querySelector('.cruise-ias-input');
        if (cruiseIasInput) {
            cruiseIasInput.addEventListener('change', async (e) => {
                const val = parseFloat(e.target.value) || 140;
                this.selectedProfile.cruise_ias = val;
                await this.db.saveAircraftProfile(this.selectedProfile);
                this._notifyChange();
            });
        }

        // Tic mark toggle and inputs
        const ticToggle = this.container.querySelector('#ticToggle');
        if (ticToggle) {
            ticToggle.addEventListener('click', () => {
                const section = this.container.querySelector('#ticSection');
                const icon = this.container.querySelector('#ticToggleIcon');
                if (section && icon) {
                    section.hidden = !section.hidden;
                    icon.textContent = section.hidden ? '\u25B6' : '\u25BC';
                }
            });
        }
        this.container.querySelectorAll('.tic-input').forEach(input => {
            input.addEventListener('input', () => this._updateTicConversion());
        });
        const ticApply = this.container.querySelector('#ticApply');
        if (ticApply) ticApply.addEventListener('click', () => this._applyTicFuel());
        const ticSave = this.container.querySelector('#ticSave');
        if (ticSave) ticSave.addEventListener('click', () => this._saveMeasurement());

        this._updatePreview();
        this._updateTicConversion();
    }

    async _updatePhaseValue(phase, field, value) {
        if (!this.selectedProfile) return;
        if (!this.selectedProfile.fuel_phases) {
            this.selectedProfile.fuel_phases = {
                source: 'lycoming_chart',
                taxi: { gph: 1.5, time_min: 10 },
                climb: { gph: 10.0, ias_kt: 120, rate_fpm: 700 },
                cruise: { gph: 7.0 },
                descent: { gph: 4.0, ias_kt: 120, rate_fpm: 500 },
            };
        }
        if (!this.selectedProfile.fuel_phases[phase]) {
            this.selectedProfile.fuel_phases[phase] = {};
        }
        this.selectedProfile.fuel_phases[phase][field] = value;

        // Keep fuel_burn_gph in sync with cruise GPH
        if (phase === 'cruise' && field === 'gph') {
            this.selectedProfile.fuel_burn_gph = value;
        }

        // Persist to IndexedDB
        await this.db.saveAircraftProfile(this.selectedProfile);
        this._notifyChange();
    }

    _renderFuelPhases(ac) {
        const fp = ac.fuel_phases || {};
        const taxi = fp.taxi || {};
        const climb = fp.climb || {};
        const cruise = fp.cruise || {};
        const descent = fp.descent || {};

        return `
            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr class="text-sm text-muted" style="text-align:left;">
                        <th style="padding:4px 8px;">Phase</th>
                        <th style="padding:4px 8px;">GPH</th>
                        <th style="padding:4px 8px;">IAS (kt)</th>
                        <th style="padding:4px 8px;">Rate (fpm)</th>
                        <th style="padding:4px 8px;">Time (min)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="border-top:1px solid var(--border);">
                        <td style="padding:4px 8px;" class="text-sm">Taxi</td>
                        <td style="padding:4px 8px;">
                            <input type="number" class="input phase-input" data-phase="taxi" data-field="gph"
                                value="${taxi.gph ?? 1.5}" min="0" max="20" step="0.1" inputmode="decimal"
                                style="width:70px;">
                        </td>
                        <td style="padding:4px 8px;" class="text-muted text-sm">—</td>
                        <td style="padding:4px 8px;" class="text-muted text-sm">—</td>
                        <td style="padding:4px 8px;">
                            <input type="number" class="input phase-input" data-phase="taxi" data-field="time_min"
                                value="${taxi.time_min ?? 10}" min="0" max="60" step="1" inputmode="numeric"
                                style="width:70px;">
                        </td>
                    </tr>
                    <tr style="border-top:1px solid var(--border);">
                        <td style="padding:4px 8px;" class="text-sm">Climb</td>
                        <td style="padding:4px 8px;">
                            <input type="number" class="input phase-input" data-phase="climb" data-field="gph"
                                value="${climb.gph ?? 10.0}" min="0" max="25" step="0.1" inputmode="decimal"
                                style="width:70px;">
                        </td>
                        <td style="padding:4px 8px;">
                            <input type="number" class="input phase-input" data-phase="climb" data-field="ias_kt"
                                value="${climb.ias_kt ?? 120}" min="50" max="200" step="1" inputmode="numeric"
                                style="width:70px;">
                        </td>
                        <td style="padding:4px 8px;">
                            <input type="number" class="input phase-input" data-phase="climb" data-field="rate_fpm"
                                value="${climb.rate_fpm ?? 700}" min="100" max="3000" step="50" inputmode="numeric"
                                style="width:70px;">
                        </td>
                        <td style="padding:4px 8px;" class="text-muted text-sm">calc</td>
                    </tr>
                    <tr style="border-top:1px solid var(--border);">
                        <td style="padding:4px 8px;" class="text-sm">Cruise</td>
                        <td style="padding:4px 8px;">
                            <input type="number" class="input phase-input" data-phase="cruise" data-field="gph"
                                value="${cruise.gph ?? 7.0}" min="0" max="25" step="0.1" inputmode="decimal"
                                style="width:70px;">
                        </td>
                        <td style="padding:4px 8px;">
                            <input type="number" class="input cruise-ias-input"
                                value="${ac.cruise_ias || 140}" min="50" max="250" step="1" inputmode="numeric"
                                style="width:70px;">
                        </td>
                        <td style="padding:4px 8px;" class="text-muted text-sm">—</td>
                        <td style="padding:4px 8px;" class="text-muted text-sm">calc</td>
                    </tr>
                    <tr style="border-top:1px solid var(--border);">
                        <td style="padding:4px 8px;" class="text-sm">Descent</td>
                        <td style="padding:4px 8px;">
                            <input type="number" class="input phase-input" data-phase="descent" data-field="gph"
                                value="${descent.gph ?? 4.0}" min="0" max="25" step="0.1" inputmode="decimal"
                                style="width:70px;">
                        </td>
                        <td style="padding:4px 8px;">
                            <input type="number" class="input phase-input" data-phase="descent" data-field="ias_kt"
                                value="${descent.ias_kt ?? 120}" min="50" max="200" step="1" inputmode="numeric"
                                style="width:70px;">
                        </td>
                        <td style="padding:4px 8px;">
                            <input type="number" class="input phase-input" data-phase="descent" data-field="rate_fpm"
                                value="${descent.rate_fpm ?? 500}" min="100" max="3000" step="50" inputmode="numeric"
                                style="width:70px;">
                        </td>
                        <td style="padding:4px 8px;" class="text-muted text-sm">calc</td>
                    </tr>
                </tbody>
            </table>
        `;
    }

    _updatePreview() {
        if (!this.selectedProfile) return;
        const ac = this.selectedProfile;
        const fuelStation = (ac.stations || []).find(s => s.fuel);
        const fuelWeight = this.fuelGal * (fuelStation?.gal_to_lbs || 6);

        let payloadWeight = fuelWeight;
        Object.values(this.stationWeights).forEach(w => payloadWeight += (parseFloat(w) || 0));

        const takeoff = ac.empty_weight + payloadWeight;

        const payloadEl = this.container.querySelector('#payloadWeight');
        const takeoffEl = this.container.querySelector('#takeoffWeight');
        const warningEl = this.container.querySelector('#weightWarning');

        if (payloadEl) payloadEl.textContent = `${Math.round(payloadWeight)} lb`;
        if (takeoffEl) takeoffEl.textContent = `${Math.round(takeoff)} lb`;

        if (warningEl) {
            if (takeoff > ac.max_gross_weight) {
                warningEl.hidden = false;
                warningEl.innerHTML = `<span class="indicator indicator-error">&#x26A0;</span>
                    <strong style="color:var(--color-danger)">OVER MAX GROSS by ${Math.round(takeoff - ac.max_gross_weight)} lb</strong>`;
            } else {
                warningEl.hidden = true;
            }
        }
    }

    _renderTicSection(ac) {
        if (!ac.tic_polynomial) return '';

        const edmLine = this.latestEdm
            ? '<div class="flex justify-between mt-sm text-sm">' +
              '<span>EDM Last Flight:</span>' +
              '<span class="font-mono">' + this.latestEdm.total_gal + ' gal</span>' +
              '</div>' +
              '<div class="flex justify-between text-sm" id="ticVariance">' +
              '<span>Variance:</span>' +
              '<span class="font-mono">\u2014</span>' +
              '</div>'
            : '<div class="text-sm text-muted mt-sm">No EDM data from previous flight.</div>';

        return `
            <div class="card">
                <div class="card-title" style="cursor:pointer;" id="ticToggle">
                    Pre-Flight Fuel Check <span class="text-sm text-muted" id="ticToggleIcon">&#x25B6;</span>
                </div>
                <div id="ticSection" hidden>
                    <p class="text-sm text-muted" style="margin-bottom:12px;">
                        Measure fuel in each tank using sight gauge tic marks. Polynomial converts to gallons.
                    </p>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                        <div>
                            <label class="input-label">Left Tank (tics)</label>
                            <input type="number" class="input tic-input" id="ticLeft"
                                value="${this.leftTic}" min="0" max="${ac.tic_polynomial.max_tic}"
                                step="0.25" inputmode="decimal">
                            <div class="text-sm text-muted mt-sm" id="ticLeftGal">= 0.0 gal</div>
                        </div>
                        <div>
                            <label class="input-label">Right Tank (tics)</label>
                            <input type="number" class="input tic-input" id="ticRight"
                                value="${this.rightTic}" min="0" max="${ac.tic_polynomial.max_tic}"
                                step="0.25" inputmode="decimal">
                            <div class="text-sm text-muted mt-sm" id="ticRightGal">= 0.0 gal</div>
                        </div>
                    </div>
                    <div style="padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:12px;">
                        <div class="flex justify-between" style="font-weight:600;">
                            <span>Measured Total:</span>
                            <span id="ticTotal" class="font-mono">0.0 gal</span>
                        </div>
                        ${edmLine}
                    </div>
                    <div class="flex gap-sm">
                        <button class="btn btn-primary btn-sm" id="ticApply">Apply to Fuel</button>
                        <button class="btn btn-sm" id="ticSave">Save Measurement</button>
                    </div>
                </div>
            </div>
        `;
    }

    _updateTicConversion() {
        const ac = this.selectedProfile;
        if (!ac?.tic_polynomial) return;

        const leftInput = this.container.querySelector('#ticLeft');
        const rightInput = this.container.querySelector('#ticRight');
        if (!leftInput || !rightInput) return;

        this.leftTic = parseFloat(leftInput.value) || 0;
        this.rightTic = parseFloat(rightInput.value) || 0;

        const leftGal = FuelEngine.ticToGallons(this.leftTic, ac.tic_polynomial.coefficients);
        const rightGal = FuelEngine.ticToGallons(this.rightTic, ac.tic_polynomial.coefficients);
        const total = leftGal + rightGal;

        const leftEl = this.container.querySelector('#ticLeftGal');
        const rightEl = this.container.querySelector('#ticRightGal');
        const totalEl = this.container.querySelector('#ticTotal');
        if (leftEl) leftEl.textContent = '= ' + leftGal.toFixed(1) + ' gal';
        if (rightEl) rightEl.textContent = '= ' + rightGal.toFixed(1) + ' gal';
        if (totalEl) totalEl.textContent = total.toFixed(1) + ' gal';

        const varianceEl = this.container.querySelector('#ticVariance');
        if (varianceEl && this.latestEdm) {
            const variance = total - this.latestEdm.total_gal;
            const pct = this.latestEdm.total_gal > 0
                ? Math.abs(variance / this.latestEdm.total_gal * 100) : 0;
            const grade = FuelEngine.getAccuracyGrade(pct);
            const color = grade === 'excellent' ? 'var(--color-success, green)'
                : grade === 'good' ? 'var(--color-warning, orange)' : 'var(--color-danger, red)';
            varianceEl.innerHTML = '<span>Variance:</span>' +
                '<span class="font-mono" style="color:' + color + ';">' +
                (variance > 0 ? '+' : '') + variance.toFixed(1) +
                ' gal (' + pct.toFixed(1) + '% \u2014 ' + grade + ')</span>';
        }
    }

    _applyTicFuel() {
        const ac = this.selectedProfile;
        if (!ac?.tic_polynomial) return;

        const leftGal = FuelEngine.ticToGallons(this.leftTic, ac.tic_polynomial.coefficients);
        const rightGal = FuelEngine.ticToGallons(this.rightTic, ac.tic_polynomial.coefficients);
        const total = Math.round((leftGal + rightGal) * 10) / 10;

        this.fuelGal = total;
        const fuelInput = this.container.querySelector('.fuel-input');
        if (fuelInput) fuelInput.value = total;

        const fuelStation = (ac.stations || []).find(s => s.fuel);
        const weightEl = this.container.querySelector('.fuel-weight');
        if (weightEl && fuelStation) {
            weightEl.textContent = (total * (fuelStation.gal_to_lbs || 6)).toFixed(0);
        }
        this._updatePreview();
        this._notifyChange();
    }

    async _saveMeasurement() {
        const ac = this.selectedProfile;
        if (!ac?.tic_polynomial) return;

        const measurement = FuelEngine.createMeasurement(
            this.leftTic, this.rightTic,
            ac.tic_polynomial.coefficients,
            this.latestEdm?.total_gal || null
        );
        measurement.aircraft_id = ac.id;

        await this.db.saveFuelMeasurement(measurement);
        this.latestEdm = measurement;

        const btn = this.container.querySelector('#ticSave');
        if (btn) {
            btn.textContent = 'Saved!';
            setTimeout(() => { btn.textContent = 'Save Measurement'; }, 2000);
        }
    }

    _notifyChange() {
        this.controller.dataChanged('aircraft', this.getData());
    }

    validate() {
        if (!this.selectedProfile) {
            alert('Please select an aircraft.');
            return false;
        }
        return true;
    }

    getData() {
        if (!this.selectedProfile) return null;
        const ac = this.selectedProfile;
        const fuelStation = (ac.stations || []).find(s => s.fuel);
        const nonFuelStations = (ac.stations || []).filter(s => !s.fuel);

        // Count passengers (all non-fuel, non-baggage stations)
        let totalPax = 0;
        nonFuelStations.forEach((s, i) => {
            const w = parseFloat(this.stationWeights[i]) || 0;
            if (w > 0 && !s.name.toLowerCase().includes('baggage')) {
                totalPax++;
            }
        });

        return {
            aircraft: ac,
            loading: {
                stationWeights: { ...this.stationWeights },
                fuel_gal: this.fuelGal,
                fuel_weight: this.fuelGal * (fuelStation?.gal_to_lbs || 6),
                total_pax: totalPax + 1, // +1 for pilot
            },
            ticLeft: this.leftTic,
            ticRight: this.rightTic,
        };
    }

    onEnter() {}
    onLeave() {}
}
