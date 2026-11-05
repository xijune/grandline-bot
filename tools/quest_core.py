"""
Planificateur quête pur (offline) — aucune I/O réseau.

Entrée : état character + objectifs map + catalogue PNJ.
Sortie : action structurée pour le runner live.

Principe : s'adapter à ce que le serveur expose, sans hardcoder l'ID de quête courant.
"""

from __future__ import annotations

from typing import Any


def dist(ax: int, ay: int, bx: int, by: int) -> int:
    return abs(ax - bx) + abs(ay - by)


def nearest_adjacent(tx: int, ty: int, px: int, py: int) -> tuple[int, int]:
    """Case libre adjacente préférée (vers le joueur) — PNJ souvent sur case bloquée."""
    candidates = [
        (tx, ty),
        (tx, ty + 1),
        (tx, ty - 1),
        (tx + 1, ty),
        (tx - 1, ty),
        (tx + 1, ty + 1),
        (tx - 1, ty - 1),
        (tx + 1, ty - 1),
        (tx - 1, ty + 1),
    ]
    scored = sorted(
        candidates,
        key=lambda c: (0 if c == (px, py) else 1, dist(c[0], c[1], px, py)),
    )
    return scored[0]


def objective_kind(obj: dict) -> str:
    k = (obj.get("kind") or obj.get("type") or "").lower()
    if k in ("combat", "fight", "battle"):
        return "combat"
    if k in ("fouille", "search", "recherche"):
        return "fouille"
    if k in ("talk", "parler", "dialogue"):
        return "talk"
    if obj.get("cible") or obj.get("ennemi"):
        return "combat"
    return k or "unknown"


def plan(
    character: dict,
    objectives: list[dict],
    npcs: list[dict],
    *,
    tried_talks: set[str] | None = None,
    min_hp_ratio: float = 0.35,
    approach_range: int = 3,
) -> dict[str, Any]:
    """
    Décide la prochaine action quête.

    Retours :
      rest | walk | fight_quest | search | talk | travel_hint | idle
    """
    tried_talks = tried_talks or set()
    cid_map = character.get("mapId") or character.get("map")
    px = int(character.get("x") or 0)
    py = int(character.get("y") or 0)
    hp = character.get("currentHp")
    max_hp = character.get("maxHp")
    if hp is not None and max_hp and max_hp > 0:
        if hp / max_hp < min_hp_ratio:
            return {"type": "rest", "reason": f"hp {hp}/{max_hp}"}

    if objectives:
        scored = []
        for o in objectives:
            ox, oy = o.get("x"), o.get("y")
            if ox is None or oy is None:
                scored.append((9999, o))
            else:
                scored.append((dist(px, py, int(ox), int(oy)), o))
        scored.sort(key=lambda t: t[0])
        d, obj = scored[0]
        oid = obj.get("id")
        kind = objective_kind(obj)
        ox = int(obj["x"]) if obj.get("x") is not None else px
        oy = int(obj["y"]) if obj.get("y") is not None else py
        tx, ty = nearest_adjacent(ox, oy, px, py)

        if d > approach_range:
            return {
                "type": "walk",
                "x": tx,
                "y": ty,
                "reason": f"approach {kind} {oid} d={d}",
                "objectifId": oid,
                "kind": kind,
            }
        if kind == "combat":
            return {
                "type": "fight_quest",
                "objectifId": oid,
                "x": ox,
                "y": oy,
                "reason": f"fight {oid}",
            }
        if kind == "fouille":
            return {
                "type": "search",
                "objectifId": oid,
                "x": ox,
                "y": oy,
                "reason": f"search {oid}",
            }
        if kind == "talk" and obj.get("npc"):
            return {
                "type": "talk",
                "npc": obj["npc"],
                "x": ox,
                "y": oy,
                "reason": f"talk-obj {oid}",
            }
        return {
            "type": "search",
            "objectifId": oid,
            "x": ox,
            "y": oy,
            "reason": f"unknown-kind {kind} try search",
            "fallback_fight": True,
        }

    local_radius = 35
    candidates = []
    for n in npcs:
        nid = n.get("id")
        if not nid or nid in tried_talks:
            continue
        nx, ny = int(n.get("x", 0)), int(n.get("y", 0))
        candidates.append((dist(px, py, nx, ny), n))
    candidates.sort(key=lambda t: t[0])
    local = [(d, n) for d, n in candidates if d <= local_radius]

    discovered = character.get("discoveredLocations") or character.get("discoveredIslands") or []
    others = (
        [isl for isl in discovered if isl and isl != cid_map]
        if isinstance(discovered, list)
        else []
    )
    if not local and others:
        return {
            "type": "travel_hint",
            "islandId": others[-1],
            "reason": f"no local npc left; discovered {others[-1]}",
        }

    pool = local if local else candidates
    for d, n in pool:
        nid = n["id"]
        nx, ny = int(n["x"]), int(n["y"])
        tx, ty = nearest_adjacent(nx, ny, px, py)
        if d > approach_range:
            return {
                "type": "walk",
                "x": tx,
                "y": ty,
                "reason": f"approach npc {nid} d={d}",
                "npc": nid,
            }
        return {
            "type": "talk",
            "npc": nid,
            "x": nx,
            "y": ny,
            "reason": f"probe talk {nid}",
        }

    if others:
        return {
            "type": "travel_hint",
            "islandId": others[-1],
            "reason": f"no local objective; discovered {others[-1]}",
        }

    return {"type": "idle", "reason": "no objectives, no npc left to probe"}
