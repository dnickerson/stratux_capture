#!/usr/bin/env python3
"""
PilotStation Data Pipeline — NASR Data Processor
Parses FAA NASR 28-day subscription fixed-width text files into bundle.json
matching the nasr-db.js importNasrBundle() schema.
"""

import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

from config import (
    TMP_DIR, NASR_OUTPUT_DIR, NASR_URL, NASR_CYCLE_DATE,
    NASR_CYCLE_EXPIRATION, download_file, parse_nasr_latlon,
    ensure_dirs, progress_bar,
)

NASR_ZIP = TMP_DIR / f"nasr_{NASR_CYCLE_DATE}.zip"
EXTRACT_DIR = TMP_DIR / "nasr_extracted"


def download_nasr():
    """Download the NASR subscription zip if not present."""
    return download_file(NASR_URL, NASR_ZIP, f"NASR {NASR_CYCLE_DATE}")


def open_nasr_file(filename):
    """Open a file from the NASR zip, returning a text-line iterator."""
    z = zipfile.ZipFile(NASR_ZIP, "r")
    return z.open(filename)


def parse_airports():
    """Parse APT.txt → list of airport dicts with attached runways.

    APT.txt field positions (1-indexed from FAA layout doc, 0-indexed in code):
      Record type:   0:3    (APT, RWY, ATT, ARS, RMK)
      Site number:   3:14   (links APT to RWY records)
      Facility type: 14:27
      Location ID:   27:31
      State code:    48:50
      City:          93:133
      Facility name: 133:183
      Latitude:      523:538  (DD-MM-SS.SSSSH)
      Longitude:     550:565  (DDD-MM-SS.SSSSH)
      Elevation:     578:585  (tenths of foot MSL, right-justified)
      Status:        840:842  (O=operational, CI=closed indef, CP=closed perm)
      Fuel:          900:940
      Tower:         980:981  (Y/N)
      ICAO:          1210:1217

    RWY.txt field positions (within same file):
      Record type:   0:3    (RWY)
      Site number:   3:14
      Runway ID:     16:23  (e.g., '08L/26R')
      Length ft:     23:28  (right-justified)
      Width ft:      28:32  (right-justified)
      Surface type:  32:44
    """
    print("  Parsing APT.txt (airports + runways)...")
    airports = {}       # site_number -> airport dict
    runways = defaultdict(list)  # site_number -> [runway dicts]
    apt_count = 0
    rwy_count = 0
    skip_count = 0

    with open_nasr_file("APT.txt") as f:
        for raw_line in f:
            line = raw_line.decode("latin-1")
            rec_type = line[0:3]

            if rec_type == "APT":
                status = line[840:842].strip()
                if status != "O":
                    skip_count += 1
                    continue

                site_num = line[3:14].strip()
                loc_id = line[27:31].strip()
                state = line[48:50].strip()
                city = line[93:133].strip()
                name = line[133:183].strip()
                lat = parse_nasr_latlon(line[523:538])
                lon = parse_nasr_latlon(line[550:565])
                elev_raw = line[578:585].strip()
                fuel = line[900:940].strip()
                tower = line[980:981].strip()
                icao_field = line[1210:1217].strip()

                if lat is None or lon is None:
                    skip_count += 1
                    continue

                # Determine ICAO identifier
                if icao_field:
                    icao = icao_field
                elif len(loc_id) == 3 and state and state not in ("CN", "MX"):
                    icao = "K" + loc_id
                else:
                    icao = loc_id

                try:
                    elev_ft = int(round(float(elev_raw))) if elev_raw else 0
                except ValueError:
                    elev_ft = 0

                airports[site_num] = {
                    "icao": icao,
                    "name": name.title(),
                    "city": city.title(),
                    "state": state,
                    "lat": lat,
                    "lon": lon,
                    "elev_ft": elev_ft,
                    "fuel": fuel,
                    "tower": tower == "Y",
                    "runways": [],
                }
                apt_count += 1

            elif rec_type == "RWY":
                site_num = line[3:14].strip()
                rwy_id = line[16:23].strip()
                length_raw = line[23:28].strip()
                width_raw = line[28:32].strip()
                surface = line[32:44].strip()

                try:
                    length_ft = int(length_raw) if length_raw else 0
                except ValueError:
                    length_ft = 0
                try:
                    width_ft = int(width_raw) if width_raw else 0
                except ValueError:
                    width_ft = 0

                if rwy_id and length_ft > 0:
                    runways[site_num].append({
                        "id": rwy_id,
                        "length_ft": length_ft,
                        "width_ft": width_ft,
                        "surface": surface,
                    })
                    rwy_count += 1

    # Attach runways to airports
    for site_num, apt in airports.items():
        apt["runways"] = runways.get(site_num, [])

    airport_list = sorted(airports.values(), key=lambda a: a["icao"])
    print(f"    {apt_count} airports, {rwy_count} runways (skipped {skip_count})")
    return airport_list


def parse_navaids():
    """Parse NAV.txt → list of navaid dicts.

    NAV1 field positions (0-indexed):
      Record type:   0:4    (NAV1)
      Facility ID:   4:8
      Facility type: 8:28
      Official ID:   28:32
      Name:          42:72
      Public use:    280:281  (Y/N)
      Latitude:      371:385  (DD-MM-SS.SSSH)
      Longitude:     396:410  (DDD-MM-SS.SSSH)
      Frequency:     533:539
    """
    print("  Parsing NAV.txt (navaids)...")
    navaids = []
    skip_count = 0
    valid_types = {"VOR", "VOR/DME", "VORTAC", "TACAN", "NDB", "NDB/DME", "DME"}

    with open_nasr_file("NAV.txt") as f:
        for raw_line in f:
            line = raw_line.decode("latin-1")
            if line[0:4] != "NAV1":
                continue

            public = line[280:281].strip()
            if public != "Y":
                skip_count += 1
                continue

            fac_type = line[8:28].strip()
            if fac_type not in valid_types:
                skip_count += 1
                continue

            fac_id = line[4:8].strip()
            official_id = line[28:32].strip()
            name = line[42:72].strip()
            lat = parse_nasr_latlon(line[371:385])
            lon = parse_nasr_latlon(line[396:410])
            freq = line[533:539].strip()

            if lat is None or lon is None:
                skip_count += 1
                continue

            nav_id = official_id or fac_id
            navaids.append({
                "id": nav_id,
                "name": name.title(),
                "type": fac_type,
                "lat": lat,
                "lon": lon,
                "freq": freq,
            })

    # Deduplicate by id (keep first occurrence)
    seen = {}
    unique = []
    for nav in navaids:
        if nav["id"] not in seen:
            seen[nav["id"]] = True
            unique.append(nav)

    unique.sort(key=lambda n: n["id"])
    print(f"    {len(unique)} navaids (skipped {skip_count})")
    return unique


def parse_airways():
    """Parse AWY.txt → list of airway dicts with waypoints and segments.

    AWY1 field positions (0-indexed):
      Record type:      0:4    (AWY1)
      Designation:      4:9    (e.g., 'J1   ', 'V16  ')
      Airway type:      9:10   (blank=federal, A=Alaska, H=Hawaii)
      Sequence number:  10:15  (right-justified numeric)
      Distance next NM: 44:50  (NNN.NN)
      MEA:              74:79  (NNNNN ft)

    AWY2 field positions (0-indexed):
      Record type:      0:4    (AWY2)
      Designation:      4:9
      Airway type:      9:10
      Sequence number:  10:15
      Name:             15:45
      Navaid type:      45:64
      State:            79:81
      Latitude:         83:97   (DD-MM-SS.SSSH)
      Longitude:        97:111  (DDD-MM-SS.SSSH)
      Navaid ID:        116:120
    """
    print("  Parsing AWY.txt (airways)...")
    awy1_data = {}  # (designation, type, seq) -> {dist_nm, mea_ft}
    awy2_data = {}  # (designation, type, seq) -> {name, navtype, lat, lon, id}
    airway_names = set()

    with open_nasr_file("AWY.txt") as f:
        for raw_line in f:
            line = raw_line.decode("latin-1")
            rec_type = line[0:4]

            if rec_type == "AWY1":
                desig = line[4:9].strip()
                awy_type = line[9:10].strip()
                seq_raw = line[10:15].strip()
                dist_raw = line[44:50].strip()
                mea_raw = line[74:79].strip()

                try:
                    seq = int(seq_raw)
                except ValueError:
                    continue

                try:
                    dist_nm = float(dist_raw) if dist_raw else 0.0
                except ValueError:
                    dist_nm = 0.0

                try:
                    mea_ft = int(mea_raw) if mea_raw else 0
                except ValueError:
                    mea_ft = 0

                key = (desig, awy_type, seq)
                awy1_data[key] = {"dist_nm": dist_nm, "mea_ft": mea_ft}
                airway_names.add((desig, awy_type))

            elif rec_type == "AWY2":
                desig = line[4:9].strip()
                awy_type = line[9:10].strip()
                seq_raw = line[10:15].strip()
                name = line[15:45].strip()
                nav_type = line[45:64].strip()
                lat = parse_nasr_latlon(line[83:97])
                lon = parse_nasr_latlon(line[97:111])
                nav_id = line[116:120].strip()

                try:
                    seq = int(seq_raw)
                except ValueError:
                    continue

                key = (desig, awy_type, seq)
                awy2_data[key] = {
                    "name": name.title(),
                    "nav_type": nav_type,
                    "lat": lat,
                    "lon": lon,
                    "nav_id": nav_id,
                }

    # Build airway objects
    airways = []
    for desig, awy_type in sorted(airway_names):
        # Collect all sequence numbers for this airway
        seqs = sorted(
            seq for (d, t, seq) in awy2_data if d == desig and t == awy_type
        )
        if not seqs:
            continue

        waypoints = []
        segments = []

        for i, seq in enumerate(seqs):
            key = (desig, awy_type, seq)
            pt = awy2_data.get(key, {})
            seg = awy1_data.get(key, {})

            if pt.get("lat") is not None and pt.get("lon") is not None:
                wp = {
                    "name": pt.get("name", ""),
                    "lat": pt["lat"],
                    "lon": pt["lon"],
                }
                if pt.get("nav_id"):
                    wp["id"] = pt["nav_id"]
                if pt.get("nav_type"):
                    wp["type"] = pt["nav_type"]
                waypoints.append(wp)

            if i > 0 and seg.get("mea_ft"):
                segments.append({
                    "from_seq": seqs[i - 1],
                    "to_seq": seq,
                    "dist_nm": seg.get("dist_nm", 0.0),
                    "mea_ft": seg.get("mea_ft", 0),
                })

        if len(waypoints) >= 2:
            # Determine airway route type from first character
            route_type = desig[0] if desig else "?"
            airways.append({
                "name": desig,
                "type": route_type,
                "waypoints": waypoints,
                "segments": segments,
            })

    print(f"    {len(airways)} airways")
    return airways


def parse_airspace():
    """Parse ARB.txt → list of ARTCC boundary airspace dicts.

    ARB record field positions (0-indexed):
      ARTCC ID:          0:4
      Altitude structure: 4:5   (H=high, L=low)
      Boundary designator: 5:6
      Center name:       12:52
      Altitude decode:   52:62
      Latitude:          62:76  (DD-MM-SS.SSSH)
      Longitude:         76:90  (DDD-MM-SS.SSSH)
      Description:       90:390
      Sequence:          390:396
    """
    print("  Parsing ARB.txt (ARTCC boundaries)...")
    boundaries = defaultdict(list)  # (artcc_id, alt) -> [(lat, lon, seq, name)]

    with open_nasr_file("ARB.txt") as f:
        for raw_line in f:
            line = raw_line.decode("latin-1")
            artcc_id = line[0:4].strip()
            alt_struct = line[4:5].strip()
            center_name = line[12:52].strip()
            lat = parse_nasr_latlon(line[62:76])
            lon = parse_nasr_latlon(line[76:90])
            seq_raw = line[390:396].strip()

            if lat is None or lon is None:
                continue

            try:
                seq = int(seq_raw) if seq_raw else 0
            except ValueError:
                seq = 0

            key = (artcc_id, alt_struct)
            boundaries[key].append({
                "lat": lat,
                "lon": lon,
                "seq": seq,
                "name": center_name,
            })

    airspace = []
    for (artcc_id, alt_struct), points in sorted(boundaries.items()):
        if len(points) < 3:
            continue
        points.sort(key=lambda p: p["seq"])
        name = points[0]["name"].title() if points[0]["name"] else artcc_id
        alt_label = "HIGH" if alt_struct == "H" else "LOW"
        airspace.append({
            "id": f"{artcc_id}-{alt_struct}",
            "name": name,
            "class": "ARTCC",
            "altitude": alt_label,
            "boundary": [[p["lat"], p["lon"]] for p in points],
        })

    print(f"    {len(airspace)} ARTCC boundaries")

    # Try to parse Class airspace from shapefiles
    class_airspace = parse_class_airspace()
    if class_airspace:
        airspace.extend(class_airspace)

    return airspace


def _simplify_polygon(points, tolerance=0.001):
    """Simplify a polygon using the Douglas-Peucker algorithm.
    tolerance is in degrees (~0.001 deg ≈ 111 meters)."""
    if len(points) <= 3:
        return points

    def _perpendicular_distance(point, line_start, line_end):
        """Distance from point to line segment."""
        dx = line_end[0] - line_start[0]
        dy = line_end[1] - line_start[1]
        if dx == 0 and dy == 0:
            dx = point[0] - line_start[0]
            dy = point[1] - line_start[1]
            return (dx * dx + dy * dy) ** 0.5
        t = ((point[0] - line_start[0]) * dx + (point[1] - line_start[1]) * dy) / (dx * dx + dy * dy)
        t = max(0, min(1, t))
        proj_x = line_start[0] + t * dx
        proj_y = line_start[1] + t * dy
        dx = point[0] - proj_x
        dy = point[1] - proj_y
        return (dx * dx + dy * dy) ** 0.5

    # Iterative Douglas-Peucker to avoid recursion limit
    stack = [(0, len(points) - 1)]
    keep = set()
    keep.add(0)
    keep.add(len(points) - 1)

    while stack:
        start, end = stack.pop()
        max_dist = 0
        max_idx = start
        for i in range(start + 1, end):
            d = _perpendicular_distance(points[i], points[start], points[end])
            if d > max_dist:
                max_dist = d
                max_idx = i
        if max_dist > tolerance:
            keep.add(max_idx)
            stack.append((start, max_idx))
            stack.append((max_idx, end))

    return [points[i] for i in sorted(keep)]


def parse_class_airspace():
    """Parse Class B/C/D/E airspace from shapefiles using pyshp (if available).
    Simplifies polygon boundaries to reduce bundle size."""
    try:
        import shapefile
    except ImportError:
        print("    [skip] Class airspace — pyshp not installed (pip install pyshp)")
        return []

    print("  Parsing Class_Airspace shapefiles...")
    airspace = []

    # Tolerance in degrees: ~0.002 deg ≈ 220m — good for flight planning display
    SIMPLIFY_TOLERANCE = 0.002

    try:
        z = zipfile.ZipFile(NASR_ZIP, "r")
        shp_dir = EXTRACT_DIR / "shapefiles"
        shp_dir.mkdir(parents=True, exist_ok=True)

        for ext in ("shp", "shx", "dbf", "prj"):
            fname = f"Additional_Data/Shape_Files/Class_Airspace.{ext}"
            try:
                z.extract(fname, EXTRACT_DIR)
            except KeyError:
                print(f"    [skip] Missing {fname}")
                return []

        shp_path = EXTRACT_DIR / "Additional_Data" / "Shape_Files" / "Class_Airspace"
        sf = shapefile.Reader(str(shp_path))
        fields = [f[0] for f in sf.fields[1:]]

        total_pts_before = 0
        total_pts_after = 0

        for i, (shape_rec, rec) in enumerate(zip(sf.shapes(), sf.records())):
            rec_dict = dict(zip(fields, rec))

            airspace_class = str(rec_dict.get("CLASS", "")).strip()
            name = str(rec_dict.get("NAME", "")).strip()
            lower = rec_dict.get("LOWER_VAL", 0)
            upper = rec_dict.get("UPPER_VAL", 0)

            if not airspace_class or airspace_class not in ("B", "C", "D", "E"):
                continue

            # Convert shape points to [lat, lon] (shapefile stores as lon, lat)
            boundary = [[round(pt[1], 6), round(pt[0], 6)] for pt in shape_rec.points]

            if len(boundary) < 3:
                continue

            total_pts_before += len(boundary)

            # Simplify polygon to reduce size
            boundary = _simplify_polygon(boundary, SIMPLIFY_TOLERANCE)
            total_pts_after += len(boundary)

            airspace.append({
                "id": f"{name}-{airspace_class}-{i}",
                "name": name.title() if name else f"Class {airspace_class}",
                "class": airspace_class,
                "lower_ft": int(lower) if lower else 0,
                "upper_ft": int(upper) if upper else 0,
                "boundary": boundary,
            })

        reduction = (1 - total_pts_after / total_pts_before) * 100 if total_pts_before else 0
        print(f"    {len(airspace)} Class B/C/D/E airspace areas")
        print(f"    Simplified: {total_pts_before:,} → {total_pts_after:,} points ({reduction:.0f}% reduction)")
        z.close()

    except Exception as e:
        print(f"    [error] Class airspace: {e}")
        return []

    return airspace


def parse_fixes():
    """Parse FIX.txt → list of named fix/waypoint dicts.

    FIX1 field positions (0-indexed):
      Record type: 0:4    (FIX1)
      Fix ID:      4:34   (30 chars, left-justified)
      State name:  34:64
      ICAO region: 64:66
      Latitude:    66:80   (DD-MM-SS.SSSH)
      Longitude:   80:94   (DDD-MM-SS.SSSH)
      Published:   212:213 (Y/N)
    """
    print("  Parsing FIX.txt (named fixes)...")
    fixes = []
    skip_count = 0

    with open_nasr_file("FIX.txt") as f:
        for raw_line in f:
            line = raw_line.decode("latin-1")
            if line[0:4] != "FIX1":
                continue

            published = line[212:213].strip()
            if published != "Y":
                skip_count += 1
                continue

            fix_id = line[4:34].strip()
            lat = parse_nasr_latlon(line[66:80])
            lon = parse_nasr_latlon(line[80:94])

            if not fix_id or lat is None or lon is None:
                skip_count += 1
                continue

            fixes.append({
                "id": fix_id,
                "lat": lat,
                "lon": lon,
            })

    fixes.sort(key=lambda f: f["id"])
    print(f"    {len(fixes)} published fixes (skipped {skip_count})")
    return fixes


def build_nasr_pipeline():
    """Main entry point: download, parse, and write bundle.json."""
    ensure_dirs()

    print("\n=== NASR Data Processor ===")
    print(f"  Cycle: {NASR_CYCLE_DATE} to {NASR_CYCLE_EXPIRATION}")

    # Download if needed
    download_nasr()

    if not NASR_ZIP.exists():
        print("  [error] NASR zip not found!")
        sys.exit(1)

    # Parse all data types
    airports = parse_airports()
    navaids = parse_navaids()
    airways = parse_airways()
    airspace = parse_airspace()
    fixes = parse_fixes()

    # Build cycle info
    cycle_info = {
        "effective_date": NASR_CYCLE_DATE,
        "expiration_date": NASR_CYCLE_EXPIRATION,
    }

    # Assemble bundle
    bundle = {
        "airports": airports,
        "navaids": navaids,
        "airways": airways,
        "airspace": airspace,
        "fixes": fixes,
        "cycle_info": cycle_info,
    }

    # Write bundle.json (compact for size)
    bundle_path = NASR_OUTPUT_DIR / "bundle.json"
    with open(bundle_path, "w") as f:
        json.dump(bundle, f, separators=(",", ":"))
    bundle_size = bundle_path.stat().st_size / (1024 * 1024)

    # Write cycle_info.json (readable, for FastAPI endpoint)
    cycle_path = NASR_OUTPUT_DIR / "cycle_info.json"
    with open(cycle_path, "w") as f:
        json.dump(cycle_info, f, indent=2)

    # Summary
    print(f"\n  === Summary ===")
    print(f"  Airports:  {len(airports):,}")
    print(f"  Navaids:   {len(navaids):,}")
    print(f"  Airways:   {len(airways):,}")
    print(f"  Airspace:  {len(airspace):,}")
    print(f"  Fixes:     {len(fixes):,}")
    print(f"  Bundle:    {bundle_path} ({bundle_size:.1f} MB)")
    print(f"  Cycle:     {cycle_path}")
    print(f"  === Done ===\n")


if __name__ == "__main__":
    build_nasr_pipeline()
