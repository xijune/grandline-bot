"""Régression planificateur leveling (offline)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from level_core import plan, pick_farm_pack, estimate_farm_xp  # noqa: E402


def test_rest_low_hp():
    a = plan({"level": 10, "currentHp": 20, "maxHp": 200}, [])
    assert a["type"] == "rest"


def test_daily_claim():
    a = plan({"level": 10, "currentHp": 100, "maxHp": 100}, [], daily={"claimedToday": False})
    assert a["type"] == "daily_claim"


def test_soft_quest_preferred():
    objs = [{"id": "campagne:x", "kind": "fouille", "x": 1, "y": 1}]
    a = plan({"level": 5, "currentHp": 100, "maxHp": 100}, objs)
    assert a["type"] == "quest"
    assert a["kind"] == "fouille"


def test_underlevel_combat_farms_first():
    objs = [
        {
            "id": "campagne:hard",
            "kind": "combat",
            "x": 10,
            "y": 10,
            "cible": {"level": 15, "count": 3},
        }
    ]
    packs = [{"id": "p1", "level": 6, "x": 5, "y": 5}]
    a = plan({"level": 6, "currentHp": 100, "maxHp": 100}, objs, packs=packs)
    assert a["type"] == "farm"
    assert a["blocked_objectifId"] == "campagne:hard"


def test_ready_combat_quest():
    objs = [
        {
            "id": "campagne:ok",
            "kind": "combat",
            "cible": {"level": 10, "count": 2},
        }
    ]
    a = plan({"level": 10, "currentHp": 100, "maxHp": 100}, objs, packs=[])
    assert a["type"] == "quest"
    assert a["kind"] == "combat"


def test_travel_when_no_objectives():
    char = {
        "level": 11,
        "currentHp": 300,
        "maxHp": 500,
        "mapId": "ohara",
        "discoveredLocations": ["ilusia", "ohara", "toroa"],
    }
    a = plan(char, [], packs=[])
    assert a["type"] == "travel"
    assert a["islandId"] == "toroa"


def test_farm_when_no_travel():
    char = {"level": 8, "currentHp": 100, "maxHp": 100, "mapId": "ohara"}
    packs = [
        {"id": "hard", "level": 20},
        {"id": "ok", "level": 8},
        {"id": "dead", "level": 7, "dead": True},
    ]
    a = plan(char, [], packs=packs)
    assert a["type"] == "farm"
    assert a["pack"]["id"] == "ok"


def test_pick_farm_pack_prefers_near_level():
    packs = [
        {"id": "low", "level": 3},
        {"id": "mid", "level": 10},
        {"id": "high", "level": 18},
    ]
    p = pick_farm_pack(packs, 10, window=3)
    assert p["id"] == "mid"


def test_estimate_farm_xp_table():
    assert estimate_farm_xp(1) == 9
    assert estimate_farm_xp(2) == 15


def test_fixture_bukima_travel_toroa():
    fix = json.loads(
        (ROOT / "tests/fixtures/level/bukima_stage134_no_obj.json").read_text()
    )
    a = plan(fix["character"], fix["objectives"], daily=fix["daily"], packs=[])
    assert a["type"] == fix["expected_plan"]["type"]
    assert a["islandId"] == fix["expected_plan"]["islandId"]


def test_build_waypoints_sea():
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
    from sea_travel import build_waypoints

    plan = {
        "distanceCases": 100,
        "tiles": [
            {"col": 2, "row": 0},
            {"col": 1, "row": 0},
            {"col": 0, "row": 2},
        ],
        "entry": {"x": 0.0, "y": 10.0, "col": 2, "row": 0},
        "arrival": {"x": 50.0, "y": 20.0, "col": 0, "row": 2},
    }
    wps = build_waypoints(plan, steps=5)
    assert len(wps) == 6
    assert wps[0]["x"] == 0.0
    assert wps[-1]["x"] == 50.0
