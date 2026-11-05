"""Régression pathfinding map offline."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from map_path import bfs_path, load_walkable, blocked_set  # noqa: E402


def test_ohara_fixture_loads():
    w = load_walkable("ohara")
    assert w["width"] == 160
    assert w["height"] == 160
    assert len(w["blocked"]) >= 100


def test_bfs_same_cell():
    w = load_walkable("ohara")
    p = bfs_path(w, 100, 89, 100, 89)
    assert p is not None
    assert p[0] == {"x": 100, "y": 89}


def test_bfs_short_path_open():
    w = load_walkable("ohara")
    blocked = blocked_set(w)
    # find open neighbor of 119,90 (pos live récente)
    x0, y0 = 119, 90
    assert (x0, y0) not in blocked
    p = bfs_path(w, x0, y0, x0 + 3, y0)
    assert p is not None
    assert len(p) >= 2
    assert p[0] == {"x": x0, "y": y0}
    assert p[-1]["x"] == x0 + 3
    # consecutive orthogonal
    for a, b in zip(p, p[1:]):
        assert abs(a["x"] - b["x"]) + abs(a["y"] - b["y"]) == 1


def test_bfs_avoids_blocked():
    w = load_walkable("ohara")
    blocked = blocked_set(w)
    # take a known blocked cell from fixture
    bx, by = next(iter(blocked))
    p = bfs_path(w, 119, 90, bx, by)
    # should not end on blocked (nearest open or None)
    if p:
        assert (p[-1]["x"], p[-1]["y"]) not in blocked
