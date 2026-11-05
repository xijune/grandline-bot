#!/usr/bin/env python3
"""
Boucle quête adaptative - lit l'état serveur et agit (combat / fouille / talk / walk).

Méthodo : plan offline (quest_core) -> exécution live ici -> rapport artifacts/.

Usage:
  export GL_EMAIL=... GL_PASSWORD=...
  python src/launcher/quest_loop.py --steps 12
  python src/launcher/quest_loop.py --steps 5 --no-travel
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
from pure_api_farm import decide, execute  # noqa: E402
from quest_core import plan  # noqa: E402

NPCS_PATH = ROOT / "docs" / "data" / "npcs.json"


def load_npcs(map_id: str) -> list[dict]:
    if not NPCS_PATH.exists():
        return []
    data = json.loads(NPCS_PATH.read_text())
    return list(data.get(map_id) or [])


def get_objectives(token: str, char_id: str) -> list[dict]:
    st, data = http("GET", f"/api/characters/{char_id}/quest-objectives", token=token)
    if st != 200 or not isinstance(data, dict):
        return []
    return list(data.get("objectifs") or [])


def rest_if_needed(token: str, char_id: str) -> dict:
    st, data = http(
        "POST",
        "/api/world/rest",
        {"characterId": char_id, "kind": "BELLE_ETOILE"},
        token,
    )
    return {"status": st, "data": data}


def fight_quest(token: str, char_id: str, objectif_id: str, timeout: float = 120) -> dict:
    st, start = http(
        "POST",
        "/api/battles/start",
        {"characterId": char_id, "objectifId": objectif_id},
        token,
    )
    if st != 200 or not isinstance(start, dict):
        return {"error": "start", "status": st, "data": start}
    bid = start.get("id")
    if not bid:
        return {"error": "no id", "data": start}
    http("POST", f"/api/battles/{bid}/engage", {"characterId": char_id}, token)
    logs: list[str] = []
    banned: set = set()
    hp_before = None
    t0 = time.time()
    while time.time() - t0 < timeout:
        st, s = http("GET", f"/api/battles/{bid}", token=token)
        if not s:
            time.sleep(0.2)
            continue
        if hp_before is None:
            me = next((f for f in s.get("fighters") or [] if f.get("id") == char_id), {})
            hp_before = me.get("hp")
        if s.get("winner") or s.get("finished"):
            me = next((f for f in s.get("fighters") or [] if f.get("id") == char_id), {})
            return {
                "winner": s.get("winner"),
                "hpDelta": (me.get("hp") or 0) - (hp_before or 0),
                "logs": logs,
                "battleId": bid,
            }
        if s.get("tactics", {}).get("placementDone") is False:
            http("POST", f"/api/battles/{bid}/engage", {"characterId": char_id}, token)
            time.sleep(0.3)
            continue
        my_turn = s.get("yourTurn") is True or (s.get("tactics") or {}).get("yourTurn") is True
        if not my_turn:
            time.sleep(0.2)
            continue
        decision = decide(s, char_id, banned)
        logs.append(decision.get("reason") or decision["type"])
        st2, _ = execute(token, char_id, bid, decision)
        if st2 == 409:
            banned.add(json.dumps(decision, sort_keys=True, default=str)[:120])
            logs.append("BAN409")
            http("POST", f"/api/battles/{bid}/end-turn", {"characterId": char_id}, token)
        time.sleep(0.12)
    return {"error": "timeout", "logs": logs, "battleId": bid}


def quest_search(token: str, char_id: str, objectif_id: str) -> dict:
    st, data = http(
        "POST",
        f"/api/characters/{char_id}/quest-search",
        {"objectifId": objectif_id},
        token,
    )
    return {"status": st, "data": data}


def campaign_talk(token: str, char_id: str, npc: str) -> dict:
    st, data = http(
        "POST",
        f"/api/characters/{char_id}/campaign/talk",
        {"npc": npc},
        token,
    )
    return {"status": st, "data": data}


def try_simple_travel(token: str, char_id: str, island_id: str) -> dict:
    st, data = http(
        "POST",
        "/api/world/travel",
        {"characterId": char_id, "islandId": island_id},
        token,
    )
    if st == 200:
        return {"method": "travel", "status": st, "data": data}
    st1, d1 = http(
        "POST",
        "/api/sea/depart",
        {"characterId": char_id, "mode": "navire"},
        token,
    )
    st2, d2 = http(
        "POST",
        "/api/sea/cap",
        {"characterId": char_id, "islandId": island_id},
        token,
    )
    plan_ = (d2 or {}).get("plan") if isinstance(d2, dict) else None
    tiles = (plan_ or {}).get("tiles") if isinstance(plan_, dict) else None
    if isinstance(tiles, list):
        for t in tiles[-3:]:
            http(
                "POST",
                "/api/sea/position",
                {
                    "characterId": char_id,
                    "col": t.get("col"),
                    "row": t.get("row"),
                    "x": t.get("x"),
                    "y": t.get("y"),
                },
                token,
            )
            time.sleep(2.8)
    st3, d3 = http(
        "POST",
        "/api/sea/dock",
        {"characterId": char_id, "islandId": island_id},
        token,
    )
    return {
        "method": "sea",
        "depart": {"status": st1, "data": d1},
        "cap": {"status": st2, "data": d2},
        "dock": {"status": st3, "data": d3},
    }


def run_loop(
    token: str,
    char_id: str,
    *,
    max_steps: int = 10,
    allow_travel: bool = True,
    verbose: bool = True,
) -> list[dict]:
    history: list[dict] = []
    tried_talks: set[str] = set()
    walk_fails: dict[str, int] = {}
    world: HeadlessWorld | None = None

    def log(msg: str):
        if verbose:
            print(msg)

    try:
        world = HeadlessWorld(token, char_id)
        world.connect()
        log(f"joined {world.map_id} @ ({world.x},{world.y})")
    except Exception as e:
        log(f"world connect failed ({e}) - walk disabled, REST only")
        world = None

    for step in range(1, max_steps + 1):
        char = get_char(token, char_id)
        if world and world.x is not None:
            char = {**char, "x": world.x, "y": world.y}
            if world.map_id:
                char["mapId"] = world.map_id
        map_id = char.get("mapId") or (world.map_id if world else None)
        objectives = get_objectives(token, char_id)
        npcs = load_npcs(map_id or "")
        action = plan(char, objectives, npcs, tried_talks=tried_talks)
        entry: dict = {
            "step": step,
            "map": map_id,
            "pos": [char.get("x"), char.get("y")],
            "campaign": char.get("campaign"),
            "n_obj": len(objectives),
            "objectives": [o.get("id") for o in objectives],
            "action": action,
        }
        log(f"\n[{step}/{max_steps}] {action.get('type')} - {action.get('reason')}")

        typ = action.get("type")
        if typ == "idle":
            entry["result"] = "stop"
            history.append(entry)
            break

        if typ == "rest":
            entry["result"] = rest_if_needed(token, char_id)
            history.append(entry)
            continue

        if typ == "walk":
            tx, ty = int(action["x"]), int(action["y"])
            target_key = action.get("npc") or action.get("objectifId") or f"{tx},{ty}"
            ok = False
            if world:
                try:
                    if world.map_id != map_id:
                        world.connect(carte=map_id)
                    ok = world.walk_to(tx, ty)
                    if not ok:
                        world.refresh_pos_rest()
                except Exception as e:
                    entry["walk_error"] = str(e)
            entry["result"] = {
                "ok": ok,
                "pos": [getattr(world, "x", None), getattr(world, "y", None)],
            }
            if not ok:
                walk_fails[target_key] = walk_fails.get(target_key, 0) + 1
                if walk_fails[target_key] >= 2 and action.get("npc"):
                    tried_talks.add(action["npc"])
                    log(f"  walk fail x{walk_fails[target_key]} -> skip {action['npc']}")
            else:
                walk_fails[target_key] = 0
            history.append(entry)
            continue

        if typ == "fight_quest":
            oid = action["objectifId"]
            if world and action.get("x") is not None:
                try:
                    world.walk_to(int(action["x"]), int(action["y"]))
                except Exception:
                    pass
            res = fight_quest(token, char_id, oid)
            entry["result"] = res
            history.append(entry)
            log(f"  fight -> {res.get('winner') or res.get('error')} hpΔ={res.get('hpDelta')}")
            if res.get("winner") == "ALLIE":
                tried_talks.clear()
            continue

        if typ == "search":
            oid = action["objectifId"]
            res = quest_search(token, char_id, oid)
            entry["result"] = res
            if res.get("status") == 409 and action.get("fallback_fight"):
                entry["fallback_fight"] = fight_quest(token, char_id, oid)
            history.append(entry)
            if res.get("status") == 200:
                tried_talks.clear()
            continue

        if typ == "talk":
            npc = action["npc"]
            res = campaign_talk(token, char_id, npc)
            data = res.get("data") if isinstance(res.get("data"), dict) else {}
            entry["result"] = {
                "status": res.get("status"),
                "resolved": data.get("resolved"),
                "error": data.get("error"),
            }
            st = res.get("status")
            if st == 200 and data.get("resolved"):
                log(f"  resolved {[r.get('id') for r in data['resolved']]}")
                tried_talks.clear()
            elif st == 409:
                log(f"  409 {data.get('error')}")
            else:
                tried_talks.add(npc)
                log(f"  no resolve, skip {npc}")
            history.append(entry)
            continue

        if typ == "travel_hint":
            if not allow_travel:
                entry["result"] = "travel disabled"
                history.append(entry)
                break
            island = action["islandId"]
            log(f"  travel -> {island}")
            res = try_simple_travel(token, char_id, island)
            entry["result"] = res
            history.append(entry)
            tried_talks.clear()
            if world:
                try:
                    world.disconnect()
                except Exception:
                    pass
                try:
                    world = HeadlessWorld(token, char_id)
                    world.connect()
                    log(f"  rejoined {world.map_id} @ ({world.x},{world.y})")
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
    ap = argparse.ArgumentParser(description="Adaptive quest loop")
    ap.add_argument("--steps", type=int, default=10)
    ap.add_argument("--no-travel", action="store_true")
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
        f"char {char.get('name')} {char.get('mapId')} ({char.get('x')},{char.get('y')}) "
        f"lvl {char.get('level')} campaign {char.get('campaign')}"
    )

    history = run_loop(
        token,
        cid,
        max_steps=args.steps,
        allow_travel=not args.no_travel,
    )

    char = get_char(token, cid)
    print(
        f"\nDONE campaign={char.get('campaign')} xp={char.get('xp')} "
        f"pos={char.get('mapId')} ({char.get('x')},{char.get('y')})"
    )

    out = args.out or str(
        ROOT / "artifacts" / f"quest_loop_{time.strftime('%Y%m%d_%H%M%S')}.json"
    )
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(history, indent=2, ensure_ascii=False, default=str))
    print(f"report {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
