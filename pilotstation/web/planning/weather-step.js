/**
 * PilotStation — Step 3: Weather
 * Auto-fetch METARs, TAFs, winds aloft, PIREPs, SIGMETs for route corridor.
 * PLAN-04
 */

class WeatherStep {
    constructor({ controller, db }) {
        this.controller = controller;
        this.db = db;
        this.container = null;
        this.weatherData = null;
        this.fetching = false;
        this.client = new WeatherClient(db);
    }

    async render(container, workflowData) {
        this.container = container;

        // Restore from saved data
        if (workflowData.weather) {
            this.weatherData = workflowData.weather;
        }

        this._render();
    }

    async onEnter(workflowData) {
        // Auto-fetch if we have a route but no weather, or weather is stale (>60 min)
        const routeData = workflowData.route;
        if (!routeData || !routeData.departure) return;

        if (!this.weatherData || this._isStale(this.weatherData.fetched_at, 60)) {
            await this._fetchWeather();
        }
    }

    _render() {
        if (!this.container) return;

        const routeData = this.controller.workflowData.route;
        if (!routeData || !routeData.departure) {
            this.container.innerHTML = `
                <div class="card">
                    <div class="card-title">Weather</div>
                    <p class="text-muted">Complete the Route step first to fetch weather.</p>
                </div>
            `;
            return;
        }

        const wx = this.weatherData;
        const fetchedAt = wx?.fetched_at;
        const stale = this._isStale(fetchedAt, 60);

        this.container.innerHTML = `
            <div class="weather-fetch-bar">
                <span>
                    ${fetchedAt
                        ? `Fetched: ${new Date(fetchedAt).toLocaleTimeString()}`
                        : 'No weather data yet'}
                    ${stale ? '<span class="stale-warning"> — STALE (>60 min)</span>' : ''}
                </span>
                <button class="btn btn-primary refresh-wx-btn" ${this.fetching ? 'disabled' : ''}>
                    ${this.fetching ? '<span class="spinner"></span> Fetching...' : 'Refresh Weather'}
                </button>
            </div>

            ${wx ? this._renderWeatherCards(wx, routeData) : `
                <div class="card">
                    <p class="text-muted text-center">Click "Refresh Weather" to fetch data for your route.</p>
                </div>
            `}
        `;

        this.container.querySelector('.refresh-wx-btn')?.addEventListener('click', () => {
            this._fetchWeather();
        });
    }

    _renderWeatherCards(wx, routeData) {
        const metarEntries = Object.entries(wx.metars || {});
        const tafEntries = Object.entries(wx.tafs || {});
        const pireps = wx.pireps || [];
        const sigmets = wx.sigmets || [];
        const windsAloft = wx.winds_aloft || {};

        return `
            <!-- METARs -->
            <div class="card">
                <div class="card-title">
                    <span class="weather-section-title">
                        METARs <span class="count">${metarEntries.length}</span>
                    </span>
                </div>
                <div class="weather-stations">
                    ${metarEntries.length > 0 ? metarEntries.map(([icao, m]) => {
                        const d = m.decoded || {};
                        const cat = d.flight_category || 'VFR';
                        return `
                            <div class="weather-station">
                                <span class="cat-dot ${cat.toLowerCase()}"></span>
                                <span class="weather-station-id">${icao}</span>
                                <div class="weather-station-info">
                                    <div>
                                        ${d.wind_dir !== null ? `Wind ${d.wind_dir}° @ ${d.wind_speed}kt${d.wind_gust ? ` G${d.wind_gust}` : ''}` : 'Wind calm'}
                                        &nbsp;|&nbsp;
                                        Vis ${d.visibility !== null ? d.visibility + 'SM' : '?'}
                                        &nbsp;|&nbsp;
                                        Ceil ${d.ceiling !== null ? d.ceiling + ' AGL' : 'CLR'}
                                        &nbsp;|&nbsp;
                                        Alt ${d.altimeter ? d.altimeter.toFixed(2) : '?'}
                                    </div>
                                    <div class="text-sm text-muted">
                                        T ${d.temperature ?? '?'}°C / Dp ${d.dewpoint ?? '?'}°C
                                        ${d.weather.length > 0 ? ' | ' + d.weather.join(' ') : ''}
                                    </div>
                                    <div class="weather-raw">${m.raw || ''}</div>
                                </div>
                            </div>
                        `;
                    }).join('') : '<p class="text-muted">No METARs available</p>'}
                </div>
            </div>

            <!-- TAFs -->
            <div class="card">
                <div class="card-title">
                    <span class="weather-section-title">
                        TAFs <span class="count">${tafEntries.length}</span>
                    </span>
                </div>
                ${tafEntries.length > 0 ? tafEntries.map(([icao, t]) => `
                    <div class="weather-station" style="flex-direction:column;">
                        <div class="flex items-center gap-sm">
                            <span class="weather-station-id">${icao}</span>
                        </div>
                        <div class="weather-raw" style="margin-top:4px;">${t.raw || ''}</div>
                    </div>
                `).join('') : '<p class="text-muted">No TAFs available</p>'}
            </div>

            <!-- Winds Aloft -->
            <div class="card">
                <div class="card-title">
                    <span class="weather-section-title">
                        Winds Aloft
                    </span>
                </div>
                ${Object.keys(windsAloft).length > 0 ? `
                    <table class="winds-table">
                        <thead>
                            <tr>
                                <th>Altitude</th>
                                <th>Direction</th>
                                <th>Speed</th>
                                <th>Temp</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.entries(windsAloft)
                                .sort(([a], [b]) => Number(a) - Number(b))
                                .map(([alt, w]) => `
                                    <tr ${Number(alt) === routeData.altitude ? 'style="background:color-mix(in srgb, var(--accent) 10%, transparent);font-weight:700;"' : ''}>
                                        <td>${Number(alt).toLocaleString()} ft</td>
                                        <td>${w.variable ? 'VRB' : w.dir + '°'}</td>
                                        <td>${w.spd} kt</td>
                                        <td>${w.temp !== null ? w.temp + '°C' : '—'}</td>
                                    </tr>
                                `).join('')}
                        </tbody>
                    </table>
                ` : '<p class="text-muted">No winds aloft data available</p>'}
            </div>

            <!-- PIREPs & SIGMETs -->
            <div class="card">
                <div class="card-title">
                    <span class="weather-section-title">
                        PIREPs <span class="count">${pireps.length}</span>
                        &nbsp;&nbsp;|&nbsp;&nbsp;
                        SIGMETs/AIRMETs <span class="count">${sigmets.length}</span>
                    </span>
                </div>
                ${pireps.length > 0 ? `
                    <div class="weather-section">
                        ${pireps.slice(0, 10).map(p => `
                            <div class="weather-raw mb-sm">${p.rawOb || p.raw_text || JSON.stringify(p)}</div>
                        `).join('')}
                        ${pireps.length > 10 ? `<p class="text-sm text-muted">+ ${pireps.length - 10} more</p>` : ''}
                    </div>
                ` : '<p class="text-muted mb-sm">No PIREPs in route corridor</p>'}
                ${sigmets.length > 0 ? `
                    <div class="weather-section">
                        ${sigmets.slice(0, 5).map(s => `
                            <div class="weather-raw mb-sm">${s.rawAirSigmet || s.raw_text || JSON.stringify(s)}</div>
                        `).join('')}
                        ${sigmets.length > 5 ? `<p class="text-sm text-muted">+ ${sigmets.length - 5} more</p>` : ''}
                    </div>
                ` : '<p class="text-muted">No active SIGMETs/AIRMETs</p>'}
            </div>
        `;
    }

    async _fetchWeather() {
        const routeData = this.controller.workflowData.route;
        if (!routeData || !routeData.departure) return;

        this.fetching = true;
        this._render();

        try {
            // Build station list from route
            const stations = [routeData.departure];
            if (routeData.waypoints) {
                for (const wp of routeData.waypoints) {
                    if (wp.id && wp.type === 'fix') stations.push(wp.id);
                }
            }
            stations.push(routeData.destination);

            // Deduplicate
            const unique = [...new Set(stations.filter(Boolean))];

            this.weatherData = await this.client.fetchAllForRoute(
                unique,
                routeData.altitude || 8000
            );

            this._notifyChange();
        } catch (err) {
            console.error('Weather fetch error:', err);
            if (this.container) {
                const bar = this.container.querySelector('.weather-fetch-bar');
                if (bar) {
                    bar.innerHTML += `<span class="text-sm" style="color:var(--color-danger);">
                        Fetch failed: ${err.message}</span>`;
                }
            }
        } finally {
            this.fetching = false;
            this._render();
        }
    }

    _isStale(isoTimestamp, maxAgeMinutes) {
        if (!isoTimestamp) return true;
        const age = Date.now() - new Date(isoTimestamp).getTime();
        return age > maxAgeMinutes * 60 * 1000;
    }

    _notifyChange() {
        this.controller.dataChanged('weather', this.getData());
    }

    validate() {
        if (!this.weatherData) {
            alert('Fetch weather before proceeding.');
            return false;
        }
        return true;
    }

    getData() {
        return this.weatherData;
    }

    onLeave() {}
}
