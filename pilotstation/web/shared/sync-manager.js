/**
 * PilotStation — Sync Manager
 * Handles data synchronization between the PWA (IndexedDB) and the Stratux Pi.
 * SYNC-01 through SYNC-06, PLAN-13
 */

class SyncManager {
    static PI_BASE = 'http://192.168.10.1';
    static NASR_REMOTE = 'https://flywhere.app/data/nasr';
    static MAX_RETRIES = 3;
    static RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

    constructor(db) {
        this.db = db;
        this.syncing = false;
        this.lastSyncTimestamp = null;
        this.syncState = 'idle'; // idle, syncing, success, error
        this._listeners = [];
    }

    /**
     * Register a listener for sync state changes.
     */
    onStateChange(callback) {
        this._listeners.push(callback);
    }

    _notifyStateChange() {
        for (const cb of this._listeners) {
            try { cb(this.syncState, this.lastSyncTimestamp); } catch {}
        }
    }

    /**
     * Full sync on mode transition to cockpit.
     * 1. Check for staged package in IndexedDB
     * 2. Compare with Pi sync status
     * 3. Upload if newer
     * 4. Download NASR/aircraft data if available
     */
    async syncOnCockpitTransition() {
        if (this.syncing) return;
        this.syncing = true;
        this.syncState = 'syncing';
        this._notifyStateChange();

        try {
            // Upload flight plan package
            await this._uploadFlightPlan();

            // Download NASR data if stale
            await this._syncNasrData();

            // Download aircraft profiles
            await this._syncAircraftProfiles();

            this.lastSyncTimestamp = new Date().toISOString();
            await this.db.setMeta('last_sync', this.lastSyncTimestamp);
            this.syncState = 'success';
        } catch (err) {
            console.error('Sync error:', err);
            this.syncState = 'error';
        } finally {
            this.syncing = false;
            this._notifyStateChange();
        }
    }

    /**
     * Upload the active flight plan package to the Pi.
     */
    async _uploadFlightPlan() {
        const pkg = await this.db.getActiveFlightPlan();
        if (!pkg) return;

        // Check if Pi already has this version
        try {
            const statusResp = await this._fetchWithTimeout(
                `${SyncManager.PI_BASE}/api/plan/sync-status`
            );
            if (statusResp.ok) {
                const status = await statusResp.json();
                if (status.lastSync && pkg.created_at &&
                    new Date(status.lastSync) >= new Date(pkg.created_at)) {
                    return; // Pi already has this or newer
                }
            }
        } catch {
            // Can't reach sync-status, try upload anyway
        }

        // Upload with retry
        await this._uploadWithRetry(pkg);
    }

    async _uploadWithRetry(pkg, attempt = 0) {
        try {
            const resp = await this._fetchWithTimeout(
                `${SyncManager.PI_BASE}/api/plan/upload-package`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(pkg),
                }
            );

            if (!resp.ok) {
                throw new Error(`Upload failed: HTTP ${resp.status}`);
            }
        } catch (err) {
            if (attempt < SyncManager.MAX_RETRIES - 1) {
                await this._delay(SyncManager.RETRY_DELAYS[attempt] || 4000);
                return this._uploadWithRetry(pkg, attempt + 1);
            }
            throw err;
        }
    }

    /**
     * Sync NASR data — tries Pi first, falls back to flywhere.app.
     */
    async _syncNasrData() {
        const localCycle = await this.db.getCycleInfo();

        // Try Pi first (cockpit mode)
        try {
            const cycleResp = await this._fetchWithTimeout(
                `${SyncManager.PI_BASE}/api/nasr/cycle-info`
            );
            if (cycleResp.ok) {
                const piCycle = await cycleResp.json();
                if (!localCycle || piCycle.effective_date !== localCycle.effective_date) {
                    const nasrResp = await this._fetchWithTimeout(
                        `${SyncManager.PI_BASE}/api/nasr/export`,
                        {},
                        30000
                    );
                    if (nasrResp.ok) {
                        const bundle = await nasrResp.json();
                        await this.db.importNasrBundle(bundle);
                        return;
                    }
                } else {
                    return; // Already current
                }
            }
        } catch {
            // Pi not reachable — try remote
        }

        // Fall back to flywhere.app (planning mode)
        await this._syncNasrFromRemote(localCycle);
    }

    /**
     * Download NASR bundle from flywhere.app (gzipped, ~3.7 MB).
     * Uses DecompressionStream to inflate client-side.
     */
    async _syncNasrFromRemote(localCycle) {
        try {
            // Check remote cycle info
            const cycleResp = await this._fetchWithTimeout(
                `${SyncManager.NASR_REMOTE}/cycle_info.json`
            );
            if (!cycleResp.ok) return;

            const remoteCycle = await cycleResp.json();
            if (localCycle && localCycle.effective_date === remoteCycle.effective_date) {
                return; // Already current
            }

            console.log('Downloading NASR bundle from flywhere.app...');
            const resp = await this._fetchWithTimeout(
                `${SyncManager.NASR_REMOTE}/bundle.json.gz`,
                {},
                60000 // 60s timeout for large download
            );
            if (!resp.ok) return;

            // Decompress gzip stream
            const ds = new DecompressionStream('gzip');
            const decompressed = resp.body.pipeThrough(ds);
            const text = await new Response(decompressed).text();
            const bundle = JSON.parse(text);

            await this.db.importNasrBundle(bundle);
            console.log('NASR bundle imported from flywhere.app');
        } catch (err) {
            console.warn('Remote NASR sync failed:', err);
        }
    }

    /**
     * Sync aircraft profiles from Pi.
     */
    async _syncAircraftProfiles() {
        try {
            const resp = await this._fetchWithTimeout(
                `${SyncManager.PI_BASE}/api/aircraft`
            );
            if (!resp.ok) return;

            const profiles = await resp.json();
            if (Array.isArray(profiles) && profiles.length > 0) {
                await this.db.saveAircraftProfiles(profiles);
            }
        } catch (err) {
            console.warn('Aircraft profile sync failed:', err);
        }
    }

    /**
     * Download the active flight plan package from Pi (for cockpit mode startup).
     */
    async downloadActivePackage() {
        try {
            const resp = await this._fetchWithTimeout(
                `${SyncManager.PI_BASE}/api/plan/active-package`
            );
            if (!resp.ok) return null;

            const pkg = await resp.json();
            if (pkg && pkg.flight_plan) {
                await this.db.saveFlightPlan(pkg);
                return pkg;
            }
        } catch (err) {
            console.warn('Package download failed:', err);
        }
        return null;
    }

    /**
     * Check if Pi is reachable.
     */
    async isPiReachable() {
        try {
            const resp = await this._fetchWithTimeout(
                `${SyncManager.PI_BASE}/api/status`,
                {},
                2000
            );
            return resp.ok;
        } catch {
            return false;
        }
    }

    /**
     * Get last sync info.
     */
    async getLastSyncInfo() {
        const stored = await this.db.getMeta('last_sync');
        return {
            timestamp: stored || this.lastSyncTimestamp,
            state: this.syncState,
        };
    }

    // ========== Helpers ==========

    async _fetchWithTimeout(url, options = {}, timeout = 5000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
