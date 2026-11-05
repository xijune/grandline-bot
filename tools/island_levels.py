#!/usr/bin/env python3
"""
Îles GrandLine → niveaux recommandés (atlas live dump).

Usage:
  python tools/island_levels.py
  python tools/island_levels.py --level 12
  python tools/island_levels.py --level 12 --sea west
  python tools/island_levels.py --json
  python tools/island_levels.py --all

Source: docs/data/atlas.json (level / niveauRencontre / niveauDeRoute)
Fenêtre farm: ± WINDOW (défaut 3, comme xp_knowledge farm_level_window)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ATLAS = ROOT / "docs" / "data" / "atlas.json"
XP_K = ROOT / "docs" / "data" / "xp_knowledge.json"

SEA_LABEL = {
    "east": "East Blue",
    "west": "West Blue",
    "north": "North Blue",
    "south": "South Blue",
    "grandline": "Grand Line",
    "newworld": "New World",
}


def load_islands() -> list[dict]:
    data = json.loads(ATLAS.read_text(encoding="utf-8"))
    islands = data.get("islands") or data.get("iles") or []
    if not islands:
        for v in data.values():
            if isinstance(v, list) and v and isinstance(v[0], dict) and "level" in v[0]:
                islands = v
                break
    out = []
    for i in islands:
        if not i.get("id") or i.get("id") == "event-pvp":
            continue
        lvl = int(i.get("niveauRencontre") or i.get("level") or 0)
        out.append(
            {
                "id": i.get("id"),
                "name": i.get("name") or i.get("id"),
                "sea": i.get("sea") or "?",
                "level": int(i.get("level") or lvl),
                "rencontre": lvl,
                "route": int(i.get("niveauDeRoute") or 0),
                "danger": int(i.get("danger") or 0),
                "faction": i.get("faction") or "",
                "pvp": bool(i.get("pvp")),
                "arc": i.get("arc") or "",
            }
        )
    out.sort(key=lambda x: (x["rencontre"], x["route"], x["name"]))
    return out


def farm_window() -> int:
    if XP_K.exists():
        try:
            rules = (json.loads(XP_K.read_text(encoding="utf-8")).get("rules") or {})
            return int(rules.get("farm_level_window") or 3)
        except Exception:
            pass
    return 3


def recommend(islands: list[dict], level: int, window: int, sea: str | None) -> list[dict]:
    lo, hi = max(1, level - window), level + window
    picks = []
    for i in islands:
        if sea and i["sea"] != sea:
            continue
        r = i["rencontre"]
        if lo <= r <= hi:
            # score: closer to player level better; slight prefer non-pvp
            dist = abs(r - level)
            score = dist * 10 + (5 if i["pvp"] else 0) + i["danger"]
            picks.append({**i, "score": score, "delta": r - level})
    picks.sort(key=lambda x: (x["score"], x["rencontre"], x["name"]))
    return picks


def print_table(rows: list[dict], title: str) -> None:
    print(f"\n=== {title} ===")
    print(f"{'lvl':>4}  {'Δ':>3}  {'id':<18} {'name':<28} {'mer':<12} {'route':>5} {'dang':>4}  pvp")
    print("-" * 90)
    for i in rows:
        sea = SEA_LABEL.get(i["sea"], i["sea"])
        delta = i.get("delta")
        dlt = f"{delta:+d}" if delta is not None else ""
        print(
            f"{i['rencontre']:>4}  {dlt:>3}  {i['id']:<18} {i['name']:<28} "
            f"{sea:<12} {i['route']:>5} {i['danger']:>4}  {'oui' if i['pvp'] else '-'}"
        )


def main() -> int:
    ap = argparse.ArgumentParser(description="Îles GrandLine par niveau")
    ap.add_argument("--level", "-l", type=int, default=None, help="Niveau du perso")
    ap.add_argument("--window", "-w", type=int, default=None, help="Fenêtre farm ±N (défaut 3)")
    ap.add_argument("--sea", "-s", type=str, default=None, help="Filtrer mer: east west north south grandline newworld")
    ap.add_argument("--all", action="store_true", help="Lister toutes les îles")
    ap.add_argument("--json", action="store_true", help="Sortie JSON")
    ap.add_argument("--top", type=int, default=15, help="Max recommandations")
    args = ap.parse_args()

    if not ATLAS.exists():
        print(f"ERR: atlas manquant: {ATLAS}", file=sys.stderr)
        return 1

    islands = load_islands()
    window = args.window if args.window is not None else farm_window()
    sea = args.sea.lower().strip() if args.sea else None

    if args.level is not None:
        picks = recommend(islands, args.level, window, sea)[: args.top]
        if args.json:
            print(json.dumps({"level": args.level, "window": window, "islands": picks}, indent=2, ensure_ascii=False))
        else:
            print(f"Perso niveau {args.level} · fenêtre ±{window}" + (f" · mer={sea}" if sea else ""))
            print("→ îles dont niveauRencontre est dans ta zone de farm")
            print_table(picks, f"Recommandé pour lvl {args.level}")
            if not picks:
                print("(aucune île dans la fenêtre — élargis avec --window 5)")
            # also show progression band
            bands = {}
            for i in islands:
                if sea and i["sea"] != sea:
                    continue
                bands.setdefault(i["rencontre"], []).append(i["id"])
            print("\nRappel: farm efficace ≈ mobs lvl perso±window (xp_knowledge).")
        return 0

    # listing
    rows = [i for i in islands if not sea or i["sea"] == sea]
    if not args.all:
        # compact: group by level, show first few names
        if args.json:
            print(json.dumps(rows, indent=2, ensure_ascii=False))
            return 0
        print("Îles par niveau de rencontre (atlas)")
        print(f"{'lvl':>4}  îles")
        print("-" * 70)
        by_lvl: dict[int, list[str]] = {}
        for i in rows:
            by_lvl.setdefault(i["rencontre"], []).append(f"{i['id']}({SEA_LABEL.get(i['sea'], i['sea'])[:1]})")
        for lvl in sorted(by_lvl):
            names = ", ".join(by_lvl[lvl][:8])
            extra = f" +{len(by_lvl[lvl])-8}" if len(by_lvl[lvl]) > 8 else ""
            print(f"{lvl:>4}  {names}{extra}")
        print(f"\n{len(rows)} îles · utilise --level N pour des conseils farm · --all pour le détail")
        return 0

    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
    else:
        print_table([{**i, "delta": None} for i in rows], "Toutes les îles")
        print(f"\nTotal: {len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
