#!/usr/bin/env python3
"""Îles avec service FORGE (craft).

Usage:
  python tools/forge_islands.py
  python tools/forge_islands.py --level 49
  python tools/forge_islands.py --sea east
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ATLAS = ROOT / "docs" / "data" / "atlas.json"

SEA = {
    "east": "East Blue",
    "west": "West Blue",
    "north": "North Blue",
    "south": "South Blue",
    "grandline": "Grand Line",
    "newworld": "New World",
}


def load() -> list[dict]:
    data = json.loads(ATLAS.read_text(encoding="utf-8"))
    islands = data.get("islands") or data.get("iles") or []
    out = []
    for i in islands:
        services = [str(s).upper() for s in (i.get("services") or [])]
        shops = [str(s).upper() for s in (i.get("shops") or [])]
        if "FORGE" not in services and "FORGE" not in shops:
            continue
        out.append(
            {
                "id": i.get("id"),
                "name": i.get("name") or i.get("id"),
                "sea": i.get("sea") or "?",
                "level": int(i.get("niveauRencontre") or i.get("level") or 0),
                "danger": int(i.get("danger") or 0),
                "services": i.get("services") or [],
            }
        )
    out.sort(key=lambda x: (x["level"], x["name"]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--level", "-l", type=int, default=None)
    ap.add_argument("--window", "-w", type=int, default=50)
    ap.add_argument("--sea", "-s", type=str, default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if not ATLAS.exists():
        print(f"ERR: {ATLAS}", file=sys.stderr)
        return 1

    rows = load()
    if args.sea:
        rows = [r for r in rows if r["sea"] == args.sea.lower()]
    if args.level is not None:
        rows = sorted(
            ({**r, "delta": r["level"] - args.level} for r in rows),
            key=lambda r: (abs(r["delta"]), r["level"]),
        )
        # show closest + those in window first
        in_w = [r for r in rows if abs(r["delta"]) <= args.window]
        if in_w:
            rows = in_w

    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
        return 0

    print(f"Îles avec FORGE ({len(rows)})")
    print(f"{'lvl':>5}  {'id':<18} {'name':<28} {'mer':<12}  services")
    print("-" * 90)
    for r in rows:
        d = r.get("delta")
        lvl = f"{r['level']}"
        if d is not None:
            lvl = f"{r['level']} ({d:+d})"
        print(
            f"{lvl:>10}  {r['id']:<18} {r['name']:<28} "
            f"{SEA.get(r['sea'], r['sea']):<12}  {', '.join(r['services'])}"
        )
    if not rows:
        print("(aucune)")
    else:
        print("\nPlus accessible early-game: loguetown (East Blue, lvl ~35)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
