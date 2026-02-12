/**
 * PilotStation — Application Orchestrator
 * Manages mode switching, view lifecycle, status bar, and navigation.
 */

class PilotStationApp {
    constructor() {
        this.currentMode = null;
        this.modeDetector = null;
        this.workflowController = null;

        // DOM references
        this.dom = {
            statusBar: document.getElementById('statusBar'),
            statusMode: document.getElementById('statusMode'),
            statusAircraft: document.getElementById('statusAircraft'),
            statusRoute: document.getElementById('statusRoute'),
            statusWeather: document.getElementById('statusWeather'),
            statusTime: document.getElementById('statusTime'),
            mainContent: document.getElementById('mainContent'),
            planningView: document.getElementById('planningView'),
            cockpitView: document.getElementById('cockpitView'),
            offlineView: document.getElementById('offlineView'),
            planningNav: document.getElementById('planningNav'),
            cockpitNav: document.getElementById('cockpitNav'),
            modeBanner: document.getElementById('modeBanner'),
            modeBannerText: document.getElementById('modeBannerText'),
            modeModal: document.getElementById('modeModal'),
            modeModalCancel: document.getElementById('modeModalCancel'),
            offlineStaleWarning: document.getElementById('offlineStaleWarning'),
        };

        this._bannerTimeout = null;
        this._clockInterval = null;
    }

    async init() {
        // Initialize mode detector
        this.modeDetector = new ModeDetector();
        this.modeDetector.addEventListener('modechange', (e) => this._onModeChange(e));

        // Set up UI event listeners
        this._setupNavListeners();
        this._setupModeModal();

        // Start clock
        this._startClock();

        // Start mode detection
        const initialMode = this.modeDetector.start();
        this._applyMode(initialMode, false);

        console.log('PilotStation initialized, mode:', initialMode);
    }

    // ========== Mode Management ==========

    _onModeChange(event) {
        const { from, to } = event.detail;
        if (from === to) return;

        this._applyMode(to, true);
        this._showModeBanner(to);
    }

    _applyMode(mode, animate) {
        this.currentMode = mode;

        // Update HTML data attribute for CSS theming
        document.documentElement.dataset.mode = mode;

        // Update status bar mode badge
        const labels = { planning: 'PLANNING', cockpit: 'COCKPIT', offline: 'OFFLINE' };
        this.dom.statusMode.textContent = labels[mode] || mode.toUpperCase();

        // Show/hide appropriate views and nav bars
        this.dom.planningView.hidden = mode !== 'planning';
        this.dom.cockpitView.hidden = mode !== 'cockpit';
        this.dom.offlineView.hidden = mode !== 'offline';
        this.dom.planningNav.hidden = mode !== 'planning';
        this.dom.cockpitNav.hidden = mode !== 'cockpit';

        // Initialize mode-specific UI
        if (mode === 'planning') {
            this._initPlanningMode();
        } else if (mode === 'cockpit') {
            this._initCockpitMode();
        } else if (mode === 'offline') {
            this._initOfflineMode();
        }
    }

    _showModeBanner(mode) {
        const messages = {
            planning: 'Switched to Planning Mode — internet detected',
            cockpit: 'Switched to Cockpit Mode — Pi detected',
            offline: 'Switched to Offline Mode — no network',
        };

        this.dom.modeBannerText.textContent = messages[mode] || '';
        this.dom.modeBanner.hidden = false;

        // Auto-dismiss after 5 seconds
        clearTimeout(this._bannerTimeout);
        this._bannerTimeout = setTimeout(() => {
            this.dom.modeBanner.hidden = true;
        }, 5000);
    }

    // ========== Planning Mode ==========

    _initPlanningMode() {
        if (!this.workflowController) {
            this.workflowController = new WorkflowController({
                container: document.getElementById('stepContent'),
                navButtons: this.dom.planningNav.querySelectorAll('.step-btn'),
                onStepChange: (step) => this._onPlanningStepChange(step),
                onDataChange: (data) => this._onPlanningDataChange(data),
            });
        }
        this.workflowController.activate();
    }

    _onPlanningStepChange(stepNum) {
        // Update nav bar active state
        this.dom.planningNav.querySelectorAll('.step-btn').forEach(btn => {
            const btnStep = parseInt(btn.dataset.step);
            btn.classList.toggle('active', btnStep === stepNum);
        });
    }

    _onPlanningDataChange(data) {
        // Update status bar with planning data
        if (data.aircraft) {
            const ac = data.aircraft;
            this.dom.statusAircraft.textContent = `${ac.name || ''} ${ac.tail_number || ''}`.trim();
        }
        if (data.route) {
            const dep = data.route.departure || '';
            const dest = data.route.destination || '';
            this.dom.statusRoute.textContent = dep && dest ? `${dep} → ${dest}` : '';
        }
        if (data.weather && data.weather.fetched_at) {
            const fetchedAt = new Date(data.weather.fetched_at);
            const timeStr = fetchedAt.toISOString().slice(11, 16) + 'Z';
            this.dom.statusWeather.textContent = `WX ${timeStr}`;
        }
    }

    // ========== Cockpit Mode ==========

    _initCockpitMode() {
        // Cockpit views will be implemented in Phase 1c
        // For now, show a placeholder
        const primaryView = document.getElementById('primaryView');
        if (!primaryView.querySelector('.cockpit-placeholder')) {
            primaryView.innerHTML = `
                <div class="cockpit-placeholder" style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);">
                    <div style="text-align:center;">
                        <h2>Cockpit Mode</h2>
                        <p>Connect to Stratux WiFi for full cockpit UI.</p>
                        <p style="margin-top:8px;">Cockpit views will be built in Phase 1b/1c.</p>
                    </div>
                </div>
            `;
        }
    }

    // ========== Offline Mode ==========

    _initOfflineMode() {
        // Check for cached flight plan
        if (typeof NasrDB !== 'undefined') {
            const db = new NasrDB();
            db.open().then(() => db.getActiveFlightPlan()).then(plan => {
                if (plan) {
                    const age = Date.now() - new Date(plan.created_at).getTime();
                    const ageHours = Math.round(age / 3600000);
                    this.dom.offlineStaleWarning.textContent =
                        `Cached plan from ${ageHours} hour${ageHours !== 1 ? 's' : ''} ago. Weather may be stale.`;
                } else {
                    this.dom.offlineStaleWarning.textContent = 'No cached flight plan available.';
                }
            }).catch(() => {
                this.dom.offlineStaleWarning.textContent = 'Unable to access cached data.';
            });
        }
    }

    // ========== Navigation Listeners ==========

    _setupNavListeners() {
        // Planning nav step buttons
        this.dom.planningNav.querySelectorAll('.step-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const step = parseInt(btn.dataset.step);
                if (this.workflowController) {
                    this.workflowController.goToStep(step);
                }
            });
        });

        // Cockpit nav tab buttons
        this.dom.cockpitNav.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                this._switchCockpitView(view);
            });
        });

        // Status bar mode badge — tap to open mode modal
        this.dom.statusMode.addEventListener('click', () => {
            this.dom.modeModal.hidden = false;
        });
    }

    _switchCockpitView(viewName) {
        // Update active tab
        this.dom.cockpitNav.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewName);
        });
        // Cockpit view switching will be implemented in Phase 1c
    }

    // ========== Mode Override Modal ==========

    _setupModeModal() {
        // Mode selection buttons
        this.dom.modeModal.querySelectorAll('.modal-btn[data-mode]').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                this.modeDetector.setManualOverride(mode);
                this.dom.modeModal.hidden = true;
            });
        });

        // Cancel button
        this.dom.modeModalCancel.addEventListener('click', () => {
            this.dom.modeModal.hidden = true;
        });

        // Close on backdrop click
        this.dom.modeModal.addEventListener('click', (e) => {
            if (e.target === this.dom.modeModal) {
                this.dom.modeModal.hidden = true;
            }
        });
    }

    // ========== Clock ==========

    _startClock() {
        const updateClock = () => {
            const now = new Date();
            const z = now.toISOString().slice(11, 16) + 'Z';
            this.dom.statusTime.textContent = z;
        };
        updateClock();
        this._clockInterval = setInterval(updateClock, 10000);
    }

    // ========== Alerts ==========

    showAlert(message, severity = 'blue', duration = null) {
        const banner = document.createElement('div');
        banner.className = `alert-banner alert-${severity}`;
        banner.textContent = message;
        banner.addEventListener('click', () => banner.remove());
        document.body.appendChild(banner);

        if (duration || severity === 'blue') {
            setTimeout(() => banner.remove(), duration || 10000);
        }
    }

    // ========== Toast Notifications ==========

    showToast(message, actions = []) {
        // Remove existing toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `
            <span>${message}</span>
            ${actions.length ? `<div class="toast-actions">
                ${actions.map(a => `<button class="toast-btn btn-primary" data-action="${a.id}">${a.label}</button>`).join('')}
            </div>` : ''}
        `;

        actions.forEach(action => {
            const btn = toast.querySelector(`[data-action="${action.id}"]`);
            if (btn) btn.addEventListener('click', () => {
                action.callback();
                toast.remove();
            });
        });

        document.body.appendChild(toast);
        return toast;
    }
}

// ========== Initialize on DOM ready ==========

const app = new PilotStationApp();
document.addEventListener('DOMContentLoaded', () => app.init());
