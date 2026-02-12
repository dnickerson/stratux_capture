/**
 * PilotStation — Step 4: Weight & Balance
 * Station table, CG envelope diagram, go/no-go check.
 * PLAN-08 (lightweight client-side)
 */

class WbStep {
    constructor({ controller, db }) {
        this.controller = controller;
        this.db = db;
        this.container = null;
        this.result = null;
        this.landingResult = null;
        this.chart = null;
    }

    async render(container, workflowData) {
        this.container = container;
        this._calculate(workflowData);
        this._render();
    }

    onEnter(workflowData) {
        // Recalculate with latest data from previous steps
        this._calculate(workflowData);
        this._render();
    }

    _calculate(workflowData) {
        const acData = workflowData.aircraft;
        const routeData = workflowData.route;

        if (!acData || !acData.aircraft) {
            this.result = null;
            return;
        }

        const profile = acData.aircraft;
        const loading = acData.loading || {};

        // Calculate takeoff W&B
        this.result = WbCalculator.calculate(
            profile,
            loading.stationWeights || {},
            loading.fuel_gal || 0
        );

        // Estimate landing W&B (fuel burned during flight)
        const fuelBurn = routeData?.totalFuel || 0;
        if (fuelBurn > 0) {
            this.landingResult = WbCalculator.estimateLandingWeight(
                this.result, fuelBurn, profile
            );
        } else {
            this.landingResult = null;
        }
    }

    _render() {
        if (!this.container) return;

        if (!this.result) {
            this.container.innerHTML = `
                <div class="card">
                    <div class="card-title">Weight & Balance</div>
                    <p class="text-muted">Complete the Aircraft step first.</p>
                </div>
            `;
            return;
        }

        const r = this.result;
        const lr = this.landingResult;
        const profile = this.controller.workflowData.aircraft?.aircraft;

        this.container.innerHTML = `
            <div class="step-two-col">
                <!-- Station Table -->
                <div class="card">
                    <div class="card-title">Weight & Balance — Station Table</div>
                    <table class="wb-table">
                        <thead>
                            <tr>
                                <th>Station</th>
                                <th style="text-align:right;">Weight (lb)</th>
                                <th style="text-align:right;">Arm (in)</th>
                                <th style="text-align:right;">Moment (in-lb)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${r.stations.map(s => `
                                <tr>
                                    <td>${s.name}${s.gallons !== undefined ? ` (${s.gallons.toFixed(1)} gal)` : ''}</td>
                                    <td style="text-align:right;">${s.weight.toFixed(1)}</td>
                                    <td style="text-align:right;">${s.arm.toFixed(2)}</td>
                                    <td style="text-align:right;">${s.moment.toFixed(0)}</td>
                                </tr>
                            `).join('')}
                            <tr class="total-row">
                                <td><strong>TAKEOFF</strong></td>
                                <td style="text-align:right;"><strong>${r.totalWeight.toFixed(1)}</strong></td>
                                <td style="text-align:right;"><strong>${r.cg.toFixed(2)}</strong></td>
                                <td style="text-align:right;"><strong>${r.totalMoment.toFixed(0)}</strong></td>
                            </tr>
                            ${lr ? `
                            <tr>
                                <td><strong>EST. LANDING</strong></td>
                                <td style="text-align:right;"><strong>${lr.landingWeight.toFixed(1)}</strong></td>
                                <td style="text-align:right;"><strong>${lr.landingCg.toFixed(2)}</strong></td>
                                <td style="text-align:right;">—</td>
                            </tr>
                            ` : ''}
                        </tbody>
                    </table>

                    <!-- Results -->
                    <div class="mt-md">
                        <div class="wb-result ${r.inEnvelope && !r.overGross ? 'in-envelope' : 'out-of-envelope'}">
                            <span>${r.inEnvelope && !r.overGross ? '&#x2713;' : '&#x26A0;'}</span>
                            <span>
                                ${r.overGross
                                    ? `OVER MAX GROSS by ${Math.round(r.totalWeight - (profile?.max_gross_weight || 0))} lb`
                                    : r.inEnvelope
                                        ? 'TAKEOFF: Within CG Envelope'
                                        : `OUT OF ENVELOPE — ${r.envelopeReason || 'CG limit exceeded'}`}
                            </span>
                        </div>
                        ${lr ? `
                        <div class="wb-result mt-sm ${lr.inEnvelope ? 'in-envelope' : 'out-of-envelope'}">
                            <span>${lr.inEnvelope ? '&#x2713;' : '&#x26A0;'}</span>
                            <span>
                                ${lr.inEnvelope
                                    ? 'LANDING: Within CG Envelope'
                                    : `LANDING OUT OF ENVELOPE — ${lr.envelopeReason || ''}`}
                            </span>
                        </div>
                        ` : ''}
                    </div>

                    <!-- Weight Summary -->
                    <div class="mt-md">
                        <div class="flex justify-between mb-sm">
                            <span>Max Gross Weight:</span>
                            <span class="font-mono">${profile?.max_gross_weight || '?'} lb</span>
                        </div>
                        <div class="flex justify-between mb-sm">
                            <span>Takeoff Weight:</span>
                            <span class="font-mono" style="${r.overGross ? 'color:var(--color-danger);font-weight:700;' : ''}">${r.totalWeight.toFixed(1)} lb</span>
                        </div>
                        ${lr ? `
                        <div class="flex justify-between mb-sm">
                            <span>Est. Landing Weight:</span>
                            <span class="font-mono">${lr.landingWeight.toFixed(1)} lb</span>
                        </div>
                        ` : ''}
                        <div class="flex justify-between">
                            <span>Useful Load Remaining:</span>
                            <span class="font-mono">${((profile?.max_gross_weight || 0) - r.totalWeight).toFixed(1)} lb</span>
                        </div>
                    </div>
                </div>

                <!-- CG Envelope Chart -->
                <div class="card">
                    <div class="card-title">CG Envelope Diagram</div>
                    <div class="cg-chart-container">
                        <canvas id="cgChart"></canvas>
                    </div>
                    <div class="text-sm text-muted text-center mt-sm">
                        CG: ${r.cg.toFixed(2)}" at ${r.totalWeight.toFixed(0)} lb
                    </div>
                </div>
            </div>
        `;

        // Render CG chart
        this._renderChart(profile);
    }

    _renderChart(profile) {
        const canvas = this.container?.querySelector('#cgChart');
        if (!canvas || typeof Chart === 'undefined') return;

        // Destroy existing chart
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }

        const envelope = profile?.cg_envelope || profile?.envelope;
        const envelopePoints = WbCalculator.getEnvelopePoints(envelope);

        const datasets = [];

        // Envelope polygon
        if (envelopePoints.length > 0) {
            datasets.push({
                label: 'CG Envelope',
                data: envelopePoints,
                fill: true,
                backgroundColor: 'rgba(0, 170, 255, 0.1)',
                borderColor: 'rgba(0, 170, 255, 0.6)',
                borderWidth: 2,
                pointRadius: 0,
                showLine: true,
            });
        }

        // Takeoff point
        if (this.result) {
            datasets.push({
                label: 'Takeoff',
                data: [{ x: this.result.cg, y: this.result.totalWeight }],
                backgroundColor: this.result.inEnvelope ? '#00ff88' : '#ff4444',
                borderColor: '#ffffff',
                borderWidth: 2,
                pointRadius: 8,
                pointStyle: 'circle',
            });
        }

        // Landing point
        if (this.landingResult) {
            datasets.push({
                label: 'Landing',
                data: [{ x: this.landingResult.landingCg, y: this.landingResult.landingWeight }],
                backgroundColor: this.landingResult.inEnvelope ? '#00aaff' : '#ff4444',
                borderColor: '#ffffff',
                borderWidth: 2,
                pointRadius: 8,
                pointStyle: 'triangle',
            });
        }

        this.chart = new Chart(canvas, {
            type: 'scatter',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { usePointStyle: true, boxWidth: 10, font: { size: 11 } },
                    },
                },
                scales: {
                    x: {
                        title: { display: true, text: 'CG (inches aft of datum)' },
                        grid: { color: 'rgba(128,128,128,0.2)' },
                    },
                    y: {
                        title: { display: true, text: 'Weight (lb)' },
                        grid: { color: 'rgba(128,128,128,0.2)' },
                    },
                },
            },
        });
    }

    _notifyChange() {
        this.controller.dataChanged('wb', this.getData());
    }

    validate() {
        if (!this.result) {
            alert('Weight & Balance has not been calculated.');
            return false;
        }
        if (!this.result.inEnvelope || this.result.overGross) {
            const proceed = confirm(
                'WARNING: Aircraft is out of CG envelope or over max gross weight.\n\n' +
                'Are you sure you want to proceed?'
            );
            return proceed;
        }
        return true;
    }

    getData() {
        if (!this.result) return null;

        const profile = this.controller.workflowData.aircraft?.aircraft;

        return {
            scenario_name: 'Current Loading',
            stations: this.result.stations,
            takeoff_weight: this.result.totalWeight,
            takeoff_cg: this.result.cg,
            landing_weight: this.landingResult?.landingWeight || null,
            landing_cg: this.landingResult?.landingCg || null,
            in_envelope: this.result.inEnvelope && !this.result.overGross,
            max_gross_weight: profile?.max_gross_weight || null,
        };
    }

    onLeave() {
        this._notifyChange();
    }
}
