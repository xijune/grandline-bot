"""
Planificateur leveling pur (offline) — aucune I/O réseau.

Choisit entre rest / daily / quest / farm / travel selon l'état personnage
et les observables serveur (objectifs, packs, discovered).

Aucun ID de quête hardcodé comme obligation : on réagit à ce qui est exposé.
"""

from __future__ import annotations

from typing import Any


def _obj_max_level(obj: dict) -> int | None:
    """Niveau max des cibles d'un objectif combat, si connu."""
    cible = obj.get("cible") or {}
    if isinstance(cible, dict) and cible.get("level") is not None:
        return int(cible["level"])
    levels = []
    for m in obj.get("mobs") or []:
        if isinstance(m, dict) and m.get("niveau") is not None:
            levels.append(int(m["niveau"]))
        elif isinstance(m, dict) and m.get("level") is not None:
            levels.append(int(m["level"]))
    return max(levels) if levels else None


def _objective_kind(obj: dict) -> str:
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


def estimate_farm_xp(mob_level: int, knowledge: dict | None = None) -> float:
    """XP estimé d'un kill solo (table capturée, interpolation grossière)."""
    table = (knowledge or {}).get("farm_solo") or [
        {"mob_level": 1, "xp": 9},
        {"mob_level": 2, "xp": 15},
    ]
    table = sorted(table, key=lambda r: r["mob_level"])
    if mob_level <= table[0]["mob_level"]:
        return float(table[0]["xp"])
    for i in range(len(table) - 1):
        a, b = table[i], table[i + 1]
        if a["mob_level"] <= mob_level <= b["mob_level"]:
            t = (mob_level - a["mob_level"]) / max(1, b["mob_level"] - a["mob_level"])
            return a["xp"] + t * (b["xp"] - a["xp"])
    # extrapolate ~ +6 xp per level beyond last point (heuristic)
    last = table[-1]
    return float(last["xp"] + 6 * (mob_level - last["mob_level"]))


def pick_farm_pack(
    packs: list[dict],
    player_level: int,
    *,
    window: int = 3,
) -> dict | None:
    """
    Choisit un pack FAUNE proche du niveau joueur.
    pack: {id, level|max_level, x, y, dead?, engaged?}
    """
    candidates = []
    for p in packs:
        if p.get("dead") or p.get("engaged") or p.get("mort"):
            continue
        lvl = p.get("max_level")
        if lvl is None:
            lvl = p.get("level")
        if lvl is None and p.get("mobs"):
            lvls = [m.get("niveau") or m.get("level") or 0 for m in p["mobs"]]
            lvl = max(lvls) if lvls else None
        if lvl is None:
            continue
        lvl = int(lvl)
        gap = abs(lvl - player_level)
        if gap > window and lvl > player_level + window:
            continue  # trop dur
        # score: prefer slightly below or equal, then closer
        score = gap + (0 if lvl <= player_level + 1 else 2)
        candidates.append((score, -lvl, p))
    if not candidates:
        # fallback: any non-dead pack
        alive = [p for p in packs if not p.get("dead") and not p.get("engaged")]
        return alive[0] if alive else None
    candidates.sort(key=lambda t: (t[0], t[1]))
    return candidates[0][2]


def plan(
    character: dict,
    objectives: list[dict],
    *,
    packs: list[dict] | None = None,
    daily: dict | None = None,
    knowledge: dict | None = None,
    tried_islands: set[str] | None = None,
) -> dict[str, Any]:
    """
    Décide la prochaine action de progression XP.

    Retours type:
      rest | daily_claim | daily_task | quest | farm | travel | idle
    """
    knowledge = knowledge or {}
    rules = knowledge.get("rules") or {}
    min_hp = float(rules.get("min_hp_ratio", 0.35))
    under_margin = int(rules.get("quest_combat_underlevel_margin", 2))
    farm_window = int(rules.get("farm_level_window", 3))
    tried_islands = tried_islands or set()

    level = int(character.get("level") or 1)
    hp = character.get("currentHp")
    max_hp = character.get("maxHp")
    map_id = character.get("mapId") or character.get("map")

    if hp is not None and max_hp and max_hp > 0 and hp / max_hp < min_hp:
        return {"type": "rest", "reason": f"hp {hp}/{max_hp}"}

    # --- Daily calendar ---
    if daily and daily.get("claimedToday") is False:
        return {"type": "daily_claim", "reason": "calendar unclaimed"}

    # --- Daily tasks claim (ids already complete) ---
    taches = character.get("tachesDuJour") or {}
    reclamees = set(taches.get("reclamees") or [])
    for tid in taches.get("ids") or []:
        if tid not in reclamees:
            # runner must check progress; planner only suggests try_claim
            # Prefer quest/farm for incomplete; claim is attempted by runner if API says ready
            pass

    # --- Quest objectives ---
    if objectives:
        # talk / fouille = cheap, always prefer
        soft = [o for o in objectives if _objective_kind(o) in ("talk", "fouille", "unknown")]
        hard = [o for o in objectives if _objective_kind(o) == "combat"]

        for o in soft:
            return {
                "type": "quest",
                "reason": f"soft objective {_objective_kind(o)} {o.get('id')}",
                "objectifId": o.get("id"),
                "kind": _objective_kind(o),
                "objective": o,
            }

        for o in hard:
            mob_lvl = _obj_max_level(o)
            if mob_lvl is not None and mob_lvl > level + under_margin:
                # underleveled → farm first
                pack = pick_farm_pack(packs or [], level, window=farm_window)
                return {
                    "type": "farm",
                    "reason": f"underlevel for {o.get('id')} (mobs~{mob_lvl} vs lvl {level})",
                    "pack": pack,
                    "blocked_objectifId": o.get("id"),
                    "target_level": mob_lvl - under_margin,
                }
            return {
                "type": "quest",
                "reason": f"combat objective {o.get('id')} (mobs~{mob_lvl})",
                "objectifId": o.get("id"),
                "kind": "combat",
                "objective": o,
            }

    # --- No objectives: unlock next island if discovered ---
    discovered = character.get("discoveredLocations") or character.get("discoveredIslands") or []
    visited = set(character.get("visitedIslands") or [])
    if isinstance(discovered, list) and map_id:
        candidates = [
            isl
            for isl in discovered
            if isl and isl != map_id and isl not in tried_islands
        ]
        # Prefer never-visited (campaign unlock), else skip travel → farm
        unvisited = [isl for isl in candidates if isl not in visited]
        if unvisited:
            island = unvisited[-1]
            return {
                "type": "travel",
                "islandId": island,
                "reason": f"no local objectives; unlock unvisited {island}",
            }

    # --- Farm ---
    pack = pick_farm_pack(packs or [], level, window=farm_window)
    if pack:
        return {
            "type": "farm",
            "reason": f"farm pack near lvl {level}",
            "pack": pack,
        }

    return {
        "type": "idle",
        "reason": "no objectives, no packs, no travel target",
    }
