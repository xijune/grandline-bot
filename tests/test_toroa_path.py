"""Régression path Toroa — méthodo C.

Sans fixture : skip (gap A documenté).
Avec tests/fixtures/map/toroa_walkable.json : valide le trajet farm critique
  (120,92) -> (120,43)  pack chiens
  (120,92) -> (120,66)  pack colombes
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from map_path import bfs_path, load_walkable  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "map" / "toroa_walkable.json"


@pytest.fixture(scope="module")
def walkable():
    if not FIXTURE.exists():
        pytest.skip("toroa_walkable.json absent — capture A requise (scripts/dump_walkable.js)")
    return load_walkable("toroa")


def test_fixture_shape(walkable):
    assert walkable["width"] >= 80
    assert walkable["height"] >= 80
    assert len(walkable.get("blocked") or []) > 50


@pytest.mark.parametrize(
    "start,goal,max_len",
    [
        ((120, 92), (120, 43), 120),  # chiens
        ((120, 92), (120, 66), 80),   # colombes
        ((53, 129), (120, 66), 200),  # port -> colombes
        ((53, 129), (40, 56), 200),   # port -> poules
    ],
)
def test_critical_farm_paths(walkable, start, goal, max_len):
    path = bfs_path(walkable, start[0], start[1], goal[0], goal[1])
    assert path is not None, f"no path {start} -> {goal}"
    assert path[0]["x"] == start[0] and path[0]["y"] == start[1]
    # nearest-to-goal ok if goal cell blocked (pack anchor)
    end = path[-1]
    d = abs(end["x"] - goal[0]) + abs(end["y"] - goal[1])
    assert d <= 2, f"end too far from goal: {end} vs {goal}"
    assert len(path) <= max_len
