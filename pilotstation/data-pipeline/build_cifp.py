#!/usr/bin/env python3
"""
PilotStation Data Pipeline — CIFP Processor
Parses FAA CIFP (ARINC 424 format) into a SQLite database for procedure lookups.
"""

import json
import sqlite3
import sys
import zipfile
from pathlib import Path

from config import (
    TMP_DIR, CIFP_OUTPUT_DIR, CIFP_URL, CIFP_CYCLE_CODE,
    download_file, ensure_dirs,
)

CIFP_ZIP = TMP_DIR / f"cifp_{CIFP_CYCLE_CODE}.zip"
CIFP_DB = CIFP_OUTPUT_DIR / "cifp.db"


def download_cifp():
    """Download the CIFP zip if not present."""
    return download_file(CIFP_URL, CIFP_ZIP, f"CIFP {CIFP_CYCLE_CODE}")


def create_schema(conn):
    """Create SQLite tables for CIFP data."""
    conn.executescript("""
        DROP TABLE IF EXISTS procedures;
        DROP TABLE IF EXISTS meta;

        CREATE TABLE procedures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            airport_icao TEXT NOT NULL,
            proc_type TEXT NOT NULL,
            proc_name TEXT NOT NULL,
            route_type TEXT,
            transition TEXT,
            seq_num INTEGER,
            fix_id TEXT,
            fix_icao_region TEXT,
            fix_section TEXT,
            desc_code TEXT,
            path_term TEXT,
            turn_dir TEXT,
            rec_navaid TEXT,
            rec_navaid_region TEXT,
            theta REAL,
            rho REAL,
            mag_course REAL,
            route_dist REAL,
            alt_desc TEXT,
            altitude1 INTEGER,
            altitude2 INTEGER,
            speed_limit INTEGER,
            waypoint_lat REAL,
            waypoint_lon REAL
        );

        CREATE INDEX idx_proc_airport ON procedures(airport_icao);
        CREATE INDEX idx_proc_type ON procedures(proc_type);
        CREATE INDEX idx_proc_name ON procedures(airport_icao, proc_name);

        CREATE TABLE meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    """)


def parse_arinc_latlon(lat_str, lon_str):
    """Parse ARINC 424 lat/lon from the last 22 chars of a record.

    ARINC 424 stores coordinates in the last portion of certain records.
    Format: NDDMMSSSS WDDDMMSSSS (packed, no separators)
    lat: N/S + DD + MM + SS.SS (9 chars: H + 2deg + 2min + 4sec_hundredths)
    lon: E/W + DDD + MM + SS.SS (10 chars: H + 3deg + 2min + 4sec_hundredths)
    """
    lat = None
    lon = None

    if lat_str and len(lat_str) >= 9:
        try:
            hemi = lat_str[0]
            deg = int(lat_str[1:3])
            minutes = int(lat_str[3:5])
            sec = int(lat_str[5:9]) / 100.0
            lat = deg + minutes / 60.0 + sec / 3600.0
            if hemi == "S":
                lat = -lat
        except (ValueError, IndexError):
            pass

    if lon_str and len(lon_str) >= 10:
        try:
            hemi = lon_str[0]
            deg = int(lon_str[1:4])
            minutes = int(lon_str[4:6])
            sec = int(lon_str[6:10]) / 100.0
            lon = deg + minutes / 60.0 + sec / 3600.0
            if hemi == "W":
                lon = -lon
        except (ValueError, IndexError):
            pass

    return lat, lon


def parse_altitude(alt_str):
    """Parse ARINC 424 altitude field (5 chars). Returns feet or None."""
    s = alt_str.strip()
    if not s:
        return None
    # Can start with FL prefix for flight levels, or be numeric feet
    if s.startswith("FL"):
        try:
            return int(s[2:]) * 100
        except ValueError:
            return None
    try:
        return int(s)
    except ValueError:
        return None


def parse_numeric(s, decimal_places=0):
    """Parse a numeric field, returning None if blank. Handles implied decimals."""
    s = s.strip()
    if not s:
        return None
    try:
        val = int(s)
        if decimal_places > 0:
            val = val / (10 ** decimal_places)
        return val
    except ValueError:
        return None


def parse_cifp_records(conn):
    """Parse FAACIFP18 ARINC 424 records into the procedures table.

    Record layout (132 chars, 0-indexed):
      [0:1]   Record type (S=standard)
      [1:4]   Customer/area code
      [4:5]   Section code
      [5:6]   Subsection code (blank for airport procs)
      [6:10]  Airport ICAO identifier
      [10:12] ICAO region code
      [12:13] Subcode: D=SID, E=STAR, F=Approach
      [13:19] Procedure identifier (SID/STAR/approach name)
      [19:20] Route type
      [20:25] Transition identifier
      [25:26] Reserved
      [26:29] Sequence number
      [29:34] Fix identifier
      [34:36] Fix ICAO region
      [36:38] Fix section/subsection
      [38:39] Continuation record number
      [39:43] Waypoint description code
      [43:44] Turn direction (L/R)
      [44:47] RNP value
      [47:49] Path and termination
      [49:50] Turn direction / recommended
      [50:54] Recommended navaid
      [54:56] Recommended navaid ICAO region
      [62:66] Theta (bearing from navaid, tenths of degree)
      [66:70] Rho (distance from navaid, tenths of NM)
      [70:74] Magnetic course (tenths of degree)
      [74:78] Route distance/time (tenths of NM or minutes)
      [82:83] Altitude description
      [83:88] Altitude 1
      [88:93] Altitude 2
      [93:94] Transition altitude
      [99:102] Speed limit
    """
    z = zipfile.ZipFile(CIFP_ZIP, "r")
    proc_type_map = {"D": "SID", "E": "STAR", "F": "APPROACH"}

    batch = []
    total = 0
    skipped = 0

    print("  Parsing FAACIFP18...")

    with z.open("FAACIFP18") as f:
        for raw_line in f:
            line = raw_line.decode("latin-1")
            if len(line) < 132:
                continue

            # Only process airport procedure records (section P)
            section = line[4:5]
            if section != "P":
                continue

            # Only subcodes D (SID), E (STAR), F (Approach)
            subcode = line[12:13]
            if subcode not in proc_type_map:
                skipped += 1
                continue

            # Skip continuation records (non-primary)
            cont = line[38:39].strip()
            if cont and cont != "0" and cont != "1":
                skipped += 1
                continue

            airport = line[6:10].strip()
            proc_name = line[13:19].strip()
            route_type = line[19:20].strip()
            transition = line[20:25].strip()
            seq_num = parse_numeric(line[26:29])
            fix_id = line[29:34].strip()
            fix_icao = line[34:36].strip()
            fix_section = line[36:38].strip()
            desc_code = line[39:43].strip()
            path_term = line[47:49].strip()
            turn_dir = line[43:44].strip()
            rec_navaid = line[50:54].strip()
            rec_navaid_region = line[54:56].strip()
            theta = parse_numeric(line[62:66], 1)
            rho = parse_numeric(line[66:70], 1)
            mag_course = parse_numeric(line[70:74], 1)
            route_dist = parse_numeric(line[74:78], 1)
            alt_desc = line[82:83].strip()
            altitude1 = parse_altitude(line[83:88])
            altitude2 = parse_altitude(line[88:93])
            speed_raw = line[99:102].strip()
            speed_limit = int(speed_raw) if speed_raw.isdigit() else None

            # Parse lat/lon from end of record (cols 109-118 lat, 119-128 lon)
            lat_str = line[109:118].strip() if len(line) > 118 else ""
            lon_str = line[118:128].strip() if len(line) > 128 else ""
            wp_lat, wp_lon = parse_arinc_latlon(lat_str, lon_str)

            batch.append((
                airport, proc_type_map[subcode], proc_name, route_type,
                transition, seq_num, fix_id, fix_icao, fix_section,
                desc_code, path_term, turn_dir, rec_navaid, rec_navaid_region,
                theta, rho, mag_course, route_dist, alt_desc,
                altitude1, altitude2, speed_limit, wp_lat, wp_lon,
            ))

            if len(batch) >= 10000:
                conn.executemany("""
                    INSERT INTO procedures (
                        airport_icao, proc_type, proc_name, route_type,
                        transition, seq_num, fix_id, fix_icao_region, fix_section,
                        desc_code, path_term, turn_dir, rec_navaid, rec_navaid_region,
                        theta, rho, mag_course, route_dist, alt_desc,
                        altitude1, altitude2, speed_limit, waypoint_lat, waypoint_lon
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, batch)
                total += len(batch)
                batch = []

    # Insert remaining
    if batch:
        conn.executemany("""
            INSERT INTO procedures (
                airport_icao, proc_type, proc_name, route_type,
                transition, seq_num, fix_id, fix_icao_region, fix_section,
                desc_code, path_term, turn_dir, rec_navaid, rec_navaid_region,
                theta, rho, mag_course, route_dist, alt_desc,
                altitude1, altitude2, speed_limit, waypoint_lat, waypoint_lon
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, batch)
        total += len(batch)

    conn.commit()
    z.close()

    print(f"    {total:,} procedure records inserted (skipped {skipped:,})")
    return total


def build_cifp_pipeline():
    """Main entry point: download, parse, and create SQLite database."""
    ensure_dirs()

    print("\n=== CIFP Processor ===")
    print(f"  Cycle: {CIFP_CYCLE_CODE}")

    # Download
    download_cifp()

    if not CIFP_ZIP.exists():
        print("  [error] CIFP zip not found!")
        sys.exit(1)

    # Create database
    if CIFP_DB.exists():
        CIFP_DB.unlink()

    conn = sqlite3.connect(str(CIFP_DB))
    create_schema(conn)

    # Parse records
    total = parse_cifp_records(conn)

    # Store metadata
    conn.execute("INSERT INTO meta VALUES (?, ?)", ("cycle_code", CIFP_CYCLE_CODE))
    conn.execute("INSERT INTO meta VALUES (?, ?)", ("record_count", str(total)))
    conn.commit()

    # Stats
    cursor = conn.execute("""
        SELECT proc_type, COUNT(*) FROM procedures GROUP BY proc_type
    """)
    print("\n  Procedure breakdown:")
    for row in cursor:
        print(f"    {row[0]}: {row[1]:,}")

    cursor = conn.execute("""
        SELECT COUNT(DISTINCT airport_icao) FROM procedures
    """)
    airports = cursor.fetchone()[0]
    print(f"    Airports: {airports:,}")

    # Vacuum for size optimization
    conn.execute("VACUUM")
    conn.close()

    db_size = CIFP_DB.stat().st_size / (1024 * 1024)
    print(f"\n  Database: {CIFP_DB} ({db_size:.1f} MB)")
    print("  === Done ===\n")


if __name__ == "__main__":
    build_cifp_pipeline()
