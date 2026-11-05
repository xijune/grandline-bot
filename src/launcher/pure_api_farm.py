#!/usr/bin/env python3
"""
Farm combat API + découverte live des packs (socket world:join).

Les IDs fauna sont dynamiques - les listes hardcodées meurent vite
(409 « Ce groupe n'existe pas ici »). Par défaut on joint le monde
via socket pour lister les packs proches, puis on combat en REST.

Prérequis :
  - GL_EMAIL / GL_PASSWORD
  - perso assez proche des packs (sinon 409 trop loin -> utiliser headless_world --farm)
  - python-socketio[client] recommandé pour la découverte live

  export GL_EMAIL=... GL_PASSWORD=...
  python src/launcher/pure_api_farm.py --fights 8
  python src/launcher/pure_api_farm.py --packs id1,id2 --fights 3
  python src/launcher/headless_world.py --farm 5   # walk + farm

Voir docs/guide/testing.md
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
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.grandline-online.fr"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
ROOT = Path(__file__).resolve().parents[2]


def http(method: str, path: str, body=None, token: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    headers = {
        "content-type": "application/json",
        "user-agent": UA,
        "accept": "application/json",
    }
    if token:
        headers["authorization"] = "Bearer " + token
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw}


def dist(a, b):
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])


def action_range(a):
    if a.get("kind") == "ATTAQUE":
        return 1
    g = a.get("geometry") or {}
    return g.get("range", a.get("range", 1))


def action_pa(a):
    if a.get("kind") in ("GARDE", "FUITE"):
        return 0
    if a.get("kind") == "ATTAQUE":
        return max(2, a.get("pa") or a.get("cost") or 2)
    return a.get("pa") or a.get("cost") or 99


def avg_est(est):
    if not est:
        return 0
    return ((est.get("min") or 0) + (est.get("max") or 0)) / 2


def enemy_max_range(e):
    m = 1
    for t in e.get("techniques") or []:
        r = (t.get("geometry") or {}).get("range", t.get("range", 1))
        if isinstance(r, (int, float)) and r > m:
            m = r
    return m


def my_max_range(actions):
    m = 1
    for a in actions:
        if a.get("kind") in ("FUITE", "GARDE", "ATTAQUE"):
            continue
        m = max(m, action_range(a))
    return max(m, 1)


def has_los(frm, to, obstacles):
    if not frm or not to:
        return False
    obs = {f"{o['x']}:{o['y']}" for o in (obstacles or [])}
    if not obs:
        return True
    x0, y0, x1, y1 = frm["x"], frm["y"], to["x"], to["y"]
    dx, dy = abs(x1 - x0), abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx - dy
    while not (x0 == x1 and y0 == y1):
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x0 += sx
        if e2 < dx:
            err += dx
            y0 += sy
        if x0 == x1 and y0 == y1:
            break
        if f"{x0}:{y0}" in obs:
            return False
    return True


def decide(s, char_id, banned):
    banned = banned or set()
    me_id = s.get("you") or char_id
    tactics = s.get("tactics") or {}
    positions = tactics.get("positions") or {}
    my_pos = positions.get(me_id)
    if not my_pos:
        return {"type": "endturn", "reason": "no pos"}
    ap = int(tactics.get("ap") or 0)
    mp = int(tactics.get("mp") or 0)
    actions = [
        a
        for a in (s.get("actions") or [])
        if a.get("usable") is not False and not a.get("locked")
    ]
    enemies = []
    for f in s.get("fighters") or []:
        if f.get("team") != "ENNEMI" or (f.get("hp") or 0) <= 0:
            continue
        pos = positions.get(f["id"])
        if not pos:
            continue
        enemies.append({**f, "pos": pos, "d": dist(my_pos, pos)})
    enemies.sort(key=lambda e: e["d"])
    if not enemies:
        return {"type": "endturn", "reason": "no enemies"}

    max_r = my_max_range(actions)
    max_pm = max((e.get("caracs") or {}).get("pm", 3) for e in enemies)
    max_er = max(enemy_max_range(e) for e in enemies)
    sweet = min(max_r, max(4, max_pm + max_er + 1))
    cur_min = enemies[0]["d"]
    threatened = any(
        e["d"] <= (e.get("caracs") or {}).get("pm", 3) + enemy_max_range(e)
        for e in enemies
    )
    reachable = [c for c in (tactics.get("reachable") or []) if (c.get("cost") or 0) <= mp]
    ranged = max_r >= 4
    obstacles = tactics.get("obstacles") or []

    # KITE FIRST
    if threatened and mp > 0 and reachable and ranged:
        best = None
        for c in reachable:
            dmin = min(dist(c, e["pos"]) for e in enemies)
            score = 1000 + dmin if dmin >= sweet else (dmin * 10 if dmin > cur_min else dmin)
            if any(dist(c, e["pos"]) <= max_r for e in enemies):
                score += 50
            if not best or score > best["score"]:
                best = {"cell": c, "score": score, "d": dmin}
        if best and best["d"] > cur_min:
            return {
                "type": "move",
                "cell": best["cell"],
                "reason": f"KITE {cur_min}->{best['d']}",
            }

    if ap <= 0:
        return {"type": "endturn", "reason": f"AP0 d={cur_min}"}

    best = None
    for a in actions:
        if a.get("kind") in ("FUITE", "GARDE"):
            continue
        if ranged and a.get("kind") == "ATTAQUE":
            continue
        rng = action_range(a)
        pa = action_pa(a)
        if pa > ap:
            continue
        needs_sight = a.get("kind") != "ATTAQUE" and (
            (a.get("geometry") or {}).get("needsSight") is not False or rng > 1
        )
        for en in enemies:
            ban = f"{a.get('id')}:{en['id']}"
            if ban in banned:
                continue
            if en["d"] > rng:
                continue
            if needs_sight and not has_los(my_pos, en["pos"], obstacles):
                continue
            est = (a.get("estimates") or {}).get(en["id"])
            if not est and a.get("kind") != "ATTAQUE":
                continue
            dmg = avg_est(est) if est else 10
            score = dmg / max(pa, 1)
            if est and (est.get("max") or 0) >= en.get("hp", 0):
                score += 10000
            if len(enemies) >= 2:
                score += 350 * (1 - en.get("hp", 0) / max(en.get("maxHp") or 1, 1))
            if a.get("kind") == "TECHNIQUE":
                score += 3
            if threatened:
                score -= 40
            if en["d"] >= sweet:
                score += 15
            if not best or score > best["score"]:
                best = {
                    "type": "attack" if a.get("kind") == "ATTAQUE" else "cast",
                    "action": a,
                    "enemy": en,
                    "banKey": ban,
                    "score": score,
                    "reason": f"{a.get('name')}->{en.get('name')} d={en['d']} ~{int(dmg)}",
                }

    if best and (not threatened or mp <= 0):
        return best
    if best and threatened and mp <= 0:
        return best

    if mp > 0 and reachable:
        approach = None
        for c in reachable:
            dmin = min(dist(c, e["pos"]) for e in enemies)
            score = -abs(dmin - sweet) * 10
            if ranged and dmin < sweet - 1:
                score -= 40
            if dmin <= max_r and dmin >= (sweet if ranged else 1):
                score += 30
            if not approach or score > approach["score"]:
                approach = {"cell": c, "score": score, "d": dmin}
        if approach and approach["d"] != cur_min:
            return {
                "type": "move",
                "cell": approach["cell"],
                "reason": f"APPROACH {cur_min}->{approach['d']}",
            }

    if best:
        return best
    return {"type": "endturn", "reason": f"idle d={cur_min}"}


def execute(token, char_id, bid, decision):
    if decision["type"] == "move":
        return http(
            "POST",
            f"/api/battles/{bid}/move",
            {
                "characterId": char_id,
                "cell": {"x": decision["cell"]["x"], "y": decision["cell"]["y"]},
            },
            token,
        )
    if decision["type"] in ("cast", "attack"):
        a, en = decision["action"], decision["enemy"]
        return http(
            "POST",
            f"/api/battles/{bid}/action",
            {
                "characterId": char_id,
                "kind": a["kind"],
                "id": a["id"],
                "targetId": en["id"],
                "targetCell": {"x": en["pos"]["x"], "y": en["pos"]["y"]},
            },
            token,
        )
    return http("POST", f"/api/battles/{bid}/end-turn", {"characterId": char_id}, token)


def fight(token, char_id, pack_id):
    st, start = http(
        "POST", "/api/battles/start", {"characterId": char_id, "fauna": pack_id}, token
    )
    if st != 200 or not isinstance(start, dict):
        return {"error": "start", "status": st, "data": start, "pack": pack_id}
    bid = start.get("id")
    if not bid:
        return {"error": "no id", "keys": list(start.keys())[:15], "pack": pack_id}

    http("POST", f"/api/battles/{bid}/engage", {"characterId": char_id}, token)
    logs = []
    banned = set()
    hp_before = None
    t0 = time.time()
    while time.time() - t0 < 90:
        st, s = http("GET", f"/api/battles/{bid}", token=token)
        if not s:
            time.sleep(0.2)
            continue
        if hp_before is None:
            me = next((f for f in s.get("fighters") or [] if f.get("id") == char_id), {})
            hp_before = me.get("hp")
        if s.get("winner") or s.get("finished"):
            logs.append("WINNER " + str(s.get("winner")))
            break
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
        st2, res = execute(token, char_id, bid, decision)
        if st2 == 409:
            logs.append("409:" + str((res or {}).get("error", ""))[:60])
            if decision.get("banKey"):
                banned.add(decision["banKey"])
            banned.add(decision["type"])
            time.sleep(0.25)
            continue
        if isinstance(res, dict) and (res.get("winner") or res.get("finished")):
            logs.append("WINNER " + str(res.get("winner")))
            break
        time.sleep(0.22 if decision["type"] == "move" else 0.15)

    st, s = http("GET", f"/api/battles/{bid}", token=token)
    me = next((f for f in (s or {}).get("fighters") or [] if f.get("id") == char_id), {})
    hp_after = me.get("hp", hp_before)
    return {
        "pack": pack_id,
        "bid": bid,
        "logs": logs[:40],
        "hpBefore": hp_before,
        "hpAfter": hp_after,
        "hpDelta": (hp_after or 0) - (hp_before or 0),
        "winner": (s or {}).get("winner")
        or next((l.replace("WINNER ", "") for l in logs if l.startswith("WINNER")), None),
    }


# Packs de secours Ohara (ids observés 2026-11-02) - la liste live n’est pas en REST
# Packs de secours (IDs dynamiques -> deviennent vite invalides).
# Préférer la découverte live via socket (world:join).
FALLBACK_PACKS_BY_MAP: dict[str, list[str]] = {
    "ohara": [
        "ohara-groupe-30-g55",
        "ohara-groupe-8-g64",
        "ohara-groupe-42-g60",
        "ohara-groupe-43-g59",
        "ohara-groupe-45-g47",
        "ohara-groupe-32-g86",
        "ohara-groupe-9-g57",
        "ohara-groupe-17-g146",
    ],
    "toroa": [
        "toroa-groupe-1",
        "toroa-groupe-2",
        "toroa-groupe-3",
        "toroa-groupe-4",
    ],
    "ilusia": [
        "ilusia-groupe-1",
        "ilusia-groupe-2",
        "ilusia-groupe-3",
        "ilusia-groupe-4",
    ],
}


def rest_if_needed(token: str, char_id: str, me: dict | None = None, force: bool = False) -> dict:
    """Repos GET /api/world/rest/:id — multi NAVIRE/BELLE jusqu'à plus de gain. """
    st_code, st = http("GET", f"/api/world/rest/{char_id}", token=token)
    if st_code != 200 or not isinstance(st, dict):
        return {"ok": False, "error": "no rest state", "status": st_code}
    hp = (st.get("hp") or {}).get("current")
    mx = (st.get("hp") or {}).get("max")
    if hp is None or not mx:
        return {"ok": False, "error": "no hp"}
    pct = hp / max(mx, 1)
    if not force and pct >= 0.92:
        return {"ok": True, "skipped": "ok", "hp": hp, "max": mx, "pct": pct}

    results = []
    for round_i in range(10):
        st_code, st = http("GET", f"/api/world/rest/{char_id}", token=token)
        if st_code != 200 or not isinstance(st, dict):
            break
        hp = (st.get("hp") or {}).get("current")
        mx = (st.get("hp") or {}).get("max")
        if hp is None or not mx:
            break
        pct = hp / max(mx, 1)
        if pct >= 0.92:
            break
        ship = st.get("ship") or {}
        rough = st.get("rough") or {}
        free = st.get("freeSleep") or {}
        ship_cd = (free.get("waitMs") or 0) > 0 or (ship.get("waitMs") or 0) > 0
        ship_ok = ship.get("available") is True and not ship_cd and (ship.get("hpRecovery") or 0) > 0
        belle_ok = rough.get("available") is not False and (rough.get("hpRecovery") or 0) > 0
        if not ship_ok and not belle_ok:
            break
        kinds = []
        if ship_ok and (ship.get("hpRecovery") or 0) >= (rough.get("hpRecovery") or 0):
            kinds = ["NAVIRE", "BELLE_ETOILE"]
        elif belle_ok:
            kinds = ["BELLE_ETOILE", "NAVIRE"]
        else:
            kinds = ["NAVIRE"]
        did = False
        for kind in kinds:
            if kind == "NAVIRE" and not ship_ok:
                continue
            if kind == "BELLE_ETOILE" and not belle_ok:
                continue
            code, data = http(
                "POST",
                "/api/world/rest",
                {"characterId": char_id, "kind": kind},
                token,
            )
            results.append({"kind": kind, "status": code, "recovered": (data or {}).get("hpRecovered")})
            if code == 200:
                did = True
                time.sleep(0.35)
                break
        if not did:
            break
    st_code, st = http("GET", f"/api/world/rest/{char_id}", token=token)
    hp2 = ((st or {}).get("hp") or {}).get("current")
    mx2 = ((st or {}).get("hp") or {}).get("max")
    return {
        "ok": True,
        "hp": hp2,
        "max": mx2,
        "pct": (hp2 / mx2) if hp2 is not None and mx2 else None,
        "results": results,
    }



def discover_packs_live(token: str, char: dict, max_dist: int | None = None) -> tuple[list[dict], str]:
    """
    Liste les packs fauna live via Socket world:join (seule source fiable).
    Retourne ([{id, ox, oy, d, especes}, ...], source).
    """
    try:
        sys.path.insert(0, str(ROOT / "src" / "launcher"))
        from headless_world import HeadlessWorld  # type: ignore
    except Exception as e:
        return [], f"no-socket ({e})"

    world = None
    try:
        cid = char.get("id") if isinstance(char, dict) else char
        world = HeadlessWorld(token, cid)
        world.connect(carte=(char.get("mapId") if isinstance(char, dict) else None))
        packs = world.fauna_packs()
        if max_dist is not None:
            packs = [p for p in packs if p.get("d", 999) <= max_dist]
        return packs, "socket-world:join"
    except Exception as e:
        return [], f"socket-fail ({e})"
    finally:
        if world is not None:
            try:
                world.disconnect()
            except Exception:
                pass


def start_error_kind(r: dict) -> str:
    """Classifie les 409 start pour skip rapide."""
    if r.get("error") != "start":
        return ""
    data = r.get("data") or {}
    msg = str(data.get("error") or data.get("raw") or "").lower()
    if "existe pas" in msg or "n'existe" in msg or "n’existe" in msg:
        return "missing"
    if "trop loin" in msg:
        return "far"
    if "repose" in msg or "debout" in msg or "tient à peine" in msg:
        return "hp"
    return "other"


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Pure API fauna farm - découverte live packs (socket) + combat API"
    )
    ap.add_argument("--fights", type=int, default=8)
    ap.add_argument(
        "--packs",
        type=str,
        default="",
        help="ids packs forcés (virgule). Sinon découverte live via socket.",
    )
    ap.add_argument(
        "--max-dist",
        type=int,
        default=14,
        help="distance Manhattan max depuis le perso (défaut 14). 0 = illimité.",
    )
    ap.add_argument(
        "--fallback",
        action="store_true",
        help="si socket KO, tenter les IDs fallback de la map (souvent 409).",
    )
    ap.add_argument(
        "--no-rest",
        action="store_true",
        help="ne pas auto-rest si HP bas",
    )
    args = ap.parse_args()

    email = os.getenv("GL_EMAIL", "")
    password = os.getenv("GL_PASSWORD", "")
    if not email or not password:
        print("Set GL_EMAIL and GL_PASSWORD", file=sys.stderr)
        return 1

    st, login_data = http("POST", "/api/auth/login", {"email": email, "password": password})
    if st != 200 or not login_data.get("accessToken"):
        print("login failed", st, login_data)
        return 2
    token = login_data["accessToken"]
    print("login OK", login_data.get("player", {}).get("username"))

    st, chars = http("GET", "/api/characters", token=token)
    char_list = chars if isinstance(chars, list) else (chars or {}).get("characters") or []
    char_id = os.getenv("GL_CHAR_ID") or (char_list[0]["id"] if char_list else None)
    if not char_id:
        print("no character")
        return 3
    me = next((c for c in char_list if c["id"] == char_id), char_list[0])
    map_id = (me.get("mapId") or "").lower()
    cx, cy = int(me.get("x") or 0), int(me.get("y") or 0)
    print(
        f"char {me.get('name')} {map_id} ({cx},{cy}) "
        f"hp={me.get('hp')}/{me.get('maxHp') or me.get('hpMax')} id={char_id}"
    )

    if not args.no_rest:
        rr = rest_if_needed(token, char_id, me)
        if not rr.get("skipped"):
            print("rest ->", rr)
            st, chars = http("GET", "/api/characters", token=token)
            char_list = chars if isinstance(chars, list) else (chars or {}).get("characters") or []
            me = next((c for c in char_list if c["id"] == char_id), me)

    # --- resolve pack list ---
    pack_ids: list[str] = []
    pack_meta: dict[str, dict] = {}
    source = "cli"

    explicit = [p.strip() for p in args.packs.split(",") if p.strip()]
    if explicit:
        pack_ids = explicit
        source = "cli --packs"
    else:
        max_dist = None if args.max_dist <= 0 else args.max_dist
        live, source = discover_packs_live(token, me, max_dist=max_dist)
        if live:
            pack_ids = [p["id"] for p in live]
            pack_meta = {p["id"]: p for p in live}
            print(f"packs live ({source}): {len(pack_ids)}")
            for p in live[:12]:
                print(
                    f"  {p['id']}  d={p['d']} @ ({p['ox']},{p['oy']})  "
                    f"{','.join(str(s) for s in (p.get('especes') or [])[:3])}"
                )
            if len(live) > 12:
                print(f"  ... +{len(live) - 12} autres")
        elif args.fallback:
            pack_ids = list(FALLBACK_PACKS_BY_MAP.get(map_id) or [])
            source = f"fallback:{map_id}"
            print(
                f"WARN socket indisponible -> fallback {map_id}: {len(pack_ids)} ids "
                f"(souvent invalides, IDs dynamiques)"
            )
        else:
            print(
                "\nERR Aucun pack live trouvé.\n"
                "  Cause probable : python-socketio non installé, ou join KO.\n"
                "  Fixes :\n"
                "    pip install 'python-socketio[client]' websocket-client\n"
                "    # ou packs explicites (console F12) :\n"
                "    python src/launcher/pure_api_farm.py --packs id1,id2 --fights 5\n"
                "    # ou farm + walk headless :\n"
                "    python src/launcher/headless_world.py --farm 5\n"
                f"  detail: {source}"
            )
            return 4

    if not pack_ids:
        print("aucun pack à tenter")
        return 4

    print(f"source={source}  fights_target={args.fights}  candidates={len(pack_ids)}")

    results = []
    t0 = time.time()
    wins = 0
    missing = 0
    far = 0
    tried: set[str] = set()

    for i, pack in enumerate(pack_ids):
        if wins >= args.fights:
            break
        if pack in tried:
            continue
        tried.add(pack)
        meta = pack_meta.get(pack) or {}
        dinfo = f" d={meta['d']}" if "d" in meta else ""
        print(f"\n=== try {len(tried)}/{len(pack_ids)} {pack}{dinfo} ===")
        r = fight(token, char_id, pack)
        results.append(r)
        kind = start_error_kind(r)
        print(
            {
                k: r.get(k)
                for k in (
                    "pack",
                    "bid",
                    "winner",
                    "hpBefore",
                    "hpAfter",
                    "hpDelta",
                    "error",
                    "status",
                )
            }
        )
        if r.get("logs"):
            print(" ", " | ".join(r["logs"][:10]))
        if r.get("winner") == "ALLIE":
            wins += 1
        elif kind == "missing":
            missing += 1
        elif kind == "far":
            far += 1
        elif kind == "hp":
            print("-> HP trop bas, rest...")
            if not args.no_rest:
                print(rest_if_needed(token, char_id, me))
        time.sleep(0.35)

    summary = {
        "ms": int((time.time() - t0) * 1000),
        "wins": wins,
        "attempts": len(results),
        "missing": missing,
        "far": far,
        "source": source,
        "mapId": map_id,
        "pos": [cx, cy],
        "hpDeltas": [r.get("hpDelta") for r in results if r.get("hpDelta") is not None],
        "results": results,
    }
    out = ROOT / "artifacts" / "pure_api_farm_latest.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    print("\n===== SUMMARY =====")
    print(
        json.dumps(
            {
                k: summary[k]
                for k in ("ms", "wins", "attempts", "missing", "far", "source", "mapId", "hpDeltas")
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    print("saved", out)

    if wins == 0 and missing == len(results) and results:
        print(
            "\nTIP Tous les packs sont introuvables (IDs morts).\n"
            "   -> Relance sans --packs pour forcer la découverte socket,\n"
            "     ou utilise headless_world.py --farm N (walk + join live)."
        )
    elif wins == 0 and far and far == len(results):
        print(
            "\nTIP Packs existent mais trop loin de la position serveur.\n"
            "   -> python src/launcher/headless_world.py --farm N  (approche auto)\n"
            "   -> ou rapproche le perso manuellement puis relance pure_api_farm."
        )
    return 0 if wins > 0 else 5


if __name__ == "__main__":
    sys.exit(main())
