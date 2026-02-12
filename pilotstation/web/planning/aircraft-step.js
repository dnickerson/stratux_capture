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

        this._updatePreview();
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
        };
    }

    onEnter() {}
    onLeave() {}
}
