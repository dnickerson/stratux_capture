#!/usr/bin/env python3
"""
PilotStation Data Pipeline — Approach Plates Processor
Downloads FAA d-TPP volumes, parses the metafile XML, organizes PDFs by airport
ICAO code, and builds a plate_index.json for the client.
"""

import json
import os
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from config import (
    TMP_DIR, PLATES_OUTPUT_DIR, DTPP_VOLUMES, DTPP_URL_TEMPLATE,
    DTPP_META_URL, DTPP_CYCLE_CODE, download_file, ensure_dirs,
    progress_bar,
)

PLATES_TMP = TMP_DIR / "plates"
META_FILE = PLATES_TMP / "d-TPP_Metafile.xml"
INDEX_FILE = PLATES_OUTPUT_DIR / "plate_index.json"


def download_metafile():
    """Download the d-TPP Metafile XML."""
    PLATES_TMP.mkdir(parents=True, exist_ok=True)
    return download_file(DTPP_META_URL, META_FILE, "d-TPP Metafile XML")


def download_volumes():
    """Download all d-TPP zip volumes (A-E)."""
    PLATES_TMP.mkdir(parents=True, exist_ok=True)
    results = {}
    for vol in DTPP_VOLUMES:
        url = DTPP_URL_TEMPLATE.format(vol=vol)
        dest = PLATES_TMP / f"DDTPP{vol}_{DTPP_CYCLE_CODE}.zip"
        success = download_file(url, dest, f"d-TPP Volume {vol}")
        results[vol] = dest if success else None
    return results


def parse_metafile():
    """Parse d-TPP_Metafile.xml into a structured dict.

    XML structure:
      <digital_tpp edition="...">
        <state_code id="AL">
          <city_name ID="BIRMINGHAM">
            <airport_name ID="BHM" military="N" apt_ident="BHM"
                          icao_ident="KBHM" alnum="...">
              <record>
                <chartseq>10100</chartseq>
                <chart_code>IAP</chart_code>
                <chart_name>ILS OR LOC RWY 06</chart_name>
                <useraction>...</useraction>
                <pdf_name>00001IL6.PDF</pdf_name>
                <cn_flg>N</cn_flg>
                <cn_date>...</cn_date>
                <civil>...</civil>
                <faession_date>...</faession_date>
              </record>
            </airport_name>
          </city_name>
        </state_code>
      </digital_tpp>

    Returns: dict keyed by ICAO ident
    """
    print("  Parsing d-TPP Metafile XML...")
    if not META_FILE.exists():
        print("  [error] Metafile not found!")
        return {}

    tree = ET.parse(str(META_FILE))
    root = tree.getroot()

    index = {}
    plate_count = 0

    for state in root.findall(".//state_code"):
        state_id = state.get("id", "")

        for city in state.findall("city_name"):
            city_name = city.get("ID", "")

            for airport in city.findall("airport_name"):
                apt_ident = airport.get("apt_ident", "")
                icao = airport.get("icao_ident", "")
                apt_name = airport.get("ID", "")
                military = airport.get("military", "N")

                if not icao:
                    # No ICAO code — use FAA ident
                    icao = apt_ident

                if icao not in index:
                    index[icao] = {
                        "name": apt_name.title(),
                        "city": city_name.title(),
                        "state": state_id,
                        "military": military == "Y",
                        "plates": [],
                    }

                for record in airport.findall("record"):
                    chart_code = _text(record, "chart_code")
                    chart_name = _text(record, "chart_name")
                    pdf_name = _text(record, "pdf_name")

                    if not pdf_name or not chart_name:
                        continue

                    # Skip non-chart entries (compare pages, etc.)
                    if pdf_name.upper() == "DELETED" or not pdf_name.endswith(".PDF"):
                        continue

                    index[icao]["plates"].append({
                        "name": chart_name,
                        "type": chart_code,
                        "pdf_name": pdf_name,
                    })
                    plate_count += 1

    print(f"    {len(index):,} airports, {plate_count:,} plates")
    return index


def _text(element, tag):
    """Get text content of a child element, or empty string."""
    child = element.find(tag)
    return child.text.strip() if child is not None and child.text else ""


def extract_and_organize(volume_zips, plate_index):
    """Extract PDFs from volume zips and organize into airport directories.

    Volume zips contain PDFs with names like '00001IL6.PDF' — we need to
    map these to airports using the plate_index from the metafile.
    """
    print("  Extracting and organizing PDFs...")

    # Build reverse lookup: pdf_name -> (icao, plate_info)
    pdf_lookup = {}
    for icao, airport_data in plate_index.items():
        for plate in airport_data["plates"]:
            pdf_lookup[plate["pdf_name"].upper()] = (icao, plate)

    extracted = 0
    skipped = 0

    for vol, zip_path in sorted(volume_zips.items()):
        if zip_path is None or not zip_path.exists():
            print(f"    [skip] Volume {vol} — not downloaded")
            continue

        print(f"    Extracting volume {vol}...")
        try:
            z = zipfile.ZipFile(str(zip_path), "r")
            pdf_names = [n for n in z.namelist() if n.upper().endswith(".PDF")]

            for pdf_name in pdf_names:
                lookup_key = pdf_name.upper()
                # Handle path prefixes in zip (some have subdirectories)
                base_name = os.path.basename(lookup_key)

                info = pdf_lookup.get(base_name)
                if not info:
                    skipped += 1
                    continue

                icao, plate = info

                # Create airport directory
                apt_dir = PLATES_OUTPUT_DIR / icao
                apt_dir.mkdir(parents=True, exist_ok=True)

                # Use descriptive filename
                safe_name = plate["name"].replace("/", "-").replace(" ", "_")
                dest_name = f"{safe_name}.pdf"
                dest_path = apt_dir / dest_name

                if dest_path.exists():
                    skipped += 1
                    continue

                # Extract
                data = z.read(pdf_name)
                dest_path.write_bytes(data)
                extracted += 1

                # Update plate entry with local filename
                plate["filename"] = dest_name

            z.close()

        except (zipfile.BadZipFile, OSError) as e:
            print(f"    [error] Volume {vol}: {e}")

    print(f"    {extracted:,} PDFs extracted, {skipped:,} skipped")
    return extracted


def write_index(plate_index):
    """Write the plate_index.json file."""
    # Clean up entries — only include plates that have a local filename
    clean_index = {}
    for icao, data in sorted(plate_index.items()):
        plates_with_files = [p for p in data["plates"] if "filename" in p]
        if plates_with_files:
            clean_index[icao] = {
                "name": data["name"],
                "city": data["city"],
                "state": data["state"],
                "military": data["military"],
                "plates": plates_with_files,
            }

    with open(INDEX_FILE, "w") as f:
        json.dump(clean_index, f, separators=(",", ":"))

    size_mb = INDEX_FILE.stat().st_size / (1024 * 1024)
    print(f"    Index: {INDEX_FILE} ({size_mb:.1f} MB, {len(clean_index):,} airports)")
    return clean_index


def build_plates_pipeline():
    """Main entry point: download, parse, extract, and index."""
    ensure_dirs()

    print("\n=== Approach Plates Processor ===")
    print(f"  Cycle: {DTPP_CYCLE_CODE}")

    # Download metafile
    download_metafile()

    # Parse metafile into index
    plate_index = parse_metafile()
    if not plate_index:
        print("  [error] No plate data parsed!")
        sys.exit(1)

    # Download volume zips
    volume_zips = download_volumes()

    # Extract and organize
    extracted = extract_and_organize(volume_zips, plate_index)

    # Write index
    clean_index = write_index(plate_index)

    # Summary
    total_plates = sum(len(d["plates"]) for d in clean_index.values())
    print(f"\n  === Summary ===")
    print(f"  Airports: {len(clean_index):,}")
    print(f"  Plates:   {total_plates:,}")
    print(f"  === Done ===\n")


if __name__ == "__main__":
    build_plates_pipeline()
