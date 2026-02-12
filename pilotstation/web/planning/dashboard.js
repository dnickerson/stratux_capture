/**
 * PilotStation — Dashboard View (Phase 2)
 * PLAN-02: 2x3 grid showing all six panels in condensed form.
 * Toggle from guided flow via [DASHBOARD] button.
 */

class Dashboard {
    constructor({ controller, db }) {
        this.controller = controller;
        this.db = db;
        this.container = null;
    }

    render(container, workflowData) {
        this.container = container;
        const wd = workflowData;

        const acData = wd.aircraft;
        const routeData = wd.route;
        const wxData = wd.weather;
        const wbData = wd.wb;
        const briefData = wd.briefing;
        const readyData = wd.ready;

        this.container.innerHTML = `
            <div class="dashboard-grid">
                <!-- Panel 1: Aircraft -->
                <div class="dashboard-panel" data-step="1">
                    <div class="dashboard-panel-header">
                        <span class="dashboard-panel-num">1</span>
                        <span class="dashboard-panel-title">AIRCRAFT</span>
                    </div>
                    <div class="dashboard-panel-body">
                        ${acData?.aircraft ? `
                            <div class="font-mono" style="font-size:16px;font-weight:700;">
                                ${acData.aircraft.name}
                            </div>
                            <div class="text-sm text-muted">${acData.aircraft.tail_number || ''}</div>
                            <div class="text-sm mt-sm">
                                Fuel: ${acData.loading?.fuel_gal?.toFixed(1) || '?'} gal
                                | POB: ${acData.loading?.total_pax || '?'}
                            </div>
                        ` : '<span class="text-muted">Not selected</span>'}
                    </div>
                </div>

                <!-- Panel 2: Route -->
                <div class="dashboard-panel" data-step="2">
                    <div class="dashboard-panel-header">
                        <span class="dashboard-panel-num">2</span>
                        <span class="dashboard-panel-title">ROUTE</span>
                    </div>
                    <div class="dashboard-panel-body">
                        ${routeData?.departure ? `
                            <div class="font-mono" style="font-size:16px;font-weight:700;">
                                ${routeData.departure} → ${routeData.destination}
                            </div>
                            <div class="text-sm mt-sm">
                                ${routeData.totalDist || '?'} nm |
                                ${routeData.altitude?.toLocaleString() || '?'} ft |
                                ${routeData.totalFuel?.toFixed(1) || '?'} gal
                            </div>
                        ` : '<span class="text-muted">No route</span>'}
                    </div>
                </div>

                <!-- Panel 3: Weather -->
                <div class="dashboard-panel" data-step="3">
                    <div class="dashboard-panel-header">
                        <span class="dashboard-panel-num">3</span>
                        <span class="dashboard-panel-title">WEATHER</span>
                    </div>
                    <div class="dashboard-panel-body">
                        ${wxData?.fetched_at ? `
                            <div class="flex gap-sm flex-wrap">
                                ${Object.entries(wxData.metars || {}).map(([icao, m]) => {
                                    const cat = m.decoded?.flight_category || 'VFR';
                                    return `<span class="flex items-center gap-sm">
                                        <span class="cat-dot ${cat.toLowerCase()}"></span>
                                        <span class="font-mono text-sm">${icao}</span>
                                    </span>`;
                                }).join('')}
                            </div>
                            <div class="text-sm text-muted mt-sm">
                                ${new Date(wxData.fetched_at).toLocaleTimeString()}
                            </div>
                        ` : '<span class="text-muted">Not fetched</span>'}
                    </div>
                </div>

                <!-- Panel 4: W&B -->
                <div class="dashboard-panel" data-step="4">
                    <div class="dashboard-panel-header">
                        <span class="dashboard-panel-num">4</span>
                        <span class="dashboard-panel-title">W&B</span>
                    </div>
                    <div class="dashboard-panel-body">
                        ${wbData ? `
                            <div class="wb-result ${wbData.in_envelope ? 'in-envelope' : 'out-of-envelope'}" style="padding:6px 10px;font-size:13px;">
                                ${wbData.in_envelope ? '&#x2713; In Envelope' : '&#x26A0; Out of Envelope'}
                            </div>
                            <div class="text-sm mt-sm font-mono">
                                ${wbData.takeoff_weight} lb @ ${wbData.takeoff_cg?.toFixed(2)}"
                            </div>
                        ` : '<span class="text-muted">Not calculated</span>'}
                    </div>
                </div>

                <!-- Panel 5: Briefing -->
                <div class="dashboard-panel" data-step="5">
                    <div class="dashboard-panel-header">
                        <span class="dashboard-panel-num">5</span>
                        <span class="dashboard-panel-title">BRIEF</span>
                    </div>
                    <div class="dashboard-panel-body">
                        ${briefData?.goNogo ? `
                            <div class="go-nogo-badge ${briefData.goNogo.status.toLowerCase()}" style="font-size:13px;padding:4px 10px;">
                                ${briefData.goNogo.status}
                            </div>
                            ${briefData.officialBriefing ? `
                                <div class="text-sm mt-sm text-muted">
                                    Official: #${briefData.officialBriefing.confirmation || '—'}
                                </div>
                            ` : '<div class="text-sm mt-sm text-muted">No official briefing</div>'}
                        ` : '<span class="text-muted">Not reviewed</span>'}
                    </div>
                </div>

                <!-- Panel 6: Ready -->
                <div class="dashboard-panel" data-step="6">
                    <div class="dashboard-panel-header">
                        <span class="dashboard-panel-num">6</span>
                        <span class="dashboard-panel-title">READY</span>
                    </div>
                    <div class="dashboard-panel-body">
                        ${readyData?.filedPlan ? `
                            <div class="filing-status filed" style="padding:6px 10px;font-size:13px;">
                                &#x2713; Filed: ${readyData.filedPlan.flight_identifier || '—'}
                            </div>
                        ` : '<span class="text-muted">Not filed</span>'}
                    </div>
                </div>
            </div>
        `;

        // Click panels to navigate to that step
        this.container.querySelectorAll('.dashboard-panel').forEach(panel => {
            panel.addEventListener('click', () => {
                const step = parseInt(panel.dataset.step);
                if (step) this.controller.goToStep(step);
            });
        });
    }
}
