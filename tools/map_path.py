"""
Pathfinding map offline — BFS sur fixtures walkable.

Fixture format (tests/fixtures/map/<mapId>_walkable.json):
  { width, height, blocked: ["x:y", ...], blockedFormat: "x:y" }
"""

from __future__ import annotations

import json
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAPS = ROOT / "tests" / "fixtures" / "map"
DATA_MAPS = ROOT / "docs" / "data" / "maps"


def load_walkable(map_id: str) -> dict:
    for base in (MAPS, DATA_MAPS):
        path = base / f"{map_id}_walkable.json"
        if path.exists():
            return json.loads(path.read_text())
    raise FileNotFoundError(f"No walkable fixture for map {map_id}")


def blocked_set(data: dict) -> set[tuple[int, int]]:
    fmt = data.get("blockedFormat") or "x:y"
    out = set()
    for cell in data.get("blocked") or []:
        if isinstance(cell, dict):
            out.add((int(cell["x"]), int(cell["y"])))
        elif isinstance(cell, str):
            sep = ":" if ":" in cell else ","
            x, y = cell.split(sep)
            out.add((int(x), int(y)))
        else:
            out.add((int(cell[0]), int(cell[1])))
    return out


def in_bounds(x: int, y: int, w: int, h: int) -> bool:
    return 0 <= x < w and 0 <= y < h


def bfs_path(
    walkable: dict,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    max_nodes: int = 20000,
) -> list[dict] | None:
    """Retourne path inclusif [{x,y},…] ou None."""
    w = int(walkable["width"])
    h = int(walkable["height"])
    blocked = blocked_set(walkable)
    start, goal = (x0, y0), (x1, y1)
    if start in blocked or goal in blocked:
        # autoriser start sur blocked (parfois edge) mais pas goal
        if goal in blocked:
            return None
    if not in_bounds(x1, y1, w, h):
        return None
    q = deque([start])
    prev: dict[tuple[int, int], tuple[int, int] | None] = {start: None}
    while q and len(prev) < max_nodes:
        x, y = q.popleft()
        if (x, y) == goal:
            break
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not in_bounds(nx, ny, w, h):
                continue
            if (nx, ny) in blocked or (nx, ny) in prev:
                continue
            prev[(nx, ny)] = (x, y)
            q.append((nx, ny))
    if goal not in prev:
        # nearest reachable to goal
        best = None
        best_d = 10**9
        for cx, cy in prev:
            d = abs(cx - x1) + abs(cy - y1)
            if d < best_d:
                best_d = d
                best = (cx, cy)
        if best is None:
            return None
        goal = best
    path = []
    cur: tuple[int, int] | None = goal
    while cur is not None:
        path.append({"x": cur[0], "y": cur[1]})
        cur = prev.get(cur)
    path.reverse()
    return path


def chunk_path(path: list[dict], max_len: int = 12) -> list[list[dict]]:
    if not path:
        return []
    chunks = []
    i = 0
    while i < len(path) - 1:
        chunk = path[i : i + max_len]
        if len(chunk) < 2 and i + 1 < len(path):
            chunk = path[i : i + 2]
        chunks.append(chunk)
        i += max(1, len(chunk) - 1)
    return chunks
