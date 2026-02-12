"""
PilotStation — Pi-side FastAPI Stubs
Minimal endpoints for Planning Mode sync only.
Full backend is Phase 1b (separate effort).
"""

import json
import os
from datetime import datetime
from pathlib import Path

try:
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse, FileResponse
    from fastapi.staticfiles import StaticFiles
except ImportError:
    # Fallback: if FastAPI not installed, provide a minimal stub
    print("FastAPI not installed. Run: pip install fastapi uvicorn")
    raise

app = FastAPI(title="PilotStation", version="1.0.0")

# Paths
DATA_DIR = Path("/boot/firmware/pilotstation")
AIRCRAFT_DIR = DATA_DIR / "aircraft"
NASR_DIR = DATA_DIR / "nasr"
PLANS_DIR = DATA_DIR / "plans"
WEB_DIR = Path(__file__).parent.parent / "web"

# Ensure directories exist
for d in [AIRCRAFT_DIR, NASR_DIR, PLANS_DIR]:
    d.mkdir(parents=True, exist_ok=True)


# ========== Mode Detection Probe ==========

@app.get("/api/status")
async def status():
    """Mode detection probe — returns OK if Pi is reachable."""
    return {
        "status": "ok",
        "mode": "cockpit",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "version": "1.0.0",
    }


# ========== NASR Data ==========

@app.get("/api/nasr/cycle-info")
async def nasr_cycle_info():
    """Return current NASR cycle dates."""
    info_file = NASR_DIR / "cycle_info.json"
    if info_file.exists():
        return json.loads(info_file.read_text())
    return {"effective_date": None, "message": "No NASR data available"}


@app.get("/api/nasr/export")
async def nasr_export():
    """Serve the full NASR bundle for client-side import."""
    bundle_file = NASR_DIR / "bundle.json"
    if bundle_file.exists():
        return FileResponse(bundle_file, media_type="application/json")
    return JSONResponse(
        {"error": "No NASR bundle available"},
        status_code=404,
    )


# ========== Flight Plan Packages ==========

@app.post("/api/plan/upload-package")
async def upload_package(request: Request):
    """Receive a flight plan package from the PWA."""
    body = await request.json()

    # Generate filename from timestamp
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"plan_{ts}.json"
    plan_file = PLANS_DIR / filename

    plan_file.write_text(json.dumps(body, indent=2))

    # Also write as active plan
    active_file = PLANS_DIR / "active.json"
    active_file.write_text(json.dumps(body, indent=2))

    return {"status": "ok", "filename": filename}


@app.get("/api/plan/sync-status")
async def plan_sync_status():
    """Return the timestamp of the last synced plan."""
    active_file = PLANS_DIR / "active.json"
    if active_file.exists():
        data = json.loads(active_file.read_text())
        return {
            "lastSync": data.get("created_at"),
            "hasActivePlan": True,
        }
    return {"lastSync": None, "hasActivePlan": False}


@app.get("/api/plan/active-package")
async def active_package():
    """Return the active flight plan package."""
    active_file = PLANS_DIR / "active.json"
    if active_file.exists():
        return json.loads(active_file.read_text())
    return JSONResponse(
        {"error": "No active plan"},
        status_code=404,
    )


# ========== Aircraft Profiles ==========

@app.get("/api/aircraft")
async def list_aircraft():
    """List all aircraft profiles from the Pi filesystem."""
    profiles = []
    if AIRCRAFT_DIR.exists():
        for f in sorted(AIRCRAFT_DIR.glob("*.json")):
            try:
                profile = json.loads(f.read_text())
                profiles.append(profile)
            except (json.JSONDecodeError, OSError):
                continue
    return profiles


@app.get("/api/aircraft/{aircraft_id}")
async def get_aircraft(aircraft_id: str):
    """Return a single aircraft profile."""
    profile_file = AIRCRAFT_DIR / f"{aircraft_id}.json"
    if profile_file.exists():
        return json.loads(profile_file.read_text())
    return JSONResponse(
        {"error": f"Aircraft {aircraft_id} not found"},
        status_code=404,
    )


# ========== Static File Serving ==========

# Serve the PWA static files (must be last to not shadow API routes)
if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="static")
