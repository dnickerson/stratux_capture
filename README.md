# Stratux Capture

Engine monitor and fuel planner for Stratux ADS-B receivers.

## Version

v3.3.0

## Features

- **Live Engine Dashboard** - Real-time EGT, CHT, RPM, MP, and Fuel Flow display
- **Fuel Planner PWA** - Offline-capable fuel planning with pre-flight tic measurements
- **Data Capture** - Start/stop capture via web interface with automatic GPS timestamping
- **Diagnostics API** - `/api/diagnostics` endpoint for troubleshooting serial connections
- **High-Contrast Display** - Optimized for iPad visibility in direct sunlight

## Files

| File | Description |
|------|-------------|
| `engine_monitor.py` | Main server - runs on Stratux/Raspberry Pi |
| `fuel-planner.html` | Fuel planner web app |
| `fuel-planner.js` | Fuel planner logic |
| `fuel-planner.css` | High-contrast styling |
| `service-worker.js` | Offline PWA support |
| `chart.min.js` | Chart.js for graphs |
| `data_simulator.py` | Test data generator |
| `HELP.html` | User documentation |

## Usage

1. Copy `capture_v5/` to your Stratux device
2. Run the server:
   ```bash
   python3 engine_monitor.py
   ```
3. Access at: http://stratux.local:8080

## Requirements

- Python 3
- Serial connection to EDM engine monitor
- Stratux device (Raspberry Pi)
