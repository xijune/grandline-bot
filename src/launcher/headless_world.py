#!/usr/bin/env python3
"""
Monde GrandLine headless : Socket.IO world:join + player:move + combat API.

Validé 2026-11-02 :
  - socket https://api.grandline-online.fr /socket.io auth={token: JWT}
  - world:join {characterId, pasCompacts, carteEnTexte, carte?}
  - player:move {path:[{x,y},...], courir, sauter}  path.length >= 2, start = pos serveur

Usage:
  export GL_EMAIL=... GL_PASSWORD=...
  python src/launcher/headless_world.py --to 110,91
  python src/launcher/headless_world.py --farm 5
"""

from __future__ import annotations

# Windows console: force UTF-8 to avoid UnicodeEncodeError on arrows/emoji
import sys as _sys
if hasattr(_sys.stdout, "reconfigure"):
    try:
        _sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        _sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    import socketio
except ImportError:
    print("pip install python-socketio[client] websocket-client", file=sys.stderr)
    sys.exit(1)

API = "https://api.grandline-online.fr"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
ROOT = Path(__file__).resolve().parents[2]
import sys
sys.path.insert(0, str(ROOT / "tools"))
try:
    from map_path import load_walkable, bfs_path, chunk_path
except ImportError:
    load_walkable = bfs_path = chunk_path = None  # type: ignore
try:
    from decide_core import decide as decide_combat
except ImportError:
    decide_combat = None  # type: ignore


def http(method: str, path: str, body=None, token: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    headers = {
        "content-type": "application/json",
        "user-agent": UA,
        "accept": "application/json",
    }
    if token:
        headers["authorization"] = "Bearer " + token
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw}


def login(email: str, password: str) -> str:
    st, data = http("POST", "/api/auth/login", {"email": email, "password": password})
    if st != 200 or not data.get("accessToken"):
        raise RuntimeError(f"login failed: {st} {data}")
    return data["accessToken"]


def get_char(token: str, char_id: str | None = None) -> dict:
    st, chars = http("GET", "/api/characters", token=token)
    lst = chars if isinstance(chars, list) else (chars or {}).get("characters") or []
    if char_id:
        for c in lst:
            if c["id"] == char_id:
                return c
    return lst[0]


class HeadlessWorld:
    def __init__(self, token: str, character_id: str):
        self.token = token
        self.character_id = character_id
        self.sio = socketio.Client(logger=False, engineio_logger=False)
        self.join_data: dict | None = None
        self.x = 0
        self.y = 0
        self.map_id = None

    def connect(self, carte: str | None = None):
        # Prefer websocket; fall back to polling if websocket-client missing
        try:
            self.sio.connect(
                API,
                socketio_path="/socket.io",
                auth={"token": self.token},
                transports=["websocket", "polling"],
                wait_timeout=25,
            )
        except Exception:
            self.sio.connect(
                API,
                socketio_path="/socket.io",
                auth={"token": self.token},
                transports=["polling"],
                wait_timeout=25,
            )
        payload = {
            "characterId": self.character_id,
            "pasCompacts": True,
            "carteEnTexte": True,
        }
        if carte:
            payload["carte"] = carte
        self.join_data = self.sio.call("world:join", payload, timeout=30)
        if not self.join_data or not self.join_data.get("ok"):
            raise RuntimeError(f"world:join failed: {self.join_data}")
        self.map_id = (self.join_data.get("map") or {}).get("id") or carte
        self._sync_pos_from_join()
        return self.join_data

    def _sync_pos_from_join(self):
        for p in self.join_data.get("players") or []:
            if p.get("id") == self.character_id:
                self.x = int(p["x"])
                self.y = int(p["y"])
                self.map_id = p.get("mapId") or self.map_id
                return
        # fallback REST
        c = get_char(self.token, self.character_id)
        self.x = int(c.get("x") or 0)
        self.y = int(c.get("y") or 0)
        self.map_id = c.get("mapId") or self.map_id

    def refresh_pos_rest(self):
        c = get_char(self.token, self.character_id)
        self.x = int(c.get("x") or self.x)
        self.y = int(c.get("y") or self.y)
        return self.x, self.y

    def move_path(self, path: list[dict], courir: bool = True) -> dict:
        """path: liste de {x,y}, length >= 2, path[0] doit être la pos actuelle serveur."""
        if len(path) < 2:
            return {"ok": False, "error": "path too short"}
        # normalize ints
        path = [{"x": int(p["x"]), "y": int(p["y"])} for p in path]
        ack = self.sio.call(
            "player:move",
            {"path": path, "courir": courir, "sauter": False},
            timeout=15,
        )
        if isinstance(ack, dict) and ack.get("ok"):
            last = path[-1]
            self.x, self.y = last["x"], last["y"]
        return ack if isinstance(ack, dict) else {"ok": False, "error": str(ack)}

    def step(self, dx: int, dy: int, courir: bool = True) -> dict:
        """Un pas orthogonal (ou multi si |dx|+|dy|>1 via ligne)."""
        path = [{"x": self.x, "y": self.y}]
        cx, cy = self.x, self.y
        # greedy orthogonal
        while cx != self.x + dx or cy != self.y + dy:
            if cx != self.x + dx:
                cx += 1 if self.x + dx > cx else -1
            elif cy != self.y + dy:
                cy += 1 if self.y + dy > cy else -1
            path.append({"x": cx, "y": cy})
            if len(path) > 40:
                break
        return self.move_path(path, courir=courir)

    def walk_to(self, tx: int, ty: int, max_steps: int = 120) -> bool:
        """BFS fixture si dispo, sinon BFS online qui apprend les murs (Invalid path)."""
        from collections import deque

        tx, ty = int(tx), int(ty)
        if abs(self.x - tx) + abs(self.y - ty) <= 0:
            return True

        # persistent blocked cells for this session/map
        if not hasattr(self, "_blocked") or not isinstance(self._blocked, set):
            self._blocked = set()
            self._load_blocked_cache()

        # --- offline fixture path ---
        if bfs_path and load_walkable and self.map_id:
            try:
                w = load_walkable(self.map_id)
                path = bfs_path(w, self.x, self.y, tx, ty)
                if path and len(path) >= 2:
                    ok = self._execute_path(path)
                    if abs(self.x - tx) + abs(self.y - ty) <= 1:
                        return True
                    if ok:
                        self.refresh_pos_rest()
                        if abs(self.x - tx) + abs(self.y - ty) <= 1:
                            return True
            except FileNotFoundError:
                pass
            except Exception as e:
                print(f"  walk fixture warn: {e}")

        # --- online learning BFS (no fixture) ---
        return self._walk_learning(tx, ty, max_steps=max_steps)

    def _blocked_cache_path(self) -> Path:
        mid = self.map_id or "unknown"
        return ROOT / "artifacts" / f"map_blocked_{mid}.json"

    def _load_blocked_cache(self) -> None:
        path = self._blocked_cache_path()
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            for cell in data.get("blocked") or []:
                if isinstance(cell, str) and ":" in cell:
                    a, b = cell.split(":", 1)
                    self._blocked.add((int(a), int(b)))
                elif isinstance(cell, (list, tuple)) and len(cell) >= 2:
                    self._blocked.add((int(cell[0]), int(cell[1])))
            print(f"  blocked cache {path.name}: {len(self._blocked)} cells")
        except Exception as e:
            print(f"  blocked cache load warn: {e}")

    def _save_blocked_cache(self) -> None:
        path = self._blocked_cache_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            blocked = sorted(f"{x}:{y}" for x, y in self._blocked)
            path.write_text(
                json.dumps(
                    {"mapId": self.map_id, "blocked": blocked, "count": len(blocked)},
                    indent=2,
                ),
                encoding="utf-8",
            )
        except Exception:
            pass

    def _execute_path(self, path: list[dict], chunk: int = 10) -> bool:
        """Execute path in chunks. Returns False if a move failed."""
        if not path or len(path) < 2:
            return False
        # re-anchor to current server pos
        if path[0]["x"] != self.x or path[0]["y"] != self.y:
            path = [{"x": self.x, "y": self.y}] + [
                c for c in path[1:] if not (c["x"] == self.x and c["y"] == self.y)
            ]
        if len(path) < 2:
            return True
        chunks = chunk_path(path, chunk) if chunk_path else [path]
        all_ok = True
        for ch in chunks:
            if len(ch) < 2:
                continue
            if ch[0]["x"] != self.x or ch[0]["y"] != self.y:
                ch = [{"x": self.x, "y": self.y}] + ch[1:]
            if len(ch) < 2:
                continue
            ack = self.move_path(ch, courir=True)
            if not ack.get("ok"):
                all_ok = False
                # mark next cell as blocked
                if len(ch) >= 2:
                    self._blocked.add((int(ch[1]["x"]), int(ch[1]["y"])))
                break
            time.sleep(0.06)
        return all_ok

    def _plan_bfs(
        self, x0: int, y0: int, x1: int, y1: int, max_nodes: int = 25000
    ) -> list[dict] | None:
        """BFS treating self._blocked as walls. Bounds soft 0..159 (typical maps)."""
        from collections import deque

        # expand bounds around start/goal
        lo = min(x0, x1, 0) - 5
        hi_x = max(x0, x1, 160) + 5
        hi_y = max(y0, y1, 160) + 5
        start, goal = (x0, y0), (x1, y1)
        if start == goal:
            return [{"x": x0, "y": y0}]
        q = deque([start])
        prev: dict[tuple[int, int], tuple[int, int] | None] = {start: None}
        found = False
        while q and len(prev) < max_nodes:
            x, y = q.popleft()
            if (x, y) == goal:
                found = True
                break
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if nx < lo or ny < lo or nx > hi_x or ny > hi_y:
                    continue
                if (nx, ny) in self._blocked or (nx, ny) in prev:
                    continue
                prev[(nx, ny)] = (x, y)
                q.append((nx, ny))
        end = goal if found else None
        if end is None:
            # nearest reachable to goal
            best, best_d = None, 10**9
            for cx, cy in prev:
                d = abs(cx - x1) + abs(cy - y1)
                if d < best_d:
                    best_d, best = d, (cx, cy)
            end = best
        if end is None:
            return None
        path = []
        cur: tuple[int, int] | None = end
        while cur is not None:
            path.append({"x": cur[0], "y": cur[1]})
            cur = prev.get(cur)
        path.reverse()
        return path

    def _walk_learning(self, tx: int, ty: int, max_steps: int = 120) -> bool:
        """Plan -> move -> on fail mark blocked -> replan. Learns map walls."""
        steps = 0
        stagnant = 0
        last_pos = (self.x, self.y)
        while steps < max_steps:
            dist = abs(self.x - tx) + abs(self.y - ty)
            if dist <= 0:
                self._save_blocked_cache()
                return True
            if dist <= 1:
                # try final step onto goal
                ack = self.move_path(
                    [{"x": self.x, "y": self.y}, {"x": tx, "y": ty}], courir=True
                )
                if ack.get("ok") or abs(self.x - tx) + abs(self.y - ty) <= 1:
                    self._save_blocked_cache()
                    return True
                self._blocked.add((tx, ty))
                # accept adjacent
                self._save_blocked_cache()
                return True

            path = self._plan_bfs(self.x, self.y, tx, ty)
            if not path or len(path) < 2:
                self.refresh_pos_rest()
                self._save_blocked_cache()
                return abs(self.x - tx) + abs(self.y - ty) <= 1

            # take next few cells
            nxt = path[1]
            nx, ny = int(nxt["x"]), int(nxt["y"])
            # try multi-step chunk along path (faster)
            chunk = path[: min(8, len(path))]
            ack = self.move_path(chunk, courir=True) if len(chunk) >= 2 else {"ok": False}
            if not ack.get("ok"):
                # single step fallback
                ack = self.move_path(
                    [{"x": self.x, "y": self.y}, {"x": nx, "y": ny}], courir=True
                )
            if not ack.get("ok"):
                self._blocked.add((nx, ny))
                err = str(ack.get("error") or "")
                if steps < 3 or steps % 15 == 0:
                    print(f"  block ({nx},{ny}) err={err[:50]}")
                # if server desync, refresh
                if "mismatch" in err.lower() or "invalid" in err.lower():
                    self.refresh_pos_rest()
            steps += 1
            if (self.x, self.y) == last_pos:
                stagnant += 1
                if stagnant >= 8:
                    # try lateral escape
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, 1)):
                        ex, ey = self.x + dx, self.y + dy
                        if (ex, ey) in self._blocked:
                            continue
                        a2 = self.move_path(
                            [{"x": self.x, "y": self.y}, {"x": ex, "y": ey}], courir=True
                        )
                        if a2.get("ok"):
                            stagnant = 0
                            break
                        self._blocked.add((ex, ey))
                    else:
                        self.refresh_pos_rest()
                        self._save_blocked_cache()
                        return abs(self.x - tx) + abs(self.y - ty) <= 2
            else:
                stagnant = 0
                last_pos = (self.x, self.y)
            time.sleep(0.05)

        self.refresh_pos_rest()
        self._save_blocked_cache()
        return abs(self.x - tx) + abs(self.y - ty) <= 2

    def approach_pack(self, ox: int, oy: int, max_dist: int = 3) -> int:
        """Walk toward pack anchor then ring of neighbors until d <= max_dist. Returns final d."""
        ox, oy = int(ox), int(oy)
        self.walk_to(ox, oy)
        self.refresh_pos_rest()
        d = abs(self.x - ox) + abs(self.y - oy)
        if d <= max_dist:
            return d
        # spiral neighbors around anchor
        for radius in range(1, 6):
            for dx in range(-radius, radius + 1):
                for dy in range(-radius, radius + 1):
                    if max(abs(dx), abs(dy)) != radius:
                        continue
                    tx, ty = ox + dx, oy + dy
                    if (tx, ty) in getattr(self, "_blocked", set()):
                        continue
                    self.walk_to(tx, ty, max_steps=60)
                    self.refresh_pos_rest()
                    d = abs(self.x - ox) + abs(self.y - oy)
                    if d <= max_dist:
                        return d
        return abs(self.x - ox) + abs(self.y - oy)

    def fauna_packs(self) -> list[dict]:
        fauna = (self.join_data or {}).get("fauna") or {}
        packs = fauna.get("packs") or []
        morts = fauna.get("morts") or {}
        engagees = set(fauna.get("engagees") or [])
        now = time.time() * 1000
        out = []
        for p in packs:
            pid = p.get("id")
            if pid in engagees:
                continue
            mort = morts.get(pid)
            if mort and mort > now:
                continue
            ancre = p.get("ancre") or {}
            ox = int(ancre.get("x") or (p.get("mobs") or [{}])[0].get("orbit", {}).get("cx") or 0)
            oy = int(ancre.get("y") or (p.get("mobs") or [{}])[0].get("orbit", {}).get("cy") or 0)
            especes = [m.get("espece") for m in (p.get("mobs") or [])]
            # skip heavy packs for stable 0-dmg tests
            weak_re = __import__("re").compile(
                r"chien|chat|ecureuil|rat|oiseau|hibou|vautour|lapin|cerf|poule|colombe|pigeon", __import__("re").I
            )
            if especes and not all(weak_re.search(str(s or "")) for s in especes):
                continue
            out.append(
                {
                    "id": pid,
                    "ox": ox,
                    "oy": oy,
                    "d": abs(ox - self.x) + abs(oy - self.y),
                    "especes": especes,
                }
            )
        out.sort(key=lambda p: p["d"])
        return out

    def disconnect(self):
        try:
            self.sio.disconnect()
        except Exception:
            pass


# --- combat helpers (subset of pure_api_farm) ---

FIXTURES_BATTLES = ROOT / "tests" / "fixtures" / "battles"


def dist(a, b):
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])


def save_battle_fixture(char_id: str, bid: str, turn: int, state: dict, decision: dict, pack_id: str = "") -> Path:
    """Persiste un turn pour replay offline (méthodo A->B->C)."""
    from datetime import datetime, timezone

    FIXTURES_BATTLES.mkdir(parents=True, exist_ok=True)
    # Strip heavy appearance blobs to keep fixtures small
    slim = json.loads(json.dumps(state))
    for f in slim.get("fighters") or []:
        f.pop("appearance", None)
    fixture = {
        "meta": {
            "system": "combat",
            "capturedAt": datetime.now(timezone.utc).isoformat(),
            "source": "headless_world",
            "characterId": char_id,
            "battleId": bid,
            "packId": pack_id,
            "turn": turn,
        },
        "state": slim,
        "decision": {
            "type": decision.get("type"),
            "reason": decision.get("reason"),
            # serializable subset only
            "cell": decision.get("cell"),
            "banKey": decision.get("banKey"),
            "actionId": (decision.get("action") or {}).get("id"),
            "targetId": (decision.get("enemy") or {}).get("id"),
        },
    }
    path = FIXTURES_BATTLES / f"{bid[:8]}_t{turn:02d}.json"
    path.write_text(json.dumps(fixture, ensure_ascii=False))
    return path


def fight_pack(token, char_id, pack_id, capture: bool = True):
    """Fight loop - tools.decide_core (kite-first). Capture turns si capture=True."""
    st, start = http(
        "POST", "/api/battles/start", {"characterId": char_id, "fauna": pack_id}, token
    )
    if st != 200 or not isinstance(start, dict) or not start.get("id"):
        return {"error": "start", "status": st, "data": start}
    bid = start["id"]
    http("POST", f"/api/battles/{bid}/engage", {"characterId": char_id}, token)
    logs = []
    banned = set()
    hp_before = None
    turn = 0
    fixtures = []
    t0 = time.time()
    while time.time() - t0 < 90:
        st, s = http("GET", f"/api/battles/{bid}", token=token)
        if not s:
            time.sleep(0.2)
            continue
        me = next((f for f in s.get("fighters") or [] if f.get("id") == char_id), {})
        if hp_before is None:
            hp_before = me.get("hp")
        if s.get("winner") or s.get("finished"):
            logs.append("WINNER " + str(s.get("winner")))
            break
        if s.get("tactics", {}).get("placementDone") is False:
            http("POST", f"/api/battles/{bid}/engage", {"characterId": char_id}, token)
            time.sleep(0.3)
            continue
        if not (s.get("yourTurn") is True or (s.get("tactics") or {}).get("yourTurn")):
            time.sleep(0.2)
            continue
        if decide_combat is None:
            http("POST", f"/api/battles/{bid}/end-turn", {"characterId": char_id}, token)
            logs.append("no-decide_core")
            time.sleep(0.25)
            continue
        decision = decide_combat(s, char_id, banned)
        turn += 1
        logs.append(decision.get("reason") or decision.get("type"))
        if capture:
            try:
                fixtures.append(str(save_battle_fixture(char_id, bid, turn, s, decision, pack_id)))
            except Exception as e:
                logs.append(f"fixture-err:{e}")
        st2, res = 200, None
        if decision["type"] == "move":
            st2, res = http(
                "POST",
                f"/api/battles/{bid}/move",
                {
                    "characterId": char_id,
                    "cell": {
                        "x": decision["cell"]["x"],
                        "y": decision["cell"]["y"],
                    },
                },
                token,
            )
        elif decision["type"] in ("cast", "attack"):
            a, en = decision["action"], decision["enemy"]
            st2, res = http(
                "POST",
                f"/api/battles/{bid}/action",
                {
                    "characterId": char_id,
                    "kind": a["kind"],
                    "id": a["id"],
                    "targetId": en["id"],
                    "targetCell": {"x": en["pos"]["x"], "y": en["pos"]["y"]},
                },
                token,
            )
        elif decision["type"] == "flee":
            st2, res = http(
                "POST",
                f"/api/battles/{bid}/action",
                {"characterId": char_id, "kind": "FUITE", "id": "flee"},
                token,
            )
        else:
            st2, res = http(
                "POST", f"/api/battles/{bid}/end-turn", {"characterId": char_id}, token
            )
        if st2 == 409:
            logs.append("409:" + str((res or {}).get("error", ""))[:50])
            if decision.get("banKey"):
                banned.add(decision["banKey"])
            banned.add(decision.get("type") or "")
            time.sleep(0.25)
            continue
        if isinstance(res, dict) and (res.get("winner") or res.get("finished")):
            logs.append("WINNER " + str(res.get("winner")))
            break
        time.sleep(0.22 if decision["type"] == "move" else 0.18)
    st, s = http("GET", f"/api/battles/{bid}", token=token)
    me = next((f for f in (s or {}).get("fighters") or [] if f.get("id") == char_id), {})
    hp_after = me.get("hp", hp_before)
    return {
        "bid": bid,
        "pack": pack_id,
        "winner": (s or {}).get("winner"),
        "hpBefore": hp_before,
        "hpAfter": hp_after,
        "hpDelta": (hp_after or 0) - (hp_before or 0),
        "logs": logs[:25],
        "fixtures": len(fixtures),
        "fixtureFiles": fixtures[:5],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", type=str, help="x,y destination")
    ap.add_argument("--farm", type=int, default=0, help="N combats after optional walk")
    ap.add_argument("--step", type=str, help="dx,dy one relative step")
    ap.add_argument(
        "--no-capture",
        action="store_true",
        help="ne pas écrire tests/fixtures/battles/ (défaut: capture ON)",
    )
    args = ap.parse_args()

    email = os.getenv("GL_EMAIL", "")
    password = os.getenv("GL_PASSWORD", "")
    if not email or not password:
        print("Set GL_EMAIL GL_PASSWORD")
        return 1

    token = login(email, password)
    char = get_char(token, os.getenv("GL_CHAR_ID"))
    print(f"char {char['name']} {char.get('mapId')} ({char.get('x')},{char.get('y')})")

    world = HeadlessWorld(token, char["id"])
    try:
        world.connect(carte=char.get("mapId"))
        print(f"joined {world.map_id} at ({world.x},{world.y})")

        if args.step:
            dx, dy = map(int, args.step.split(","))
            ack = world.step(dx, dy)
            print("step", ack, "pos", world.x, world.y)

        if args.to:
            tx, ty = map(int, args.to.split(","))
            ok = world.walk_to(tx, ty)
            print(f"walk_to ({tx},{ty}) ok={ok} pos=({world.x},{world.y})")
            world.refresh_pos_rest()
            print("REST pos", world.x, world.y)

        if args.farm:
            packs = world.fauna_packs()
            print(f"packs visibles: {len(packs)} nearest:", packs[:5])
            results = []
            engage_max = 5  # Manhattan to pack anchor before start
            for p in packs:
                if len([r for r in results if r.get("winner") == "ALLIE"]) >= args.farm:
                    break
                print(f"\n-> approach pack {p['id']} d0={p['d']} @ ({p['ox']},{p['oy']})")
                d_after = world.approach_pack(p["ox"], p["oy"], max_dist=engage_max)
                world.refresh_pos_rest()
                d_now = abs(world.x - p["ox"]) + abs(world.y - p["oy"])
                print(f"  pos=({world.x},{world.y}) d_anchor={d_now} (target<={engage_max})")
                if d_now > engage_max + 2:
                    r = {
                        "error": "too_far_after_walk",
                        "status": None,
                        "pack": p["id"],
                        "d": d_now,
                        "pos": [world.x, world.y],
                        "anchor": [p["ox"], p["oy"]],
                    }
                    results.append(r)
                    print(r)
                    continue
                r = fight_pack(
                    token, char["id"], p["id"], capture=not args.no_capture
                )
                r["d"] = d_now
                r["pos"] = [world.x, world.y]
                results.append(r)
                # richer error print
                if r.get("error") == "start":
                    data = r.get("data") or {}
                    print({
                        "error": "start",
                        "status": r.get("status"),
                        "msg": (data.get("error") if isinstance(data, dict) else data),
                        "d": d_now,
                        "pos": [world.x, world.y],
                    })
                else:
                    print({
                        k: r.get(k)
                        for k in (
                            "winner",
                            "hpDelta",
                            "error",
                            "status",
                            "bid",
                            "fixtures",
                            "d",
                        )
                    })
                if r.get("logs"):
                    print(" ", " | ".join(r["logs"][:8]))
                # re-join fauna after fight
                try:
                    world.join_data = world.sio.call(
                        "world:join",
                        {
                            "characterId": char["id"],
                            "pasCompacts": True,
                            "carteEnTexte": True,
                            "carte": world.map_id,
                        },
                        timeout=20,
                    )
                    world._sync_pos_from_join()
                except Exception as e:
                    print("rejoin warn", e)
                time.sleep(0.5)
            out = ROOT / "artifacts" / "headless_farm_latest.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(results, indent=2, ensure_ascii=False))
            wins = sum(1 for r in results if r.get("winner") == "ALLIE")
            print(f"\nDONE wins={wins}/{len(results)} saved {out}")
    finally:
        world.disconnect()
    return 0


if __name__ == "__main__":
    sys.exit(main())
