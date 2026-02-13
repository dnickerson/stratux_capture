/**
 * PilotStation — Mode Detector
 * Network probe state machine for detecting Planning/Cockpit/Offline mode.
 * MODE-01 through MODE-06
 */

class ModeDetector extends EventTarget {
    static MODES = { PLANNING: 'planning', COCKPIT: 'cockpit', OFFLINE: 'offline' };
    static PI_URL = 'http://192.168.10.1/api/status';
    static HEALTH_URL = '/api/health';
    static PROBE_TIMEOUT = 2000;
    static REPROBE_INTERVAL = 30000;
    static OVERRIDE_DURATION = 300000; // 5 minutes

    constructor() {
        super();
        this._mode = null;
        this._probeTimer = null;
        this._overrideMode = null;
        this._overrideExpiry = 0;
    }

    /**
     * Start mode detection. Returns initial mode.
     */
    start() {
        // Fast fallback: IP heuristic (MODE-02 shortcut)
        if (typeof window !== 'undefined' && window.location.hostname === '192.168.10.1') {
            this._setMode(ModeDetector.MODES.COCKPIT);
        } else {
            // Force planning mode when not on the Pi
            this._mode = ModeDetector.MODES.PLANNING;
            localStorage.setItem('pilotstation-mode', 'planning');
        }

        // Only probe if on the Pi — skip probing on home WiFi to avoid mode flicker
        if (typeof window !== 'undefined' && window.location.hostname === '192.168.10.1') {
            this._probe();
            this._probeTimer = setInterval(() => this._probe(), ModeDetector.REPROBE_INTERVAL);
        }

        return this._mode;
    }

    /**
     * Stop mode detection probes.
     */
    stop() {
        if (this._probeTimer) {
            clearInterval(this._probeTimer);
            this._probeTimer = null;
        }
    }

    /**
     * Get current mode.
     */
    get mode() {
        return this._mode;
    }

    /**
     * Set manual mode override (MODE-04).
     * Overrides auto-detection for OVERRIDE_DURATION, then resumes probing.
     */
    setManualOverride(mode) {
        if (!Object.values(ModeDetector.MODES).includes(mode)) return;
        this._overrideMode = mode;
        this._overrideExpiry = Date.now() + ModeDetector.OVERRIDE_DURATION;
        this._setMode(mode);
    }

    /**
     * Clear manual override.
     */
    clearOverride() {
        this._overrideMode = null;
        this._overrideExpiry = 0;
        this._probe();
    }

    // ========== Internal ==========

    async _probe() {
        // If manual override is active, skip auto-detection
        if (this._overrideMode && Date.now() < this._overrideExpiry) {
            return;
        }
        // Clear expired override
        if (this._overrideMode && Date.now() >= this._overrideExpiry) {
            this._overrideMode = null;
            this._overrideExpiry = 0;
        }

        // Probe Pi first (MODE-01)
        const piReachable = await this._probeUrl(ModeDetector.PI_URL);
        if (piReachable) {
            this._setMode(ModeDetector.MODES.COCKPIT);
            return;
        }

        // Pi not reachable — check if browser has network connectivity
        if (typeof navigator !== 'undefined' && navigator.onLine) {
            this._setMode(ModeDetector.MODES.PLANNING);
            return;
        }

        this._setMode(ModeDetector.MODES.OFFLINE);
    }

    async _probeUrl(url) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), ModeDetector.PROBE_TIMEOUT);
            const response = await fetch(url, {
                method: 'GET',
                signal: controller.signal,
                cache: 'no-store',
                mode: 'cors',
            });
            clearTimeout(timeout);
            return response.ok;
        } catch {
            return false;
        }
    }

    _setMode(newMode) {
        const oldMode = this._mode;
        this._mode = newMode;

        // Persist for instant startup (MODE-06)
        localStorage.setItem('pilotstation-mode', newMode);

        // Dispatch change event (MODE-05)
        if (oldMode !== newMode) {
            this.dispatchEvent(new CustomEvent('modechange', {
                detail: { from: oldMode, to: newMode }
            }));
        }
    }
}
