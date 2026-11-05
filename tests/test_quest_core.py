"""Régression planificateur quête (offline) — couche C méthodo."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from quest_core import plan, objective_kind  # noqa: E402


def test_combat_objective_walk_then_fight():
    char = {"mapId": "ohara", "x": 85, "y": 112, "currentHp": 300, "maxHp": 500}
    objs = [{"id": "campagne:pw2-receleurs", "kind": "combat", "x": 72, "y": 36}]
    a = plan(char, objs, [])
    assert a["type"] == "walk"
    assert a["objectifId"] == "campagne:pw2-receleurs"
    char2 = {**char, "x": 72, "y": 36}
    a2 = plan(char2, objs, [])
    assert a2["type"] == "fight_quest"
    assert a2["objectifId"] == "campagne:pw2-receleurs"


def test_fouille():
    char = {"mapId": "ilusia", "x": 64, "y": 88}
    objs = [{"id": "campagne:pw1-affiches", "kind": "fouille", "x": 64, "y": 88}]
    a = plan(char, objs, [])
    assert a["type"] == "search"
    assert a["objectifId"] == "campagne:pw1-affiches"


def test_probe_npc_when_no_objectives():
    char = {"mapId": "ohara", "x": 49, "y": 42}
    npcs = [{"id": "npc-lucien-le-pelerin", "x": 49, "y": 42}]
    a = plan(char, [], npcs, tried_talks=set())
    assert a["type"] == "talk"
    assert a["npc"] == "npc-lucien-le-pelerin"
    a2 = plan(char, [], npcs, tried_talks={"npc-lucien-le-pelerin"})
    assert a2["type"] in ("idle", "travel_hint")


def test_travel_hint_when_no_local_npc():
    char = {
        "mapId": "ohara",
        "x": 100,
        "y": 100,
        "discoveredLocations": ["ilusia", "ohara", "toroa"],
    }
    npcs = [{"id": "far", "x": 10, "y": 10}]
    a = plan(char, [], npcs, tried_talks=set())
    assert a["type"] == "travel_hint"
    assert a["islandId"] == "toroa"


def test_rest_low_hp():
    char = {"mapId": "ohara", "x": 50, "y": 50, "currentHp": 50, "maxHp": 500}
    a = plan(char, [], [])
    assert a["type"] == "rest"


def test_kind_heuristic():
    assert objective_kind({"kind": "combat"}) == "combat"
    assert objective_kind({"kind": "fouille"}) == "fouille"
    assert objective_kind({"cible": {"name": "x"}}) == "combat"


def test_nearest_objective_preferred():
    char = {"mapId": "ohara", "x": 50, "y": 50}
    objs = [
        {"id": "far", "kind": "combat", "x": 10, "y": 10},
        {"id": "near", "kind": "fouille", "x": 52, "y": 50},
    ]
    a = plan(char, objs, [])
    assert a["objectifId"] == "near"


def test_fixture_receleurs_golden():
    fix = json.loads(
        (ROOT / "tests/fixtures/quests/ohara_receleurs_objective.json").read_text()
    )
    char = fix["character"]
    objs = fix["quest_objectives"]["objectifs"]
    a = plan(char, objs, [])
    assert a["type"] == fix["expected_plan_far"]["type"]
    assert a["objectifId"] == fix["expected_plan_far"]["objectifId"]
    near = {**char, "x": 72, "y": 36}
    a2 = plan(near, objs, [])
    assert a2["type"] == fix["expected_plan_near"]["type"]
