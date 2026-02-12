"""
PilotStation Data Pipeline — Shared Configuration
Paths, FAA cycle dates, download URLs, and utility functions.
"""

import os
import sys
import requests
from pathlib import Path

# ========== Cycle Configuration ==========
# Update these when a new FAA cycle is released (every 28 days)
NASR_CYCLE_DATE = "2026-01-22"
NASR_CYCLE_EXPIRATION = "2026-02-19"
CHART_CYCLE_DATE = "01-22-2026"       # MM-DD-YYYY for FAA URL format
DTPP_CYCLE_CODE = "260122"            # YYMMDD for d-TPP URLs
CIFP_CYCLE_CODE = "260122"            # YYMMDD for CIFP URLs

# ========== Directory Paths ==========
PIPELINE_DIR = Path(__file__).parent
TMP_DIR = PIPELINE_DIR / "tmp"
DATA_DIR = PIPELINE_DIR.parent / "data"

NASR_OUTPUT_DIR = DATA_DIR / "nasr"
TILES_OUTPUT_DIR = DATA_DIR / "tiles"
PLATES_OUTPUT_DIR = DATA_DIR / "plates"
CIFP_OUTPUT_DIR = DATA_DIR / "cifp"
TERRAIN_OUTPUT_DIR = DATA_DIR / "terrain" / "srtm"

# ========== Download URLs ==========
NASR_URL = f"https://nfdc.faa.gov/webContent/28DaySub/28DaySubscription_Effective_{NASR_CYCLE_DATE}.zip"

SECTIONAL_CHARTS = [
    "Albuquerque", "Anchorage", "Atlanta", "Billings", "Brownsville",
    "Charlotte", "Cheyenne", "Chicago", "Cincinnati", "Dallas-Ft_Worth",
    "Denver", "Detroit", "Dutch_Harbor", "El_Paso", "Fairbanks",
    "Great_Falls", "Green_Bay", "Halifax", "Hawaiian_Islands", "Houston",
    "Jacksonville", "Juneau", "Kansas_City", "Ketchikan", "Kodiak",
    "Lake_Huron", "Las_Vegas", "Los_Angeles", "McGrath",
    "Memphis", "Miami", "Montreal", "New_Orleans", "New_York",
    "Nome", "Omaha", "Phoenix", "Point_Barrow", "Salt_Lake_City",
    "San_Antonio", "San_Francisco", "Seattle", "Seward",
    "St_Louis", "Twin_Cities", "Washington", "Western_Aleutian_Islands",
    "Whitehorse", "Wichita",
]
SECTIONAL_URL_TEMPLATE = f"https://aeronav.faa.gov/visual/{CHART_CYCLE_DATE}/sectional-files/{{name}}.zip"

DTPP_VOLUMES = ["A", "B", "C", "D", "E"]
DTPP_URL_TEMPLATE = f"https://aeronav.faa.gov/upload_313-d/terminal/DDTPP{{vol}}_{DTPP_CYCLE_CODE}.zip"
DTPP_META_CYCLE = DTPP_CYCLE_CODE[:4]  # 2601 (4-digit for metafile URL)
DTPP_META_URL = f"https://aeronav.faa.gov/d-tpp/{DTPP_META_CYCLE}/xml_data/d-TPP_Metafile.xml"

CIFP_URL = f"https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_{CIFP_CYCLE_CODE}.zip"

# SRTM tiles — NASA Earthdata or CGIAR mirror
SRTM_BASE_URL = "https://e4ftl01.cr.usgs.gov/MEASURES/SRTMGL1.003/2000.02.11"

# CONUS bounding box for tile/terrain filtering
CONUS_BBOX = {"lat_min": 24, "lat_max": 50, "lon_min": -125, "lon_max": -66}


# ========== Utility Functions ==========

def ensure_dirs():
    """Create all output directories if they don't exist."""
    for d in [TMP_DIR, NASR_OUTPUT_DIR, TILES_OUTPUT_DIR, PLATES_OUTPUT_DIR,
              CIFP_OUTPUT_DIR, TERRAIN_OUTPUT_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def download_file(url, dest_path, description=""):
    """Download a file with progress display. Skip if file already exists."""
    dest_path = Path(dest_path)
    if dest_path.exists() and dest_path.stat().st_size > 0:
        print(f"  [skip] {description or dest_path.name} (already exists)")
        return True

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    label = description or dest_path.name
    print(f"  [download] {label} ...")

    try:
        resp = requests.get(url, stream=True, timeout=60)
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        downloaded = 0

        with open(dest_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
                downloaded += len(chunk)
                if total > 0:
                    pct = downloaded * 100 // total
                    mb = downloaded / (1024 * 1024)
                    total_mb = total / (1024 * 1024)
                    sys.stdout.write(f"\r    {mb:.1f}/{total_mb:.1f} MB ({pct}%)")
                    sys.stdout.flush()

        if total > 0:
            print()  # newline after progress
        print(f"  [done] {label} ({downloaded / (1024*1024):.1f} MB)")
        return True

    except requests.RequestException as e:
        print(f"  [error] {label}: {e}")
        if dest_path.exists():
            dest_path.unlink()
        return False


def parse_nasr_latlon(s):
    """Parse NASR lat/lon string 'DD-MM-SS.SSSSH' or 'DDD-MM-SS.SSSSH' to decimal degrees.
    H is the hemisphere indicator: N/S/E/W. Returns None if blank/unparseable."""
    s = s.strip()
    if not s:
        return None
    try:
        hemi = s[-1]
        parts = s[:-1].split("-")
        deg = int(parts[0])
        minutes = int(parts[1])
        sec = float(parts[2])
        decimal = deg + minutes / 60.0 + sec / 3600.0
        if hemi in ("S", "W"):
            decimal = -decimal
        return round(decimal, 6)
    except (ValueError, IndexError):
        return None


def progress_bar(current, total, prefix="", width=40):
    """Print a simple terminal progress bar."""
    if total == 0:
        return
    pct = current / total
    filled = int(width * pct)
    bar = "=" * filled + "-" * (width - filled)
    sys.stdout.write(f"\r  {prefix} [{bar}] {current}/{total} ({pct*100:.0f}%)")
    sys.stdout.flush()
    if current >= total:
        print()
