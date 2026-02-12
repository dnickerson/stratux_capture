#!/usr/bin/env python3
"""
PilotStation Data Pipeline — Chart Tile Processor
Downloads FAA sectional chart GeoTIFFs, reprojects to Web Mercator,
generates XYZ tile pyramids, and converts to WEBP format.
Requires GDAL: sudo apt install gdal-bin python3-gdal libgdal-dev

Pipeline order (critical for quality):
  1. Extract paletted GeoTIFF from zip
  2. Expand palette to RGB (gdal_translate -expand rgb)
  3. Reproject to EPSG:3857 with lanczos (now works on RGB data, smooths dithering)
  4. Generate tile pyramid with average resampling (further smooths halftone)
  5. Convert PNG tiles to WEBP
"""

import glob
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from config import (
    TMP_DIR, TILES_OUTPUT_DIR, SECTIONAL_CHARTS, SECTIONAL_URL_TEMPLATE,
    CHART_CYCLE_DATE, download_file, ensure_dirs, progress_bar,
)

CHARTS_TMP = TMP_DIR / "charts"
TILE_ZOOM_MIN = 5
TILE_ZOOM_MAX = 11


def check_gdal():
    """Verify GDAL tools are installed."""
    required = ["gdalwarp", "gdal2tiles.py", "gdalinfo"]
    missing = []
    for tool in required:
        if shutil.which(tool) is None:
            missing.append(tool)
    if missing:
        print(f"  [error] Missing GDAL tools: {', '.join(missing)}")
        print("  Install with: sudo apt install gdal-bin python3-gdal")
        return False
    try:
        ver = subprocess.check_output(["gdalinfo", "--version"], text=True).strip()
        print(f"  GDAL: {ver}")
    except subprocess.CalledProcessError:
        pass
    return True


def check_webp_support():
    """Verify Pillow has WEBP support."""
    try:
        from PIL import features
        if features.check("webp"):
            return True
        print("  [warn] Pillow WEBP support not available.")
        return False
    except ImportError:
        print("  [error] Pillow not installed")
        return False


def download_charts(chart_type="sectional"):
    """Download chart GeoTIFF zips."""
    CHARTS_TMP.mkdir(parents=True, exist_ok=True)

    if chart_type == "sectional":
        charts = SECTIONAL_CHARTS
        url_template = SECTIONAL_URL_TEMPLATE
    else:
        print(f"  [skip] Chart type '{chart_type}' not yet supported")
        return []

    downloaded = []
    for name in charts:
        url = url_template.format(name=name)
        dest = CHARTS_TMP / f"{name}.zip"
        success = download_file(url, dest, f"Sectional: {name}")
        if success:
            downloaded.append((name, dest))

    return downloaded


def extract_tiff(chart_name, zip_path):
    """Extract the main GeoTIFF from a chart zip."""
    extract_dir = CHARTS_TMP / chart_name
    extract_dir.mkdir(parents=True, exist_ok=True)

    existing_tifs = list(extract_dir.glob("*.tif"))
    if existing_tifs:
        return existing_tifs[0]

    try:
        z = zipfile.ZipFile(str(zip_path), "r")
        tif_files = [n for n in z.namelist() if n.lower().endswith(".tif")]
        if not tif_files:
            print(f"    [error] No .tif in {zip_path.name}")
            return None

        largest = max(tif_files, key=lambda n: z.getinfo(n).file_size)
        z.extract(largest, str(extract_dir))
        z.close()
        return extract_dir / largest

    except (zipfile.BadZipFile, OSError) as e:
        print(f"    [error] Extracting {chart_name}: {e}")
        return None


def expand_to_rgb(tif_path, chart_name):
    """Expand paletted GeoTIFF to RGB via VRT.
    MUST happen before reprojection so lanczos can interpolate real colors."""
    output = CHARTS_TMP / chart_name / f"{chart_name}_rgb.vrt"
    if output.exists():
        return output

    print(f"    Expanding {chart_name} to RGB...")
    cmd = [
        "gdal_translate",
        "-expand", "rgb",
        "-of", "VRT",
        str(tif_path),
        str(output),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"    [error] gdal_translate expand: {result.stderr[:200]}")
        return None

    return output


def reproject_chart(rgb_path, chart_name):
    """Reproject RGB chart to EPSG:3857 with lanczos resampling.
    Lanczos on RGB data inherently smooths halftone dithering."""
    output = CHARTS_TMP / chart_name / f"{chart_name}_3857.tif"
    if output.exists():
        return output

    print(f"    Reprojecting {chart_name} (lanczos)...")
    cmd = [
        "gdalwarp",
        "-t_srs", "EPSG:3857",
        "-r", "lanczos",
        "-dstalpha",
        "-co", "COMPRESS=LZW",
        "-co", "TILED=YES",
        "-wo", "NUM_THREADS=ALL_CPUS",
        "-wm", "1024",
        str(rgb_path),
        str(output),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"    [error] gdalwarp: {result.stderr[:200]}")
        return None

    return output


def generate_tiles(tif_path, chart_name, output_dir):
    """Generate XYZ tile pyramid with average resampling."""
    tiles_dir = output_dir / chart_name
    if tiles_dir.exists() and any(tiles_dir.iterdir()):
        print(f"    [skip] Tiles for {chart_name} already exist")
        return tiles_dir

    print(f"    Tiling {chart_name} (zoom {TILE_ZOOM_MIN}-{TILE_ZOOM_MAX}, average resampling)...")
    cmd = [
        "gdal2tiles.py",
        "-z", f"{TILE_ZOOM_MIN}-{TILE_ZOOM_MAX}",
        "-r", "average",
        "-w", "none",
        "--xyz",
        "--processes=4",
        str(tif_path),
        str(tiles_dir),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"    [error] gdal2tiles: {result.stderr[:200]}")
        return None

    return tiles_dir


def convert_tiles_to_webp(tiles_dir, output_dir, quality=85):
    """Convert PNG tiles to WEBP format."""
    from PIL import Image

    png_files = list(Path(tiles_dir).rglob("*.png"))
    if not png_files:
        return 0

    converted = 0
    total = len(png_files)

    for i, png_path in enumerate(png_files):
        rel_path = png_path.relative_to(tiles_dir)
        webp_path = output_dir / rel_path.with_suffix(".webp")
        webp_path.parent.mkdir(parents=True, exist_ok=True)

        if webp_path.exists():
            continue

        try:
            img = Image.open(png_path)
            img.save(str(webp_path), "WEBP", quality=quality)
            converted += 1
        except Exception:
            continue

        if (i + 1) % 1000 == 0:
            progress_bar(i + 1, total, prefix="WEBP")

    if total >= 1000:
        progress_bar(total, total, prefix="WEBP")
    print(f"    Converted {converted:,}/{total:,} tiles to WEBP")
    return converted


def process_chart(chart_name, zip_path, chart_type="sectional"):
    """Full pipeline for a single chart: extract → expand RGB → reproject → tile → WEBP."""
    print(f"\n  Processing: {chart_name}")

    # 1. Extract TIF
    tif = extract_tiff(chart_name, zip_path)
    if not tif:
        return False

    # 2. Expand palette to RGB (MUST happen before reprojection)
    rgb = expand_to_rgb(tif, chart_name)
    if not rgb:
        return False

    # 3. Reproject with lanczos (works properly on RGB, smooths dithering)
    reprojected = reproject_chart(rgb, chart_name)
    if not reprojected:
        return False

    # 4. Generate PNG tiles with average resampling
    tile_tmp = CHARTS_TMP / "tiles_png"
    tiles_dir = generate_tiles(reprojected, chart_name, tile_tmp)
    if not tiles_dir:
        return False

    # 5. Convert to WEBP
    webp_output = TILES_OUTPUT_DIR / chart_type
    if check_webp_support():
        convert_tiles_to_webp(tiles_dir, webp_output)
    else:
        print(f"    [warn] Using PNG tiles (no WEBP support)")
        shutil.copytree(str(tiles_dir), str(webp_output), dirs_exist_ok=True)

    # 6. Clean up intermediate files to save disk space
    if reprojected.exists():
        reprojected.unlink()

    return True


def build_charts_pipeline(chart_type="sectional"):
    """Main entry point: download, process, and tile all charts."""
    ensure_dirs()

    print("\n=== Chart Tile Processor ===")
    print(f"  Chart type: {chart_type}")
    print(f"  Cycle: {CHART_CYCLE_DATE}")
    print(f"  Zoom levels: {TILE_ZOOM_MIN}-{TILE_ZOOM_MAX}")

    if not check_gdal():
        sys.exit(1)

    has_webp = check_webp_support()

    downloaded = download_charts(chart_type)
    if not downloaded:
        print("  [error] No charts downloaded!")
        sys.exit(1)

    success = 0
    failed = 0
    for chart_name, zip_path in downloaded:
        if process_chart(chart_name, zip_path, chart_type):
            success += 1
        else:
            failed += 1

    # Summary
    output_dir = TILES_OUTPUT_DIR / chart_type
    tile_count = sum(1 for _ in output_dir.rglob("*.webp")) if output_dir.exists() else 0
    if tile_count == 0:
        tile_count = sum(1 for _ in output_dir.rglob("*.png")) if output_dir.exists() else 0

    print(f"\n  === Summary ===")
    print(f"  Charts processed: {success} success, {failed} failed")
    print(f"  Tiles generated: {tile_count:,}")
    if output_dir.exists():
        total_size = sum(f.stat().st_size for f in output_dir.rglob("*") if f.is_file())
        print(f"  Total size: {total_size / (1024*1024*1024):.2f} GB")
    print(f"  Output: {output_dir}")
    print(f"  === Done ===\n")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Generate chart tiles")
    parser.add_argument("--type", default="sectional",
                        choices=["sectional", "ifr-low", "ifr-high", "tac"],
                        help="Chart type to process")
    args = parser.parse_args()
    build_charts_pipeline(args.type)
