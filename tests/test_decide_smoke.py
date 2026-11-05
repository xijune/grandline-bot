"""Régression smoke : decide_core sur fixtures si présentes."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from decide_core import decide  # noqa: E402

FIX = ROOT / "tests" / "fixtures" / "battles"


def test_fixtures_exist_or_skip():
    files = list(FIX.glob("*.json")) if FIX.exists() else []
    if not files:
        # pas encore de capture — skip soft
        assert True
        return
    for path in files[:30]:
        data = json.loads(path.read_text())
        state = data.get("state") or data
        char_id = data.get("meta", {}).get("characterId") or state.get("you")
        if not char_id:
            for f in state.get("fighters") or []:
                if f.get("team") == "ALLIE":
                    char_id = f["id"]
                    break
        d = decide(state, char_id or "")
        assert "type" in d
        assert d["type"] in ("move", "cast", "attack", "endturn", "guard", "flee")


def test_ranged_never_returns_bare_attack_when_techniques_exist():
    """Construit un mini-state synthétique threatened + technique dispo."""
    state = {
        "you": "me",
        "yourTurn": True,
        "fighters": [
            {"id": "me", "team": "ALLIE", "hp": 300, "maxHp": 400},
            {
                "id": "en1",
                "team": "ENNEMI",
                "hp": 50,
                "maxHp": 50,
                "name": "Rat",
                "caracs": {"pm": 3},
                "techniques": [],
            },
        ],
        "tactics": {
            "ap": 6,
            "mp": 3,
            "positions": {"me": {"x": 10, "y": 10}, "en1": {"x": 11, "y": 10}},
            "reachable": [
                {"x": 10, "y": 10, "cost": 0},
                {"x": 9, "y": 10, "cost": 1},
                {"x": 8, "y": 10, "cost": 2},
                {"x": 7, "y": 10, "cost": 3},
            ],
            "obstacles": [],
        },
        "actions": [
            {"kind": "ATTAQUE", "id": "attack", "name": "Attaque", "pa": 2},
            {
                "kind": "TECHNIQUE",
                "id": "tir-1",
                "name": "Tir précis",
                "pa": 2,
                "geometry": {"range": 6, "needsSight": True},
                "estimates": {"en1": {"min": 40, "max": 50}},
            },
        ],
    }
    d = decide(state, "me")
    # threatened d=1 + kill available → HIT-THEN-KITE (cast kill), not bare ATTAQUE
    assert d["type"] in ("cast", "move"), d
    if d["type"] == "cast":
        assert d.get("action", {}).get("kind") == "TECHNIQUE", d
        assert "KILL" in (d.get("reason") or "") or "HIT-THEN-KITE" in (d.get("reason") or "")
    else:
        assert "KITE" in (d.get("reason") or "")
