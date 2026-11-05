#!/usr/bin/env python3
"""
Capture chaque state GET /battles/:id pendant un combat API → tests/fixtures/battles/

  export GL_EMAIL=... GL_PASSWORD=...
  python tools/capture_battle_turns.py --pack ohara-groupe-xxx
  python tools/capture_battle_turns.py --battle-id <uuid>   # combat déjà lancé
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from decide_core import decide  # noqa: E402

API = "https://api.grandline-online.fr"
UA = "Mozilla/5.0"
OUT = ROOT / "tests" / "fixtures" / "battles"


def http(method, path, body=None, token=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"content-type": "application/json", "user-agent": UA}
    if token:
        headers["authorization"] = "Bearer " + token
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", type=str, default="")
    ap.add_argument("--battle-id", type=str, default="")
    args = ap.parse_args()
    email, password = os.getenv("GL_EMAIL", ""), os.getenv("GL_PASSWORD", "")
    if not email or not password:
        print("GL_EMAIL / GL_PASSWORD required")
        return 1
    st, login = http("POST", "/api/auth/login", {"email": email, "password": password})
    token = login["accessToken"]
    st, chars = http("GET", "/api/characters", token=token)
    char = chars[0]
    C = char["id"]
    bid = args.battle_id
    if not bid:
        if not args.pack:
            print("need --pack or --battle-id")
            return 1
        st, start = http(
            "POST", "/api/battles/start", {"characterId": C, "fauna": args.pack}, token
        )
        if st != 200 or not start.get("id"):
            print("start failed", st, start)
            return 2
        bid = start["id"]
        http("POST", f"/api/battles/{bid}/engage", {"characterId": C}, token)

    OUT.mkdir(parents=True, exist_ok=True)
    turn = 0
    t0 = time.time()
    print("capturing", bid)
    while time.time() - t0 < 120:
        st, s = http("GET", f"/api/battles/{bid}", token=token)
        if not s:
            time.sleep(0.25)
            continue
        if s.get("winner") or s.get("finished"):
            print("done", s.get("winner"))
            break
        my_turn = s.get("yourTurn") is True or (s.get("tactics") or {}).get("yourTurn")
        if not my_turn:
            time.sleep(0.2)
            continue
        turn += 1
        decision = decide(s, C)
        fixture = {
            "meta": {
                "capturedAt": datetime.now(timezone.utc).isoformat(),
                "characterId": C,
                "battleId": bid,
                "turn": turn,
                "source": "capture_battle_turns",
            },
            "state": s,
            "decision": {
                "type": decision.get("type"),
                "reason": decision.get("reason"),
            },
        }
        path = OUT / f"{bid[:8]}_turn_{turn:02d}.json"
        path.write_text(json.dumps(fixture, indent=2, ensure_ascii=False))
        print("saved", path.name, decision.get("reason") or decision.get("type"))

        # execute minimal to advance fight
        if decision["type"] == "move":
            http(
                "POST",
                f"/api/battles/{bid}/move",
                {
                    "characterId": C,
                    "cell": {
                        "x": decision["cell"]["x"],
                        "y": decision["cell"]["y"],
                    },
                },
                token,
            )
        elif decision["type"] in ("cast", "attack"):
            a, en = decision["action"], decision["enemy"]
            http(
                "POST",
                f"/api/battles/{bid}/action",
                {
                    "characterId": C,
                    "kind": a["kind"],
                    "id": a["id"],
                    "targetId": en["id"],
                    "targetCell": {"x": en["pos"]["x"], "y": en["pos"]["y"]},
                },
                token,
            )
        elif decision["type"] == "flee":
            http(
                "POST",
                f"/api/battles/{bid}/action",
                {"characterId": C, "kind": "FUITE", "id": "flee"},
                token,
            )
        else:
            http("POST", f"/api/battles/{bid}/end-turn", {"characterId": C}, token)
        time.sleep(0.25)
    print("fixtures in", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
