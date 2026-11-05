#!/usr/bin/env python3
"""Installe une capture walkable (méthodo A -> C).

Usage:
  python tools/install_walkable_fixture.py path/to/dump.json
  # ou stdin :
  cat dump.json | python tools/install_walkable_fixture.py -

Écrit :
  tests/fixtures/map/<mapId>_walkable.json
  docs/data/maps/<mapId>_walkable.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python tools/install_walkable_fixture.py <file|->")
        return 1
    src = sys.argv[1]
    raw = sys.stdin.read() if src == "-" else Path(src).read_text(encoding="utf-8")
    data = json.loads(raw)
    map_id = (data.get("meta") or {}).get("mapId") or data.get("mapId")
    if not map_id:
        print("ERR: mapId manquant")
        return 2
    blocked = data.get("blocked") or []
    if len(blocked) < 10:
        print("ERR: blocked trop petit", len(blocked))
        return 3
    # normalize
    data.setdefault("blockedFormat", "x:y")
    data["blocked"] = [
        (c.replace(",", ":") if isinstance(c, str) else c) for c in blocked
    ]
    for base in (ROOT / "tests" / "fixtures" / "map", ROOT / "docs" / "data" / "maps"):
        base.mkdir(parents=True, exist_ok=True)
        out = base / f"{map_id}_walkable.json"
        out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("wrote", out, "blocked=", len(data["blocked"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
