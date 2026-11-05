"""
Décision combat pure (offline + headless) — source Python pour replay.

Doit rester alignée avec src/inject/combat-module.js (kite-first).
Pas d'I/O réseau ici.
"""

from __future__ import annotations

from typing import Any


def dist(a: dict, b: dict) -> int:
    return abs(int(a.get("x", 0)) - int(b.get("x", 0))) + abs(
        int(a.get("y", 0)) - int(b.get("y", 0))
    )


def action_range(a: dict) -> int:
    if a.get("kind") == "ATTAQUE":
        return 1
    g = a.get("geometry") or {}
    r = g.get("range", a.get("range", 1))
    return int(r if r is not None else 1)


def action_pa(a: dict) -> int:
    if a.get("kind") in ("GARDE", "FUITE"):
        return 0
    if a.get("kind") == "ATTAQUE":
        return max(2, int(a.get("pa") or a.get("cost") or 2))
    return int(a.get("pa") or a.get("cost") or 99)


def avg_est(est: dict | None) -> float:
    if not est:
        return 0.0
    return ((est.get("min") or 0) + (est.get("max") or 0)) / 2


def enemy_max_range(e: dict) -> int:
    m = 1
    for t in e.get("techniques") or []:
        r = (t.get("geometry") or {}).get("range", t.get("range", 1))
        if isinstance(r, (int, float)) and r > m:
            m = int(r)
    return m


def my_max_range(actions: list) -> int:
    m = 1
    for a in actions:
        if a.get("kind") in ("FUITE", "GARDE", "ATTAQUE"):
            continue
        m = max(m, action_range(a))
    return max(m, 1)


def has_los(frm: dict, to: dict, obstacles: list) -> bool:
    if not frm or not to:
        return False
    obs = {f"{o['x']}:{o['y']}" for o in (obstacles or [])}
    if not obs:
        return True
    x0, y0, x1, y1 = int(frm["x"]), int(frm["y"]), int(to["x"]), int(to["y"])
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


def decide(state: dict, char_id: str, banned: set | None = None) -> dict[str, Any]:
    """
    Entrée : body GET /api/battles/:id
    Sortie : { type, reason, ... }
    """
    banned = banned or set()
    me_id = state.get("you") or char_id
    tactics = state.get("tactics") or {}
    positions = tactics.get("positions") or {}
    my_pos = positions.get(me_id)
    if not my_pos:
        return {"type": "endturn", "reason": "no pos"}

    ap = int(tactics.get("ap") or 0)
    mp = int(tactics.get("mp") or 0)
    actions = [
        a
        for a in (state.get("actions") or [])
        if a.get("usable") is not False and not a.get("locked")
    ]
    enemies = []
    for f in state.get("fighters") or []:
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
    me = next((f for f in state.get("fighters") or [] if f.get("id") == me_id), {})
    hp = me.get("hp") or 0
    max_hp = me.get("maxHp") or 1
    hp_pct = hp / max(max_hp, 1)

    if hp_pct < 0.15 and any(a.get("kind") == "FUITE" for a in actions):
        if "flee" not in banned:
            return {"type": "flee", "reason": f"FUITE {int(hp_pct*100)}%"}

    # HIT THEN KITE: AP does not spend MP — damage before retreat
    if ap <= 0:
        if threatened and mp > 0 and reachable and ranged:
            best_k = None
            cx = sum(e["pos"]["x"] for e in enemies) / len(enemies)
            cy = sum(e["pos"]["y"] for e in enemies) / len(enemies)
            dist0 = abs(my_pos["x"] - cx) + abs(my_pos["y"] - cy)
            for c in reachable:
                if c["x"] == my_pos["x"] and c["y"] == my_pos["y"]:
                    continue
                dmin = min(dist(c, e["pos"]) for e in enemies)
                can_shoot = any(dist(c, e["pos"]) <= max_r for e in enemies)
                n_safe = sum(1 for e in enemies if dist(c, e["pos"]) >= sweet)
                dist_c = abs(c["x"] - cx) + abs(c["y"] - cy)
                away = dist_c - dist0
                vx, vy = c["x"] - my_pos["x"], c["y"] - my_pos["y"]
                ex, ey = my_pos["x"] - cx, my_pos["y"] - cy
                denom = max(1, abs(vx) + abs(vy)) * max(1, abs(ex) + abs(ey))
                align = (vx * ex + vy * ey) / denom
                if dmin >= sweet and dmin <= max_r:
                    score = 12000 + (3 - abs(dmin - sweet)) * 40 + (400 if can_shoot else 0)
                elif dmin >= sweet:
                    score = 6000
                else:
                    score = (dmin - cur_min) * 120
                score += n_safe * 90 + away * 35 + align * 80 - (c.get("cost") or 0) * 8
                if not can_shoot:
                    score -= 150
                if not best_k or score > best_k["score"] or (
                    abs(score - best_k["score"]) < 0.01 and dmin > best_k["d"]
                ):
                    best_k = {"cell": c, "score": score, "d": dmin}
            if best_k and best_k["d"] > cur_min:
                return {
                    "type": "move",
                    "cell": best_k["cell"],
                    "reason": f"AP0 KITE {cur_min}→{best_k['d']}",
                }
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
            is_kill = bool(est and (est.get("max") or 0) >= en.get("hp", 0))
            score = dmg / max(pa, 1)
            if is_kill:
                score += 10000
            if len(enemies) >= 2:
                score += 350 * (1 - en.get("hp", 0) / max(en.get("maxHp") or 1, 1))
            if a.get("kind") == "TECHNIQUE":
                score += 3
            if en["d"] >= sweet:
                score += 15
            # sous sweet: only worth hits
            if threatened and en["d"] < sweet:
                worth = is_kill or dmg >= max(25, (en.get("hp") or 50) * 0.2) or (
                    dmg >= 15 and en["d"] > 1
                )
                if not worth:
                    continue
                score += 500 if not is_kill else 3000
            if not best or score > best["score"]:
                best = {
                    "type": "attack" if a.get("kind") == "ATTAQUE" else "cast",
                    "action": a,
                    "enemy": en,
                    "banKey": ban,
                    "score": score,
                    "reason": (
                        f"{'HIT-THEN-KITE ' if threatened else ''}"
                        f"{a.get('name')}→{en.get('name')} d={en['d']} ~{int(dmg)}"
                        f"{' KILL' if is_kill else ''}"
                    ),
                }
    if best:
        return best

    # KITE after no profitable shot
    if threatened and mp > 0 and reachable and ranged:
        best_k = None
        cx = sum(e["pos"]["x"] for e in enemies) / len(enemies)
        cy = sum(e["pos"]["y"] for e in enemies) / len(enemies)
        dist0 = abs(my_pos["x"] - cx) + abs(my_pos["y"] - cy)
        for c in reachable:
            if c["x"] == my_pos["x"] and c["y"] == my_pos["y"]:
                continue
            dmin = min(dist(c, e["pos"]) for e in enemies)
            can_shoot = any(dist(c, e["pos"]) <= max_r for e in enemies)
            n_safe = sum(1 for e in enemies if dist(c, e["pos"]) >= sweet)
            dist_c = abs(c["x"] - cx) + abs(c["y"] - cy)
            away = dist_c - dist0
            vx, vy = c["x"] - my_pos["x"], c["y"] - my_pos["y"]
            ex, ey = my_pos["x"] - cx, my_pos["y"] - cy
            denom = max(1, abs(vx) + abs(vy)) * max(1, abs(ex) + abs(ey))
            align = (vx * ex + vy * ey) / denom
            if dmin >= sweet and dmin <= max_r:
                score = 12000 + (3 - abs(dmin - sweet)) * 40 + (400 if can_shoot else 0)
            elif dmin >= sweet:
                score = 6000
            else:
                score = (dmin - cur_min) * 120
            score += n_safe * 90 + away * 35 + align * 80 - (c.get("cost") or 0) * 8
            if not can_shoot:
                score -= 150
            if not best_k or score > best_k["score"] or (
                abs(score - best_k["score"]) < 0.01 and dmin > best_k["d"]
            ):
                best_k = {"cell": c, "score": score, "d": dmin}
        if best_k and best_k["d"] > cur_min:
            return {
                "type": "move",
                "cell": best_k["cell"],
                "reason": f"KITE {cur_min}→{best_k['d']}",
            }

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
                "reason": f"APPROACH {cur_min}→{approach['d']}",
            }

    if best:
        return best
    return {"type": "endturn", "reason": f"idle d={cur_min}"}
