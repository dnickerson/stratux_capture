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
        // Clear stale mode state (but preserve reset flags)
        localStorage.removeItem('pilotstation-mode');

        // Set up UI event listeners
        this._setupNavListeners();
        this._setupModeModal();

        // Start clock
        this._startClock();

        // Mode detection: only on the Pi
        const onPi = (typeof window !== 'undefined' && window.location.hostname === '192.168.10.1');
        if (onPi) {
            this.modeDetector = new ModeDetector();
            this.modeDetector.addEventListener('modechange', (e) => this._onModeChange(e));
            const initialMode = this.modeDetector.start();
            this._applyMode(initialMode, false);
        } else {
            // No mode detector at all — force planning mode
            this.modeDetector = { setManualOverride() {}, clearOverride() {}, stop() {} };
            this._applyMode('planning', false);
        }

        console.log('PilotStation initialized, mode:', this.currentMode);
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
document.addEventListener('DOMContentLoaded', async () => {
    // Seed data BEFORE app init so Step 1 finds aircraft profiles
    try {
        await loadSampleAircraft();
        await loadSeedAirports();
    } catch (e) {
        console.warn('Bootstrap seed error:', e);
    }
    app.init();
});

/**
 * Bootstrap sample aircraft profile if IndexedDB is empty.
 * Call from browser console: loadSampleAircraft()
 * Or it runs automatically on first load.
 */
async function loadSampleAircraft() {
    const db = new NasrDB();
    await db.open();
    // Remove old sample profile and ensure RV-9A exists
    const existing = await db.getAircraftProfiles();
    for (const p of existing) {
        if (p.id === 'pa28-181') await db._delete('aircraft_profiles', p.id);
    }
    if (existing.find(p => p.id === 'rv9a-n194jt')) return;

    const rv9a = {
        id: 'rv9a-n194jt',
        name: 'RV-9A',
        tail_number: 'N194JT',
        type_code: 'RV9',
        active: true,
        empty_weight: 1185,
        empty_cg: 76.34,
        max_gross_weight: 1800,
        cruise_ias: 140,   // indicated airspeed at cruise power (TAS computed from altitude + temp)
        fuel_burn_gph: 7.0, // overall average fallback
        fuel: {
            capacity_gal: 36,
            usable_gal: 36,
        },
        // Lycoming O-360-A1A phase-of-flight fuel data
        // Source: Lycoming operator's manual power chart + typical RV-9A ops
        // These defaults will be refined by actual engine monitor data over time
        fuel_phases: {
            source: 'lycoming_chart', // 'lycoming_chart' | 'actual_data'
            taxi:    { gph: 1.5, time_min: 10 },                       // idle ~1000-1200 RPM
            climb:   { gph: 10.0, ias_kt: 120, rate_fpm: 700 },        // full rich, 75% power, 120 KIAS
            cruise:  { gph: 7.0 },                                     // 65% power, leaned (cruise_ias used for speed)
            descent: { gph: 4.0, ias_kt: 120, rate_fpm: 500 },         // reduced power
        },
        stations: [
            { name: 'Pilot', arm: 92.7, min: 0, max: 300, fuel: false },
            { name: 'Passenger', arm: 92.7, min: 0, max: 300, fuel: false },
            { name: 'Baggage', arm: 122.0, min: 0, max: 100, fuel: false },
            { name: 'Fuel', arm: 76.75, min: 0, max: 36, fuel: true, gal_to_lbs: 6 },
        ],
        cg_envelope: [
            { weight: 1034, fwd_cg: 77.95, aft_cg: 84.84 },
            { weight: 1750, fwd_cg: 77.95, aft_cg: 84.84 },
            { weight: 1800, fwd_cg: 77.95, aft_cg: 84.84 },
        ],
        personal_minimums: {
            ceiling_min: 3000,
            visibility_min: 5,
            crosswind_max: 15,
            wind_gust_max: 25,
        },
    };

    await db.saveAircraftProfile(rv9a);
    console.log('Aircraft profile loaded: RV-9A N194JT');
}

/**
 * Seed airport database if empty.
 * TODO: Replace with full NASR import from Pi.
 */
async function loadSeedAirports() {
    const db = new NasrDB();
    await db.open();
    const existing = await db.getAircraftProfiles(); // just to test DB is open
    const testAirport = await db.getAirport('KATL');
    if (testAirport) return; // Already seeded

    const airports = [
        // Major US airports + common GA airports
        { icao: 'KATL', name: 'Hartsfield-Jackson Atlanta Intl', lat: 33.6407, lon: -84.4277, elev_ft: 1026 },
        { icao: 'KORD', name: 'Chicago O\'Hare Intl', lat: 41.9742, lon: -87.9073 },
        { icao: 'KDFW', name: 'Dallas/Fort Worth Intl', lat: 32.8998, lon: -97.0403 },
        { icao: 'KDEN', name: 'Denver Intl', lat: 39.8561, lon: -104.6737 },
        { icao: 'KLAX', name: 'Los Angeles Intl', lat: 33.9425, lon: -118.4081 },
        { icao: 'KJFK', name: 'John F Kennedy Intl', lat: 40.6413, lon: -73.7781 },
        { icao: 'KSFO', name: 'San Francisco Intl', lat: 37.6213, lon: -122.3790 },
        { icao: 'KLAS', name: 'Harry Reid Intl', lat: 36.0840, lon: -115.1537 },
        { icao: 'KMIA', name: 'Miami Intl', lat: 25.7959, lon: -80.2870 },
        { icao: 'KBOS', name: 'Boston Logan Intl', lat: 42.3656, lon: -71.0096 },
        { icao: 'KMSP', name: 'Minneapolis-St Paul Intl', lat: 44.8848, lon: -93.2223 },
        { icao: 'KDTW', name: 'Detroit Metro Wayne County', lat: 42.2124, lon: -83.3534 },
        { icao: 'KPHL', name: 'Philadelphia Intl', lat: 39.8721, lon: -75.2411 },
        { icao: 'KSLC', name: 'Salt Lake City Intl', lat: 40.7884, lon: -111.9778 },
        { icao: 'KSAN', name: 'San Diego Intl', lat: 32.7336, lon: -117.1897 },
        { icao: 'KTPA', name: 'Tampa Intl', lat: 27.9755, lon: -82.5332 },
        { icao: 'KMCO', name: 'Orlando Intl', lat: 28.4294, lon: -81.3090 },
        { icao: 'KIAH', name: 'George Bush Intercontinental', lat: 29.9844, lon: -95.3414 },
        { icao: 'KAUS', name: 'Austin-Bergstrom Intl', lat: 30.1945, lon: -97.6699 },
        { icao: 'KSAT', name: 'San Antonio Intl', lat: 29.5337, lon: -98.4698 },
        { icao: 'KMSY', name: 'New Orleans Louis Armstrong', lat: 29.9934, lon: -90.2580 },
        { icao: 'KBNA', name: 'Nashville Intl', lat: 36.1245, lon: -86.6782 },
        { icao: 'KCLT', name: 'Charlotte Douglas Intl', lat: 35.2140, lon: -80.9431, elev_ft: 748 },
        { icao: 'KRDU', name: 'Raleigh-Durham Intl', lat: 35.8776, lon: -78.7875 },
        { icao: 'KMDW', name: 'Chicago Midway Intl', lat: 41.7868, lon: -87.7522 },
        { icao: 'KHOU', name: 'William P Hobby', lat: 29.6454, lon: -95.2789 },
        { icao: 'KDAL', name: 'Dallas Love Field', lat: 32.8471, lon: -96.8518 },
        { icao: 'KOKC', name: 'Will Rogers World', lat: 35.3931, lon: -97.6007 },
        { icao: 'KTUL', name: 'Tulsa Intl', lat: 36.1984, lon: -95.8881 },
        { icao: 'KICT', name: 'Wichita Dwight D Eisenhower', lat: 37.6499, lon: -97.4331 },
        { icao: 'KLIT', name: 'Bill & Hillary Clinton Natl', lat: 34.7294, lon: -92.2243 },
        { icao: 'KMEM', name: 'Memphis Intl', lat: 35.0424, lon: -89.9767 },
        { icao: 'KSTL', name: 'St Louis Lambert Intl', lat: 38.7487, lon: -90.3700 },
        { icao: 'KMCI', name: 'Kansas City Intl', lat: 39.2976, lon: -94.7139 },
        { icao: 'KOMA', name: 'Eppley Airfield', lat: 41.3032, lon: -95.8941 },
        { icao: 'KDSM', name: 'Des Moines Intl', lat: 41.5340, lon: -93.6631 },
        { icao: 'KIND', name: 'Indianapolis Intl', lat: 39.7173, lon: -86.2944 },
        { icao: 'KCMH', name: 'John Glenn Columbus Intl', lat: 39.9980, lon: -82.8919 },
        { icao: 'KCVG', name: 'Cincinnati/Northern Kentucky', lat: 39.0488, lon: -84.6678 },
        { icao: 'KLEX', name: 'Blue Grass Airport', lat: 38.0365, lon: -84.6059 },
        { icao: 'KCHA', name: 'Chattanooga Metropolitan', lat: 35.0353, lon: -85.2038 },
        { icao: 'KHSV', name: 'Huntsville Intl', lat: 34.6372, lon: -86.7751 },
        { icao: 'KBHM', name: 'Birmingham-Shuttlesworth Intl', lat: 33.5629, lon: -86.7535 },
        { icao: 'KJAX', name: 'Jacksonville Intl', lat: 30.4941, lon: -81.6879, elev_ft: 30 },
        { icao: 'KSAV', name: 'Savannah/Hilton Head Intl', lat: 32.1276, lon: -81.2021, elev_ft: 50 },
        { icao: 'KCAE', name: 'Columbia Metropolitan', lat: 33.9388, lon: -81.1195, elev_ft: 236 },
        { icao: 'KSSI', name: 'Malcolm McKinnon', lat: 31.1518, lon: -81.3913, elev_ft: 19 },
        { icao: 'KCHS', name: 'Charleston Intl', lat: 32.8986, lon: -80.0405, elev_ft: 46 },
        { icao: 'KGSW', name: 'Greater Southwest Intl', lat: 32.6867, lon: -97.0528 },
        // User's airports (with field elevations for phase-of-flight fuel calc)
        { icao: 'KLKR', name: 'Lancaster County McWhirter Field', lat: 34.7229, lon: -80.8546, elev_ft: 489 },
        { icao: '7FL6', name: 'Spruce Creek Airport', lat: 29.0748, lon: -81.0413, elev_ft: 24 },
        // Common GA airports (Oklahoma / Texas / South Central)
        { icao: 'KPWA', name: 'Wiley Post Airport', lat: 35.5342, lon: -97.6471 },
        { icao: 'KRCE', name: 'Clarence E Page Municipal', lat: 35.4887, lon: -97.8226 },
        { icao: 'KGOK', name: 'Guthrie-Edmond Regional', lat: 35.8498, lon: -97.4156 },
        { icao: 'KSNL', name: 'Shawnee Regional', lat: 35.3573, lon: -96.9428 },
        { icao: 'KEND', name: 'Vance AFB', lat: 36.3392, lon: -97.9165 },
        { icao: 'KLWA', name: 'South Haven Area Regional', lat: 42.3512, lon: -86.2556 },
        { icao: 'KADS', name: 'Addison Airport', lat: 32.9686, lon: -96.8364 },
        { icao: 'KGPM', name: 'Grand Prairie Municipal', lat: 32.6986, lon: -97.0467 },
        { icao: 'KTKI', name: 'McKinney National', lat: 33.1779, lon: -96.5905 },
        { icao: 'KGYI', name: 'North Texas Regional', lat: 33.7141, lon: -96.6736 },
        { icao: 'KFWS', name: 'Fort Worth Spinks', lat: 32.5652, lon: -97.3081 },
        { icao: 'KAFW', name: 'Fort Worth Alliance', lat: 32.9876, lon: -97.3189 },
        { icao: 'KFTW', name: 'Fort Worth Meacham Intl', lat: 32.8198, lon: -97.3624 },
        { icao: 'KRBD', name: 'Dallas Executive', lat: 32.6809, lon: -96.8682 },
        { icao: 'KGGG', name: 'East Texas Regional', lat: 32.3840, lon: -94.7115 },
        { icao: 'KACT', name: 'Waco Regional', lat: 31.6113, lon: -97.2305 },
        { icao: 'KSPS', name: 'Wichita Falls Municipal', lat: 33.9888, lon: -98.4919 },
        { icao: 'KABI', name: 'Abilene Regional', lat: 32.4113, lon: -99.6819 },
        { icao: 'KSJT', name: 'San Angelo Regional', lat: 31.3577, lon: -100.4963 },
        { icao: 'KMAF', name: 'Midland Intl', lat: 31.9425, lon: -102.2019 },
        { icao: 'KELP', name: 'El Paso Intl', lat: 31.8072, lon: -106.3778 },
        { icao: 'KABQ', name: 'Albuquerque Intl Sunport', lat: 35.0402, lon: -106.6091 },
        { icao: 'KAMA', name: 'Rick Husband Amarillo Intl', lat: 35.2194, lon: -101.7059 },
        { icao: 'KLBB', name: 'Lubbock Preston Smith Intl', lat: 33.6636, lon: -101.8227 },
        { icao: 'KSAF', name: 'Santa Fe Municipal', lat: 35.6171, lon: -106.0889 },
        { icao: 'KPHX', name: 'Phoenix Sky Harbor Intl', lat: 33.4373, lon: -112.0078 },
        { icao: 'KTUS', name: 'Tucson Intl', lat: 32.1161, lon: -110.9410 },
        { icao: 'KFFZ', name: 'Falcon Field', lat: 33.4608, lon: -111.7282 },
        { icao: 'KDVT', name: 'Deer Valley Airport', lat: 33.6883, lon: -112.0833 },
        { icao: 'KCHD', name: 'Chandler Municipal', lat: 33.2691, lon: -111.8111 },
        { icao: 'KSDL', name: 'Scottsdale Airport', lat: 33.6229, lon: -111.9105 },
    ];

    await db._bulkPut('airports', airports);
    console.log(`Seeded ${airports.length} airports into IndexedDB`);

    // Seed common VOR navaids used in route strings
    const navaids = [
        // Southeast US VORs (common for KLKR → 7FL6 routing)
        { id: 'CAE', name: 'Columbia VOR', type: 'VOR/DME', lat: 33.9388, lon: -81.1195, freq: '114.7' },
        { id: 'SAV', name: 'Savannah VOR', type: 'VOR/DME', lat: 32.0166, lon: -81.1452, freq: '114.1' },
        { id: 'SSI', name: 'St Simons VOR', type: 'VOR/DME', lat: 31.1518, lon: -81.3913, freq: '117.0' },
        { id: 'CLT', name: 'Charlotte VOR', type: 'VOR/DME', lat: 35.2186, lon: -80.9561, freq: '115.0' },
        { id: 'CHS', name: 'Charleston VOR', type: 'VOR/DME', lat: 32.8863, lon: -80.0408, freq: '113.5' },
        { id: 'JAX', name: 'Jacksonville VOR', type: 'VOR/DME', lat: 30.4862, lon: -81.6887, freq: '117.0' },
        { id: 'OMN', name: 'Ormond Beach VOR', type: 'VOR/DME', lat: 29.3006, lon: -81.1133, freq: '112.6' },
        { id: 'ORL', name: 'Orlando VOR', type: 'VOR/DME', lat: 28.5425, lon: -81.3331, freq: '112.2' },
        { id: 'ATL', name: 'Atlanta VOR', type: 'VOR/DME', lat: 33.6282, lon: -84.4349, freq: '116.9' },
        { id: 'GRD', name: 'Greenwood VOR', type: 'VOR', lat: 34.2494, lon: -82.1589, freq: '115.0' },
        { id: 'SPA', name: 'Spartanburg VOR', type: 'VOR/DME', lat: 35.0456, lon: -81.9614, freq: '115.7' },
        { id: 'GSO', name: 'Greensboro VOR', type: 'VOR/DME', lat: 36.0997, lon: -79.9500, freq: '113.5' },
        { id: 'RDU', name: 'Raleigh-Durham VOR', type: 'VOR/DME', lat: 35.8700, lon: -78.7874, freq: '117.2' },
        { id: 'ILM', name: 'Wilmington VOR', type: 'VOR/DME', lat: 34.2710, lon: -77.9074, freq: '117.0' },
        { id: 'FLO', name: 'Florence VOR', type: 'VOR/DME', lat: 34.1918, lon: -79.7239, freq: '115.2' },
        { id: 'CTF', name: 'Chesterfield VOR', type: 'VOR', lat: 34.7833, lon: -80.2667, freq: '109.0' },
        // Common US VORs
        { id: 'BNA', name: 'Nashville VOR', type: 'VOR/DME', lat: 36.1350, lon: -86.6700, freq: '114.1' },
        { id: 'MEM', name: 'Memphis VOR', type: 'VOR/DME', lat: 35.0642, lon: -89.9933, freq: '117.5' },
        { id: 'MCO', name: 'Orlando VOR', type: 'VORTAC', lat: 28.4294, lon: -81.3242, freq: '112.2' },
        { id: 'TPA', name: 'Tampa VOR', type: 'VORTAC', lat: 27.9191, lon: -82.6869, freq: '113.6' },
        { id: 'MIA', name: 'Miami VOR', type: 'VORTAC', lat: 25.7880, lon: -80.2780, freq: '115.9' },
        { id: 'PBI', name: 'Palm Beach VOR', type: 'VORTAC', lat: 26.6843, lon: -80.0947, freq: '115.7' },
        { id: 'DAB', name: 'Daytona Beach VOR', type: 'VOR/DME', lat: 29.1736, lon: -81.0495, freq: '114.5' },
        { id: 'AGS', name: 'Augusta VOR', type: 'VOR/DME', lat: 33.3707, lon: -81.9643, freq: '114.1' },
    ];

    await db._bulkPut('navaids', navaids);
    console.log(`Seeded ${navaids.length} navaids into IndexedDB`);
}

