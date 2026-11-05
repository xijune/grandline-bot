"""
Voyage mer autonome — pure helpers + exécution HTTP.

Flux validé live 2026-11-02 (ohara→toroa):
  walk ponton → depart → cap → position interpolée (rate-limit) → dock
Prérequis: 1+ ration, sac non plein, navire owned, île dans caps.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
DOCKS_PATH = ROOT / "docs" / "data" / "docks.json"


def load_docks() -> dict:
    if DOCKS_PATH.exists():
        return json.loads(DOCKS_PATH.read_text())
    return {}


def build_waypoints(
    plan: dict,
    *,
    steps: int | None = None,
) -> list[dict]:
    """Interpole entry→arrival sur les tiles du plan."""
    entry = plan.get("entry") or {}
    arrival = plan.get("arrival") or {}
    tiles = plan.get("tiles") or []
    dist = float(plan.get("distanceCases") or 50)
    n = steps if steps is not None else max(10, int(dist / 20))
    if not entry or not arrival:
        return []
    out = []
    for i in range(n + 1):
        t = i / n
        ti = min(len(tiles) - 1, int(t * (len(tiles) - 1) + 0.5)) if tiles else 0
        col = tiles[ti]["col"] if tiles else entry.get("col", 0)
        row = tiles[ti]["row"] if tiles else entry.get("row", 0)
        out.append(
            {
                "col": col,
                "row": row,
                "x": entry["x"] + t * (arrival["x"] - entry["x"]),
                "y": entry["y"] + t * (arrival["y"] - entry["y"]),
            }
        )
    return out


def inventory_items(character: dict) -> list[dict]:
    inv = character.get("inventory") or {}
    if isinstance(inv, list):
        return [x for x in inv if isinstance(x, dict)]
    items = inv.get("items")
    if isinstance(items, list):
        return [x for x in items if isinstance(x, dict)]
    return []


def count_item(character: dict, item_id: str) -> int:
    return sum(
        int(it.get("quantity") or 0)
        for it in inventory_items(character)
        if it.get("id") == item_id
    )


def is_inventory_full_error(err: Any) -> bool:
    return "plein" in str(err).lower() or "sac" in str(err).lower()


# Items safe to bulk-sell for space (farm loot)
SELL_JUNK = [
    "plumes",
    "viande-de-gibier",
    "bois-brut",
    "poisson-commun",
    "peau-tannee",
    "baies-sauvages",
    "algue-marine",
    "ble",
    "sel-marin",
]


def ensure_travel_ready(
    http: Callable,
    token: str,
    char_id: str,
    character: dict,
) -> dict:
    """Vend le surplus et achète 1 ration si besoin."""
    log = []
    # sell junk
    for it in inventory_items(character):
        iid = it.get("id")
        qty = int(it.get("quantity") or 0)
        if iid in SELL_JUNK and qty > 0:
            st, data = http(
                "POST",
                "/api/economy/sell",
                {"characterId": char_id, "itemId": iid, "quantity": qty},
                token,
            )
            log.append({"sell": iid, "qty": qty, "status": st})
    # refresh
    st, chars = http("GET", "/api/characters", token=token)
    lst = chars if isinstance(chars, list) else (chars or {}).get("characters") or []
    character = next((c for c in lst if c.get("id") == char_id), character)

    if count_item(character, "ration") < 1:
        st, data = http(
            "POST",
            f"/api/characters/{char_id}/buy",
            {"itemId": "ration", "shopId": "port"},
            token,
        )
        log.append({"buy": "ration", "status": st, "data": data if st != 200 else "ok"})
        if st != 200 and is_inventory_full_error(data):
            log.append({"error": "inventory still full after sell"})
    return {"log": log, "rations": count_item(character, "ration")}
