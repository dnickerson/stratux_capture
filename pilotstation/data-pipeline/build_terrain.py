#!/usr/bin/env python3
"""
PilotStation Data Pipeline — SRTM Terrain Downloader
Downloads SRTM 1-arc-second elevation tiles for CONUS coverage.
Requires a free NASA Earthdata account (https://urs.earthdata.nasa.gov/users/new).
"""

import os
import sys
from pathlib import Path

from config import (
    TERRAIN_OUTPUT_DIR, SRTM_BASE_URL, CONUS_BBOX,
    download_file, ensure_dirs, progress_bar,
)


def get_tile_list(bbox=None):
    """Generate list of SRTM tile names for a bounding box.

    SRTM tiles are named by their SW corner:
      N33W085.hgt covers 33-34N, 84-85W
      Format: {N|S}{DD}{E|W}{DDD}.hgt
    """
    if bbox is None:
        bbox = CONUS_BBOX

    tiles = []
    for lat in range(bbox["lat_min"], bbox["lat_max"]):
        for lon in range(bbox["lon_min"], bbox["lon_max"]):
            # Tile name uses SW corner
            lat_prefix = "N" if lat >= 0 else "S"
            lon_prefix = "E" if lon >= 0 else "W"
            name = f"{lat_prefix}{abs(lat):02d}{lon_prefix}{abs(lon):03d}"
            tiles.append(name)

    return tiles


def get_auth():
    """Get NASA Earthdata credentials from ~/.netrc or environment."""
    import netrc

    # Try environment variables first
    user = os.environ.get("EARTHDATA_USER", "")
    password = os.environ.get("EARTHDATA_PASS", "")
    if user and password:
        return (user, password)

    # Try .netrc
    try:
        nrc = netrc.netrc()
        auth = nrc.authenticators("urs.earthdata.nasa.gov")
        if auth:
            return (auth[0], auth[2])
    except (FileNotFoundError, netrc.NetrcParseError):
        pass

    return None


def download_tile(tile_name, auth=None):
    """Download a single SRTM .hgt tile.

    Tries NASA Earthdata first, falls back to CGIAR mirror.
    """
    import requests

    dest = TERRAIN_OUTPUT_DIR / f"{tile_name}.hgt"
    if dest.exists() and dest.stat().st_size > 0:
        return True

    # NASA Earthdata URL
    url = f"{SRTM_BASE_URL}/{tile_name}.SRTMGL1.hgt.zip"

    try:
        session = requests.Session()
        if auth:
            session.auth = auth

        resp = session.get(url, allow_redirects=True, timeout=30)

        # NASA Earthdata requires redirect authentication
        if resp.status_code == 401 and auth:
            # Re-authenticate after redirect
            resp = session.get(resp.url, auth=auth, timeout=30)

        if resp.status_code == 200:
            import zipfile
            import io
            # SRTM files come as .hgt.zip — extract the .hgt
            try:
                zf = zipfile.ZipFile(io.BytesIO(resp.content))
                hgt_files = [n for n in zf.namelist() if n.endswith(".hgt")]
                if hgt_files:
                    data = zf.read(hgt_files[0])
                    dest.write_bytes(data)
                    return True
            except zipfile.BadZipFile:
                # Might be raw .hgt
                dest.write_bytes(resp.content)
                return True
        elif resp.status_code == 404:
            # Tile doesn't exist (ocean area)
            return False

    except Exception:
        pass

    return False


def build_terrain_pipeline(bbox=None):
    """Main entry point: generate tile list and download."""
    ensure_dirs()

    print("\n=== SRTM Terrain Downloader ===")

    # Check auth
    auth = get_auth()
    if not auth:
        print("  [warn] No NASA Earthdata credentials found.")
        print("  Set up one of:")
        print("    1. Environment: EARTHDATA_USER and EARTHDATA_PASS")
        print("    2. ~/.netrc entry for urs.earthdata.nasa.gov")
        print("  Register free at: https://urs.earthdata.nasa.gov/users/new")
        print()
        print("  Proceeding without auth (may fail for NASA Earthdata)...")

    # Generate tile list
    tiles = get_tile_list(bbox)
    print(f"  Tiles needed: {len(tiles):,} (CONUS)")

    # Check existing
    existing = sum(1 for t in tiles if (TERRAIN_OUTPUT_DIR / f"{t}.hgt").exists())
    print(f"  Already downloaded: {existing:,}")

    if existing == len(tiles):
        print("  All tiles present!")
        _print_summary()
        return

    # Download
    success = existing
    failed = 0
    ocean = 0

    for i, tile_name in enumerate(tiles):
        dest = TERRAIN_OUTPUT_DIR / f"{tile_name}.hgt"
        if dest.exists() and dest.stat().st_size > 0:
            continue

        result = download_tile(tile_name, auth)
        if result:
            success += 1
        else:
            # 404 = ocean tile (expected)
            ocean += 1

        progress_bar(i + 1, len(tiles), prefix="SRTM")

    print(f"\n  Downloaded: {success - existing:,} new tiles")
    print(f"  Ocean/missing: {ocean:,}")
    _print_summary()


def _print_summary():
    """Print final summary."""
    if TERRAIN_OUTPUT_DIR.exists():
        hgt_files = list(TERRAIN_OUTPUT_DIR.glob("*.hgt"))
        total_size = sum(f.stat().st_size for f in hgt_files)
        print(f"\n  === Summary ===")
        print(f"  Tiles: {len(hgt_files):,}")
        print(f"  Total size: {total_size / (1024*1024*1024):.2f} GB")
        print(f"  Output: {TERRAIN_OUTPUT_DIR}")
    print(f"  === Done ===\n")


if __name__ == "__main__":
    build_terrain_pipeline()
