/**
 * PilotStation — NASR Database (IndexedDB)
 * Wraps IndexedDB for structured data storage: airports, navaids, airways,
 * weather cache, flight plans, W&B scenarios, fuel prices, aircraft profiles.
 */

class NasrDB {
    static DB_NAME = 'pilotstation';
    static DB_VERSION = 2;

    constructor() {
        this._db = null;
    }

    async open() {
        if (this._db) return this._db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(NasrDB.DB_NAME, NasrDB.DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Airports — keyed by ICAO, indexed for spatial queries
                if (!db.objectStoreNames.contains('airports')) {
                    const store = db.createObjectStore('airports', { keyPath: 'icao' });
                    store.createIndex('name', 'name', { unique: false });
                    store.createIndex('lat', 'lat', { unique: false });
                    store.createIndex('lon', 'lon', { unique: false });
                }

                // Navaids (VOR, NDB, DME)
                if (!db.objectStoreNames.contains('navaids')) {
                    const store = db.createObjectStore('navaids', { keyPath: 'id' });
                    store.createIndex('type', 'type', { unique: false });
                }

                // Airways (V, J, T, Q routes)
                if (!db.objectStoreNames.contains('airways')) {
                    db.createObjectStore('airways', { keyPath: 'name' });
                }

                // Airspace boundaries
                if (!db.objectStoreNames.contains('airspace')) {
                    const store = db.createObjectStore('airspace', { keyPath: 'id' });
                    store.createIndex('class', 'class', { unique: false });
                }

                // Named fixes/waypoints for route parsing
                if (!db.objectStoreNames.contains('fixes')) {
                    db.createObjectStore('fixes', { keyPath: 'id' });
                }

                // Weather cache — keyed by station ICAO
                if (!db.objectStoreNames.contains('weather_cache')) {
                    const store = db.createObjectStore('weather_cache', { keyPath: 'icao' });
                    store.createIndex('fetched_at', 'fetched_at', { unique: false });
                }

                // Flight plan packages
                if (!db.objectStoreNames.contains('flight_plans')) {
                    const store = db.createObjectStore('flight_plans', { keyPath: 'id' });
                    store.createIndex('created_at', 'created_at', { unique: false });
                    store.createIndex('active', 'active', { unique: false });
                }

                // W&B saved scenarios
                if (!db.objectStoreNames.contains('wb_scenarios')) {
                    const store = db.createObjectStore('wb_scenarios', { keyPath: 'id' });
                    store.createIndex('aircraft_id', 'aircraft_id', { unique: false });
                }

                // Fuel prices by airport
                if (!db.objectStoreNames.contains('fuel_prices')) {
                    db.createObjectStore('fuel_prices', { keyPath: 'icao' });
                }

                // Aircraft profiles
                if (!db.objectStoreNames.contains('aircraft_profiles')) {
                    db.createObjectStore('aircraft_profiles', { keyPath: 'id' });
                }

                // AI briefing cache
                if (!db.objectStoreNames.contains('ai_briefings')) {
                    const store = db.createObjectStore('ai_briefings', { keyPath: 'id' });
                    store.createIndex('flight_plan_id', 'flight_plan_id', { unique: false });
                }

                // Key-value metadata store
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                this._db = event.target.result;
                resolve(this._db);
            };

            request.onerror = (event) => {
                reject(new Error('IndexedDB open failed: ' + event.target.error));
            };
        });
    }

    // ========== Generic CRUD Helpers ==========

    async _get(storeName, key) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async _put(storeName, value) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const req = tx.objectStore(storeName).put(value);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async _delete(storeName, key) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const req = tx.objectStore(storeName).delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async _getAll(storeName) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async _clear(storeName) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const req = tx.objectStore(storeName).clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async _bulkPut(storeName, items) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            for (const item of items) {
                store.put(item);
            }
            tx.oncomplete = () => resolve(items.length);
            tx.onerror = () => reject(tx.error);
        });
    }

    // ========== Airport Operations ==========

    async getAirport(icao) {
        return this._get('airports', icao.toUpperCase());
    }

    async searchAirports(query) {
        const q = query.toUpperCase();
        const all = await this._getAll('airports');
        return all.filter(a =>
            a.icao.startsWith(q) ||
            (a.name && a.name.toUpperCase().includes(q))
        ).slice(0, 20);
    }

    async getAirportsNear(lat, lon, radiusNm) {
        // Rough bounding box filter, then haversine refinement
        const degPerNm = 1 / 60;
        const latRange = radiusNm * degPerNm;
        const lonRange = radiusNm * degPerNm / Math.cos(lat * Math.PI / 180);

        const all = await this._getAll('airports');
        return all.filter(a => {
            if (!a.lat || !a.lon) return false;
            if (Math.abs(a.lat - lat) > latRange) return false;
            if (Math.abs(a.lon - lon) > lonRange) return false;
            return NasrDB.haversineNm(lat, lon, a.lat, a.lon) <= radiusNm;
        });
    }

    // ========== Navaid Operations ==========

    async getNavaid(id) {
        return this._get('navaids', id.toUpperCase());
    }

    async searchNavaids(query) {
        const q = query.toUpperCase();
        const all = await this._getAll('navaids');
        return all.filter(n => n.id.startsWith(q)).slice(0, 20);
    }

    // ========== Airway Operations ==========

    async getAirway(name) {
        return this._get('airways', name.toUpperCase());
    }

    // ========== Weather Cache ==========

    async getWeather(icao) {
        return this._get('weather_cache', icao.toUpperCase());
    }

    async putWeather(icao, data) {
        return this._put('weather_cache', {
            icao: icao.toUpperCase(),
            ...data,
            fetched_at: data.fetched_at || new Date().toISOString(),
        });
    }

    async clearOldWeather(maxAgeMs = 3 * 3600000) {
        const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
        const all = await this._getAll('weather_cache');
        const old = all.filter(w => w.fetched_at < cutoff);
        for (const w of old) {
            await this._delete('weather_cache', w.icao);
        }
        return old.length;
    }

    // ========== Flight Plan Operations ==========

    async getActiveFlightPlan() {
        const all = await this._getAll('flight_plans');
        // Find the active one, or the most recent
        const active = all.find(p => p.active);
        if (active) return active;
        if (all.length === 0) return null;
        return all.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    }

    async saveFlightPlan(pkg) {
        if (!pkg.id) {
            pkg.id = crypto.randomUUID ? crypto.randomUUID() : `fp-${Date.now()}`;
        }
        pkg.created_at = pkg.created_at || new Date().toISOString();
        // Deactivate others
        const all = await this._getAll('flight_plans');
        for (const p of all) {
            if (p.id !== pkg.id && p.active) {
                p.active = false;
                await this._put('flight_plans', p);
            }
        }
        pkg.active = true;
        return this._put('flight_plans', pkg);
    }

    async getFlightPlan(id) {
        return this._get('flight_plans', id);
    }

    // ========== W&B Scenarios ==========

    async getWbScenarios(aircraftId) {
        const all = await this._getAll('wb_scenarios');
        return all.filter(s => s.aircraft_id === aircraftId);
    }

    async saveWbScenario(scenario) {
        if (!scenario.id) {
            scenario.id = crypto.randomUUID ? crypto.randomUUID() : `wb-${Date.now()}`;
        }
        scenario.created_at = scenario.created_at || new Date().toISOString();
        return this._put('wb_scenarios', scenario);
    }

    // ========== Fuel Prices ==========

    async getFuelPrice(icao) {
        return this._get('fuel_prices', icao.toUpperCase());
    }

    async putFuelPrices(prices) {
        return this._bulkPut('fuel_prices', prices);
    }

    // ========== Aircraft Profiles ==========

    async getAircraftProfiles() {
        return this._getAll('aircraft_profiles');
    }

    async getAircraftProfile(id) {
        return this._get('aircraft_profiles', id);
    }

    async saveAircraftProfile(profile) {
        return this._put('aircraft_profiles', profile);
    }

    async saveAircraftProfiles(profiles) {
        return this._bulkPut('aircraft_profiles', profiles);
    }

    // ========== AI Briefings ==========

    async getAiBriefing(flightPlanId) {
        const all = await this._getAll('ai_briefings');
        return all.find(b => b.flight_plan_id === flightPlanId) || null;
    }

    async saveAiBriefing(briefing) {
        if (!briefing.id) {
            briefing.id = crypto.randomUUID ? crypto.randomUUID() : `ai-${Date.now()}`;
        }
        return this._put('ai_briefings', briefing);
    }

    // ========== Metadata ==========

    async getMeta(key) {
        const result = await this._get('meta', key);
        return result ? result.value : null;
    }

    async setMeta(key, value) {
        return this._put('meta', { key, value, updated_at: new Date().toISOString() });
    }

    async getCycleInfo() {
        return this.getMeta('nasr_cycle_info');
    }

    // ========== NASR Data Import ==========

    async importNasrBundle(bundle) {
        // Bundle is an object with { airports, navaids, airways, airspace, fixes, cycle_info }
        let count = 0;
        if (bundle.airports && bundle.airports.length) {
            await this._clear('airports');
            count += await this._bulkPut('airports', bundle.airports);
        }
        if (bundle.navaids && bundle.navaids.length) {
            await this._clear('navaids');
            count += await this._bulkPut('navaids', bundle.navaids);
        }
        if (bundle.airways && bundle.airways.length) {
            await this._clear('airways');
            count += await this._bulkPut('airways', bundle.airways);
        }
        if (bundle.airspace && bundle.airspace.length) {
            await this._clear('airspace');
            count += await this._bulkPut('airspace', bundle.airspace);
        }
        if (bundle.fixes && bundle.fixes.length) {
            await this._clear('fixes');
            count += await this._bulkPut('fixes', bundle.fixes);
        }
        if (bundle.cycle_info) {
            await this.setMeta('nasr_cycle_info', bundle.cycle_info);
        }
        await this.setMeta('nasr_last_import', new Date().toISOString());
        return count;
    }

    // ========== Fix Operations ==========

    async getFix(id) {
        return this._get('fixes', id.toUpperCase());
    }

    async searchFixes(query) {
        const q = query.toUpperCase();
        const all = await this._getAll('fixes');
        return all.filter(f => f.id.startsWith(q)).slice(0, 20);
    }

    // ========== Static Utility: Haversine ==========

    static haversineNm(lat1, lon1, lat2, lon2) {
        const R = 3440.065; // Earth radius in nautical miles
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
