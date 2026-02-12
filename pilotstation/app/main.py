"""
PilotStation — Pi-side FastAPI Server
Serves aviation data (NASR, plates, CIFP) and flight plan sync.
"""

import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

try:
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse, FileResponse
    from fastapi.staticfiles import StaticFiles
except ImportError:
    print("FastAPI not installed. Run: pip install fastapi uvicorn")
    raise

app = FastAPI(title="PilotStation", version="1.0.0")

# Paths
DATA_DIR = Path("/boot/firmware/pilotstation")
AIRCRAFT_DIR = DATA_DIR / "aircraft"
NASR_DIR = DATA_DIR / "nasr"
PLANS_DIR = DATA_DIR / "plans"
PLATES_DIR = DATA_DIR / "plates"
CIFP_DIR = DATA_DIR / "cifp"
TERRAIN_DIR = DATA_DIR / "terrain" / "srtm"
WEB_DIR = Path(__file__).parent.parent / "web"

# Ensure directories exist
for d in [AIRCRAFT_DIR, NASR_DIR, PLANS_DIR, PLATES_DIR, CIFP_DIR]:
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


# ========== Approach Plates ==========

@app.get("/api/plates/index")
async def plates_index():
    """Return the plate index (airport → plate list)."""
    index_file = PLATES_DIR / "plate_index.json"
    if index_file.exists():
        return FileResponse(index_file, media_type="application/json")
    return JSONResponse({"error": "No plate index available"}, status_code=404)


@app.get("/api/plates/{icao}")
async def plates_for_airport(icao: str):
    """Return the list of plates for an airport."""
    index_file = PLATES_DIR / "plate_index.json"
    if not index_file.exists():
        return JSONResponse({"error": "No plate index"}, status_code=404)
    index = json.loads(index_file.read_text())
    data = index.get(icao.upper())
    if data:
        return data
    return JSONResponse({"error": f"No plates for {icao}"}, status_code=404)


@app.get("/api/plates/{icao}/{filename}")
async def plate_pdf(icao: str, filename: str):
    """Serve a single approach plate PDF."""
    pdf_path = PLATES_DIR / icao.upper() / filename
    if pdf_path.exists() and pdf_path.suffix == ".pdf":
        return FileResponse(pdf_path, media_type="application/pdf")
    return JSONResponse({"error": "Plate not found"}, status_code=404)


# ========== CIFP Procedures ==========

@app.get("/api/cifp/{icao}")
async def cifp_procedures(icao: str):
    """Return SID/STAR/Approach procedures for an airport."""
    db_path = CIFP_DIR / "cifp.db"
    if not db_path.exists():
        return JSONResponse({"error": "No CIFP database"}, status_code=404)

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.execute(
        "SELECT proc_type, proc_name, COUNT(*) as steps "
        "FROM procedures WHERE airport_icao = ? "
        "GROUP BY proc_type, proc_name ORDER BY proc_type, proc_name",
        (icao.upper(),),
    )
    results = [dict(row) for row in cursor]
    conn.close()

    if not results:
        return JSONResponse({"error": f"No procedures for {icao}"}, status_code=404)
    return {"icao": icao.upper(), "procedures": results}


@app.get("/api/cifp/{icao}/{proc_name}")
async def cifp_procedure_detail(icao: str, proc_name: str):
    """Return the full waypoint sequence for a procedure."""
    db_path = CIFP_DIR / "cifp.db"
    if not db_path.exists():
        return JSONResponse({"error": "No CIFP database"}, status_code=404)

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.execute(
        "SELECT * FROM procedures WHERE airport_icao = ? AND proc_name = ? "
        "ORDER BY transition, seq_num",
        (icao.upper(), proc_name.upper()),
    )
    results = [dict(row) for row in cursor]
    conn.close()

    if not results:
        return JSONResponse({"error": "Procedure not found"}, status_code=404)
    return {"icao": icao.upper(), "proc_name": proc_name.upper(), "steps": results}


# ========== Static File Serving ==========

# Serve chart tiles as static files (if available)
TILES_DIR = DATA_DIR / "tiles"
if TILES_DIR.exists():
    app.mount("/tiles", StaticFiles(directory=str(TILES_DIR)), name="tiles")

# Serve the PWA static files (must be last to not shadow API routes)
if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="static")
