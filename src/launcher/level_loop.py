#!/usr/bin/env python3
"""
Boucle leveling adaptative - farm / quête / daily / travel selon l'état.

Plan pure : tools/level_core.py
Exécution : réutilise headless_world, pure_api_farm, quest_loop.

Usage:
  export GL_EMAIL=... GL_PASSWORD=...
  python src/launcher/level_loop.py --steps 5
  python src/launcher/level_loop.py --steps 3 --no-travel   # farm only si travel bloqué
  python src/launcher/level_loop.py --plan-only             # couche B sur état live
"""

from __future__ import annotations

# Windows console: force UTF-8 to avoid UnicodeEncodeError on arrows/emoji
import sys as _sys
if hasattr(_sys.stdout, "reconfigure"):
    try:
        _sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        _sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "launcher"))
sys.path.insert(0, str(ROOT / "tools"))

from headless_world import HeadlessWorld, get_char, http, login  # noqa: E402
from level_core import plan  # noqa: E402
from sea_travel import (  # noqa: E402
    build_waypoints,
    ensure_travel_ready,
    load_docks,
)

from pure_api_farm import fight  # noqa: E402
import quest_loop as ql  # noqa: E402

KNOWLEDGE_PATH = ROOT / "docs" / "data" / "xp_knowledge.json"


def load_knowledge() -> dict:
    if KNOWLEDGE_PATH.exists():
        return json.loads(KNOWLEDGE_PATH.read_text())
    return {}


def packs_from_world(world: HeadlessWorld | None) -> list[dict]:
    if not world:
        return []
    raw = world.fauna_packs() if hasattr(world, "fauna_packs") else []
    out = []
    for p in raw:
        pid = p.get("id")
        mobs = p.get("mobs") or p.get("groupe") or []
        levels = []
        for m in mobs:
            if isinstance(m, dict):
                levels.append(int(m.get("niveau") or m.get("level") or 0))
        # orbit center as approx position
        ox = oy = None
        if mobs and isinstance(mobs[0], dict):
            orb = mobs[0].get("orbit") or {}
            ox, oy = orb.get("cx"), orb.get("cy")
        out.append(
            {
                "id": pid,
                "max_level": max(levels) if levels else p.get("level"),
                "level": max(levels) if levels else p.get("level"),
                "mobs": mobs,
                "x": ox,
                "y": oy,
                "ox": ox,
                "oy": oy,
                "dead": bool(p.get("dead")),
                "engaged": bool(p.get("engaged")),
            }
        )
    return out


def claim_daily(token: str, char_id: str) -> dict:
    st, data = http("POST", f"/api/characters/{char_id}/daily/claim", {}, token)
    return {"status": st, "data": data}


def try_claim_tasks(token: str, char_id: str, taches: dict) -> list[dict]:
    results = []
    reclamees = set(taches.get("reclamees") or [])
    for tid in taches.get("ids") or []:
        if tid in reclamees:
            continue
        st, data = http(
            "POST",
            f"/api/characters/{char_id}/daily/taches/{tid}/reclamer",
            {},
            token,
        )
        results.append({"id": tid, "status": st, "data": data})
    return results



def sea_travel_to(
    token: str,
    char_id: str,
    island_id: str,
    world: HeadlessWorld | None,
    *,
    verbose: bool = True,
) -> dict:
    """Travel mer complet vers island_id."""
    def log(m):
        if verbose:
            print(m)

    char = get_char(token, char_id)
    prep = ensure_travel_ready(http, token, char_id, char)
    log(f"  travel prep {prep}")

    docks = load_docks()
    dock = docks.get(char.get("mapId") or "") or {}
    dx, dy = dock.get("x"), dock.get("y")
    if world and dx is not None:
        try:
            world.walk_to(int(dx), int(dy))
            log(f"  ponton ({world.x},{world.y})")
        except Exception as e:
            log(f"  walk ponton fail {e}")

    # depart
    st, dep = http(
        "POST",
        "/api/sea/depart",
        {"characterId": char_id, "mode": "navire"},
        token,
    )
    if st != 200:
        for sortie in ("sud", "ouest", "est", "nord"):
            st, dep = http(
                "POST",
                "/api/sea/depart",
                {"characterId": char_id, "mode": "navire", "sortie": sortie},
                token,
            )
            if st == 200:
                break
    if st != 200:
        return {"error": "depart", "status": st, "data": dep, "prep": prep}

    st, cap = http(
        "POST",
        "/api/sea/cap",
        {"characterId": char_id, "islandId": island_id},
        token,
    )
    if st != 200:
        return {"error": "cap", "status": st, "data": cap, "prep": prep}
    plan = (cap or {}).get("plan") or {}
    waypoints = build_waypoints(plan)
    log(f"  plan tiles={len(plan.get('tiles') or [])} waypoints={len(waypoints)}")

    for i, wp in enumerate(waypoints):
        body = {"characterId": char_id, **wp}
        for attempt in range(10):
            st, pos = http("POST", "/api/sea/position", body, token)
            if st == 200:
                break
            err = str((pos or {}).get("error") if isinstance(pos, dict) else pos)
            if "vite" in err.lower():
                time.sleep(2.4)
                continue
            break
        time.sleep(1.8)

    st, dock_res = http(
        "POST",
        "/api/sea/dock",
        {"characterId": char_id, "islandId": island_id},
        token,
    )
    return {
        "depart": "ok",
        "cap": "ok",
        "waypoints": len(waypoints),
        "dock": {"status": st, "data": dock_res},
        "prep": prep,
    }


def run_loop(
    token: str,
    char_id: str,
    *,
    max_steps: int = 5,
    allow_travel: bool = True,
    plan_only: bool = False,
    verbose: bool = True,
) -> list[dict]:
    knowledge = load_knowledge()
    history: list[dict] = []
    tried_islands: set[str] = set()
    world: HeadlessWorld | None = None

    def log(msg: str):
        if verbose:
            print(msg)

    try:
        world = HeadlessWorld(token, char_id)
        world.connect()
        log(f"joined {world.map_id} @ ({world.x},{world.y})")
    except Exception as e:
        log(f"world connect failed: {e}")
        world = None

    for step in range(1, max_steps + 1):
        char = get_char(token, char_id)
        if world and world.x is not None:
            char = {**char, "x": world.x, "y": world.y}
            if world.map_id:
                char["mapId"] = world.map_id

        objectives = ql.get_objectives(token, char_id)
        st_d, daily = http("GET", f"/api/characters/{char_id}/daily", token=token)
        if st_d != 200:
            daily = {}
        packs = packs_from_world(world)

        action = plan(
            char,
            objectives,
            packs=packs,
            daily=daily if isinstance(daily, dict) else {},
            knowledge=knowledge,
            tried_islands=tried_islands,
        )
        entry = {
            "step": step,
            "level": char.get("level"),
            "xp": char.get("xp"),
            "map": char.get("mapId"),
            "campaign": char.get("campaign"),
            "n_obj": len(objectives),
            "n_packs": len(packs),
            "action": action,
        }
        log(
            f"\n[{step}/{max_steps}] lvl={char.get('level')} xp={char.get('xp')} "
            f"-> {action.get('type')} - {action.get('reason')}"
        )

        if plan_only:
            history.append(entry)
            break

        typ = action.get("type")
        if typ == "idle":
            entry["result"] = "stop"
            history.append(entry)
            break

        if typ == "rest":
            entry["result"] = ql.rest_if_needed(token, char_id)
            history.append(entry)
            continue

        if typ == "daily_claim":
            entry["result"] = claim_daily(token, char_id)
            history.append(entry)
            continue

        if typ == "quest":
            # delegate one step of quest behaviour via plan from quest_core path
            # walk + fight/search/talk handled by a short quest_loop run
            sub = ql.run_loop(
                token,
                char_id,
                max_steps=3,
                allow_travel=False,
                verbose=verbose,
            )
            entry["result"] = {"quest_steps": sub}
            # refresh world after quest
            if world:
                try:
                    world.disconnect()
                except Exception:
                    pass
                try:
                    world = HeadlessWorld(token, char_id)
                    world.connect()
                except Exception:
                    world = None
            history.append(entry)
            continue

        if typ == "farm":
            pack = action.get("pack") or {}
            pid = pack.get("id")
            if not pid:
                entry["result"] = {"error": "no pack"}
                history.append(entry)
                continue
            # walk to pack if coords
            ox, oy = pack.get("ox") or pack.get("x"), pack.get("oy") or pack.get("y")
            if world and ox is not None and oy is not None:
                try:
                    world.walk_to(int(ox), int(oy))
                except Exception as e:
                    entry["walk_error"] = str(e)
            # pure_api_farm.fight expects fauna pack id
            try:
                res = fight(token, char_id, pid)
            except Exception as e:
                res = {"error": str(e)}
            entry["result"] = res
            log(f"  farm {pid} -> {res.get('winner') or res.get('error')} "
                f"hpΔ={res.get('hpDelta')}")
            history.append(entry)
            # rejoin fauna
            if world:
                try:
                    world.connect()
                except Exception:
                    pass
            continue

        if typ == "travel":
            if not allow_travel:
                entry["result"] = "travel disabled"
                history.append(entry)
                tried_islands.add(action["islandId"])
                continue
            island = action["islandId"]
            log(f"  travel -> {island}")
            res = sea_travel_to(token, char_id, island, world, verbose=verbose)
            entry["result"] = res
            history.append(entry)
            dock = (res or {}).get("dock") or {}
            ok = dock.get("status") == 200
            if not ok:
                tried_islands.add(island)
            if world:
                try:
                    world.disconnect()
                except Exception:
                    pass
                try:
                    world = HeadlessWorld(token, char_id)
                    world.connect()
                    log(f"  map now {world.map_id} @ ({world.x},{world.y})")
                except Exception as e:
                    log(f"  rejoin failed: {e}")
                    world = None
            continue

        entry["result"] = "unhandled"
        history.append(entry)

    if world:
        try:
            world.disconnect()
        except Exception:
            pass
    return history


def main() -> int:
    ap = argparse.ArgumentParser(description="Adaptive leveling loop")
    ap.add_argument("--steps", type=int, default=5)
    ap.add_argument("--no-travel", action="store_true")
    ap.add_argument("--plan-only", action="store_true")
    ap.add_argument("--out", type=str, default="")
    args = ap.parse_args()

    email = os.getenv("GL_EMAIL", "")
    password = os.getenv("GL_PASSWORD", "")
    if not email or not password:
        print("Set GL_EMAIL and GL_PASSWORD", file=sys.stderr)
        return 1

    token = login(email, password)
    char = get_char(token)
    cid = char["id"]
    print(
        f"char {char.get('name')} lvl={char.get('level')} xp={char.get('xp')} "
        f"{char.get('mapId')} ({char.get('x')},{char.get('y')}) "
        f"campaign={char.get('campaign')}"
    )

    # opportunistic task claims
    tasks = try_claim_tasks(token, cid, char.get("tachesDuJour") or {})
    if tasks:
        print("task claims", [(t["id"], t["status"]) for t in tasks])

    history = run_loop(
        token,
        cid,
        max_steps=args.steps,
        allow_travel=not args.no_travel,
        plan_only=args.plan_only,
    )

    char = get_char(token, cid)
    print(
        f"\nDONE lvl={char.get('level')} xp={char.get('xp')} "
        f"map={char.get('mapId')} campaign={char.get('campaign')}"
    )

    out = args.out or str(
        ROOT / "artifacts" / f"level_loop_{time.strftime('%Y%m%d_%H%M%S')}.json"
    )
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(history, indent=2, ensure_ascii=False, default=str))
    print(f"report {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
