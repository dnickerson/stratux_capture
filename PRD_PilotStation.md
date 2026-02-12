# PilotStation: Unified Cockpit EFB Platform

## Product Requirements Document v1.6

**Date:** 2026-02-11
**Author:** Dana Nickerson
**Platform:** Raspberry Pi 5 (headless server) + iPad (display via Safari)
**Status:** Draft

---

## 1. Executive Summary

PilotStation is a unified, open-source Electronic Flight Bag (EFB) platform that consolidates navigation, engine monitoring, fuel planning, weather briefing, flight planning, and flight logging into a single cockpit-optimized web interface. The **Raspberry Pi 5 runs headless** as a server (alongside Stratux ADS-B), serving the full PilotStation UI to an **iPad via Safari** over the existing Stratux WiFi hotspot (`192.168.10.1`).

The PWA operates as a **dual-mode application**: when the iPad is on home WiFi (internet), it enters **Planning Mode** with a 6-step pre-flight workflow integrating route planning, weather, weight & balance, fuel stop optimization, an AI copilot (Claude API) for weather analysis and go/no-go reasoning, official weather briefing via 1800wxbrief, and VFR/IFR flight plan filing. When the iPad connects to Stratux WiFi at the aircraft, it enters **Cockpit Mode** with the full in-flight UI, automatically syncing the flight plan package to the Pi and reminding the pilot to activate and close filed flight plans.

This architecture leverages:

- **iPad's superior display** — high brightness, Retina resolution, proven sunlight readability, existing cockpit yoke mount
- **Existing workflow** — the engine monitor v3.3.0 already works this way (iPad → `192.168.10.1:8080`)
- **No AvareX dependency** — FAA sectional/IFR charts are served as map tiles directly from the Pi using Leaflet.js, eliminating all of AvareX's UI/UX problems
- **Existing Stratux hardware** — ADS-B reception, WiFi hotspot, GPS already running on the Pi
- **Dual-mode PWA** — one app handles both pre-flight planning (internet) and in-flight cockpit display (Stratux WiFi)
- **AI-powered decision support** — Claude API via Cloudflare Worker proxy for weather analysis, NOTAM filtering, and go/no-go reasoning
- **Integrated flight plan filing** — file VFR/IFR plans and obtain official weather briefings via 1800wxbrief API, with smart cockpit reminders for activation and closing

It replaces ForeFlight ($200+/yr subscription) by integrating custom-built modules (engine monitor v3.3.0, fuel planner) with a new web-based moving map and new capabilities (profile view, logbook, weather briefing, AI copilot) — all in one unified cockpit UI.

The core design principle is **cockpit-first UI/UX**: every interaction must be achievable with one gloved tap on a turbulence-shaken touchscreen in direct sunlight.

---

## 2. Problem Statement

Today's cockpit requires a pilot to manage multiple disconnected systems:

| Current Tool                    | Function                                                 | Problem                                                              |
| ------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| ForeFlight (iPad)               | Charts, navigation, weather, flight planning             | $200+/yr subscription, closed ecosystem                              |
| Stratux (Pi)                    | ADS-B traffic and FIS-B weather                          | Separate web UI, not integrated with engine/fuel data                |
| Engine Monitor v3.3.0 (Pi/iPad) | EDM-700/800 data, power analysis, sticky valve detection | Separate web app on port 8080, not integrated with navigation        |
| Fuel Planner PWA (Pi/iPad)      | Fuel tracking, tic measurements, burn rate profiles      | Separate app, manual sync with engine monitor                        |
| Garmin GPS 175 (panel)          | IFR navigation, WAAS approaches                          | Proprietary Connext protocol limits third-party flight plan transfer |
| Paper/1800wxbrief               | Weather briefing, profile view                           | No digital integration, no cross-section visualization               |

**PilotStation unifies all of these into one screen on the iPad, served from the same Pi that already runs Stratux.**

---

## 3. Target User

- VFR/IFR general aviation pilot
- Multiple aircraft:
  - Piper Cherokee PA-28 (O-360-A1A, fixed gear, EDM-700/800 engine monitor, EI FT-60 Red Cube fuel flow sensor)
  - Vans RV-9A (O-320, Dynon D180 EFIS with integrated engine monitor, Garmin GPS 175, TruTrak Xcruze 100 autopilot)
- Typical missions: 1-4 hour flights, 100-300nm, operating out of towered and non-towered fields, up to Class B airspace
- Existing equipment: Stratux ADS-B receiver, Garmin GPS 175 (both aircraft)
- Technical comfort: Can configure Raspberry Pi, comfortable with web interfaces

---

## 4. Design Philosophy

### 4.1 Cockpit-First UI Principles

Based on FAA AC 25-11B, AC 120-76E, and published cockpit touchscreen research:

| Principle                  | Requirement                                                     | Rationale                                                                                            |
| -------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Touch targets**          | Minimum 18mm (21mm preferred)                                   | Cockpit research: 21mm achieves lowest operation time; 18mm lowest error rate (PLOS One PMC10852311) |
| **Button spacing**         | Minimum 3mm between targets                                     | Prevents mis-taps in turbulence (Springer 978-3-031-06509-5_23)                                      |
| **Font size**              | Minimum 14pt body, 18pt critical data, 24pt primary instruments | FAA AC 25-11B: readable from total darkness to bright reflected sunlight                             |
| **Display density**        | Below 50%, prefer below 25% for text                            | FAA AC 25-11B                                                                                        |
| **Contrast ratio**         | Minimum 7:1 (WCAG AAA)                                          | Sunlight readability requirement                                                                     |
| **Color scheme**           | High-contrast day mode + red-filtered night mode                | AC 25-11B: all normal cockpit lighting conditions                                                    |
| **Tap depth**              | Maximum 2 taps to any critical function                         | ForeFlight's key advantage: persistent bottom bar, single-tap access                                 |
| **Screen orientation**     | Landscape locked, no auto-rotation                              | AvareX forum complaint: auto-rotation makes app "unusable" in flight                                 |
| **Progressive disclosure** | Show only what's needed for current flight phase                | Reduce cognitive load: taxi → takeoff → cruise → approach → landing                                  |

### 4.2 One-Screen Architecture

The primary display is a **single-screen layout with persistent zones**:

```
┌─────────────────────────────────────────────────────┐
│ STATUS BAR (GPS, time, fuel remaining, next WPT)    │  ← Always visible
├───────────────────────────────────┬─────────────────┤
│                                   │                 │
│                                   │   RIGHT PANEL   │
│         PRIMARY VIEW              │   (split)       │
│    (map / profile / engine)       │                 │
│                                   │  Top: contextual│
│                                   │  (per-view data)│
│                                   │  ─────────────  │
│                                   │  Bottom: always │
│                                   │  engine + fuel  │
│                                   │                 │
├───────────────────────────────────┴─────────────────┤
│ NAV BAR: [MAP] [ENGINE] [FUEL] [WX] [PLAN] [LOG]   │  ← Always visible
└─────────────────────────────────────────────────────┘
```

- **Status bar** (top): persistent, shows critical flight data at all times — never goes blank
- **Primary view** (left ~70%): swappable main content area
- **Right panel** (right ~30%): split into a contextual top section (changes per view) and a persistent bottom strip that always shows engine/fuel health at a glance
- **Nav bar** (bottom): 6 large tab buttons, always accessible — no buried menus

**Note:** This layout describes **Cockpit Mode** (Stratux WiFi). In **Planning Mode** (home WiFi), the layout adapts with a different status bar, step progress nav bar, and light color scheme — see Section 5.7.4 and Section 7.4 for Planning Mode layouts.

---

## 5. System Architecture

### 5.1 Hardware

**Pi 5 (headless server — mounts behind/under panel or in baggage area):**

| Component             | Specification                                               | Purpose                                               |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| Raspberry Pi 5 (8GB)  | Quad Cortex-A76 @ 2.4GHz, 8GB RAM                           | Headless server — runs Stratux + PilotStation backend |
| SDR dongle (978 MHz)  | RTL-SDR Blog V3 or equivalent                               | UAT ADS-B reception (existing Stratux hardware)       |
| SDR dongle (1090 MHz) | RTL-SDR Blog V3 or equivalent                               | 1090ES ADS-B reception (existing Stratux hardware)    |
| USB GPS (WAAS)        | GlobalSat BU-353S4 or VK-162                                | Position source (existing Stratux hardware)           |
| USB-to-Serial adapter | FTDI or CH340                                               | Engine monitor serial (EDM-700/800 or Dynon D180)     |
| Bluetooth 5.0         | Pi 5 built-in                                               | Garmin GPS 175 connection (future)                    |
| Cooling               | Active fan + heatsink case                                  | Cockpit heat management                               |
| Power                 | 5V/5A USB-C, aircraft USB port or cigarette lighter adapter | Reliable cockpit power                                |
| MicroSD               | 128GB+ Class 10 A2                                          | OS + FAA chart tiles + terrain data + flight logs     |

**iPad (display — existing cockpit setup):**

| Component            | Specification                              | Purpose                                     |
| -------------------- | ------------------------------------------ | ------------------------------------------- |
| iPad (any model)     | Existing device with yoke/panel mount      | High-brightness Retina display, touch input |
| WiFi connection      | Connects to Stratux hotspot (192.168.10.1) | Network link to Pi 5                        |
| Safari (full screen) | Add-to-Home-Screen PWA                     | PilotStation UI — no app store dependency   |

**No new display hardware required.** The iPad already in the cockpit becomes the sole display. The Pi 5 becomes a more capable version of the existing Stratux box.

### 5.2 Software Stack

```
  iPad (Display)                    Raspberry Pi 5 (Headless Server)
┌─────────────────┐              ┌─────────────────────────────────────┐
│                 │   WiFi       │                                     │
│  Safari / PWA   │◀──────────▶│  Nginx (reverse proxy + tile server) │
│                 │ 192.168.10.1 │    ├── /            → PilotStation UI│
│  PilotStation   │              │    ├── /tiles/      → FAA chart tiles│
│  Web UI         │              │    └── /api/        → FastAPI backend│
│  (HTML/CSS/JS)  │              │                                     │
│  Leaflet.js map │              │  FastAPI Backend (Python)            │
│  Chart.js graphs│              │    ├── Engine Monitor (from v3.3.0) │
│  WebSocket live │              │    ├── Fuel Planner                  │
│                 │              │    ├── Weather Service               │
│                 │              │    ├── Flight Planner                │
│                 │              │    ├── Logbook                       │
│                 │              │    ├── GDL90 Listener                │
│                 │              │    └── WebSocket Server              │
│                 │              │                                     │
│                 │              │  Stratux (existing)                  │
│                 │              │    ├── dump978 / dump1090            │
│                 │              │    ├── GPS (NMEA)                    │
│                 │              │    └── WiFi hotspot                  │
│                 │              │                                     │
│                 │              │  Nginx serving static files:         │
│                 │              │    └── /tiles/{z}/{x}/{y}.webp      │
│                 │              │        (FAA sectional, IFR, TAC)    │
└─────────────────┘              └─────────────────────────────────────┘
         │ Bluetooth                        │ Serial (USB)
         ▼                                  ▼
   ┌──────────┐                      ┌──────────────┐
   │ Garmin   │                      │ EDM-700/800  │
   │ GPS 175  │                      │ or Dynon D180│
   │ (future) │                      │ Engine Mon   │
   └──────────┘                      └──────────────┘
```

**Key architectural decisions:**

1. **Web-based UI served to iPad via Safari** — the existing engine monitor already works this way. iPad connects to Stratux WiFi, opens `http://192.168.10.1:8080`. Zero app store friction.

2. **PWA (Progressive Web App)** — add-to-home-screen for full-screen experience, offline caching of UI assets, no Safari chrome/address bar.

3. **FAA chart tiles served by Nginx** — FAA provides free GeoTIFF sectional/IFR/TAC charts. These are pre-processed into WEBP map tiles using GDAL (on a desktop machine) and served as static files by Nginx on the Pi. Leaflet.js renders them in Safari. ~3-5 GB for full CONUS coverage. Updated every 56-day AIRAC cycle.

4. **No AvareX dependency** — by rendering FAA charts natively in Leaflet.js, we control the entire UI/UX. No fighting with AvareX's small buttons, overlapping tap targets, or buried menus.

5. **Stratux coexistence** — PilotStation runs alongside Stratux on the same Pi. Stratux handles ADS-B decoding and WiFi hotspot. PilotStation reads Stratux data via its HTTP API (`localhost/getSituation`) and GDL90 (UDP 4000), exactly as engine_monitor.py v3.3.0 already does.

### 5.3 Chart & Data Pipeline

**The Pi never has internet access.** All FAA data must be prepared externally and transferred to the Pi via iPad (WiFi upload) or USB drive. There are three categories of data with different update cycles:

| Data Type       | Update Cycle | Source                | Size (full US) | Preparation             |
| --------------- | ------------ | --------------------- | -------------- | ----------------------- |
| Chart tiles     | 56 days      | FAA GeoTIFF → GDAL    | 3-5 GB         | Desktop (GDAL required) |
| Approach plates | 28 days      | FAA d-TPP PDFs        | 2-3 GB         | Download + repackage    |
| NASR data       | 28 days      | FAA NASR subscription | ~50 MB         | Download + convert      |
| Terrain         | Static       | NASA SRTM             | ~500 MB        | One-time download       |

**Chart tile processing (desktop, every 56 days):**

```
FAA GeoTIFF download (faa.gov, free)
    │
    ▼
gdalwarp (crop borders using shapefiles, reproject to EPSG:3857)
    │
    ▼
gdalbuildvrt (merge all charts into virtual mosaic)
    │
    ▼
gdal2tiles.py (generate tiles at zoom levels 5-11, WEBP format)
    │
    ▼
tar -czf pilotstation-tiles-YYYYMMDD.tar.gz tiles/
    │
    ▼
Transfer to Pi via USB drive or iPad upload (see 6.9 Data Update Manager)
```

**Chart types to process:**

| Chart Type       | Tile URL Path                       | Update Cycle |
| ---------------- | ----------------------------------- | ------------ |
| VFR Sectional    | `/tiles/sectional/{z}/{x}/{y}.webp` | 56 days      |
| IFR Low Enroute  | `/tiles/ifr-low/{z}/{x}/{y}.webp`   | 56 days      |
| IFR High Enroute | `/tiles/ifr-high/{z}/{x}/{y}.webp`  | 56 days      |
| Terminal Area    | `/tiles/tac/{z}/{x}/{y}.webp`       | 56 days      |

**Tools:** [aviationCharts](https://github.com/jlmcgraw/aviationCharts) automates the full pipeline (download → crop → tile → optimize).

**Approach plate preparation (desktop or iPad, every 28 days):**

```
Download d-TPP ZIP from FAA (by state or full US)
    │
    ▼
Extract individual plate PDFs
    │
    ▼
Parse d-TPP_Metafile.xml → generate plate_index.json
    │
    ▼
For each IAP plate: extract geo bounds via GDAL, rasterize to PNG (see 6.8)
    │
    ▼
Generate plate_geo_index.json (WGS84 bounds per plate)
    │
    ▼
Organize by airport ICAO code (PDFs + PNGs)
    │
    ▼
tar -czf pilotstation-plates-YYYYMMDD.tar.gz plates/
    │
    ▼
Transfer to Pi via iPad upload or USB drive
```

**Storage budget (128 GB MicroSD):**

| Content                | Size        |
| ---------------------- | ----------- |
| Stratux OS + software  | ~4 GB       |
| Chart tiles (CONUS)    | ~3-5 GB     |
| Approach plates + PNGs | ~4-6 GB     |
| NASR + airspace        | ~100 MB     |
| Terrain (SRTM)         | ~500 MB     |
| Flight data + logs     | ~5 GB       |
| CIFP database (SQLite) | ~50 MB      |
| **Total**              | **~19 GB**  |
| **Free space**         | **~109 GB** |

### 5.4 Data Flow

```
                  Raspberry Pi 5 (in aircraft, NO internet)
                ┌─────────────────────────────────────────────┐
                │                                              │
Engine Mon  ──serial──▶ Engine Monitor ──API──▶ ┐             │
(EDM/D180)              (parser per aircraft)   │             │
                │                                │             │
Stratux SDRs ──GDL90──▶ Traffic/FIS-B  ──API──▶ │  WiFi       │
                │            Weather              ├──────────▶ │──▶ iPad
Stratux GPS ──HTTP───▶ Position        ──API──▶ │ 192.168.10.1│    Safari
                │                                │             │
                │  Nginx ─▶ Chart Tiles ────────▶ │             │
                │  Nginx ─▶ Approach Plates ────▶ │             │
                │  Cache ─▶ Pre-fetched Weather ─▶ ┘             │
                │                                              │
                └─────────────────────────────────────────────┘

Weather sources (Pi has no internet):
  In-flight:  FIS-B via Stratux ADS-B (METARs, NEXRAD, TAFs, winds)
  Pre-flight: Weather fetched in Planning Mode via Cloudflare Worker, uploaded to Pi as flight plan package
```

### 5.5 Connectivity Model

**The Pi stays in the aircraft and never connects to the internet.** This is a fundamental constraint that shapes the entire data architecture. The PilotStation PWA operates in different modes depending on which network the iPad is connected to (see Section 5.7).

| Context                | iPad WiFi                   | Pi connectivity | PWA Mode         | Weather source                                   | Data updates                          |
| ---------------------- | --------------------------- | --------------- | ---------------- | ------------------------------------------------ | ------------------------------------- |
| At home/FBO            | Home/FBO WiFi (internet)    | Not accessible  | **Planning Mode** | PWA fetches via Cloudflare Worker proxy          | PWA downloads NASR, fuel prices to IndexedDB |
| Pre-flight at aircraft | Stratux WiFi (192.168.10.1) | iPad ↔ Pi only  | **Cockpit Mode**  | iPad uploads flight plan + weather package to Pi | iPad syncs NASR cache, uploads flight plan |
| In-flight              | Stratux WiFi (192.168.10.1) | iPad ↔ Pi only  | **Cockpit Mode**  | FIS-B via ADS-B + pre-cached                    | All data on Pi                        |
| No network             | None                        | Not accessible  | **Offline Mode**  | Cached only — stale data warning                 | No updates possible                   |

**Pre-flight planning workflow (see Section 6.11 for details):**

1. At home/FBO: iPad on internet WiFi → PilotStation PWA auto-enters **Planning Mode** → pilot completes 6-step flight planning workflow (aircraft → route → weather → W&B → AI briefing → ready)
2. PWA fetches weather via Cloudflare Worker proxy, calculates W&B, optionally queries Claude API for AI analysis
3. PWA auto-saves flight plan package to IndexedDB
4. Drive to airport, switch iPad to Stratux WiFi
5. PWA auto-detects Pi → offers to upload flight plan package via `POST /api/plan/upload-package`
6. Pi receives package: flight plan active on map, weather in cache with "fetched at" timestamp, W&B displayed in PLAN view
7. In-flight: FIS-B supplements/replaces cached weather with live data received via ADS-B

**Future option:** USB cellular dongle on Pi could provide internet access, but adds complexity and monthly cost. Defer until proven necessary.

### 5.6 Overlay-Aware Data Persistence

**The problem:** Stratux uses `overlayfs` to make the root filesystem read-only, protecting the SD card from corruption during sudden power loss (common in aircraft — master switch off = instant power cut). All writes to `/` go to a 250MB tmpfs layer that vanishes on reboot. PilotStation must persist flight logs, engine data, fuel state, preferences, and aircraft profiles through power cycles while respecting this overlay.

**How Stratux's overlay works:**

```
Boot:
  Kernel runs /sbin/init-overlay
  → Creates tmpfs (250MB) as writable layer
  → Mounts overlayfs: tmpfs (rw) + root (ro) = combined root
  → pivot_root into combined root
  → /overlay/robase = bind mount of real root (normally ro)
  → /overlay/rwdata = tmpfs writable layer (lost on reboot)

Runtime paths:
  /boot/firmware/         ← FAT32 boot partition, ALWAYS writable
  /overlay/robase/        ← real root, normally ro, unlockable via overlayctl
  everything else         ← overlay (reads from base, writes to tmpfs)
```

Stratux persists its own config to `/boot/firmware/stratux.conf` (always writable). For network settings, it uses `overlayctl unlock` → writes to `/overlay/robase/etc/` → `overlayctl lock`. PilotStation follows these same established patterns.

**PilotStation tiered storage strategy:**

| Tier                | Location                                        | Writable?                                   | Survives reboot? | Data type                                          |
| ------------------- | ----------------------------------------------- | ------------------------------------------- | ---------------- | -------------------------------------------------- |
| 1 — Boot partition  | `/boot/firmware/pilotstation/`                  | Always                                      | Yes              | Config, fuel state, aircraft profiles              |
| 2 — Base filesystem | `/overlay/robase/home/pi/pilotstation/data/`    | Via overlayctl unlock/lock                  | Yes              | Flight logs, engine CSVs, SQLite DB, W&B scenarios |
| 3 — Overlay (tmpfs) | `/home/pi/pilotstation/` (in overlay)           | Always                                      | No               | Weather cache, runtime state, active session       |
| 4 — Read-only base  | `/home/pi/pilotstation/tiles/`, `plates/`, etc. | Via overlayctl (data pipeline updates only) | Yes              | Chart tiles, approach plates, NASR data, terrain   |

**Tier 1 — Boot Partition (always writable, instant persistence)**

```
/boot/firmware/pilotstation/
├── pilotstation.conf          # Main settings + preferences (JSON)
│                              #   includes pilot_info: { name, phone, address, wxbrief_username }
│                              #   for 1800wxbrief flight plan filing (see Section 6.13)
├── active_fuel_state.json     # Current fuel quantities (written every 60s in flight)
└── aircraft/
    ├── pa28-cherokee.json     # Aircraft W&B + engine + fuel config
    └── rv9a.json
```

Same pattern as Stratux's `stratux.conf`. The FAT32 boot partition is never part of the overlay — writes are immediate and survive power loss. Ideal for small, critical config files. Updated on settings change and periodically for fuel state.

Limitation: FAT32 (no symlinks, no POSIX permissions, 4GB file limit). Keep files small and few.

**Tier 2 — Managed Writes to Base Filesystem (event-driven flush)**

Writes are **batched at key events**, not on every data point, to minimize the unlock/lock window:

| Event             | Data written                            | Flush target                              |
| ----------------- | --------------------------------------- | ----------------------------------------- |
| Flight end        | Engine CSV, GPS track, flight log entry | Base filesystem via overlayctl            |
| Fuel addition     | Fuel log entry                          | Base filesystem + boot partition          |
| W&B scenario save | Scenario JSON                           | Base filesystem via overlayctl            |
| Settings change   | Preferences                             | Boot partition (Tier 1, no unlock needed) |

Flush sequence:

```python
def flush_flight_data(flight):
    # Filename format: {date}_{route}.csv (e.g., 2026-02-11_KLKR-KCLT.csv)
    base_name = f"{flight.date}_{flight.departure}-{flight.destination}"
    base_path = "/overlay/robase/home/pi/pilotstation/data/flights"
    subprocess.run(["/sbin/overlayctl", "unlock"])
    try:
        write_engine_csv(f"{base_path}/{base_name}.csv")
        write_savvy_csv(f"{base_path}/{base_name}_savvy.csv", flight.aircraft)
        update_flight_log("/overlay/robase/home/pi/pilotstation/data/pilotstation.db")
    finally:
        subprocess.run(["/sbin/overlayctl", "lock"])
    # Also update fuel state on boot partition (no unlock needed)
    write_fuel_state("/boot/firmware/pilotstation/active_fuel_state.json")
```

**Tier 3 — Volatile (rebuilt from live data, no persistence needed)**

Weather cache, active ADS-B traffic, WebSocket state, tile render cache. These are rebuilt from FIS-B or re-cached on next boot. Lost on power cycle — acceptable.

**Tier 4 — Static / Pre-loaded (updated via data pipeline only)**

Chart tiles, approach plates, NASR data, terrain. Updated every 28-56 days via the data pipeline (Section 5.3) using `overlayctl unlock` → transfer files → `overlayctl lock`. Read-only during normal operation — the overlay serves them transparently.

**In-flight data buffering:**

During flight, engine data and GPS tracks accumulate in **tmpfs** (Tier 3). At flight end, the backend flushes to Tier 2 (base filesystem). If power is lost mid-flight before flush, the current flight's engine/GPS recording is lost — same behavior as Stratux losing its logs in overlay mode. The last-known fuel state from Tier 1 (boot partition, updated every 60 seconds) survives.

**Power-loss recovery on next startup:**

1. Read fuel state from `/boot/firmware/pilotstation/active_fuel_state.json` (Tier 1)
2. Read aircraft profiles from `/boot/firmware/pilotstation/aircraft/` (Tier 1)
3. Read flight log from base filesystem via overlay — overlay reads see both layers (Tier 2)
4. Prompt pilot to confirm fuel quantities (they may have fueled while powered down)
5. Rebuild volatile caches from live data (Tier 3)

**SQLite journal mode:**

The SQLite database uses **WAL (Write-Ahead Logging)** mode for atomic writes during the brief overlayctl unlock windows. WAL ensures the database remains consistent even if power is lost during a write. The `-wal` and `-shm` files are written alongside the database in the base filesystem.

### 5.7 Dual-Mode PWA Architecture

PilotStation is a single PWA that operates in different modes depending on the iPad's network connectivity. This replaces the previous "Companion page" concept with an integrated experience — one app, one install, two modes.

#### 5.7.1 Operating Modes

```
                        PWA Loads
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
       Pi reachable?   Internet?    Neither?
       (probe 2s)      (probe 2s)
             │             │             │
             ▼             ▼             ▼
       COCKPIT MODE   PLANNING MODE  OFFLINE MODE
       (full cockpit   (pre-flight    (cached plan +
        UI + live       workflow +     stale weather
        data from Pi)   internet APIs) warning)

       Manual override: [MODE ▼] in status bar
```

**Mode detection algorithm:**

1. **Network probe (primary):** On page load and every 30 seconds, the PWA probes:
   - `fetch('http://192.168.10.1/api/status', { signal: AbortSignal.timeout(2000) })` — if reachable → Cockpit Mode
   - `fetch('https://pilotstation-api.workers.dev/health', { signal: AbortSignal.timeout(2000) })` — if reachable → Planning Mode
   - Both fail → Offline Mode
2. **IP address heuristic (fast fallback):** If `window.location.hostname === '192.168.10.1'`, default to Cockpit Mode immediately before probes complete
3. **Manual override:** Tappable mode badge in status bar (`PLANNING` / `COCKPIT` / `OFFLINE`) opens modal with three options

**Mode transition notifications:** Non-blocking blue banner: "Switched to Cockpit Mode — Pi detected" (auto-dismisses after 5 seconds).

| ID      | Requirement                                                        | Priority |
| ------- | ------------------------------------------------------------------ | -------- |
| MODE-01 | Network probe to detect Pi (192.168.10.1) with 2-second timeout   | P1       |
| MODE-02 | Network probe to detect internet via Cloudflare Worker health endpoint | P1   |
| MODE-03 | Automatic mode switching with 30-second re-probe interval         | P1       |
| MODE-04 | Manual mode override via tappable status bar badge                | P1       |
| MODE-05 | Mode transition notification (non-blocking blue banner, 5s dismiss) | P1     |
| MODE-06 | Mode state persisted in localStorage for instant startup          | P1       |

#### 5.7.2 Planning Mode Architecture

```
  iPad (Planning Mode — on home/FBO WiFi)
┌───────────────────────────────────────────────────────────┐
│                                                            │
│  PilotStation PWA (Safari / Home Screen)                  │
│  ├── Mode Detector (network probes every 30s)             │
│  ├── Planning Workflow UI (6-step guided flow)            │
│  ├── IndexedDB Store                                      │
│  │   ├── NASR cache (airports, navaids, airways, airspace)│
│  │   ├── Weather cache (METARs, TAFs, winds, PIREPs)     │
│  │   ├── Flight plan package (staged for upload)         │
│  │   ├── W&B scenarios                                   │
│  │   └── Fuel prices                                     │
│  ├── Service Worker (dual-mode caching)                  │
│  └── API Client → Cloudflare Worker Proxy                │
│                         │                                  │
│                         ▼                                  │
│           Cloudflare Worker (pilotstation-api.workers.dev) │
│           ├── /claude       → api.anthropic.com             │
│           ├── /wx/*         → aviationweather.gov          │
│           ├── /fuel-prices  → aviation-fuel-prices.com     │
│           ├── /fp/*         → lmfsweb.afss.com (filing)    │
│           └── /briefing     → lmfsweb.afss.com (briefing)  │
│                                                            │
└───────────────────────────────────────────────────────────┘
```

**IndexedDB storage budget:**

| Data                            | Size (compressed) | Purpose                          |
| ------------------------------- | ----------------- | -------------------------------- |
| NASR airports + runways + freqs | ~8 MB             | Airport search, info popups      |
| NASR navaids + airways          | ~3 MB             | Route planning with airways      |
| NASR airspace boundaries        | ~4 MB             | Airspace awareness               |
| Weather cache (route)           | ~0.1 MB           | METARs, TAFs, winds, PIREPs     |
| Flight plan package             | ~0.01 MB          | Staged plan for upload           |
| Fuel prices                     | ~0.5 MB           | Fuel stop comparison             |
| AI briefing results             | ~0.01 MB          | Cached Claude analysis           |
| **Total**                       | **~16 MB**        | Well within Safari's 500 MB limit |

#### 5.7.3 Mode Transition & Data Sync

When the PWA detects a transition from Planning Mode (or Offline Mode) to Cockpit Mode, it offers to upload the staged flight plan package.

**Sync protocol:**

1. Mode detection fires "Pi reachable" event
2. PWA checks IndexedDB for a staged flight plan package
3. If package exists and is newer than last sync (`GET /api/plan/sync-status`), a confirmation toast appears: "Flight plan KLKR → KLWA ready to upload. [UPLOAD NOW] [LATER]"
4. Auto-upload after 10 seconds if no response (pilot may be doing preflight)
5. PWA POSTs package to `POST /api/plan/upload-package`
6. On success: "Flight plan uploaded. Weather cached at 14:30Z."
7. Pi makes the flight plan active — route on map, weather in cache, W&B in PLAN view

**Flight plan package format (JSON):**

```json
{
  "version": 1,
  "created_at": "2026-02-11T14:30:00Z",
  "aircraft_id": "pa28-cherokee",
  "flight_plan": {
    "departure": "KLKR",
    "destination": "KLWA",
    "route": ["KLKR", "V16", "GSP", "V20", "AVL", "KLWA"],
    "altitude": 8000,
    "legs": [
      { "from": "KLKR", "to": "GSP", "via": "V16", "dist_nm": 89, "mag_hdg": 254, "ete_min": 39, "fuel_gal": 5.1 },
      { "from": "GSP", "to": "AVL", "via": "V20", "dist_nm": 62, "mag_hdg": 278, "ete_min": 27, "fuel_gal": 3.5 },
      { "from": "AVL", "to": "KLWA", "via": "DIR", "dist_nm": 377, "mag_hdg": 261, "ete_min": 164, "fuel_gal": 22.4 }
    ]
  },
  "weather_cache": {
    "fetched_at": "2026-02-11T14:28:00Z",
    "metars": { "KLKR": "...", "KGSP": "...", "KAVL": "...", "KLWA": "..." },
    "tafs": { "KGSP": "...", "KAVL": "...", "KLWA": "..." },
    "winds_aloft": { "6000": { "dir": 290, "spd": 22 }, "8000": { "dir": 300, "spd": 28 } },
    "pireps": [],
    "sigmets": [],
    "tfrs": []
  },
  "weight_balance": {
    "scenario_name": "Two pax, full fuel",
    "stations": [
      { "name": "Pilot & Front Pax", "weight": 340, "arm": 85.5, "moment": 29070 },
      { "name": "Rear Passengers", "weight": 180, "arm": 118.1, "moment": 21258 },
      { "name": "Baggage", "weight": 25, "arm": 142.8, "moment": 3570 },
      { "name": "Fuel (50 gal)", "weight": 300, "arm": 95.0, "moment": 28500 }
    ],
    "takeoff_weight": 2070,
    "takeoff_cg": 90.9,
    "landing_weight": 1884,
    "landing_cg": 90.5,
    "in_envelope": true
  },
  "ai_briefing": {
    "summary": "VFR conditions entire route. Ceilings at KGSP BKN025 improving to SCT040 by ETA.",
    "go_nogo": "GO",
    "notam_highlights": ["KLKR: RWY 03/21 closed", "KLWA: PAPI RWY 28 OTS"],
    "generated_at": "2026-02-11T14:30:00Z"
  },
  "official_briefing": {
    "type": "standard",
    "confirmation": "WB-2026-7654321",
    "obtained_at": "2026-02-11T14:30:00Z"
  },
  "filed_plan": {
    "status": "filed",
    "flight_rules": "VFR",
    "flight_identifier": "FP-2026-1234567",
    "version_stamp": "20260211143500",
    "filed_at": "2026-02-11T14:35:00Z",
    "proposed_departure": "2026-02-11T15:00:00Z",
    "people_on_board": 3,
    "equipment_suffix": "/G",
    "alternate": null,
    "remarks": ""
  }
}
```

| ID     | Requirement                                                            | Priority |
| ------ | ---------------------------------------------------------------------- | -------- |
| SYNC-01 | Auto-detect staged flight plan package on mode transition to Cockpit  | P1       |
| SYNC-02 | Confirmation toast with 10-second auto-upload default                 | P1       |
| SYNC-03 | Upload progress indicator                                             | P1       |
| SYNC-04 | Retry with exponential backoff on upload failure                      | P1       |
| SYNC-05 | NASR data sync from Pi to IndexedDB when on Stratux WiFi             | P1       |
| SYNC-06 | Sync status indicator: last sync timestamp, data freshness            | P1       |

#### 5.7.4 Shared UI Shell

Both modes share the same PWA shell (status bar at top, nav bar at bottom). The nav bar and status bar adapt per mode:

**Planning Mode:**

```
┌───────────────────────────────────────────────────────────┐
│ PLANNING │ PA-28 N1234 │ KLKR → KLWA │ WX 14:30Z │ MODE▼│
├───────────────────────────────────────────────────────────┤
│                                                            │
│                    PRIMARY VIEW                            │
│              (current planning step)                       │
│                                                            │
├───────────────────────────────────────────────────────────┤
│ [1 AIRCRAFT] [2 ROUTE] [3 WEATHER] [4 W&B] [5 BRIEF] [6 READY] │
└───────────────────────────────────────────────────────────┘
```

**Cockpit Mode (unchanged):**

```
┌───────────────────────────────────────────────────────────┐
│ N1234 │ 12:34Z │ GS:125kt │ ALT:5500 │ FUEL:22g 2:41    │
├───────────────────────────────────────────────────────────┤
│                                                            │
│                    PRIMARY VIEW + RIGHT PANEL              │
│              (map / engine / fuel / wx / plan / log)       │
│                                                            │
├───────────────────────────────────────────────────────────┤
│ [MAP]  [ENGINE]  [FUEL]  [WX]  [PLAN]  [LOG]             │
└───────────────────────────────────────────────────────────┘
```

**Planning Mode visual design:** Planning Mode uses a light color scheme since the pilot is at home or in an FBO — indoor lighting, not cockpit sunlight. Aviation-standard colors (VFR green, MVFR blue, IFR red, LIFR magenta) remain identical across modes.

| Token              | Planning Mode        | Cockpit Mode (unchanged) |
| ------------------ | -------------------- | ------------------------ |
| `--bg-primary`     | `#ffffff` (white)    | `#1a1a2e` (dark navy)    |
| `--bg-surface`     | `#f5f5f5` (light gray) | `#16213e` (dark blue)  |
| `--text-primary`   | `#1a1a2e` (dark navy) | `#ffffff`               |
| `--text-secondary` | `#666666`            | `#a0a0a0`               |
| `--accent`         | `#0066cc` (blue)     | `#00d4ff` (cyan)        |

**Service worker strategy:** The service worker caches static assets (HTML, JS, CSS) for both modes on install. Structured data (NASR, weather, flight plans) is stored in IndexedDB, not the service worker cache, because it needs to be queried. The service worker intercepts API calls and routes them based on mode: to `192.168.10.1` in Cockpit Mode, to `pilotstation-api.workers.dev` in Planning Mode.

### 5.8 Cloudflare Worker Proxy

**The problem:** The PilotStation PWA runs in Safari on the iPad. Browser security (CORS) prevents direct API calls from the browser to `aviationweather.gov` and `api.anthropic.com`. Additionally, the Anthropic API key must not be stored in client-side code.

**The solution:** A lightweight Cloudflare Worker (~150 lines) acts as a CORS-enabled proxy. It runs on Cloudflare's free tier (100,000 requests/day — far exceeding aviation planning needs).

**Worker routes:**

| Route                    | Proxies to                                    | Purpose                    |
| ------------------------ | --------------------------------------------- | -------------------------- |
| `POST /claude`           | `api.anthropic.com/v1/messages`               | AI copilot (Claude API)    |
| `GET /wx/metar?ids=...`  | `aviationweather.gov/api/data/metar`          | METARs                     |
| `GET /wx/taf?ids=...`    | `aviationweather.gov/api/data/taf`            | TAFs                       |
| `GET /wx/pirep?...`      | `aviationweather.gov/api/data/pirep`          | PIREPs                     |
| `GET /wx/airsigmet?...`  | `aviationweather.gov/api/data/airsigmet`      | SIGMETs/AIRMETs            |
| `GET /wx/windtemp?...`   | `aviationweather.gov/api/data/windtemp`       | Winds aloft (FB)           |
| `GET /wx/notam?...`      | `notams.aim.faa.gov/notamSearch`              | NOTAMs                     |
| `GET /fuel-prices?...`   | `aviation-fuel-prices.com` API                | 100LL/Jet-A prices         |
| `POST /fp/file`          | `lmfsweb.afss.com/Website/FP/file`            | File flight plan           |
| `POST /fp/{id}/amend`    | `lmfsweb.afss.com/Website/FP/{id}/amend`      | Amend filed flight plan    |
| `POST /fp/{id}/cancel`   | `lmfsweb.afss.com/Website/FP/{id}/cancel`     | Cancel filed flight plan   |
| `POST /fp/{id}/close`    | `lmfsweb.afss.com/Website/FP/{id}/close`      | Close flight plan          |
| `POST /briefing`         | `lmfsweb.afss.com/Website/briefing`           | Official weather briefing  |
| `GET /health`            | Returns `{ "status": "ok" }`                  | Mode detection probe       |

**Security:**

- **API keys:** Stored as Cloudflare Worker secrets: `ANTHROPIC_API_KEY`, `LEIDOS_VENDOR_ID`, `LEIDOS_VENDOR_PASSWORD`. Never sent to the browser.
- **Rate limiting:** 20 requests/minute to `/claude`, 60 requests/minute to `/wx/*`, 10 requests/minute to `/fp/*` and `/briefing`
- **Origin validation:** Worker checks the `Origin` header and only accepts requests from the PWA's origin (or `null` for home-screen PWAs)
- **Request validation:** `/claude` endpoint validates max_tokens is bounded (≤4096) and model is allowed

**Deployment:** Single `wrangler.toml` + `src/index.js` file. Deployed to `pilotstation-api.<your-domain>.workers.dev`. Updated independently of PilotStation.

**Estimated Claude API cost per planning session:**

| Function            | Input tokens | Output tokens | Est. cost (Haiku) |
| ------------------- | ------------ | ------------- | ------------------ |
| Weather analysis    | ~2,000       | ~500          | $0.01              |
| Go/No-Go reasoning  | ~3,000       | ~300          | $0.01              |
| NOTAM filtering     | ~5,000       | ~500          | $0.02              |
| Route optimization  | ~1,000       | ~300          | $0.01              |
| **Total per session** | **~11,000** | **~1,600**    | **~$0.05**         |

---

## 6. Feature Requirements

### 6.1 Module: Moving Map & Navigation (P0 — MVP)

**Source:** Custom Leaflet.js map with self-hosted FAA chart tiles + Stratux data overlays

| ID     | Requirement                                                                                | Priority |
| ------ | ------------------------------------------------------------------------------------------ | -------- |
| NAV-01 | Display current position on FAA sectional, IFR lo/hi, TAC charts                           | P0       |
| NAV-02 | Track-up mode with aircraft icon positioned 1/3 from bottom                                | P0       |
| NAV-03 | Display ADS-B traffic targets from Stratux GDL90 feed (altitude, heading, speed, callsign) | P0       |
| NAV-04 | Display FIS-B weather overlay (NEXRAD) from Stratux (see also WX-04)                       | P0       |
| NAV-05 | **Airport info on tap** — quick-access popup with all essential data (see detail below)    | P0       |
| NAV-06 | IFR approach plates, SIDs, STARs, and airport diagrams (see 6.8 Approach Plates)           | P0       |
| NAV-07 | TFR display with visual boundaries (GeoJSON overlay from FAA) (see also WX-08)             | P0       |
| NAV-08 | NOTAMs display filtered by route of flight                                                 | P1       |
| NAV-09 | Bearing/distance to selected airport or waypoint                                           | P0       |
| NAV-10 | Chart layer switching (Sectional ↔ IFR Low ↔ IFR High ↔ TAC) via single tap                | P0       |
| NAV-11 | Engine/fuel summary always visible in right panel alongside map                            | P0       |
| NAV-12 | Planned route line overlay on map (see also FLT-12)                                        | P1       |

**Implementation approach:** Leaflet.js renders FAA chart tiles served from Nginx on the Pi as static WEBP files. Traffic targets are Leaflet markers updated via WebSocket at 1Hz. Ownship position from Stratux GPS API. All rendering happens in Safari on the iPad — the Pi just serves tiles and data.

**Key Leaflet.js configuration:**

```javascript
L.tileLayer('/tiles/sectional/{z}/{x}/{y}.webp', {
    minZoom: 5, maxZoom: 11,
    minNativeZoom: 5, maxNativeZoom: 11,
    tileSize: 512, zoomOffset: -1,
    attribution: 'FAA Aeronautical Charts'
});
```

**Airport data (NAV-05 detail):**

FAA NASR 28-day subscription data (public domain) pre-loaded on Pi as GeoJSON. Tap any airport marker on the map → immediate popup with essential pilot information:

```
┌───────────────────────────────────────┐
│ KCLT — Charlotte/Douglas Intl    [X] │
│ Class B │ Elev 748 ft │ TPA 1748 MSL │
├───────────────────────────────────────┤
│ RWY 18C/36C  10,000 x 150 ft  ILS   │
│ RWY 18L/36R   9,000 x 150 ft  ILS   │
│ RWY 18R/36L   7,502 x 150 ft  RNAV  │
│ RWY 05/23     7,500 x 150 ft  VIS   │
├───────────────────────────────────────┤
│ ATIS    135.350                       │
│ CLR DEL 121.250                       │
│ GND     121.900                       │
│ TWR     119.900 / 124.000            │
│ APP     125.050 / 120.050            │
│ DEP     120.050                       │
│ CTAF    —                             │
├───────────────────────────────────────┤
│ ● VFR CLR  29.92"  270@8  12min ago  │
├───────────────────────────────────────┤
│ [PLATES]  [WX DETAIL]  [→ DIRECT TO] │
└───────────────────────────────────────┘
```

| Data Field                | Source           | Notes                                              |
| ------------------------- | ---------------- | -------------------------------------------------- |
| Airport name & identifier | NASR APT.csv     | ICAO and FAA identifiers                           |
| Field elevation           | NASR APT.csv     | Feet MSL                                           |
| Traffic pattern altitude  | NASR APT.csv     | MSL (field elev + pattern AGL, typically 1000 AGL) |
| Airspace class            | NASR airspace    | B, C, D, E, G                                      |
| Runway identifiers        | NASR RWY.csv     | Magnetic heading designators                       |
| Runway length & width     | NASR RWY.csv     | Feet                                               |
| Runway surface type       | NASR RWY.csv     | Asphalt, concrete, turf, etc.                      |
| Available approaches      | plate_index.json | ILS, RNAV, VOR, LOC, visual                        |
| All frequencies           | NASR TWR.csv     | ATIS, CTAF, GND, TWR, APP, DEP, CLR DEL, UNICOM    |
| Current METAR             | FIS-B / cache    | Flight category dot, decoded, age                  |
| Fuel availability         | NASR services    | 100LL, Jet-A                                       |

**Quick-access design:** The popup appears immediately on tap — no loading, no secondary page. All data is pre-loaded from NASR on the Pi. Bottom action bar provides one-tap access to approach plates, full weather, or direct-to navigation for that airport.

### 6.2 Module: Engine Monitor (P0 — MVP)

**Source:** Existing engine_monitor.py v3.3.0 — refactored into PilotStation UI

**Key design principle:** The panel engine monitor (EDM-700/800 or Dynon D180) already shows RPM, MP, oil temp, oil pressure, fuel flow, and volts. The PilotStation ENGINE view should focus on **what the panel display does NOT show** — primarily carb temp, and CHT/EGT trend line charts (scrollable history). The display must be **configurable** so the pilot chooses which parameters to show. The active aircraft profile determines which serial parser is used (JPI EDM protocol or Dynon serial protocol).

| ID     | Requirement                                                                                                                          | Priority |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| ENG-01 | **Configurable display layout** — pilot selects which parameters to show                                                             | P0       |
| ENG-02 | Live EGT bar graph for all 4 cylinders with numeric values                                                                           | P0       |
| ENG-03 | Live CHT bar graph for all 4 cylinders with numeric values                                                                           | P0       |
| ENG-04 | **Carb temp display** (large, prominent — not available on EDM panel)                                                                | P0       |
| ENG-05 | RPM, manifold pressure, oil temp, oil pressure, volts, amps (optional, toggle on/off)                                                | P0       |
| ENG-06 | Fuel flow (instantaneous + 3-sec smoothed)                                                                                           | P0       |
| ENG-07 | Percent power calculation (rich/lean/peak mode auto-detection)                                                                       | P0       |
| ENG-08 | Peak EGT tracking during leaning with degrees-from-peak per cylinder                                                                 | P0       |
| ENG-09 | Sticky valve detection alert (first 10 min, < 50% EGT ratio, 30s persist)                                                            | P0       |
| ENG-10 | SFC display (BSFC in lb/HP/hr)                                                                                                       | P1       |
| ENG-11 | 30-minute scrollable history graphs (selectable: EGT, CHT, carb temp, FF)                                                            | P0       |
| ENG-12 | CSV data capture with GPS position (start/stop/auto-rename)                                                                          | P0       |
| ENG-13 | Density altitude and TAS calculation from OAT + pressure alt                                                                         | P0       |
| ENG-14 | Engine health summary strip visible in bottom of right panel from ALL views                                                          | P0       |
| ENG-15 | Color-coded alert system: green (normal), yellow (caution), red (warning)                                                            | P0       |
| ENG-16 | **Saved display presets**: "Cruise" (carb temp + EGT/CHT line charts), "Leaning" (EGT bars+peak+FF), "Full" (all params)             | P1       |
| ENG-17 | **Savvy Aviation export** — generate Savvy-compatible CSV from flight engine data for upload to savvyaviation.com (see detail below) | P1       |

**Display configuration:**

The ENGINE view is built from configurable **widgets** that the pilot arranges. Each widget can be toggled on/off and resized (half-width or full-width). Configuration is saved in `/boot/firmware/pilotstation/pilotstation.conf` (Tier 1 — survives reboot).

| Widget               | Default: Cruise | Default: Leaning | Default: Full | Description                                      |
| -------------------- |:---------------:|:----------------:|:-------------:| ------------------------------------------------ |
| EGT trend line chart | ON (large)      | ON (large)       | ON            | 30-min scrollable EGT line chart, all 4 cyls     |
| CHT trend line chart | ON (large)      | OFF              | ON            | 30-min scrollable CHT line chart, all 4 cyls     |
| Carb temp            | ON (large)      | OFF              | ON            | Large carb temp gauge with caution/warning zones |
| EGT 4-bar graph      | OFF             | ON (large)       | ON            | EGT bars with numeric values (snapshot)          |
| CHT 4-bar graph      | OFF             | OFF              | ON            | CHT bars with numeric values (snapshot)          |
| Peak EGT tracking    | OFF             | ON (large)       | ON            | Degrees from peak per cylinder during leaning    |
| RPM/MP               | OFF             | OFF              | ON            | Duplicates EDM panel                             |
| Oil T/P              | OFF             | OFF              | ON            | Duplicates EDM panel                             |
| Fuel flow            | OFF             | ON               | ON            | Duplicates EDM panel                             |
| Volts/Amps           | OFF             | OFF              | ON            | Duplicates EDM panel                             |
| Power/SFC            | OFF             | ON               | ON            | Calculated values                                |
| DA/TAS/OAT           | OFF             | OFF              | ON            | Atmosphere calculations                          |

**Default preset is "Cruise"** — focused on what you can't see on the EDM panel (line charts + carb temp):

```
┌──────────────────────────────────────────────────────────┐
│ ✈ N1234  │ 12:34Z │ GS:125kt │ ALT:5500 │ FUEL:22g 2:41│
├────────────────────────────────────┬─────────────────────┤
│  EGT (°F) — 30 min line chart     │                     │
│  1400┤       ╱─╲  ╱──          │  CARB  78°F ←GREEN  │
│  1350┤──╱──╱    ╲╱    ──cyl1   │  EGT  ▊▊▊▊ (mini)   │
│  1300┤╱  ─────────── cyl2      │  CHT  ▊▊▊▊ (mini)   │
│  1250┤   ─·─·─·─·── cyl3      │  PWR   65% LOP       │
│      └──┬─────┬─────┬─────┬    │─────────────────────│
│       -30   -20   -10    now    │  ┌─┐    ┌─┐         │
│                                    │  │█│    │▓│         │
│  CHT (°F) — 30 min line chart     │  └─┘    └─┘         │
│   400┤                             │  22 gal  2:41       │
│   375┤──────────╱─── cyl1       │                     │
│   350┤─────────────── cyl2       │  [CRUISE ▼]        │
│   325┤                             │  preset selector    │
│      └──┬─────┬─────┬─────┬    │                     │
│       -30   -20   -10    now    │                     │
│                                    │                     │
│  ┌──────────────────────────────┐  │                     │
│  │ CARB TEMP    ════════ 78°F  │  │                     │
│  │ ──────[green]──▼───[yel]──  │  │                     │
│  │ 30    50    70   90  110°F  │  │                     │
│  └──────────────────────────────┘  │                     │
├────────────────────────────────────┴─────────────────────┤
│  [ MAP ]  [ENGINE]  [ FUEL ]  [ WX ]  [ PLAN ]  [ LOG ] │
└──────────────────────────────────────────────────────────┘
```

**Carb temp zones** (configurable in active aircraft profile):

- Green: 50-90°F (normal)
- Yellow: 32-50°F (carb ice risk)
- Red: below 32°F (icing likely)

**Right panel engine strip** (always visible, also configurable):

The right panel strip shows a condensed summary. Default shows only the "supplement the EDM" parameters:

```
┌─────────────┐
│ EGT ▊▊▊▊   │  ← Mini 4-bar, color coded
│ CHT ▊▊▊▊   │  ← Mini 4-bar, color coded
│ CARB  78°F  │  ← Prominent, with zone color
│ PWR   65%   │  ← Calculated from RPM/MP/FF
└─────────────┘
```

Pilot can optionally add RPM, MP, FF, oil T/P to the right panel strip via settings.

**Savvy Aviation export (ENG-17):**

PilotStation generates a Savvy-compatible CSV file from each flight's engine + GPS data. The file uses the same format that Savvy Aviation's analysis tools expect (EI/JPI-style CSV with `#airframe_info` header).

**Download workflow (iPad offline from Pi):**

```
1. Flight ends → PilotStation auto-generates Savvy CSV on the Pi (Tier 2 storage)
2. Post-flight: iPad still on Stratux WiFi → LOG view → tap flight → [EXPORT ▼] → "Savvy CSV"
3. Safari downloads the .csv file to iPad Files app (~/Downloads/)
4. Later at home: iPad on internet WiFi → open Safari → savvyaviation.com → upload CSV from Files
```

The key constraint is that the iPad must download the file **while still connected to Stratux WiFi** (at the airport), then upload to Savvy later when on internet WiFi. Safari's native file download handles this — no app needed.

**Savvy CSV format:**

The file has two metadata header lines followed by a column header and data rows:

```csv
#airframe_info," log_version=""1.00"""," airframe_name=""PA-28-180 Cherokee"""," unit_software_part_number=""PilotStation"""," unit_software_version=""1.00"""," system_software_part_number=""EDM-700"""," system_id=""N1234""", mode=NORMAL,,,,,,,,,,,,
#yyy-mm-dd, hh:mm:ss,   hh:mm, degrees, degrees, ft wgs, kt, deg, deg, deg, Hg,deg F,psi,volts,  amps,    rpm,gph,  gals,   gals,  deg f, deg F,   deg F,   deg F,   deg F,   deg F,   deg F,   deg F,   deg F
Lcl Date,Lcl Time,UTCOfst,Longitude,Latitude,AltGPS,GndSpd,Roll,Pitch,CRS,E1 MAP,E1 OilT,E1 OilP,volt1,amp1,E1 RPM,E1 FFlow,FQtyL,FQtyR,Carb Temp,E1 EGT1,E1 EGT2,E1 EGT3,E1 EGT4,E1 CHT1,E1 CHT2,E1 CHT3,E1 CHT4
2026-02-11,09:25:46,-05:00,-80.943,35.214,2500,125.0,-1.20,2.80,185,23.5,185,062,14.1,002,2350.0,9.2,18.0,17.5,78,1385,1362,1370,1390,345,328,340,350
```

**Column mapping from PilotStation internal data → Savvy columns:**

| PilotStation field | Savvy column | Transform |
|---|---|---|
| date | Lcl Date | UTC → local using aircraft profile timezone |
| Zulu_Time | Lcl Time | UTC → local time |
| (computed) | UTCOfst | Computed at runtime from aircraft profile `timezone` (DST-aware) |
| longitude | Longitude | Stratux GPS, decimal degrees |
| latitude | Latitude | Stratux GPS, decimal degrees |
| altitude_ft | AltGPS | Stratux GPS, feet WGS84 |
| speed_kts | GndSpd | Stratux GPS, knots |
| bank | Roll | Stratux AHRS, degrees |
| pitch | Pitch | Stratux AHRS, degrees |
| course | CRS | Stratux GPS, degrees |
| MP | E1 MAP | EDM manifold pressure, inHg |
| Oil Temp | E1 OilT | EDM oil temperature, °F |
| Oil Pressure | E1 OilP | EDM oil pressure, PSI |
| Volts | volt1 | EDM voltage, V |
| Amps | amp1 | EDM current, A |
| RPM | E1 RPM | EDM RPM |
| Fuel Flow | E1 FFlow | EDM fuel flow, GPH |
| Fuel Level 1 | FQtyL | Left tank, gallons |
| Fuel Level 2 | FQtyR | Right tank, gallons |
| Carb Temp | Carb Temp | EDM carb temp, °F |
| EGT 1-4 | E1 EGT1-4 | EDM exhaust gas temp, °F |
| CHT 1-4 | E1 CHT1-4 | EDM cylinder head temp, °F |

**Airframe info header** is populated from the active aircraft profile:
- `airframe_name` → aircraft profile `name` field
- `system_id` → aircraft profile `tail_number` field
- `system_software_part_number` → aircraft profile `engine.monitor_model` (e.g., `EDM-700`, `Dynon D180`)
- `unit_software_version` → PilotStation version

**Auto-generation:** At flight end (ENG-12 CSV stop), PilotStation automatically generates the Savvy CSV alongside the internal flight CSV. Both are flushed to Tier 2 storage via `overlayctl unlock/lock`. The Savvy file is named `{date}_{route}_savvy.csv` (e.g., `2026-02-11_KLKR-KCLT_savvy.csv`).

### 6.3 Module: Fuel Management (P0 — MVP)

**Source:** Existing fuel planner PWA + engine_monitor.py fuel tracking — unified

| ID      | Requirement                                                        | Priority |
| ------- | ------------------------------------------------------------------ | -------- |
| FUEL-01 | Real-time fuel remaining from EDM fuel flow integration            | P0       |
| FUEL-02 | Visual fuel gauge (tank graphic with level indicator)              | P0       |
| FUEL-03 | Endurance remaining (hours:minutes at current burn rate)           | P0       |
| FUEL-04 | Range remaining (nm at current GS and burn rate)                   | P0       |
| FUEL-05 | Fuel warning thresholds: yellow at 8 gal, red at 4 gal             | P0       |
| FUEL-06 | Pre-flight fuel tic measurements with polynomial calibration       | P0       |
| FUEL-07 | Fuel addition logging (gallons, airport, price, timestamp)         | P0       |
| FUEL-08 | K-factor calibration tracking (EI FT-60 Red Cube)                  | P1       |
| FUEL-09 | Burn rate profiles (65% LOP, 75% power, etc.) for planning         | P0       |
| FUEL-10 | EDM vs. manual tic comparison for cross-checking                   | P1       |
| FUEL-11 | Fuel status always visible in bottom of right panel from ALL views | P0       |
| FUEL-12 | Offline capability — full function without network connection      | P0       |

**Right panel fuel strip (always visible):**

```
┌─────────────┐
│ ┌─┐   ┌─┐  │
│ │█│   │█│  │  ← L/R tank graphic
│ │█│   │▓│  │
│ │█│   │ │  │
│ └─┘   └─┘  │
│ FUEL 22 gal │
│ ENDUR 2:41  │
│ RANGE 312nm │
└─────────────┘
```

### 6.4 Module: Weather — Map Interaction, FIS-B, Radar, Briefing & Profile View (P0/P1)

**Source:** Stratux FIS-B (in-flight) + Aviation Weather Center APIs (pre-cached) + Leidos 1800wxbrief API

#### 6.4.1 Map Weather Interactions (P0 — MVP)

| ID    | Requirement                                                                                                                          | Priority |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| WX-01 | **Tap any airport on map → show METAR popup** with flight category color, decoded wind/vis/ceiling, raw text, and age ("12 min ago") | P0       |
| WX-02 | **Tap METAR popup → expand to full TAF** for that airport                                                                            | P0       |
| WX-03 | Color-coded flight category dots on map (VFR=green, MVFR=blue, IFR=red, LIFR=magenta) for all airports with METARs                   | P0       |
| WX-04 | **NEXRAD radar overlay** on map — FIS-B radar data from Stratux, toggled with one tap                                                | P0       |
| WX-05 | **Weather data age indicator** — every METAR/TAF shows minutes since observation AND minutes since received by Stratux               | P0       |
| WX-06 | SIGMET and AIRMET boundaries displayed on map as colored polygons                                                                    | P1       |
| WX-07 | PIREPs displayed as icons on map at reported location, tap to see details                                                            | P1       |
| WX-08 | TFR boundaries displayed on map with type label (tap for details)                                                                    | P0       |

#### 6.4.2 Stratux FIS-B Weather Integration (P0 — MVP)

**Stratux broadcasts all received FIS-B weather via WebSocket at `ws://192.168.10.1/weather`.**

Each message is JSON:

```json
{
    "Type": "METAR",
    "Location": "KLKR",
    "Time": "111756Z",
    "Data": "15015G25KT 10SM FEW250 24/14 A3002 RMK AO2",
    "LocaltimeReceived": "2026-02-11T17:56:32Z"
}
```

Types received: `METAR`, `SPECI`, `TAF`, `TAF.AMD`, `WINDS` (winds aloft), `PIREP`

| ID    | Requirement                                                                                                          | Priority |
| ----- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| WX-10 | Connect to Stratux weather WebSocket and consume all FIS-B text weather in real-time                                 | P0       |
| WX-11 | Maintain in-memory weather database: latest METAR/TAF per station, all PIREPs, winds aloft                           | P0       |
| WX-12 | **Auto-set Stratux WatchList** to include route airports via `POST /setSettings {"WatchList": "KLKR KCLT KGSP ..."}` | P0       |
| WX-13 | Auto-compute route weather stations: all airports within 25nm corridor of planned route                              | P0       |
| WX-14 | Parse and decode METARs (wind, visibility, ceiling, flight category, remarks)                                        | P0       |
| WX-15 | NEXRAD radar: consume via GDL90 protocol (UDP 4000) or `/jsonio` WebSocket                                           | P1       |

**Note on Stratux WatchList:** The WatchList is only a client-side display filter in Stratux's own web UI — the server broadcasts ALL received weather regardless. However, PilotStation should still update it so that if the pilot opens the Stratux web UI directly, it shows relevant stations. PilotStation does its own filtering based on the flight plan route.

**Note on NEXRAD:** NEXRAD radar images are NOT sent through the `/weather` WebSocket — they are delivered via the GDL90 protocol. **MVP approach (P0):** Stratux already decodes NEXRAD and exposes radar tiles via its `/radar/` endpoint and `jsonio` WebSocket — PilotStation consumes these for WX-04. **Future (P1, WX-15):** Build our own GDL90 decoder for raw FIS-B frame access, enabling lower-latency updates and independence from Stratux's radar rendering.

#### 6.4.3 Profile/Cross-Section View (P1)

| ID    | Requirement                                                                   | Priority |
| ----- | ----------------------------------------------------------------------------- | -------- |
| WX-20 | **Profile/cross-section view** along route showing terrain, airspace, weather | P1       |
| WX-21 | Terrain profile from SRTM elevation data                                      | P1       |
| WX-22 | Airspace boundaries (Class B/C/D/E shelves) with labels                       | P1       |
| WX-23 | Cloud layers interpolated from METARs along route                             | P1       |
| WX-24 | Icing forecasts (CIP/FIP from aviationweather.gov, pre-cached)                | P2       |
| WX-25 | Turbulence forecasts (GTG from aviationweather.gov, pre-cached)               | P2       |
| WX-26 | Winds aloft at multiple altitudes (FB data, color-coded by speed)             | P1       |
| WX-27 | Planned altitude line overlay                                                 | P1       |
| WX-28 | Time slider to show conditions at different ETEs along route                  | P2       |

```
FL180 ┤                    ╱‾‾‾╲ Class B          ▒▒ = Icing
      ┤  ═══════ planned alt ═══════════════      ░░ = Turbulence
10000 ┤         ╱ Class C╲        ▒▒▒▒
      ┤    ▓▓▓▓▓ clouds ▓▓▓▓     ▒▒▒▒
 5000 ┤  ╱‾╲              ░░░
      ┤ ╱   ╲  terrain   ░░░
  SFC ┤╱      ╲__________╱───────────────
      └─┬──────┬──────┬──────┬──────┬──▶
       KLKR   50nm   100nm  150nm  KDEST
```

#### 6.4.4 Smart Briefing — Condensed, Mission-Critical (P1)

Standard 1800wxbrief briefings can be 70+ pages. PilotStation generates a **condensed, route-specific briefing** focused on what matters for this flight. **Note:** In Planning Mode (home WiFi), this briefing is enhanced with AI-powered weather analysis, go/no-go reasoning, and NOTAM filtering — see Section 6.12 and Section 7.4 (Step 5 mockup) for the AI-enhanced version.

| ID    | Requirement                                                                                                                           | Priority |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| WX-30 | **Smart Briefing** page: 1-2 screen summary of mission-critical weather                                                               | P1       |
| WX-31 | Weather **at time of passage** — show forecast conditions for each waypoint at the ETA for that waypoint, not just current conditions | P1       |
| WX-32 | TFRs **at time of passage** — only show TFRs active during your planned transit through their area                                    | P1       |
| WX-33 | Go/No-Go recommendation based on personal minimums (configurable) — AI-powered in Planning Mode (see AI-05, Section 6.12); rules-based comparison in Cockpit Mode | P1       |
| WX-34 | Route-corridor filtering: only show weather within 25nm of route                                                                      | P1       |
| WX-35 | Highlight weather that's worse than personal minimums in red                                                                          | P1       |
| WX-36 | Official weather briefing via 1800wxbrief API — standard briefing with confirmation number, legal record of briefing obtained (see FILE-10, Section 6.13) | P1 |

**Smart Briefing layout:**

```
┌──────────────────────────────────────────────────────┐
│ SMART BRIEFING: KLKR → KLWA   528nm   ETE 3:50      │
│ Briefing generated: 11 Feb 2026 14:30Z               │
├──────────────────────────────────────────────────────┤
│                                                       │
│ ⚠ WEATHER AT TIME OF PASSAGE:                        │
│                                                       │
│ KLKR (dep 15:00Z)  VFR ● CLR  29.92" 270@8  10sm   │
│ KGSP (15:39Z ETA)  MVFR ● BKN025  29.88" 310@12    │
│ KAVL (16:06Z ETA)  VFR ● SCT040  29.90" 290@10     │
│ KLWA (18:50Z ETA)  VFR ● FEW050  29.85" 280@8      │
│                                                       │
│ ⚠ ACTIVE TFRs ON ROUTE:                              │
│ • TFR 6/1234 — sporting event near KGSP              │
│   Active 14:00-20:00Z   5nm radius SFC-3000          │
│   ← WITHIN 8nm OF ROUTE at 15:40Z                    │
│                                                       │
│ WINDS @6000: 290/22  @8000: 300/28  @10000: 310/35  │
│ Optimal altitude: 8000 (GS 138kt, ETE 3:50)         │
│                                                       │
│ SIGMETs/AIRMETs: None affecting route                │
│ PIREPs: Moderate turbulence FL100 near KAVL (1hr ago)│
│                                                       │
│ [FULL BRIEFING]  [PROFILE VIEW]  [BACK TO MAP]      │
└──────────────────────────────────────────────────────┘
```

**Data sources:**

| Source                  | URL                                      | Content                       | When                                    |
| ----------------------- | ---------------------------------------- | ----------------------------- | --------------------------------------- |
| Aviation Weather Center | `aviationweather.gov/api/data/metar`     | METARs                        | Planning Mode via Cloudflare Worker     |
| Aviation Weather Center | `aviationweather.gov/api/data/taf`       | TAFs                          | Planning Mode via Cloudflare Worker     |
| Aviation Weather Center | `aviationweather.gov/api/data/pirep`     | PIREPs                        | Planning Mode via Cloudflare Worker     |
| Aviation Weather Center | `aviationweather.gov/api/data/airsigmet` | SIGMETs/AIRMETs               | Planning Mode via Cloudflare Worker     |
| Aviation Weather Center | `aviationweather.gov/api/data/windtemp`  | Winds aloft (FB)              | Planning Mode via Cloudflare Worker     |
| FAA NOTAM Search        | `notams.aim.faa.gov/notamSearch`         | NOTAMs                        | Planning Mode via Cloudflare Worker     |
| Stratux FIS-B           | `ws://192.168.10.1/weather`              | Live METARs/TAFs/PIREPs/Winds | In-flight (Cockpit Mode)                |
| Stratux FIS-B           | GDL90 UDP 4000                           | NEXRAD radar                  | In-flight (Cockpit Mode)                |
| Leidos 1800wxbrief      | REST API (`RouteBriefingRequest`)        | Official briefing             | Planning Mode (optional, requires acct) |
| SRTM                    | Pre-loaded on Pi                         | Terrain elevation             | Offline               |
| FAA NASR                | Pre-loaded on Pi                         | Airspace boundaries           | Offline               |

### 6.5 Module: Flight Planning with Fuel Stop Optimization (P1)

| ID     | Requirement                                                                                                                                                           | Priority |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FLT-01 | Route entry: departure, waypoints, destination (ICAO identifiers)                                                                                                     | P1       |
| FLT-02 | **Airway route planning**: enter airways (V16, J80, T-routes) between fixes                                                                                           | P1       |
| FLT-03 | Airway database from FAA NASR `AWY_*.csv` — Victor, Jet, RNAV T/Q routes                                                                                              | P1       |
| FLT-04 | Distance, magnetic heading, and time-enroute per leg                                                                                                                  | P1       |
| FLT-05 | **Optimal altitude selection**: calculate groundspeed at 3000-12000 ft using winds aloft, recommend altitude with shortest enroute time (respecting hemispheric rule) | P1       |
| FLT-06 | Wind correction angles from winds aloft at selected altitude                                                                                                          | P1       |
| FLT-07 | Fuel required per leg and total (from burn rate profiles and power setting)                                                                                           | P1       |
| FLT-08 | **Fuel stop planning**: given range, find airports along route with fuel                                                                                              | P1       |
| FLT-09 | **Fuel price comparison**: show 100LL prices at candidate fuel stop airports                                                                                          | P1       |
| FLT-10 | Sort fuel stops by: price, distance from route, total cost (price × gallons needed)                                                                                   | P1       |
| FLT-11 | **Weight & balance calculator** with CG envelope diagram and multi-aircraft support (see 6.10)                                                                        | P1       |
| FLT-12 | Display planned route on moving map (with airway segments)                                                                                                            | P1       |
| FLT-13 | NAV log export (printable format)                                                                                                                                     | P2       |
| FLT-14 | Integration with profile view (route defines the cross-section)                                                                                                       | P1       |
| FLT-15 | Integration with Smart Briefing (route defines the weather corridor)                                                                                                  | P1       |

**Fuel price data source:** `aviation-fuel-prices.com` API (free, CC BY-NC-ND 4.0 license for non-commercial use). Returns JSON with 100LL/Jet-A prices by airport. Fetched in Planning Mode via Cloudflare Worker proxy (see Section 5.8), cached in IndexedDB, and included in the flight plan package uploaded to the Pi.

**Optimal altitude calculation:**

```
For each candidate altitude (3000, 4000, ..., 12000):
  1. Look up winds aloft from nearest FB reporting stations
  2. Interpolate winds for route midpoint
  3. Calculate TAS at altitude (from aircraft performance + OAT)
  4. Calculate groundspeed = f(TAS, course, wind_dir, wind_speed)
  5. Calculate fuel burn at altitude (altitude affects mixture)
  6. Calculate total time and fuel for route

Recommend: altitude with lowest total time (or lowest fuel, user choice)
Filter: hemispheric rule (odd+500 eastbound, even+500 westbound for VFR)
```

**Fuel stop planning example (KLKR → KLWA, 528nm):**

```
┌──────────────────────────────────────────────────────┐
│ FUEL STOP PLANNER: KLKR → KLWA                       │
│                                                       │
│ Current fuel: 48 gal  Range: 704nm (incl 45min res)  │
│ Route distance: 528nm  → Direct: NO STOP NEEDED      │
│                                                       │
│ But if fuel < 38 gal, recommended stops:              │
│                                                       │
│ Airport  Dist   Detour  100LL    Est Cost  Runway     │
│ KAND     142nm   +2nm   $5.89/g  $76.57   RWY 05/23  │
│ KGSP     156nm   +8nm   $6.25/g  $81.25   ILS avail  │
│ KAVL     198nm   +4nm   $6.49/g  $84.37   ILS avail  │
│                                                       │
│ ← Prices updated: 09 Feb 2026                        │
│                                                       │
│ [SELECT KAND]  [SELECT KGSP]  [SHOW ON MAP]          │
└──────────────────────────────────────────────────────┘
```

### 6.5.1 AI Copilot Integration (P1)

**Full specification in Section 6.12.** The AI copilot (Claude API via Cloudflare Worker) assists with flight planning in Planning Mode. Key functions: weather analysis, go/no-go reasoning against personal minimums, NOTAM filtering, route optimization, and alternate selection. Results are displayed in Planning Mode Step 5 (Briefing) and cached with the flight plan package for upload to the Pi.

**Important:** AI-generated recommendations are advisory only. PIC (Pilot in Command) retains all decision authority (see AI-10).

### 6.6 Module: Pilot Logbook (P1)

| ID     | Requirement                                                          | Priority |
| ------ | -------------------------------------------------------------------- | -------- |
| LOG-01 | Auto-detect flight start/end (ground speed transitions)              | P1       |
| LOG-02 | Auto-record: date, route (departure→destination), duration, landings | P1       |
| LOG-03 | Auto-record: day/night determination from civil twilight             | P1       |
| LOG-04 | Manual entry fields: approaches, holds, remarks, instrument time     | P1       |
| LOG-05 | Currency tracking: 90-day (day/night), IFR, BFR, medical             | P1       |
| LOG-06 | Hobbs/tach time entry                                                | P2       |
| LOG-07 | CSV, ForeFlight-compatible logbook export, and Savvy CSV download (see ENG-17) | P1       |
| LOG-08 | SQLite storage with backup to USB/cloud                              | P1       |
| LOG-09 | Flight track recording (GPS breadcrumb trail)                        | P1       |
| LOG-10 | Post-flight summary: max altitude, distance, fuel used, avg power    | P2       |

### 6.7 Module: Garmin GPS 175 Integration (P2 — Future)

| ID     | Requirement                                                      | Priority |
| ------ | ---------------------------------------------------------------- | -------- |
| GAR-01 | Receive GPS position via Bluetooth (Connext)                     | P2       |
| GAR-02 | Receive AHRS data (pitch/roll/heading) via Bluetooth             | P2       |
| GAR-03 | Two-way flight plan transfer                                     | P3       |
| GAR-04 | Fallback: USB GPS as primary position source when BT unavailable | P0       |

**Known constraints:** Garmin Connext is a proprietary protocol. Options:

1. **Bluetooth on iPad** — ForeFlight connects to GPS 175 via Bluetooth on the iPad. If PilotStation runs in Safari, it could potentially use Web Bluetooth API to connect. However, **Safari does not support Web Bluetooth** as of 2026. This is a dead end unless Apple adds support.
2. **Garmin Pilot app on iPad** — run Garmin Pilot in background for GPS 175 Bluetooth connection, use PilotStation in Safari foreground. iPad GPS position is available to Safari via the Geolocation API when on the ground (with location services enabled), but this uses iPad's built-in GPS, not the GPS 175.
3. **Serial/RS-232 connection** from GPS 175 to Pi via aviation data bus (requires avionics wiring, provides NMEA position data)
4. **Defer to Stratux GPS** for position and skip Connext entirely for MVP

**Recommendation:** MVP uses Stratux GPS (GAR-04), which is already WAAS-capable. The Garmin GPS 175 remains the primary IFR navigator on the panel — PilotStation is supplemental. Flight plan transfer is the main loss; position data is adequately provided by Stratux.

### 6.8 Module: Geo-Referenced IFR Approach Plates & Terminal Procedures (P0 — MVP)

**Source:** FAA d-TPP (Digital Terminal Procedures Publication) — free, public domain, updated every 28 days

**Key finding: The FAA has embedded geo-referencing data directly into d-TPP approach plate PDFs since January 2017** (FAA Charting Notice TERM 16-02). The PDFs use Lambert Conformal Conic projection on NAD83/GRS80 datum. This means we can extract geographic bounds from each plate using GDAL and overlay the plate on the Leaflet map with the aircraft's position shown in real-time — no manual geo-referencing needed.

| ID     | Requirement                                                                       | Priority |
| ------ | --------------------------------------------------------------------------------- | -------- |
| PLT-01 | Display IFR approach plates (ILS, RNAV, VOR, LOC, etc.) for any US airport        | P0       |
| PLT-02 | **Geo-referenced plate overlay on moving map with live aircraft position**        | P0       |
| PLT-03 | Display SIDs (Standard Instrument Departures) and STARs (Standard Arrivals)       | P0       |
| PLT-04 | Display airport diagrams (taxi diagrams)                                          | P0       |
| PLT-05 | Quick access: tap airport on map → list of available procedures → tap to view     | P0       |
| PLT-06 | Quick access from flight plan: show plates for departure, destination, alternates | P0       |
| PLT-07 | Pinch-to-zoom and pan on plate (works both as standalone view and map overlay)    | P0       |
| PLT-08 | Night mode inversion of plates (white-on-black for night flying)                  | P1       |
| PLT-09 | Favorites / recently viewed plates for fast access                                | P1       |
| PLT-10 | Plate currency indicator (effective dates, warn if expired)                       | P0       |
| PLT-11 | Search by airport identifier (e.g., type "KCLT" → all KCLT procedures)            | P0       |
| PLT-12 | Toggle between plate-only view and geo-referenced map overlay view                | P0       |
| PLT-13 | Geo-reference airport diagrams using CIFP runway threshold coordinates            | P1       |

**Geo-referencing architecture:**

```
                        Desktop (one-time per 28-day cycle)
                ┌─────────────────────────────────────────────────┐
                │                                                  │
                │  For each d-TPP approach plate PDF:              │
                │                                                  │
                │  1. gdalinfo plate.pdf                           │
                │     → Extract geo bounds (cornerCoordinates)     │
                │     → Lambert Conformal Conic / NAD83            │
                │                                                  │
                │  2. gdal_translate plate.pdf plate.png           │
                │     → Rasterize to PNG for Leaflet overlay       │
                │                                                  │
                │  3. gdalwarp -t_srs EPSG:4326 plate.pdf ...      │
                │     → Get WGS84 corner coordinates               │
                │                                                  │
                │  4. Store in plate_geo_index.json:                │
                │     {                                             │
                │       "KCLT/ILS-RWY-18C": {                      │
                │         "bounds": [[35.19,-80.97],[35.26,-80.88]],│
                │         "png": "KCLT/ILS-RWY-18C.png",           │
                │         "pdf": "KCLT/ILS-RWY-18C.pdf",           │
                │         "geo_referenced": true                   │
                │       }                                           │
                │     }                                             │
                └─────────────────────────────────────────────────┘

                        iPad (in-flight, Safari)
                ┌─────────────────────────────────────────────────┐
                │                                                  │
                │  MAP VIEW with plate overlay:                    │
                │                                                  │
                │  // Overlay plate image on Leaflet map           │
                │  L.imageOverlay('/plates/KCLT/ILS-RWY-18C.png', │
                │    [[35.19, -80.97], [35.26, -80.88]],           │
                │    { opacity: 0.85 }                             │
                │  ).addTo(map);                                   │
                │                                                  │
                │  // Aircraft position updates via WebSocket      │
                │  // → moves marker on plate in real-time         │
                │                                                  │
                │  ✈ ← you are here, shown on the plate           │
                │                                                  │
                └─────────────────────────────────────────────────┘
```

**What is geo-referenced by the FAA (automatic):**

- Instrument Approach Procedures (IAPs) — ILS, RNAV, VOR, LOC, etc.

**What is NOT geo-referenced by the FAA (requires CIFP workaround):**

- Airport diagrams → geo-reference using CIFP runway threshold coordinates (2-point registration)
- Departure Procedures (DPs/SIDs) → geo-reference using CIFP fix coordinates
- Standard Terminal Arrivals (STARs) → geo-reference using CIFP fix coordinates

**CIFP-based geo-referencing for non-IAP plates (P1):**

The FAA CIFP (Coded Instrument Flight Procedures) data provides lat/lon coordinates for every fix, waypoint, navaid, and runway threshold. For plates that lack embedded geo-referencing, we identify 2-3 known fixes visible on the plate, match them to CIFP coordinates, and compute an affine transformation.

```
CIFP data (ARINC 424 format, free from FAA)
    │
    ▼
Python parser (arinc424 library) → SQLite database
    │
    ▼
For each non-geo plate: match fix names on plate → CIFP lat/lon
    │
    ▼
Compute affine transform → store bounds in plate_geo_index.json
```

**CIFP also enables vector procedure overlay (P2 — future enhancement):**

CIFP contains the full lateral path of every published approach as a sequence of ARINC 424 path terminators (TF, CF, DF, AF, RF, etc.) with fix coordinates. This could be rendered as interactive Leaflet vectors overlaid on the sectional chart — showing the approach procedure path, altitude constraints, and fixes without needing the PDF plate at all.

**Data sources (all free, public domain):**

- FAA d-TPP: `https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dtpp/`
- FAA CIFP: `https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/download/`
- d-TPP Metafile XML: included in the d-TPP "E" ZIP download

**Storage approach:**

- Full US d-TPP: ~2-3 GB PDFs + ~1-2 GB PNGs (rasterized for Leaflet overlay)
- Regional subset: ~200-500 MB
- Stored on Pi organized by airport ICAO code:

```
/home/pi/pilotstation/plates/
├── cycle_info.json              # Current cycle date, expiration
├── plate_index.json             # Airport → procedure → filename lookup (from d-TPP XML)
├── plate_geo_index.json         # Geo bounds for each plate (from GDAL extraction)
├── KCLT/
│   ├── ILS-RWY-18C.pdf          # Original PDF (for standalone plate view)
│   ├── ILS-RWY-18C.png          # Rasterized PNG (for Leaflet map overlay)
│   ├── RNAV-GPS-RWY-18C.pdf
│   ├── RNAV-GPS-RWY-18C.png
│   ├── STAR-PARQR.pdf
│   ├── DP-WEAZL.pdf
│   └── APD.pdf                  # Airport diagram
├── KLKR/
│   ├── RNAV-GPS-RWY-21.pdf
│   ├── RNAV-GPS-RWY-21.png
│   └── APD.pdf
└── ...
```

**Two viewing modes:**

1. **Plate view** (standalone): Full-screen PDF rendered via PDF.js. Pinch-to-zoom, pan, night mode inversion. Aircraft position shown as a marker if geo-referenced. Best for studying the full plate (minimums, notes, profile view, missed approach).

2. **Map overlay view**: Plate PNG overlaid on the Leaflet moving map using `L.imageOverlay()` with extracted geo bounds. Semi-transparent so the underlying sectional/IFR chart is visible. Aircraft icon moves in real-time across the plate. Best for situational awareness during the approach.

Toggle between these modes with a single tap.

### 6.9 Module: Data Update Manager (P0 — MVP)

**Critical constraint: The Pi never has internet access.** It lives in the aircraft, connected only to its own Stratux WiFi hotspot. All data updates must flow through the iPad.

| ID     | Requirement                                                                      | Priority |
| ------ | -------------------------------------------------------------------------------- | -------- |
| UPD-01 | iPad-based update UI accessible from PilotStation admin/settings page            | P0       |
| UPD-02 | Upload chart tile packages from iPad to Pi over Stratux WiFi                     | P0       |
| UPD-03 | Upload approach plate packages (d-TPP) from iPad to Pi over Stratux WiFi         | P0       |
| UPD-04 | Upload NASR data (airports, airspace, waypoints) from iPad to Pi                 | P0       |
| UPD-05 | Upload terrain data updates from iPad to Pi                                      | P2       |
| UPD-06 | Display current data versions and expiration dates on admin page                 | P0       |
| UPD-07 | Warn pilot on startup if any data is expired (plates, charts, NASR)              | P0       |
| UPD-08 | Pre-flight weather cache: fetch weather on home WiFi, push to Pi on Stratux WiFi — **now handled by PLAN-04 + SYNC-01; retained for cockpit-side weather push fallback** | P1       |

**Update workflow:**

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: At home / FBO (iPad on home/FBO WiFi, internet access) │
│                                                                  │
│  Option A: PilotStation PWA in Planning Mode (auto-activates     │
│  when iPad is on home WiFi — fetches data via Cloudflare Worker) │
│                                                                  │
│  Option B: Desktop computer runs update script, prepares         │
│  packages, transfers to iPad via AirDrop / iCloud / USB         │
│                                                                  │
│  Downloads from FAA:                                             │
│  • d-TPP approach plates (PDF ZIPs by state/region)             │
│  • NASR 28-day subscription data (airports, airspace)           │
│  • Weather pre-cache (METARs, TAFs, winds for planned route)    │
│                                                                  │
│  Chart tiles (large, 3-5 GB):                                    │
│  • Processed on desktop via aviationCharts + GDAL                │
│  • Packaged as .tar.gz, transferred to iPad or USB drive        │
│                                                                  │
│  Stored on iPad in Files app or browser IndexedDB               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: At aircraft (iPad switches to Stratux WiFi)             │
│                                                                  │
│  iPad opens PilotStation → Settings → Data Manager              │
│                                                                  │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ DATA MANAGER                                         │        │
│  │                                                       │        │
│  │ Charts (Sectional)   2026-01-23  ⚠ EXPIRED           │        │
│  │ Charts (IFR Low)     2026-01-23  ⚠ EXPIRED           │        │
│  │ Approach Plates       2026-02-06  ✓ Current (12d left)│        │
│  │ NASR Data             2026-02-06  ✓ Current (12d left)│        │
│  │ Terrain Data          2025-09-01  ✓ (static)          │        │
│  │                                                       │        │
│  │ [ UPLOAD CHARTS ]  [ UPLOAD PLATES ]  [ UPLOAD NASR ] │        │
│  │                                                       │        │
│  │ Disk: 42 GB used / 128 GB total                       │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                  │
│  Tap "Upload Plates" → file picker → select d-TPP .tar.gz      │
│  → upload progress bar → Pi extracts and installs               │
│  → "Approach plates updated: cycle 2026-02-20, 1,847 plates"   │
└─────────────────────────────────────────────────────────────────┘
```

**Alternative update method — USB drive (recommended for chart tiles):**

Transfer of 3-5 GB chart tiles over Stratux WiFi (2.4 GHz) would take 15-30 minutes. For large data sets:

1. Prepare update package on desktop computer
2. Copy to USB drive
3. Plug USB into Pi (in aircraft)
4. PilotStation auto-detects USB, shows install prompt on iPad
5. Pi copies data from USB directly — much faster than WiFi

**Transfer speeds over Stratux WiFi:**

| Data Type        | Typical Size | WiFi Transfer Time | USB Transfer Time |
| ---------------- | ------------ | ------------------ | ----------------- |
| Weather cache    | ~1 MB        | Instant            | —                 |
| NASR data        | ~50 MB       | ~15 seconds        | ~5 seconds        |
| Approach plates  | 200-500 MB   | 1-3 minutes        | ~30 seconds       |
| Full chart tiles | 3-5 GB       | 15-30 minutes      | 2-3 minutes       |

**API endpoints for data management:**

| Method | Path                         | Description                                         |
| ------ | ---------------------------- | --------------------------------------------------- |
| GET    | `/api/admin/status`          | Current data versions, expiration dates, disk usage |
| POST   | `/api/admin/upload/tiles`    | Upload and install chart tile package (.tar.gz)     |
| POST   | `/api/admin/upload/plates`   | Upload and install d-TPP plate package (.tar.gz)    |
| POST   | `/api/admin/upload/nasr`     | Upload and install NASR data package                |
| POST   | `/api/admin/upload/weather`  | Push pre-cached weather data                        |
| POST   | `/api/admin/upload/terrain`  | Upload terrain data update                          |
| GET    | `/api/admin/upload/progress` | Upload/install progress (for progress bar UI)       |
| POST   | `/api/admin/detect-usb`      | Scan for update packages on connected USB drive     |
| GET    | `/api/plates/{icao}`         | List available plates for an airport                |
| GET    | `/api/plates/{icao}/{name}`  | Serve a specific plate PDF                          |

### 6.10 Module: Weight & Balance Calculator (P1)

**Runs on the Pi (Cockpit Mode) or client-side in the browser (Planning Mode) — no internet required for calculation.** In Cockpit Mode, the Pi serves aircraft profiles and runs W&B via the API. In Planning Mode, `wb-calculator.js` performs the same calculations client-side using aircraft profiles synced to IndexedDB.

| ID    | Requirement                                                                                 | Priority |
| ----- | ------------------------------------------------------------------------------------------- | -------- |
| WB-01 | **Multi-aircraft profile storage** — store and switch between aircraft (PA-28, RV-9A, etc.) | P1       |
| WB-02 | **CG envelope diagram** — interactive chart showing weight vs. CG with plotted point        | P1       |
| WB-03 | Visual go/no-go: green when inside envelope, red when outside                               | P1       |
| WB-04 | Station-based loading: pilot, passenger, baggage, fuel (per aircraft profile)               | P1       |
| WB-05 | Fuel burn CG shift — show takeoff CG AND landing CG (after fuel burn)                       | P1       |
| WB-06 | Real-time fuel weight from engine monitor feed (updates landing CG in-flight)               | P2       |
| WB-07 | Save loading scenarios (e.g., "Solo", "Two pax + bags", "Full fuel solo")                   | P1       |
| WB-08 | CG limits from aircraft POH stored in aircraft profile                                      | P1       |
| WB-09 | Print / export W&B sheet (PDF or image for filing)                                          | P2       |
| WB-10 | Moment and arm calculations shown in detail table                                           | P1       |

**Aircraft profile storage (`/boot/firmware/pilotstation/aircraft/`):**

Each aircraft is a JSON file stored on the boot partition (Tier 1 — always writable, survives power loss; see Section 5.6). The pilot selects the active aircraft from settings. All W&B calculations, engine parameters, and fuel config use the active aircraft profile.

```json
// /boot/firmware/pilotstation/aircraft/pa28-cherokee.json
{
  "id": "pa28-cherokee",
  "name": "PA-28-180 Cherokee",
  "tail_number": "N1234",
  "active": true,
  "empty_weight": 1225,
  "empty_cg": 86.4,
  "max_gross_weight": 2400,
  "stations": [
    { "name": "Pilot & Front Pax", "arm": 85.5, "min": 0, "max": 400 },
    { "name": "Rear Passengers",   "arm": 118.1, "min": 0, "max": 400 },
    { "name": "Baggage",           "arm": 142.8, "min": 0, "max": 200 },
    { "name": "Fuel (50 gal max)", "arm": 95.0,  "min": 0, "max": 300, "fuel": true, "gal_to_lbs": 6.0 }
  ],
  "cg_envelope": [
    { "weight": 1400, "fwd_cg": 82.0, "aft_cg": 93.0 },
    { "weight": 1800, "fwd_cg": 82.0, "aft_cg": 93.0 },
    { "weight": 2400, "fwd_cg": 83.0, "aft_cg": 93.0 }
  ],
  "utility_envelope": [
    { "weight": 1400, "fwd_cg": 82.0, "aft_cg": 90.0 },
    { "weight": 2100, "fwd_cg": 82.0, "aft_cg": 90.0 }
  ],
  "engine": {
    "type": "O-360-A1A",
    "rated_hp": 180,
    "rated_rpm": 2700,
    "rated_mp": 29.0,
    "monitor_model": "EDM-700"
  },
  "fuel": {
    "capacity_gal": 50,
    "usable_gal": 48,
    "tanks": ["left", "right"]
  },
  "timezone": "America/New_York",
  "personal_minimums": {
    "vfr": { "ceiling_ft": 3000, "visibility_sm": 5, "wind_kt": 25, "crosswind_kt": 15, "gust_spread_kt": 10 },
    "ifr": { "ceiling_ft": 500, "visibility_sm": 1, "wind_kt": 30, "crosswind_kt": 20 },
    "night": { "ceiling_ft": 4000, "visibility_sm": 6 },
    "turbulence_max": "moderate",
    "icing_max": "none"
  }
}
```

```json
// /boot/firmware/pilotstation/aircraft/rv9a.json
{
  "id": "rv9a",
  "name": "Vans RV-9A",
  "tail_number": "N5678",
  "active": false,
  "empty_weight": 1100,
  "empty_cg": 79.5,
  "max_gross_weight": 1750,
  "stations": [
    { "name": "Pilot",    "arm": 80.0, "min": 0, "max": 250 },
    { "name": "Passenger", "arm": 80.0, "min": 0, "max": 250 },
    { "name": "Baggage",  "arm": 108.0, "min": 0, "max": 50 },
    { "name": "Fuel (36 gal max)", "arm": 78.0, "min": 0, "max": 216, "fuel": true, "gal_to_lbs": 6.0 }
  ],
  "cg_envelope": [
    { "weight": 1100, "fwd_cg": 76.0, "aft_cg": 86.0 },
    { "weight": 1750, "fwd_cg": 77.0, "aft_cg": 86.0 }
  ],
  "engine": {
    "type": "O-320",
    "rated_hp": 160,
    "rated_rpm": 2700,
    "rated_mp": 28.0,
    "monitor_model": "Dynon D180"
  },
  "avionics": {
    "efis": "Dynon D180",
    "gps": "Garmin GPS 175",
    "autopilot": "TruTrak Xcruze 100"
  },
  "fuel": {
    "capacity_gal": 36,
    "usable_gal": 36,
    "tanks": ["left", "right"]
  },
  "timezone": "America/New_York",
  "personal_minimums": {
    "vfr": { "ceiling_ft": 3000, "visibility_sm": 5, "wind_kt": 25, "crosswind_kt": 15, "gust_spread_kt": 10 },
    "ifr": { "ceiling_ft": 500, "visibility_sm": 1, "wind_kt": 30, "crosswind_kt": 20 },
    "night": { "ceiling_ft": 4000, "visibility_sm": 6 },
    "turbulence_max": "moderate",
    "icing_max": "none"
  }
}
```

**Note on Dynon D180:** The D180 is an EFIS with integrated engine monitoring. Its serial output format differs from the JPI EDM-700/800 protocol. PilotStation requires a separate parser for D180 data (Dynon serial protocol) alongside the existing EDM parser. The active aircraft profile determines which parser is used. The Savvy export normalizes both formats into the same Savvy-compatible CSV columns.

**Note on `timezone`:** The `timezone` field (IANA format) is the authoritative source for UTC offset. The offset is computed at runtime to handle DST transitions correctly (e.g., America/New_York is `-05:00` EST or `-04:00` EDT). No static `utc_offset` field is stored.

**CG envelope diagram (interactive, rendered with Chart.js):**

```
┌──────────────────────────────────────────────────────────┐
│ WEIGHT & BALANCE: PA-28-180 Cherokee  N1234  [RV-9A ▼]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  2400 ┤─────────────────────────┐  Max Gross             │
│       ┤                  ╱──────┘                        │
│  2200 ┤    Normal ──────╱                                │
│       ┤    Category ──╱     ╲── Aft limit                │
│  2000 ┤            ╱          ╲                          │
│       ┤          ╱   ● 2100    ╲                         │
│  1800 ┤ Fwd ──╱     Takeoff     ╲                       │
│       ┤ limit       ○ 1914       ╲                       │
│  1600 ┤            Landing        ╲                      │
│       ┤          (after burn)      │                     │
│  1400 ┤─────────────────────────────│                     │
│       └──┬─────┬─────┬─────┬─────┬──                     │
│         80    83    86    89    92    CG (inches)         │
│                                                          │
│  ● = Takeoff (IN ENVELOPE ✓)                             │
│  ○ = Landing after 31 gal burn (IN ENVELOPE ✓)          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  Station             Weight  Arm    Moment               │
│  ─────────────────────────────────────────               │
│  Empty aircraft       1225   86.4   105,840              │
│  Pilot & Front Pax  [  370] 85.5    31,635              │
│  Rear Passengers     [  180] 118.1   21,258              │
│  Baggage             [   25] 142.8    3,570              │
│  Fuel (50 gal)       [  300] 95.0    28,500              │
│  ─────────────────────────────────────────               │
│  TAKEOFF TOTAL        2100   90.9   190,803   ✓ NORMAL  │
│  LANDING (est -31g)   1914   90.5   173,133   ✓ NORMAL  │
│                                                          │
│  [SAVE SCENARIO ▼]  [LOAD: Solo ▼]  [CLEAR]  [EXPORT]  │
├──────────────────────────────────────┬───────────────────┤
│                                      │ EGT▊▊▊▊ CHT▊▊▊▊  │
│                                      │ CARB 78°F 22g 2:41│
├──────────────────────────────────────┴───────────────────┤
│  [ MAP ]  [ENGINE]  [ FUEL ]  [ WX ]  [ PLAN ]  [ LOG ] │
└──────────────────────────────────────────────────────────┘
```

**Switching aircraft:** The `[RV-9A ▼]` dropdown in the header lets the pilot switch between stored aircraft profiles. Switching the active aircraft updates:

- W&B stations, CG envelope, max gross weight
- Engine parameters (for engine monitor: rated HP, RPM, MP)
- Fuel capacity and tank configuration
- All dependent calculations (power %, SFC, endurance, range)

**Offline operation:** All aircraft profiles are JSON files stored on the Pi's boot partition (`/boot/firmware/pilotstation/aircraft/*.json` — Tier 1, always writable). No internet access needed — profiles are created/edited via the PilotStation settings UI or by uploading JSON from the iPad. The CG envelope diagram is rendered client-side by Chart.js in Safari.

### 6.11 Module: Pre-Flight Planning Workflow — Planning Mode (P1)

**This module runs only in Planning Mode** (iPad on home/FBO WiFi with internet). It provides a 6-step guided workflow that integrates route planning, weather, W&B, fuel stops, and AI-powered briefing into a single sequential flow. Each step builds on the previous, and the final step packages everything for upload to the Pi.

| ID      | Requirement                                                                                 | Priority |
| ------- | ------------------------------------------------------------------------------------------- | -------- |
| PLAN-01 | 6-step guided planning workflow: Aircraft → Route → Weather → W&B → Briefing → Ready       | P1       |
| PLAN-02 | Dashboard view alternative showing all 6 panels simultaneously (toggle from guided flow)    | P2       |
| PLAN-03 | Auto-save workflow progress to IndexedDB; resume on PWA reopen                              | P1       |
| PLAN-04 | Weather fetch from aviationweather.gov via Cloudflare Worker proxy for route corridor (25nm)| P1       |
| PLAN-05 | Route planning using NASR airport/navaid/airway data from IndexedDB cache                   | P1       |
| PLAN-06 | Wind optimization: calculate GS at multiple altitudes, recommend optimal                    | P1       |
| PLAN-07 | Fuel stop planning with live fuel prices from aviation-fuel-prices.com                      | P1       |
| PLAN-08 | Weight & balance calculation integrated as Step 4 of workflow                               | P1       |
| PLAN-09 | Flight plan package assembly and staging in IndexedDB                                       | P1       |
| PLAN-10 | Auto-upload package to Pi when Stratux WiFi detected (see SYNC-01)                          | P1       |
| PLAN-11 | Manual "Upload to PilotStation" button with progress indicator                              | P1       |
| PLAN-12 | Offline mode: show cached plan + weather with prominent stale data warnings                 | P1       |
| PLAN-13 | NASR data sync from Pi when on Stratux WiFi (airports, navaids, airways, airspace)          | P1       |
| PLAN-14 | NASR data fallback: download pre-processed NASR subset from static hosted file              | P2       |
| PLAN-15 | Fuel price cache with age indicator ("Prices updated: 09 Feb 2026")                         | P1       |
| PLAN-16 | Request official standard briefing from 1800wxbrief API during Step 5; cache confirmation number with flight plan package (see FILE-10) | P1 |
| PLAN-17 | File VFR/IFR flight plan via 1800wxbrief API from Step 6 with auto-populated fields (see FILE-04, FILE-05) | P1 |
| PLAN-18 | Display filing confirmation with flight plan identifier; store in flight plan package (see FILE-06) | P1 |

**Step-by-step workflow:**

```
Step 1: AIRCRAFT           Step 2: ROUTE              Step 3: WEATHER
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│ Select aircraft:  │   │ KLKR → [____]     │   │ Fetching weather  │
│ ● PA-28 Cherokee  │   │ Via: [GSP] [AWY]  │   │ for route...      │
│ ○ RV-9A           │   │ Alt: [8000▼] ft   │   │                   │
│                   │   │                   │   │ KLKR: VFR CLR ●   │
│ Passengers: [2]   │   │ [AIRWAYS LOOKUP]  │   │ KGSP: MVFR ●      │
│ Baggage: [25 lb]  │   │ [OPT ALTITUDE]    │   │ KLWA: VFR FEW ●   │
│ Fuel: [48 gal]    │   │                   │   │                   │
│                   │   │ ETE: 3:50         │   │ TFRs: 1 near route│
│ [NEXT: ROUTE →]   │   │ Fuel req: 31.0g   │   │ NOTAMs: fetched   │
│                   │   │ [NEXT: WX →]      │   │ [NEXT: W&B →]     │
└───────────────────┘   └───────────────────┘   └───────────────────┘

Step 4: WEIGHT & BALANCE    Step 5: BRIEFING           Step 6: READY / FILE
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│ Takeoff:          │   │ SMART BRIEFING    │   │ FLIGHT PLAN READY │
│ ● 2070 lb         │   │                   │   │                   │
│   CG 90.9" NORMAL │   │ AI: GO ✓          │   │ KLKR → KLWA 8000 │
│                   │   │ VFR all route     │   │ W&B: ✓  WX: ✓     │
│ Landing:          │   │ TFR near KGSP     │   │ Fuel: ✓ 17.0 res  │
│ ○ 1884 lb         │   │ Wind favor 8000   │   │                   │
│   CG 90.5" NORMAL │   │ NOTAMs: 2 signif  │   │ Rules: [VFR|IFR]  │
│                   │   │                   │   │ Dep time: [15:00Z] │
│ [CG DIAGRAM]      │   │ Official briefing │   │ Remarks: [______]  │
│ [NEXT: BRIEF →]   │   │ ✓ WB-2026-7654321│   │                   │
└───────────────────┘   │ [NEXT: READY →]   │   │ [FILE FLIGHT PLAN]│
                        └───────────────────┘   │ [UPLOAD TO PI]    │
                                                 └───────────────────┘
```

**Step progress bar:** `[1 ✓] [2 ✓] [3 WEATHER] [4] [5] [6]` — each step is tappable to jump directly. Completed steps show a checkmark. Pilot can move freely between steps.

**Step details:**

| Step | Inputs                                        | Outputs                                                    | Data source              |
| ---- | --------------------------------------------- | ---------------------------------------------------------- | ------------------------ |
| 1. Aircraft | Aircraft selection, passengers, baggage, fuel | Aircraft profile loaded, loading weights set              | IndexedDB (synced from Pi) |
| 2. Route    | Departure, waypoints/airways, destination     | Legs with distance/heading/time/fuel, optimal altitude    | IndexedDB NASR cache     |
| 3. Weather  | (auto from route)                             | METARs, TAFs, winds, PIREPs, NOTAMs, TFRs for corridor   | Cloudflare Worker → AWC  |
| 4. W&B      | (auto from Steps 1+2)                         | CG envelope diagram, takeoff/landing weight & CG          | Client-side calculation  |
| 5. Briefing | (auto from Steps 2+3)                         | Smart briefing, AI analysis, go/no-go, NOTAM highlights, official 1800wxbrief briefing with confirmation # | Cloudflare Worker → Claude + 1800wxbrief |
| 6. Ready    | Flight rules, dep time, remarks, alternate    | Flight plan package assembled; file via 1800wxbrief; upload to Pi | Cloudflare Worker → 1800wxbrief + IndexedDB |

**Dashboard view (P2):** Toggle button in top-right switches to a 2x3 grid showing all six panels in condensed form simultaneously. For experienced pilots who prefer the overview.

### 6.12 Module: AI Copilot — Planning Mode (P1)

An AI copilot powered by the Claude API assists with pre-flight decision-making. It runs in Planning Mode only (requires internet to reach the Cloudflare Worker proxy). All AI outputs are advisory — PIC retains all decision authority.

| ID    | Requirement                                                                                       | Priority |
| ----- | ------------------------------------------------------------------------------------------------- | -------- |
| AI-01 | Cloudflare Worker proxy for Claude API with CORS support (see Section 5.8)                        | P1       |
| AI-02 | API key stored as Cloudflare Worker secret — never in PWA client code                             | P1       |
| AI-03 | Rate limiting: 20 Claude requests/minute, origin validation                                       | P1       |
| AI-04 | **Weather analysis**: plain-English decode of METARs, TAFs, PIREPs for route                     | P1       |
| AI-05 | **Go/No-Go reasoning**: evaluate weather against personal minimums with detailed rationale         | P1       |
| AI-06 | **NOTAM filtering**: identify operationally significant NOTAMs from full list (50+ per airport)   | P1       |
| AI-07 | **Route optimization**: suggest altitude, routing around weather, airspace considerations          | P2       |
| AI-08 | **Alternate selection**: recommend alternates based on weather, fuel, approach availability        | P1       |
| AI-09 | Cache Claude responses in IndexedDB with flight plan package for offline reference                 | P1       |
| AI-10 | **Advisory disclaimer** on all AI output: "AI analysis is advisory only. PIC retains all decision authority." | P0 (must ship with first AI feature) |
| AI-11 | Graceful degradation: planning workflow fully functional without AI (shows "Connect to internet for AI analysis") | P1 |
| AI-12 | Personal minimums configuration (see below)                                                       | P1       |

**AI copilot functions:**

| Function                   | Input                                            | Output                                                                        |
| -------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| **Weather analysis**       | Raw METARs, TAFs, PIREPs for route               | Plain-language summary with key concerns highlighted                          |
| **Go/No-Go reasoning**     | Weather data + personal minimums + aircraft type  | GO/MARGINAL/NO-GO with detailed reasoning for each factor                    |
| **NOTAM filtering**        | All NOTAMs for route airports (often 50+)        | 2-5 operationally significant ones, rest categorized as "informational"      |
| **Route optimization**     | Route, winds aloft, airspace, weather             | Altitude recommendation, deviation suggestions, alternate routing            |
| **Alternate selection**    | Destination weather, fuel state, aircraft         | Top 2-3 alternates with ILS availability, weather, fuel cost                 |
| **Plain-language decode**  | Raw METAR, TAF, or NOTAM text                    | Decoded into plain English: "Wind from 310 at 12 gusting 18, visibility 6sm" |

**Claude system prompt design:** The system prompt establishes the AI as an experienced aviation weather analyst with CFI-I credentials. Each request sends structured aviation data (not raw text) with the aircraft type, route, and personal minimums. The response is constrained to specific JSON output fields to keep token usage low and responses focused.

**Personal minimums (stored in aircraft profile — see Section 6.10):**

```json
{
  "personal_minimums": {
    "vfr": {
      "ceiling_ft": 3000,
      "visibility_sm": 5,
      "wind_kt": 25,
      "crosswind_kt": 15,
      "gust_spread_kt": 10
    },
    "ifr": {
      "ceiling_ft": 500,
      "visibility_sm": 1,
      "wind_kt": 30,
      "crosswind_kt": 20
    },
    "night": {
      "ceiling_ft": 4000,
      "visibility_sm": 6
    },
    "turbulence_max": "moderate",
    "icing_max": "none"
  }
}
```

The AI Go/No-Go function evaluates each weather parameter against these minimums and flags any exceedance. For example, if the crosswind at the destination exceeds `crosswind_kt`, the AI will flag it and recommend considering an alternate or waiting for improved conditions.

### 6.13 Module: 1800wxbrief Integration — Flight Plan Filing & Official Briefing (P1)

**Source:** Leidos Flight Service Web Services API (`lmfsweb.afss.com`)

PilotStation integrates with the FAA's 1800wxbrief (Leidos Flight Service) API to file VFR and IFR flight plans directly from the planning workflow and to obtain official weather briefings with a legal record. Filing and briefing happen in Planning Mode (requires internet); activation and closing use the traditional radio/phone method with PilotStation reminders in Cockpit Mode.

**Prerequisites:**
- **Vendor registration:** The PilotStation developer registers with Leidos Flight Service for web services API access. Vendor credentials (vendor ID + password) are stored as Cloudflare Worker secrets.
- **Pilot registration:** The pilot creates a free account at `1800wxbrief.com`. Their username is stored in `pilotstation.conf` and synced to IndexedDB for Planning Mode.

| ID      | Requirement                                                                                                  | Priority |
| ------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| FILE-01 | Vendor registration with Leidos Flight Service for API access                                                | P1       |
| FILE-02 | Vendor credentials (vendor ID + password) stored as Cloudflare Worker secrets                                | P1       |
| FILE-03 | Pilot's 1800wxbrief username stored in `pilotstation.conf`, synced to IndexedDB                              | P1       |
| FILE-04 | **File VFR flight plan** from Step 6 (Ready) — auto-populate from planning workflow data                     | P1       |
| FILE-05 | **File IFR flight plan** from Step 6 (Ready) — includes alternate airport(s), equipment suffix               | P1       |
| FILE-06 | Filing confirmation with `flightIdentifier` stored in flight plan package                                    | P1       |
| FILE-07 | **Amend filed flight plan** if pilot changes route/altitude/time before departure                            | P1       |
| FILE-08 | **Cancel filed flight plan** from Planning Mode or Cockpit Mode (if internet available)                      | P1       |
| FILE-09 | **Activate/close reminders** in Cockpit Mode — prompt with FSS frequency after takeoff detection (VFR activate) and landing detection (close) | P1 |
| FILE-10 | **Official weather briefing** via 1800wxbrief API during Step 5 — standard briefing, creates legal record    | P1       |
| FILE-11 | Briefing confirmation number displayed and cached with flight plan package                                   | P1       |
| FILE-12 | Filing status indicator in Cockpit Mode PLAN view: "VFR Plan Filed — KLKR→KLWA — Activate via FSS 122.2"    | P1       |

**Flight plan field mapping from planning workflow:**

| Flight Plan Field       | Source in Planning Workflow                                    |
| ----------------------- | ------------------------------------------------------------- |
| Aircraft identifier     | Aircraft profile `tail_number` (Step 1)                       |
| Aircraft type/equipment | Aircraft profile `engine.type` + equipment suffix input       |
| Departure airport       | Route departure (Step 2)                                      |
| Destination airport     | Route destination (Step 2)                                    |
| Route of flight         | Route waypoints/airways (Step 2)                              |
| Altitude                | Selected altitude (Step 2)                                    |
| True airspeed           | Calculated from aircraft performance at altitude (Step 2)     |
| Departure time          | Pilot enters proposed departure time (Step 6)                 |
| Estimated time enroute  | Calculated from route (Step 2)                                |
| Fuel on board           | From Step 1 fuel entry, converted to endurance (hours:minutes)|
| People on board         | From Step 1 passenger count + pilot                           |
| Alternate airport(s)    | Pilot enters or AI recommends (Step 5, AI-08)                 |
| Pilot info              | From `pilotstation.conf` `pilot_info` (name, phone, address)  |
| Remarks                 | Pilot enters (Step 6)                                         |
| Flight rules            | Pilot selects VFR or IFR (Step 6)                             |

**API operations (via Cloudflare Worker proxy — see Section 5.8):**

| Operation    | Endpoint                        | When                                        | Notes                                               |
| ------------ | ------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| **File**     | `POST /fp/file`                 | Step 6, pilot taps [FILE VFR] or [FILE IFR] | Returns `flightIdentifier` + `versionStamp`         |
| **Amend**    | `POST /fp/{id}/amend`           | Planning Mode, if pilot changes plan         | Requires `versionStamp` from last operation         |
| **Cancel**   | `POST /fp/{id}/cancel`          | Planning Mode, if plans change entirely      | Only before activation                              |
| **Close**    | `POST /fp/{id}/close`           | After landing, if internet available         | Fallback: pilot calls FSS 122.2                     |
| **Briefing** | `POST /briefing`                | Step 5, automatic                            | Standard briefing, returns confirmation number      |

**Activation and closing workflow (Cockpit Mode):**

Since activation and closing require communication with FSS and PilotStation is on Stratux WiFi (no internet) at the aircraft, these use the traditional radio/phone method with smart reminders:

- **VFR activation:** After engine start detection, PilotStation shows a blue banner: "Activate VFR flight plan — FSS 122.2 or contact ground." Banner persists until dismissed.
- **VFR close:** After landing detection (LOG-01), PilotStation shows a prominent red-bordered reminder: "Close your VFR flight plan within 30 minutes — call FSS 122.2 to avoid search & rescue activation." Includes ETA countdown timer.
- **IFR activation:** Handled by ATC clearance delivery — no PilotStation action needed. Status shows "IFR — activate via clearance."
- **IFR close:** At towered fields, tower closes the plan. At non-towered fields, PilotStation reminds pilot to call FSS.
- **API close (when internet returns):** If the pilot returns to internet WiFi with an unclosed VFR plan, PilotStation shows: "VFR flight plan still open. [CLOSE NOW] [ALREADY CLOSED]"

**Official weather briefing (Step 5):**

During Step 5 (Briefing), PilotStation automatically requests a standard weather briefing from 1800wxbrief API alongside the AI copilot analysis. The official briefing:
- Creates a legal record that the pilot obtained a weather briefing (useful for insurance/liability)
- Returns a confirmation number cached in the flight plan package
- Is displayed in a separate panel below the AI analysis: "Official Briefing — Confirmation #WB-2026-7654321"
- Includes the full FAA standard briefing content (adverse conditions, synopsis, current conditions, forecast, winds, NOTAMs)

---

## 7. UI/UX Specification

### 7.1 Visual Design System

#### Color Palette

| Token              | Day Mode              | Night Mode             | Usage                  |
| ------------------ | --------------------- | ---------------------- | ---------------------- |
| `--bg-primary`     | `#1a1a2e` (dark navy) | `#0a0a0a` (near black) | Background             |
| `--bg-surface`     | `#16213e` (dark blue) | `#111111`              | Cards, panels          |
| `--text-primary`   | `#ffffff`             | `#ff6b6b` (dim red)    | Primary text           |
| `--text-secondary` | `#a0a0a0`             | `#662222`              | Secondary text         |
| `--accent`         | `#00d4ff` (cyan)      | `#662222`              | Active tab, highlights |
| `--success`        | `#00ff88` (green)     | `#224422`              | Normal parameters      |
| `--caution`        | `#ffaa00` (amber)     | `#664400`              | Warnings               |
| `--danger`         | `#ff4444` (red)       | `#ff2222`              | Alarms                 |
| `--fuel-ok`        | `#00aaff` (blue)      | `#222266`              | Fuel level normal      |
| `--terrain`        | `#8b6914` (brown)     | `#443300`              | Terrain on profile     |

Night mode uses red-spectrum only to preserve night vision (rod cell sensitivity).

#### Typography

| Element                   | Font                            | Size    | Weight          |
| ------------------------- | ------------------------------- | ------- | --------------- |
| Primary instrument values | `JetBrains Mono` or `monospace` | 28-36px | Bold            |
| Secondary data            | `Inter` or `system-ui`          | 18-22px | Semi-bold       |
| Labels                    | `Inter` or `system-ui`          | 14-16px | Regular         |
| Status bar                | `Inter`                         | 16px    | Semi-bold       |
| Nav bar buttons           | `Inter`                         | 14px    | Bold, uppercase |

#### Touch Targets

| Element         | Minimum Size       | Spacing |
| --------------- | ------------------ | ------- |
| Nav bar tabs    | 80 x 56 px (21mm+) | 4px gap |
| Action buttons  | 72 x 48 px (19mm+) | 4px gap |
| Map tap targets | 56 x 56 px (15mm+) | —       |
| Sliders/toggles | 56px height        | —       |
| Dismiss/close   | 48 x 48 px         | —       |

### 7.2 Screen Layouts

#### MAP View (default)

```
┌──────────────────────────────────────────────────────────┐
│ ✈ N1234  │ 12:34Z │ GS:125kt │ ALT:5500 │ FUEL:22g 2:41│
├────────────────────────────────────┬─────────────────────┤
│                                    │ EGT ▊▊▊▊ (mini)    │
│     Leaflet.js Moving Map          │ CHT ▊▊▊▊ (mini)    │
│   (FAA sectional chart tiles       │ CARB  78°F ←GREEN   │
│    served from Pi via Nginx)       │ PWR   65% LOP       │
│                                    │─────────────────────│
│    ▲ N320UA +2100 ↗               │ ┌─┐    ┌─┐         │
│         [aircraft icon]            │ │█│    │▓│ L / R    │
│     ─ ─ ─ route line ─ ─ ─        │ └─┘    └─┘         │
│              ↑N                    │ 22 gal  2:41 endur  │
│                                    │─────────────────────│
│  [SEC ▼] chart type switcher       │                     │
│                                    │                     │
│                                    │                     │
│                                    │                     │
├────────────────────────────────────┴─────────────────────┤
│  [ MAP ]  [ENGINE]  [ FUEL ]  [ WX ]  [ PLAN ]  [ LOG ] │
└──────────────────────────────────────────────────────────┘
```

#### ENGINE View (configurable — shown in "Cruise" preset)

```
┌──────────────────────────────────────────────────────────┐
│ ✈ N1234  │ 12:34Z │ GS:125kt │ ALT:5500 │ FUEL:22g 2:41│
├────────────────────────────────────┬─────────────────────┤
│  EGT (°F) — 30 min line chart     │                     │
│  1400┤       ╱─╲  ╱──          │  CARB  78°F ←GREEN  │
│  1350┤──╱──╱    ╲╱    ──cyl1   │  EGT  ▊▊▊▊ (mini)   │
│  1300┤╱  ─────────── cyl2      │  CHT  ▊▊▊▊ (mini)   │
│  1250┤   ─·─·─·─·── cyl3      │  PWR   65% LOP       │
│      └──┬─────┬─────┬─────┬    │─────────────────────│
│       -30   -20   -10    now    │  ┌─┐    ┌─┐         │
│                                    │  │█│    │▓│         │
│  CHT (°F) — 30 min line chart     │  └─┘    └─┘         │
│   400┤                             │  22 gal  2:41       │
│   375┤──────────╱─── cyl1       │                     │
│   350┤─────────────── cyl2       │  [CRUISE ▼]        │
│   325┤                             │  preset selector    │
│      └──┬─────┬─────┬─────┬    │                     │
│       -30   -20   -10    now    │                     │
│                                    │                     │
│  ┌──────────────────────────────┐  │                     │
│  │ CARB TEMP    ════════ 78°F  │  │                     │
│  │ ──────[green]──▼───[yel]──  │  │                     │
│  │ 30    50    70   90  110°F  │  │                     │
│  └──────────────────────────────┘  │                     │
├────────────────────────────────────┴─────────────────────┤
│  [ MAP ]  [ENGINE]  [ FUEL ]  [ WX ]  [ PLAN ]  [ LOG ] │
└──────────────────────────────────────────────────────────┘
```

Presets: **Cruise** (default — carb temp + EGT/CHT line charts), **Leaning** (EGT line chart + EGT bars + peak tracking + FF), **Full** (all parameters). See Section 6.2 for widget configuration details.

#### WX View (weather briefing + profile)

```
┌──────────────────────────────────────────────────────────┐
│ ✈ N1234  │ 12:34Z │ GS:125kt │ ALT:5500 │ FUEL:22g 2:41│
├────────────────────────────────────┬─────────────────────┤
│  PROFILE VIEW: KLKR → KCLT  138nm │  KLKR (Dep)        │
│  FL180 ┤         ╱‾‾‾╲ Bravo     │  VFR ● CLR          │
│        ┤  ═══ planned alt ═══     │  29.92" 270@8       │
│  10000 ┤    ╱ Charlie ╲           │  Vis: 10sm          │
│        ┤ ▒▒▒▒ icing ▒▒▒▒         │                     │
│   5000 ┤ ▓▓▓▓ clouds ▓▓          │  KCLT (Dest)        │
│        ┤╱ terrain  ╲              │  MVFR ● BKN025      │
│    SFC ┤────────────────          │  29.88" 310@12G18   │
│        └──┬──────┬──────┬         │                     │
│         KLKR   50nm  KCLT         │  Winds @6000:       │
│                                    │  310 @ 22kt  +4°C  │
│  [METAR] [TAF] [PIREP] [SIGMET]   │─────────────────────│
│                                    │ EGT▊▊▊▊ CHT▊▊▊▊    │
│                                    │ CARB 78°F  22g 2:41 │
├────────────────────────────────────┴─────────────────────┤
│  [ MAP ]  [ENGINE]  [ FUEL ]  [ WX ]  [ PLAN ]  [ LOG ] │
└──────────────────────────────────────────────────────────┘
```

#### FUEL View

```
┌──────────────────────────────────────────────────────────┐
│ ✈ N1234  │ 12:34Z │ GS:125kt │ ALT:5500 │ FUEL:22g 2:41│
├────────────────────────────────────┬─────────────────────┤
│                                    │                     │
│  ┌──────┐     ┌──────┐            │  Burn Rate           │
│  │██████│     │▓▓▓▓▓▓│            │  8.2 GPH (current)   │
│  │██████│     │▓▓▓▓▓▓│            │  7.8 GPH (avg)       │
│  │██████│     │▓▓▓▓▓▓│            │                     │
│  │██████│     │      │            │  Range               │
│  │██████│     │      │            │  312 nm remaining    │
│  └──────┘     └──────┘            │                     │
│  LEFT 14g     RIGHT 8g            │  Endurance           │
│                                    │  2:41 remaining      │
│  TOTAL: 22 gal                    │                     │
│  ──────[green]────▼──[yel]──[red] │  Last fueled:        │
│  0    8    16   24   32   40 gal  │  KLKR  $5.89/g      │
│                                    │  10 Feb  32.0 gal    │
│  ┌─────────────────────────────┐   │─────────────────────│
│  │ Fuel flow trend (30 min)    │   │ EGT▊▊▊▊ CHT▊▊▊▊    │
│  └─────────────────────────────┘   │ CARB 78°F  22g 2:41 │
├────────────────────────────────────┴─────────────────────┤
│  [ MAP ]  [ENGINE]  [ FUEL ]  [ WX ]  [ PLAN ]  [ LOG ] │
└──────────────────────────────────────────────────────────┘
```

#### PLAN View

```
┌──────────────────────────────────────────────────────────┐
│ ✈ N1234  │ 12:34Z │ GS:125kt │ ALT:5500 │ FUEL:22g 2:41│
├────────────────────────────────────┬─────────────────────┤
│  FLIGHT PLAN: KLKR → KLWA  528nm  │  Recommended Alt:    │
│                                    │  8000 ft             │
│  LEG    AWY   HDG  DIST  TIME  FL │  GS: 138kt           │
│  ─────────────────────────────────│  ETE: 3:50           │
│  KLKR         →                   │  Fuel req: 31.0 gal  │
│   → GSP  V16  254° 89nm  0:39  60│                     │
│  GSP         →                   │  Wind @8000:          │
│   → AVL  V20  278° 62nm  0:27  80│  300/28kt  +2°C     │
│  AVL         →                   │                     │
│   → KLWA DIR  261° 377nm 2:44  80│  [FUEL STOP]        │
│  ─────────────────────────────────│  [SMART BRIEF]      │
│  TOTAL       528nm  3:50  31.0g  │  [SHOW ON MAP]      │
│                                    │─────────────────────│
│  [+ ADD WPT]  [AIRWAYS]  [OPT ALT]│ EGT▊▊▊▊ CHT▊▊▊▊    │
│                                    │ CARB 78°F  22g 2:41 │
├────────────────────────────────────┴─────────────────────┤
│  [ MAP ]  [ENGINE]  [ FUEL ]  [ WX ]  [ PLAN ]  [ LOG ] │
└──────────────────────────────────────────────────────────┘
```

#### LOG View

```
┌──────────────────────────────────────────────────────────┐
│ ✈ N1234  │ 12:34Z │ GS:125kt │ ALT:5500 │ FUEL:22g 2:41│
├────────────────────────────────────┬─────────────────────┤
│  PILOT LOGBOOK         [PA-28 ▼]   │  Currency            │
│                                    │                     │
│  DATE     ROUTE        DUR  LDGS  │  Day:   ✓ 62d left  │
│  ──────────────────────────────── │  Night: ✓ 45d left  │
│ ▶11 Feb  KLKR→KLWA    3:50  1    │  IFR:   ✓ 4mo left  │
│  08 Feb  KCLT→KLKR    1:05  2    │  BFR:   ⚠ 28d left  │
│  02 Feb  KLKR→KAVL    0:52  1    │  Med:   ✓ 8mo left  │
│  28 Jan  KAVL→KLKR    0:55  1    │                     │
│  25 Jan  KLKR→KCLT    1:10  1    │  Totals              │
│  ...                               │  This month: 6.2 hr │
│                                    │  Last 90d:  22.8 hr  │
│  [+ NEW ENTRY]  [EXPORT ▼]        │  Total:    482.5 hr  │
│   Savvy CSV / Raw CSV / ForeFlight │─────────────────────│
│  ▶ Tap entry for details + export  │ EGT▊▊▊▊ CHT▊▊▊▊    │
│                                    │ CARB 78°F  22g 2:41 │
├────────────────────────────────────┴─────────────────────┤
│  [ MAP ]  [ENGINE]  [ FUEL ]  [ WX ]  [ PLAN ]  [ LOG ] │
└──────────────────────────────────────────────────────────┘
```

### 7.3 Alerts & Notifications

Alerts overlay the current view with a non-blocking banner at top (below status bar):

| Severity   | Style                          | Duration        | Sound         | Examples                                           |
| ---------- | ------------------------------ | --------------- | ------------- | -------------------------------------------------- |
| **Red**    | Full-width red banner, pulsing | Until dismissed | 3 short tones | Low fuel (< 4 gal), sticky valve, oil pressure low |
| **Yellow** | Full-width amber banner        | Until dismissed | 1 tone        | Fuel caution (< 8 gal), CHT > 400°F, voltage low   |
| **Blue**   | Slim blue banner               | 10 seconds      | None          | New METAR available, FIS-B update, capture started |

Dismiss: single tap anywhere on the banner. Large 48px dismiss target.

### 7.4 Planning Mode Layouts

Planning Mode uses a light color scheme (see Section 5.7.4) with a step progress bar replacing the cockpit nav bar.

#### Planning Mode — Step 2 (Route)

```
┌──────────────────────────────────────────────────────────┐
│ PLANNING │ PA-28 N1234 │ KLKR → KLWA │ WX 14:30Z │MODE▼│
├──────────────────────────────────────────────────────────┤
│ [1 ✓]  [2 ROUTE]  [3]  [4]  [5]  [6]    [DASHBOARD ▤]  │
├────────────────────────────────────┬─────────────────────┤
│                                    │ ROUTE: KLKR → KLWA  │
│     Mini map showing route line    │                     │
│     (cached sectional tiles if     │ Via:                 │
│     available from Pi sync, or     │ [KLKR]               │
│     OpenStreetMap fallback)        │ └ V16 → [GSP]        │
│                                    │ └ V20 → [AVL]        │
│   KLKR ──── GSP ──── AVL ── KLWA │ └ DIR → [KLWA]       │
│                                    │                     │
│                                    │ [+ ADD WAYPOINT]     │
│                                    │ [AIRWAYS LOOKUP]     │
│                                    │─────────────────────│
│                                    │ Altitude: [8000▼] ft │
│                                    │ Winds @8000: 300/28  │
│                                    │ GS: 138 kt           │
│                                    │ Distance: 528 nm     │
│                                    │ ETE: 3:50            │
│                                    │ Fuel req: 31.0 gal   │
│                                    │ Reserve: 17.0 gal    │
│                                    │                     │
│                                    │ [OPT ALTITUDE]       │
│                                    │ [FUEL STOPS]         │
├────────────────────────────────────┴─────────────────────┤
│ [← AIRCRAFT]                           [WEATHER →]       │
└──────────────────────────────────────────────────────────┘
```

#### Planning Mode — Step 5 (AI Briefing)

```
┌──────────────────────────────────────────────────────────┐
│ PLANNING │ PA-28 N1234 │ KLKR → KLWA │ WX 14:30Z │MODE▼│
├──────────────────────────────────────────────────────────┤
│ [1 ✓]  [2 ✓]  [3 ✓]  [4 ✓]  [5 BRIEF]  [6]  [DASH ▤]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  SMART BRIEFING: KLKR → KLWA  528nm  ETE 3:50           │
│  Generated: 11 Feb 2026 14:30Z                           │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ AI COPILOT ANALYSIS                              │    │
│  │                                                  │    │
│  │ GO ✓ — Conditions are favorable.                 │    │
│  │                                                  │    │
│  │ VFR conditions along entire route. Ceilings at   │    │
│  │ KGSP are BKN025 but forecast to improve to       │    │
│  │ SCT040 by your ETA of 15:39Z. Winds favor 8000   │    │
│  │ ft (GS 138kt vs 125kt at 6000). One TFR near    │    │
│  │ KGSP — sporting event — active until 20:00Z,     │    │
│  │ 5nm radius. Your route passes 8nm south, no      │    │
│  │ deviation needed.                                │    │
│  │                                                  │    │
│  │ Significant NOTAMs:                              │    │
│  │ • KLKR: RWY 03/21 CLOSED (use 15/33)            │    │
│  │ • KLWA: PAPI RWY 28 OTS                         │    │
│  │ • 47 other NOTAMs reviewed — none operationally  │    │
│  │   significant for this flight.                   │    │
│  │                                                  │    │
│  │ AI analysis is advisory only.                    │    │
│  │ PIC retains all decision authority.              │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  WEATHER AT TIME OF PASSAGE:                             │
│  KLKR (dep 15:00Z)  VFR ● CLR  29.92" 270@8  10sm      │
│  KGSP (15:39Z ETA)  MVFR ● BKN025  29.88" 310@12       │
│  KAVL (16:06Z ETA)  VFR ● SCT040  29.90" 290@10        │
│  KLWA (18:50Z ETA)  VFR ● FEW050  29.85" 280@8         │
│                                                          │
│  [REGENERATE AI]  [FULL METAR/TAF]  [ALL NOTAMs]        │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ OFFICIAL BRIEFING (1800wxbrief)                  │    │
│  │                                                  │    │
│  │ ✓ Standard briefing obtained                     │    │
│  │ Confirmation: WB-2026-7654321                    │    │
│  │ Obtained: 11 Feb 2026 14:30Z                     │    │
│  │                                                  │    │
│  │ Synopsis: High pressure over SE US. VFR conds    │    │
│  │ prevail. Weak cold front approaching from W,     │    │
│  │ expected to reach route area after 00Z.           │    │
│  │                                                  │    │
│  │ [VIEW FULL BRIEFING]                             │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ [← W&B]                                   [READY →]     │
└──────────────────────────────────────────────────────────┘
```

#### Planning Mode — Step 6 (Ready / File / Upload)

```
┌──────────────────────────────────────────────────────────┐
│ PLANNING │ PA-28 N1234 │ KLKR → KLWA │ WX 14:30Z │MODE▼│
├──────────────────────────────────────────────────────────┤
│ [1 ✓]  [2 ✓]  [3 ✓]  [4 ✓]  [5 ✓]  [6 READY]  [DASH]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  FLIGHT PLAN PACKAGE READY                               │
│                                                          │
│  Route:      KLKR V16 GSP V20 AVL DIR KLWA   528nm      │
│  Altitude:   8000 ft (wind-optimized)                    │
│  ETE:        3:50                                        │
│  Aircraft:   PA-28-180 Cherokee N1234                    │
│                                                          │
│  W&B:        ✓ Normal category (2070 lb / CG 90.9")     │
│  Fuel:       ✓ 48 gal loaded / 31.0 required / 17.0 res │
│  Weather:    ✓ VFR all stations (fetched 14:30Z)        │
│  Briefing:   ✓ Official WB-2026-7654321                  │
│  AI Go/NoGo: ✓ GO recommended                           │
│  NOTAMs:     ⚠ 2 operationally significant              │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ FILE FLIGHT PLAN (1800wxbrief)                   │    │
│  │                                                  │    │
│  │ Flight rules:  [VFR]  [IFR]                      │    │
│  │ Departure:     KLKR  [15:00Z ▼]                  │    │
│  │ Destination:   KLWA   ETE: 3:50                  │    │
│  │ Alternate:     [____]  (required for IFR)        │    │
│  │ Equipment:     [/G ▼]  (GPS)                     │    │
│  │ People on board: [3]                             │    │
│  │ Remarks:       [________________________]        │    │
│  │                                                  │    │
│  │ Pilot: Dana Nickerson  (from settings)           │    │
│  │ Phone: 555-0123                                  │    │
│  │                                                  │    │
│  │ [FILE FLIGHT PLAN]                               │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │                                                  │    │
│  │  Pi not detected — connect to Stratux WiFi       │    │
│  │  to upload flight plan to PilotStation.           │    │
│  │                                                  │    │
│  │  Package saved locally. Will auto-upload when     │    │
│  │  Pi is detected.                                  │    │
│  │                                                  │    │
│  │  [UPLOAD TO PILOTSTATION]  ← grayed out           │    │
│  │                                                  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  [PRINT NAV LOG]  [SHARE PLAN]  [NEW PLAN]              │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ [← BRIEFING]                                            │
└──────────────────────────────────────────────────────────┘
```

**When Pi detected (Stratux WiFi connected):**

```
│  ┌──────────────────────────────────────────────────┐    │
│  │                                                  │    │
│  │  ✓ Pi detected on 192.168.10.1                   │    │
│  │                                                  │    │
│  │  [████████████████████████  100%]                │    │
│  │  Flight plan uploaded successfully.              │    │
│  │                                                  │    │
│  │  Weather cache: 14:30Z (32 min ago)              │    │
│  │  Flight plan active on PilotStation.             │    │
│  │                                                  │    │
│  │  [SWITCH TO COCKPIT MODE]                        │    │
│  │                                                  │    │
│  └──────────────────────────────────────────────────┘    │
```

**After flight plan filed (replaces filing panel):**

```
│  ┌──────────────────────────────────────────────────┐    │
│  │ FLIGHT PLAN FILED                                │    │
│  │                                                  │    │
│  │ ✓ VFR flight plan filed via 1800wxbrief          │    │
│  │ ID: FP-2026-1234567                              │    │
│  │ Filed: 11 Feb 2026 14:35Z                        │    │
│  │                                                  │    │
│  │ KLKR → KLWA  dep 15:00Z  ETE 3:50               │    │
│  │                                                  │    │
│  │ Remember to ACTIVATE before departure:           │    │
│  │ Call FSS on 122.2 or contact ground.             │    │
│  │                                                  │    │
│  │ [AMEND]  [CANCEL]                                │    │
│  └──────────────────────────────────────────────────┘    │
```

#### Cockpit Mode — Filed Flight Plan Reminders

**After engine start detection (VFR activation reminder):**

```
┌──────────────────────────────────────────────────────────┐
│ ✈ N1234  │ 12:34Z │ GS:0kt  │ ALT:748  │ FUEL:48g 5:51 │
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐ │
│ │ VFR FLIGHT PLAN — ACTIVATE NOW                       │ │
│ │ KLKR → KLWA  dep 15:00Z  ETE 3:50                   │ │
│ │ Call FSS 122.2 or contact ground to activate.        │ │
│ │                                                [OK]  │ │
│ └──────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│  PLAN: VFR Plan Filed — KLKR→KLWA — Activate via 122.2  │
├──────────────────────────────────────────────────────────┤
│  [ MAP ]  [ENGINE]  [ FUEL ]  [ WX ]  [ PLAN ]  [ LOG ] │
└──────────────────────────────────────────────────────────┘
```

**After landing detection (VFR close reminder):**

```
┌──────────────────────────────────────────────────────────┐
│ ✈ N1234  │ 18:54Z │ GS:0kt  │ ALT:890  │ FUEL:17g 2:04 │
├──────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐      │
│ │ ⚠ CLOSE YOUR VFR FLIGHT PLAN                   │      │
│ │                                                 │      │
│ │ ETA was 18:50Z — close within 30 minutes        │      │
│ │ to avoid search & rescue activation.            │      │
│ │                                                 │      │
│ │ Call FSS: 122.2                                 │      │
│ │                                                 │      │
│ │ [ALREADY CLOSED]           Time left: 26:00     │      │
│ └─────────────────────────────────────────────────┘      │
├──────────────────────────────────────────────────────────┤
│  [ MAP ]  [ENGINE]  [ FUEL ]  [ WX ]  [ PLAN ]  [ LOG ] │
└──────────────────────────────────────────────────────────┘
```

---

## 8. Data Storage

### 8.1 Database Schema (SQLite)

```sql
-- Flight log
CREATE TABLE flights (
    id INTEGER PRIMARY KEY,
    aircraft_id TEXT NOT NULL,             -- References aircraft profile id (e.g., 'pa28-cherokee')
    date TEXT NOT NULL,                    -- YYYY-MM-DD
    departure_icao TEXT,
    destination_icao TEXT,
    route TEXT,                            -- JSON array of waypoints
    departure_time_z TEXT,                 -- HH:MM Zulu
    arrival_time_z TEXT,
    duration_minutes REAL,
    landings_day INTEGER DEFAULT 0,
    landings_night INTEGER DEFAULT 0,
    instrument_time REAL DEFAULT 0,
    approaches INTEGER DEFAULT 0,
    holds INTEGER DEFAULT 0,
    fuel_start REAL,
    fuel_end REAL,
    fuel_used REAL,
    max_altitude INTEGER,
    distance_nm REAL,
    avg_power_pct REAL,
    hobbs_start REAL,
    hobbs_end REAL,
    tach_start REAL,
    tach_end REAL,
    remarks TEXT,
    track_file TEXT,                       -- Path to GPS track KML/CSV
    engine_file TEXT,                      -- Path to engine data CSV
    savvy_file TEXT,                       -- Path to Savvy-compatible CSV export
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Fuel transactions
CREATE TABLE fuel_log (
    id INTEGER PRIMARY KEY,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,                    -- 'addition', 'set', 'flight_start', 'flight_end'
    gallons REAL,
    airport_icao TEXT,
    price_per_gallon REAL,
    notes TEXT
);

-- Currency tracking
CREATE TABLE currency (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,                    -- 'day_landing', 'night_landing', 'ifr', 'bfr', 'medical'
    expiry_date TEXT NOT NULL,
    notes TEXT
);

-- Favorite airports and routes
CREATE TABLE favorites (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,                    -- 'airport', 'route'
    identifier TEXT NOT NULL,
    data TEXT                              -- JSON for route details
);
```

### 8.2 File Storage (Overlay-Aware Layout)

PilotStation data is split across four storage tiers to work with Stratux's overlayfs (see Section 5.6).

**Tier 1 — Boot Partition (always writable, survives power loss):**

```
/boot/firmware/pilotstation/
├── pilotstation.conf              # Main settings + preferences (JSON)
├── active_fuel_state.json         # Current fuel quantities (written every 60s in flight)
└── aircraft/
    ├── pa28-cherokee.json         # Aircraft W&B, engine, fuel config
    └── rv9a.json
```

**Tier 2 — Base Filesystem (written via overlayctl unlock/lock, survives reboot):**

```
/home/pi/pilotstation/data/        ← accessed via /overlay/robase/ when writing
├── pilotstation.db                # SQLite database (WAL mode)
├── flights/                       # Engine CSVs, GPS tracks, and Savvy exports per flight
│   ├── 2026-02-11_KLKR-KCLT.csv
│   ├── 2026-02-11_KLKR-KCLT_savvy.csv
│   └── 2026-02-11_KLKR-KCLT.kml
└── wb_scenarios/                  # Saved W&B loading scenarios
    └── pa28-cherokee_standard.json
```

**Tier 3 — Volatile (tmpfs overlay, lost on reboot, rebuilt from live data):**

```
/home/pi/pilotstation/cache/       ← in tmpfs overlay, no persistence
├── weather_cache.json             # Pre-cached weather (pushed from iPad)
└── session_state.json             # Active WebSocket/session state
```

**Tier 4 — Read-Only Base (app code + pre-loaded data, updated via data pipeline):**

```
/home/pi/pilotstation/             ← base filesystem, read-only during normal ops
├── app/
│   ├── main.py                    # FastAPI application entry point
│   ├── engine_monitor.py          # Refactored from capture_v5 (backend only)
│   ├── fuel_tracker.py            # Fuel management logic
│   ├── weather_service.py         # FIS-B weather + cached weather manager
│   ├── gdl90_listener.py          # Stratux GDL90 UDP listener
│   ├── logbook.py                 # Flight log auto-detection and storage
│   ├── flight_planner.py          # Route planning and calculations
│   └── overlay_storage.py         # Tier-aware read/write abstraction (see 5.6)
├── web/
│   ├── index.html                 # PilotStation PWA shell (both modes)
│   ├── app.js                     # Mode detection, view switching, layout
│   ├── mode-detector.js           # Network probing, mode state machine (see 5.7.1)
│   ├── cockpit/                   # Cockpit Mode views (Stratux WiFi)
│   │   ├── map.js                 # Leaflet.js map view
│   │   ├── engine.js              # Engine monitor view
│   │   ├── fuel.js                # Fuel management view
│   │   ├── weather.js             # Weather briefing + profile view
│   │   ├── planner.js             # Flight planning view (cockpit-side)
│   │   ├── logbook.js             # Logbook view
│   │   ├── plates.js              # Approach plate viewer
│   │   └── admin.js               # Data manager / update UI
│   ├── planning/                  # Planning Mode views (home/FBO WiFi)
│   │   ├── workflow.js            # 6-step guided flow controller
│   │   ├── aircraft-step.js       # Step 1: Aircraft selection + loading
│   │   ├── route-step.js          # Step 2: Route entry + optimization
│   │   ├── weather-step.js        # Step 3: Weather fetch + display
│   │   ├── wb-step.js             # Step 4: Weight & balance
│   │   ├── briefing-step.js       # Step 5: Smart briefing + AI analysis
│   │   ├── ready-step.js          # Step 6: Package assembly + upload
│   │   ├── dashboard.js           # Dashboard view (all panels, P2)
│   │   └── planning.css           # Planning Mode light theme overrides
│   ├── shared/                    # Shared utilities (both modes)
│   │   ├── nasr-db.js             # IndexedDB NASR data access
│   │   ├── sync-manager.js        # Flight plan package sync
│   │   ├── weather-client.js      # Weather API client (proxy or direct)
│   │   ├── ai-client.js           # Claude API client via Cloudflare Worker
│   │   ├── wb-calculator.js       # W&B calculation engine (client-side)
│   │   ├── flight-plan-model.js   # Flight plan data model
│   │   └── flight-plan-filer.js   # 1800wxbrief filing + briefing client
│   ├── style.css                  # Shared design system (cockpit + planning tokens)
│   ├── manifest.json              # PWA manifest (updated for dual-mode)
│   ├── service-worker.js          # Dual-mode service worker (mode-aware caching)
│   └── lib/
│       ├── leaflet.min.js         # Map library
│       ├── chart.min.js           # Charting library (existing)
│       └── pdf.min.js             # PDF.js for approach plate rendering
├── tiles/
│   ├── cycle_info.json            # Chart tile cycle date, expiration
│   ├── sectional/{z}/{x}/{y}.webp # FAA Sectional chart tiles
│   ├── ifr-low/{z}/{x}/{y}.webp   # FAA IFR Low Enroute tiles
│   ├── ifr-high/{z}/{x}/{y}.webp  # FAA IFR High Enroute tiles
│   └── tac/{z}/{x}/{y}.webp       # FAA Terminal Area chart tiles
├── plates/
│   ├── cycle_info.json            # d-TPP cycle date, effective/expiry dates
│   ├── plate_index.json           # Airport → procedure → filename lookup
│   ├── plate_geo_index.json       # Geo bounds for each plate (GDAL-extracted)
│   ├── KCLT/                      # Plates by airport ICAO
│   │   ├── ILS-RWY-18C.pdf
│   │   ├── ILS-RWY-18C.png
│   │   ├── RNAV-GPS-RWY-18C.pdf
│   │   ├── RNAV-GPS-RWY-18C.png
│   │   └── APD.pdf
│   └── .../                       # ~3-5 GB full US (PDF + PNG) or subset
├── data/
│   ├── airports.geojson           # FAA NASR airport data (28-day cycle)
│   ├── airspace.geojson           # FAA NASR airspace boundaries
│   ├── nasr_cycle_info.json       # NASR cycle date, expiration
│   └── terrain/                   # SRTM elevation data (for profile view)
├── config/
│   └── nginx.conf                 # Nginx site configuration
└── logs/
    └── pilotstation.log           # Application log (volatile — in overlay)
```

**Read path abstraction:** The backend reads config from Tier 1 (`/boot/firmware/pilotstation/`), persistent data from Tier 2 (visible through the overlay), and static data from Tier 4 (visible through the overlay). The `overlay_storage.py` module provides a unified interface that routes reads and writes to the correct tier transparently.

**Cloudflare Worker (separate deployment — see Section 5.8):**

```
pilotstation-worker/
├── wrangler.toml              # Cloudflare config (account ID, project name, routes)
└── src/
    └── index.js               # ~150 lines: route requests, add CORS, proxy to APIs
```

Deployed to `pilotstation-api.<your-domain>.workers.dev`. Updated independently of the Pi-side PilotStation code.

---

## 9. API Design

Unified REST API on `localhost:8080`, superseding the current engine_monitor.py endpoints. All existing endpoints remain backward-compatible.

### New/Modified Endpoints

| Method    | Path                                            | Description                                       |
| --------- | ----------------------------------------------- | ------------------------------------------------- |
| GET       | `/api/status`                                   | Unified status (engine + fuel + GPS + traffic)    |
| GET       | `/api/engine/status`                            | Engine data (replaces current `/api/status`)      |
| GET       | `/api/engine/history?minutes=N`                 | Engine history                                    |
| GET       | `/api/engine/presets`                           | List display presets (Cruise, Leaning, Full)      |
| PUT       | `/api/engine/presets/{name}`                    | Update/create display preset configuration        |
| GET       | `/api/fuel/status`                              | Fuel state, warnings, endurance                   |
| GET       | `/api/fuel/history`                             | Fuel additions and flight history                 |
| POST      | `/api/fuel/set`                                 | Set fuel quantity                                 |
| POST      | `/api/fuel/add`                                 | Log fuel addition                                 |
| GET       | `/api/weather/metar?icao=KLKR`                  | Fetch METAR                                       |
| GET       | `/api/weather/taf?icao=KLKR`                    | Fetch TAF                                         |
| GET       | `/api/weather/profile?route=KLKR-KCLT&alt=6000` | Profile view data                                 |
| GET       | `/api/weather/brief?route=KLKR-KCLT`            | Full weather briefing                             |
| GET       | `/api/airport/{icao}`                           | Full airport info (elev, TPA, rwys, freqs, fuel)  |
| GET       | `/api/airport/nearby?lat=X&lon=Y&radius=25`     | Airports within radius (nm) with summary data     |
| GET       | `/api/position`                                 | Current GPS position, altitude, ground speed      |
| GET       | `/api/traffic`                                  | ADS-B traffic targets                             |
| GET       | `/api/logbook`                                  | Flight log entries                                |
| POST      | `/api/logbook`                                  | Create/update flight log entry                    |
| GET       | `/api/logbook/currency`                         | Currency status                                   |
| GET       | `/api/logbook/{id}/export/savvy`                | Download Savvy-compatible CSV for a flight        |
| GET       | `/api/logbook/{id}/export/csv`                  | Download raw merged engine+GPS CSV for a flight   |
| POST      | `/api/plan/route`                               | Create/update flight plan                         |
| GET       | `/api/plan/route`                               | Current flight plan with calculations             |
| GET       | `/api/plan/optimal-alt?route=KLKR-KLWA`         | Optimal altitude recommendation using winds aloft |
| GET       | `/api/plan/fuel-stops?route=KLKR-KLWA&fuel=22`  | Fuel stop candidates with prices and detour info  |
| GET       | `/api/airways/{name}`                           | Airway fixes and coordinates (e.g., V16)          |
| GET       | `/api/fuel-prices?icao=KAND,KGSP`               | 100LL prices for specified airports               |
| GET       | `/api/aircraft`                                 | List all stored aircraft profiles                 |
| GET       | `/api/aircraft/{id}`                            | Get aircraft profile (W&B, engine, fuel config)   |
| PUT       | `/api/aircraft/{id}`                            | Create/update aircraft profile                    |
| DELETE    | `/api/aircraft/{id}`                            | Delete aircraft profile                           |
| PUT       | `/api/aircraft/{id}/active`                     | Set as active aircraft                            |
| POST      | `/api/wb/calculate`                             | Calculate W&B from loading (returns CG, moments)  |
| GET       | `/api/wb/scenarios?aircraft={id}`               | List saved loading scenarios for an aircraft      |
| POST      | `/api/wb/scenarios`                             | Save a loading scenario                           |
| GET       | `/api/plan/sync-status`                         | Last synced flight plan package timestamp + hash  |
| POST      | `/api/plan/upload-package`                      | Receive flight plan package from Planning Mode    |
| GET       | `/api/plan/active-package`                      | Return currently active flight plan package       |
| GET       | `/api/nasr/export`                              | Compressed NASR bundle for Planning Mode cache (~15 MB) |
| GET       | `/api/nasr/cycle-info`                          | Current NASR cycle effective/expiration dates      |
| WebSocket | `/ws/live`                                      | Real-time stream (engine + GPS + traffic + fuel)  |

The WebSocket endpoint replaces polling for the UI — pushes updates at 1Hz for engine data and 5Hz for GPS/traffic.

### Cloudflare Worker Endpoints (Planning Mode)

These endpoints run on `pilotstation-api.<your-domain>.workers.dev` and are only used in Planning Mode (see Section 5.8).

| Method | Path                      | Proxies to                               | Purpose                    |
| ------ | ------------------------- | ---------------------------------------- | -------------------------- |
| POST   | `/claude`                 | `api.anthropic.com/v1/messages`          | AI copilot (Claude API)    |
| GET    | `/wx/metar?ids=...`       | `aviationweather.gov/api/data/metar`     | METARs                     |
| GET    | `/wx/taf?ids=...`         | `aviationweather.gov/api/data/taf`       | TAFs                       |
| GET    | `/wx/pirep?...`           | `aviationweather.gov/api/data/pirep`     | PIREPs                     |
| GET    | `/wx/airsigmet?...`       | `aviationweather.gov/api/data/airsigmet` | SIGMETs/AIRMETs            |
| GET    | `/wx/windtemp?...`        | `aviationweather.gov/api/data/windtemp`  | Winds aloft                |
| GET    | `/wx/notam?...`           | `notams.aim.faa.gov/notamSearch`         | NOTAMs                     |
| GET    | `/fuel-prices?icao=...`   | `aviation-fuel-prices.com` API           | 100LL/Jet-A prices         |
| POST   | `/fp/file`                | `lmfsweb.afss.com/Website/FP/file`       | File flight plan           |
| POST   | `/fp/{id}/amend`          | `lmfsweb.afss.com/Website/FP/{id}/amend` | Amend filed flight plan    |
| POST   | `/fp/{id}/cancel`         | `lmfsweb.afss.com/Website/FP/{id}/cancel`| Cancel filed flight plan   |
| POST   | `/fp/{id}/close`          | `lmfsweb.afss.com/Website/FP/{id}/close` | Close flight plan          |
| POST   | `/briefing`               | `lmfsweb.afss.com/Website/briefing`      | Official weather briefing  |
| GET    | `/health`                 | Returns `{ "status": "ok" }`             | Mode detection probe       |

---

## 10. Implementation Phases

### Phase 1: Foundation (MVP)

**Goal:** Replace ForeFlight for basic VFR/IFR flight with engine monitoring, approach plates, and core weather

**1a. Data pipeline setup (desktop, one-time):**

- Set up aviationCharts pipeline to process FAA GeoTIFFs into WEBP tiles
- Process Sectional, IFR Low, TAC charts for operating area (or full CONUS)
- Download and repackage FAA d-TPP approach plates
- Download FAA NASR airport/airspace data, convert to GeoJSON
- Create packaging scripts for easy 28/56-day updates
- Transfer initial data to Pi via USB drive

**1b. Pi 5 server setup:**

- Install Nginx alongside Stratux, configure to serve chart tiles, plates, and proxy to FastAPI
- **Overlay-aware storage setup** (see Section 5.6):
  - Create `/boot/firmware/pilotstation/` directory and `aircraft/` subdirectory on boot partition
  - Initialize `pilotstation.conf` with default preferences
  - Create `overlay_storage.py` tier-aware read/write abstraction
  - Configure SQLite with WAL journal mode for safe writes during overlayctl unlock windows
- Integrate engine_monitor.py v3.3.0 and fuel planner into unified FastAPI backend
- Stratux GDL90 listener for traffic and FIS-B weather on localhost
- WebSocket endpoint for real-time data push to iPad
- Data Update Manager — upload endpoints for tiles, plates, NASR, weather cache
- USB drive detection for data updates
- PilotStation auto-start on boot alongside Stratux

**1c. iPad web UI:**

- Build the shell UI: status bar, nav bar, right panel, primary view area
- MAP view: Leaflet.js rendering FAA chart tiles with ownship position, traffic overlay
- MAP view weather: flight category dots on airports, tap for METAR popup, NEXRAD radar overlay, weather data age indicators (WX-01 through WX-05)
- TFR boundaries on map with tap for details (WX-08)
- FIS-B weather integration: connect to Stratux weather WebSocket, maintain in-memory weather database, METAR/TAF parsing (WX-10 through WX-14)
- ENGINE view: port existing dashboard into new UI framework with cockpit-sized touch targets
- FUEL view: port existing fuel planner into new UI framework
- PLATES view: approach plate browser with PDF.js rendering, airport search, pinch-to-zoom
- ADMIN view: Data Manager showing data currency, upload interface, disk usage
- Data expiration warnings on startup (expired charts, plates, NASR)
- PWA manifest and service worker for add-to-home-screen + offline UI caching
- Implement day/night theme switching
- Test in Safari on iPad over Stratux WiFi

**1d. Dual-Mode PWA Foundation (replaces Companion page):**

- **Mode detection** (MODE-01 through MODE-06): network probe state machine, manual override in status bar, mode persistence in localStorage
- **Service worker rewrite**: dual-mode caching strategy — route API calls to Pi (Cockpit) or Cloudflare Worker (Planning) based on mode
- **IndexedDB schema**: structured storage for NASR cache, weather cache, flight plan packages, W&B scenarios, fuel prices
- **NASR data sync** (SYNC-05): download NASR bundle from Pi (`GET /api/nasr/export`) to IndexedDB when on Stratux WiFi
- **Planning Mode shell UI**: step progress bar, planning nav bar, light theme CSS tokens
- **Step 1 (Aircraft)**: aircraft selection from synced profiles, passenger/baggage/fuel entry
- **Step 2 (Route)**: departure/waypoint/destination entry using NASR cache, airway lookup, distance/heading/time calculations, optimal altitude recommendation
- **Step 3 (Weather)**: fetch METARs, TAFs, winds aloft, PIREPs, NOTAMs, TFRs via Cloudflare Worker proxy; display weather summary (non-AI)
- **Step 4 (W&B)**: client-side W&B calculation using `wb-calculator.js` from Step 1 inputs, basic CG envelope diagram (lightweight version — full WB-01 through WB-10 cockpit-side module ships in Phase 2)
- **Step 5 (Briefing)**: smart weather briefing with weather at time of passage (non-AI version — AI added in Phase 2); official 1800wxbrief standard briefing with confirmation number (WX-36, FILE-10, FILE-11, PLAN-16)
- **Step 6 (Ready)**: flight plan package assembly, summary checklist, flight plan filing via 1800wxbrief (FILE-04 through FILE-08, PLAN-17, PLAN-18), upload to Pi (SYNC-01 through SYNC-04)
- **Cloudflare Worker deployment**: weather-only proxy routes (`/wx/*`, `/fuel-prices`, `/health`), 1800wxbrief routes (`/fp/*`, `/briefing`), rate limiting — `/claude` route added in Phase 2
- **1800wxbrief integration** (see Section 6.13): vendor registration (FILE-01), Worker secrets for vendor credentials (FILE-02), pilot info settings (FILE-03)
- **Pilot info settings**: name, phone, address, 1800wxbrief username in `pilotstation.conf`
- **Pi-side sync endpoints**: `upload-package`, `sync-status`, `active-package`, `nasr/export`
- Auto-save workflow progress to IndexedDB; resume on PWA reopen (PLAN-03)

**Deliverable:** iPad opens `http://192.168.10.1` in Safari and shows a unified moving map with engine/fuel data (Cockpit Mode). When the iPad is on home WiFi, the same PWA auto-enters Planning Mode with a 6-step pre-flight workflow. Flight plan packages sync to the Pi when the iPad connects to Stratux WiFi. Data updates flow from iPad to Pi. Pi runs headless alongside Stratux.

### Phase 2: Advanced Planning & AI

**Goal:** Add AI copilot, advanced weather (profile view, smart briefing), and complete the planning workflow with W&B and fuel stop optimization

**AI copilot integration (see Section 6.12):**
- Deploy Cloudflare Worker `/claude` route with API key secret (AI-01, AI-02, AI-03)
- Weather analysis: plain-English decode of METARs/TAFs/PIREPs (AI-04)
- Go/No-Go reasoning against personal minimums (AI-05)
- NOTAM filtering: identify operationally significant NOTAMs (AI-06)
- Alternate airport selection (AI-08)
- Advisory disclaimer on all AI output (AI-10)
- Graceful degradation when offline (AI-11)
- Personal minimums configuration in aircraft profiles (AI-12)
- Upgrade Planning Mode Step 5 (Briefing) with AI-powered analysis

**Advanced weather (cockpit-side):**
- Profile/cross-section view (terrain + airspace + clouds + icing) (WX-20 through WX-28)
- Winds aloft integration and display
- SIGMET/AIRMET boundary overlays on map (WX-06)
- PIREP display on map (WX-07)
- Smart Briefing: condensed summary with weather at time of passage (WX-30 through WX-35)

**Planning workflow completion:**
- Weight & balance calculator: full Pi-side implementation (WB-01 through WB-10) — cockpit-side W&B view, real-time fuel weight CG shift (WB-06), saved scenarios API, PDF export. Phase 1d provides client-side calculation only; Phase 2 adds the complete cockpit module
- Fuel stop planning with live price comparison (FLT-08, FLT-09, FLT-10) — requires internet, fits Planning Mode
- Route optimization suggestions (AI-07)
- Dashboard view for experienced pilots (PLAN-02)

**Deliverable:** Planning Mode with full AI copilot — weather analysis, go/no-go, NOTAM filtering, W&B, fuel stops. WX view with profile cross-section. Smart Briefing with AI-powered summaries.

### Phase 3: Flight Planning (Cockpit-Side) & Logbook

**Goal:** Close the in-flight planning and post-flight logging loop

- Route entry with waypoints and airway segments in Cockpit Mode (FLT-01, FLT-02, FLT-03)
- Distance, heading, and time-enroute per leg (FLT-04)
- Optimal altitude selection using winds aloft (FLT-05, FLT-06)
- Fuel required per leg and total from burn rate profiles (FLT-07)
- Display planned route on moving map with airway segments (FLT-12)
- Integration with profile view and Smart Briefing (FLT-14, FLT-15)
- Auto-detecting flight start/end for logbook (LOG-01)
- Logbook with currency tracking (LOG-02 through LOG-05)
- Track recording and post-flight summary (LOG-09, LOG-10)
- CSV, ForeFlight-compatible logbook export, and Savvy Aviation CSV export (ENG-17, LOG-07)
- NAV log export — printable format (FLT-13)
- Filed flight plan status in Cockpit Mode PLAN view (FILE-12)
- VFR activation reminder after engine start detection (FILE-09)
- VFR/IFR close reminder after landing detection with ETA countdown (FILE-09)
- API close when pilot returns to internet WiFi with unclosed plan (FILE-08)

**Deliverable:** Complete workflow from pre-flight planning (Planning Mode) → flight plan filing → in-flight tracking with route overlay and filed plan reminders → post-flight auto-logging with close reminder, currency tracking, and Savvy export.

### Phase 4: Polish & Integration

**Goal:** Refinement and hardware integration

- Garmin GPS 175 Bluetooth investigation/integration
- Synthetic vision (terrain rendering from SRTM data)
- Alert sound system (piezo buzzer or audio out on Pi 5)
- Over-the-air update mechanism
- Performance optimization for smooth 30fps map rendering
- Extensive flight testing and UI iteration

---

## 11. Technical Constraints & Risks

| Risk                                   | Impact                                          | Mitigation                                                                                                                          |
| -------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Garmin Connext protocol is proprietary | Cannot transfer flight plans to GPS 175         | Use Stratux GPS for position; manual entry for flight plans; defer to Phase 4                                                       |
| iPad WiFi = no internet in flight      | Cannot fetch live weather updates in flight     | Pre-cache weather on ground; FIS-B via Stratux provides in-flight METARs/NEXRAD; future: USB cellular dongle on Pi for dual-network |
| Chart tile generation complexity       | 56-day update cycle requires desktop processing | Automate with shell script using aviationCharts; store processed tiles in git/cloud for easy Pi transfer                            |
| Leaflet.js performance in Safari       | Large tile sets could lag on older iPads        | Use WEBP compression, limit zoom range (5-11), test tile sizes (256 vs 512px); Safari handles Leaflet well on modern iPads          |
| Cockpit heat (summer)                  | Pi throttling                                   | Pi is headless (lower power than w/ display), active cooling case, thermal monitoring                                               |
| Power reliability                      | Reboot during flight                            | Graceful state persistence (save state every 60s, resume on boot); iPad continues showing last cached state via PWA                 |
| Stratux WiFi range                     | iPad loses connection if Pi is in baggage area  | Pi mounts near panel (same as current Stratux location); WiFi signal is short-range by design                                       |
| FAA regulatory                         | EFB certification questions                     | Advisory use only — pilot remains responsible for current charts per AC 91-78A                                                      |
| Expired chart/plate data               | Flying with outdated procedures                 | Startup warning if any data expired; Data Manager shows days remaining; 28/56-day reminders; pilot responsibility per AC 91-78A     |
| Single point of failure                | Pi failure = no engine/fuel/map data            | iPad retains paper chart capability; Garmin GPS 175 remains primary IFR navigation; engine gauges on panel remain functional        |
| Cloudflare Worker outage               | No weather fetch or AI in Planning Mode         | Planning Mode degrades gracefully — shows "service unavailable, try again"; cached data in IndexedDB still available                |
| Claude API cost creep                  | Unexpected API charges                          | Rate limiting in Worker (20 req/min); bounded max_tokens (4096); Haiku model for routine tasks (~$0.05/session); monthly budget alert |
| Safari IndexedDB eviction              | Cached NASR/weather data lost                   | PWA installed to home screen gets persistent storage; re-sync from Pi on next Stratux WiFi connection; prompt user to re-fetch       |
| AI hallucination in Go/No-Go           | Incorrect weather analysis could influence decision | Mandatory advisory disclaimer (AI-10); raw METARs/TAFs always displayed alongside AI summary; PIC retains decision authority        |
| Mode detection false positive          | PWA enters wrong mode on captive portal WiFi    | Manual mode override in status bar (MODE-04); 30s re-probe interval auto-corrects; IP heuristic as fast fallback                    |
| 1800wxbrief API changes/deprecation   | Flight plan filing or briefing stops working     | Filing can always fall back to phone/radio (1-800-WX-BRIEF or FSS 122.2); briefing available via web at 1800wxbrief.com            |
| Leidos vendor credential revocation   | API access lost                                  | Re-apply for vendor access; phone/web fallback always available; workflow works without filing (filing is optional action)           |
| Unfiled/unclosed VFR flight plan       | SAR activation if pilot forgets to close plan    | Prominent close reminder with ETA countdown timer after landing detection; API close when internet returns; reminder persists until dismissed |

---

## 12. Success Criteria

| Metric                                 | Target                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------- |
| Pi boot to serving UI                  | < 45 seconds (Stratux + PilotStation startup)                              |
| iPad page load (cached PWA)            | < 3 seconds over Stratux WiFi                                              |
| Chart tile rendering                   | Smooth pan/zoom at 30fps in Safari                                         |
| Engine data update latency             | < 500ms from EDM to iPad screen                                            |
| Any function accessible                | ≤ 2 taps from any view                                                     |
| Touch target accuracy in turbulence    | > 95% correct tap rate on iPad                                             |
| Continuous operation in summer cockpit | 4+ hours without Pi thermal throttle                                       |
| Weather data freshness                 | < 5 minutes for METARs when internet available; FIS-B supplement in flight |
| Flight log auto-detection accuracy     | > 90% correct departure/arrival                                            |
| Fuel tracking accuracy vs. manual      | Within 1 gallon over 3-hour flight                                         |
| Chart tile update cycle                | < 30 minutes to process and deploy new 56-day cycle                        |
| Planning Mode: mode detection          | < 3 seconds from PWA load to correct mode activation                       |
| Planning Mode: weather fetch           | < 5 seconds for full route weather via Cloudflare Worker                   |
| Planning Mode: AI briefing generation  | < 10 seconds for complete Claude analysis (weather + go/no-go + NOTAMs)    |
| Planning Mode: flight plan upload      | < 5 seconds to upload package to Pi over Stratux WiFi                      |
| Planning Mode: full workflow           | < 10 minutes from opening PWA to "Ready" step with all data               |
| Planning Mode: flight plan filing      | < 5 seconds to file VFR/IFR plan via Cloudflare Worker → 1800wxbrief      |
| Planning Mode: official briefing       | < 8 seconds to obtain standard briefing with confirmation number           |
| Cockpit Mode: close reminder           | Close reminder appears within 30 seconds of landing detection              |

---

## 13. Non-Goals (Explicit Exclusions)

- **FAA certification** — This is an advisory/supplemental tool, not a certified EFB
- **Commercial distribution** — Personal use project
- **Fleet management** — Supports multiple stored aircraft profiles for W&B and engine config, but not multi-aircraft tracking or fleet dispatch
- **Native iOS app** — Web/PWA only; no Xcode, no App Store, no Apple developer account needed
- **Synthetic vision** — Defer to Phase 4+ at earliest
- **ADS-B Out** — Stratux is receive-only; ADS-B Out handled by panel transponder
- **Voice control** — Cockpit noise makes voice unreliable
- **Cellular connectivity in flight** — WiFi/internet is pre-flight only; in-flight data comes from ADS-B/FIS-B
- **Replacing the Garmin GPS 175** — GPS 175 remains the primary IFR navigator; PilotStation is supplemental situational awareness

---

## 14. Dependencies

| Dependency                  | Source                             | License             | Role                                                   |
| --------------------------- | ---------------------------------- | ------------------- | ------------------------------------------------------ |
| Stratux                     | github.com/stratux/stratux         | Open source (GPLv3) | ADS-B reception, WiFi hotspot, GPS                     |
| Engine Monitor v3.3.0       | Local (capture_v5/)                | Personal            | Engine data, fuel tracking (refactored into FastAPI)   |
| Leaflet.js                  | leafletjs.com                      | BSD-2               | Map rendering in Safari on iPad                        |
| Chart.js                    | chartjs.org                        | MIT                 | Engine/fuel graphs (already bundled)                   |
| FastAPI                     | fastapi.tiangolo.com               | MIT                 | Python API backend                                     |
| Uvicorn                     | uvicorn.org                        | BSD-3               | ASGI server for FastAPI + WebSocket                    |
| PDF.js                      | mozilla.github.io/pdf.js           | Apache 2.0          | Approach plate PDF rendering in Safari                 |
| Nginx                       | nginx.org                          | BSD-2               | Static tile server + reverse proxy                     |
| SQLite                      | sqlite.org                         | Public domain       | Logbook, fuel log, favorites                           |
| GDAL                        | gdal.org                           | MIT/X               | Chart tiles + plate geo-extraction (desktop only)      |
| aviationCharts              | github.com/jlmcgraw/aviationCharts | Open source         | Automated tile pipeline (desktop only)                 |
| arinc424 (Python)           | github.com/jack-laverty/arinc424   | Open source         | CIFP parser for fix/procedure coordinates              |
| FAA chart data (GeoTIFF)    | faa.gov/aeronav                    | Public domain       | Sectional, IFR, TAC charts                             |
| FAA d-TPP (geospatial PDFs) | faa.gov/aeronav                    | Public domain       | Geo-referenced approach plates, SIDs, STARs, diagrams  |
| FAA CIFP                    | faa.gov/aeronav                    | Public domain       | ARINC 424 procedures, fix/waypoint/navaid coordinates  |
| FAA NASR data               | faa.gov                            | Public domain       | Airport info, airspace boundaries, waypoints           |
| SRTM terrain data           | nasa.gov                           | Public domain       | Elevation data for profile view                        |
| Aviation Weather Center API | aviationweather.gov                | Public / free       | METARs, TAFs, PIREPs, SIGMETs, winds aloft             |
| Fuel price API              | aviation-fuel-prices.com           | CC BY-NC-ND 4.0     | 100LL/Jet-A prices by airport (free, non-commercial)   |
| avwx-engine (Python)        | pypi.org/project/avwx-engine       | MIT                 | METAR/TAF parsing and decoding                         |
| Leidos 1800wxbrief API      | 1800wxbrief.com                    | Free (registration) | Official weather briefings + VFR/IFR flight plan filing (vendor registration required) |
| Claude API (optional)       | anthropic.com                      | Commercial          | AI briefing summarization, route suggestion (optional) |

---

## Appendix A: AvareX UI/UX Issues to Address

Key problems documented in AvareX GitHub issues and pilot forums that PilotStation must solve:

1. **Touch targets overlap** — METAR/TAF/waypoint/course line stacked on same pixels (Issues #31, #66)
2. **Font size too small** — Status bar unreadable on larger screens (Issue #15)
3. **Icons invisible on chart backgrounds** — No theme-aware contrast (Issue #33)
4. **Text upside-down in track-up mode** — METAR data rotates with map (Issue #80)
5. **Info bar goes blank near destination** — Critical data disappears when most needed (Issue #79)
6. **No screen orientation lock** — Auto-rotation in flight
7. **Configuration buried** — Experienced pilots cannot find settings
8. **No progressive disclosure** — All information shown at once or not at all
9. **Keyboard covers input fields** — Basic layout issue (Issue #27)
10. **Dangerous double-tap exit** — Risk of accidental app closure in flight

PilotStation addresses these by **not using AvareX at all**. By rendering FAA chart tiles natively in Leaflet.js within a custom-built cockpit UI served to the iPad, we have complete control over every pixel, touch target, and interaction pattern. No inherited UI problems.

---

## Appendix B: FAA Regulatory Reference

- **AC 91-78A**: Authorizes use of EFBs in lieu of paper for Part 91 operations
- **AC 120-76E**: EFB authorization guidance (Part 121/135, informative for Part 91)
- **AC 25-11B**: Electronic flight display design standards (readability, luminance, contrast)
- **14 CFR 91.503**: Does not require paper charts for Part 91 operations
- PilotStation qualifies as a **Class 1 EFB** (portable, not mounted, no aircraft data connection required) or **Class 2** (with mount)
- Pilot retains responsibility for current chart data and operational decisions
