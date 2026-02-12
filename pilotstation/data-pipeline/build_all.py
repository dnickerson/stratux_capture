#!/usr/bin/env python3
"""
PilotStation Data Pipeline — Master Orchestrator
Runs all data processors in sequence with timing and status reporting.
"""

import argparse
import sys
import time

from config import ensure_dirs, DATA_DIR

STEPS = [
    ("nasr",    "build_nasr",    "build_nasr_pipeline",    "NASR airports/navaids/airways/airspace"),
    ("cifp",    "build_cifp",    "build_cifp_pipeline",    "CIFP instrument procedures"),
    ("plates",  "build_plates",  "build_plates_pipeline",  "Approach plate PDFs"),
    ("charts",  "build_charts",  "build_charts_pipeline",  "VFR/IFR chart tiles (GDAL required)"),
    ("terrain", "build_terrain", "build_terrain_pipeline", "SRTM elevation data (NASA auth required)"),
]

STEP_NAMES = [s[0] for s in STEPS]


def main():
    parser = argparse.ArgumentParser(
        description="PilotStation Data Pipeline — Build all aviation data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 build_all.py                    # Run everything
  python3 build_all.py --only nasr cifp   # Run only NASR and CIFP
  python3 build_all.py --skip charts terrain  # Skip long-running steps
  python3 build_all.py --dry-run          # Show what would be done
        """,
    )
    parser.add_argument("--only", nargs="+", choices=STEP_NAMES,
                        help="Run only these steps")
    parser.add_argument("--skip", nargs="+", choices=STEP_NAMES,
                        help="Skip these steps")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be done without doing it")
    args = parser.parse_args()

    print("=" * 60)
    print("  PilotStation Data Pipeline")
    print("=" * 60)

    ensure_dirs()
    t_total = time.time()
    results = []

    for name, module_name, func_name, description in STEPS:
        if args.only and name not in args.only:
            continue
        if args.skip and name in args.skip:
            print(f"\n  SKIP  {name}: {description}")
            results.append((name, "SKIP", 0))
            continue

        print(f"\n{'=' * 60}")
        print(f"  STEP: {name} — {description}")
        print(f"{'=' * 60}")

        if args.dry_run:
            print(f"  [dry-run] Would run {module_name}.{func_name}()")
            results.append((name, "DRY-RUN", 0))
            continue

        t0 = time.time()
        try:
            module = __import__(module_name)
            func = getattr(module, func_name)
            func()
            elapsed = time.time() - t0
            print(f"\n  OK  {name} ({_fmt_time(elapsed)})")
            results.append((name, "OK", elapsed))
        except SystemExit:
            elapsed = time.time() - t0
            print(f"\n  FAIL  {name} ({_fmt_time(elapsed)})")
            results.append((name, "FAIL", elapsed))
        except Exception as e:
            elapsed = time.time() - t0
            print(f"\n  FAIL  {name} ({_fmt_time(elapsed)}): {e}")
            results.append((name, "FAIL", elapsed))

    total_elapsed = time.time() - t_total

    # Results summary
    print(f"\n{'=' * 60}")
    print(f"  RESULTS")
    print(f"{'=' * 60}")
    for name, status, elapsed in results:
        time_str = _fmt_time(elapsed) if elapsed > 0 else ""
        print(f"  {status:8s}  {name:10s}  {time_str}")
    print(f"\n  Total time: {_fmt_time(total_elapsed)}")

    # Data size summary
    if not args.dry_run:
        _print_sizes()

    # Transfer instructions
    print(f"\n{'=' * 60}")
    print(f"  TRANSFER TO PI")
    print(f"{'=' * 60}")
    print(f"  Package:  tar czf pilotstation-data.tar.gz -C {DATA_DIR} nasr/ cifp/ plates/ tiles/ terrain/")
    print(f"  Transfer: scp pilotstation-data.tar.gz pi@192.168.10.1:/tmp/")
    print(f"  Install:  ssh pi@192.168.10.1 'tar xzf /tmp/pilotstation-data.tar.gz -C /boot/firmware/pilotstation/'")
    print()


def _print_sizes():
    """Print size of each data directory."""
    print(f"\n  Data sizes:")
    total = 0
    for subdir in ["nasr", "cifp", "plates", "tiles", "terrain"]:
        path = DATA_DIR / subdir
        if path.exists():
            size = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
            total += size
            print(f"    {subdir:10s}  {size / (1024*1024):.1f} MB")
    print(f"    {'TOTAL':10s}  {total / (1024*1024):.1f} MB")


def _fmt_time(seconds):
    """Format seconds to human-readable string."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        return f"{seconds/60:.1f}m"
    else:
        return f"{seconds/3600:.1f}h"


if __name__ == "__main__":
    main()
