#!/usr/bin/env python3
"""
Capture générique d'appels REST → tests/fixtures/<system>/ ou stdout JSONL.

Usage programmatique :
  from capture_rest_session import RestCapture
  cap = RestCapture(token, system="world")
  st, body = cap.request("GET", "/api/characters")
  cap.save_session("daily_smoke")

CLI :
  export GL_EMAIL=... GL_PASSWORD=...
  python tools/capture_rest_session.py --system world --get /api/characters
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = "https://api.grandline-online.fr"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


class RestCapture:
    def __init__(self, token: str, system: str = "misc", character_id: str | None = None):
        self.token = token
        self.system = system
        self.character_id = character_id
        self.rows: list[dict] = []

    def request(self, method: str, path: str, body=None):
        data = None if body is None else json.dumps(body).encode()
        headers = {
            "content-type": "application/json",
            "user-agent": UA,
            "accept": "application/json",
            "authorization": "Bearer " + self.token,
        }
        req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                status = resp.status
                raw = resp.read().decode()
        except urllib.error.HTTPError as e:
            status = e.code
            raw = e.read().decode()
        try:
            parsed = json.loads(raw) if raw else None
        except Exception:
            parsed = {"raw": raw}
        row = {
            "meta": {
                "system": self.system,
                "capturedAt": datetime.now(timezone.utc).isoformat(),
                "source": "capture_rest_session",
                "characterId": self.character_id,
            },
            "request": {"method": method, "path": path, "body": body},
            "response": {"status": status, "body": parsed},
        }
        self.rows.append(row)
        return status, parsed

    def save_session(self, name: str) -> Path:
        out_dir = ROOT / "tests" / "fixtures" / self.system
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"{name}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.json"
        path.write_text(json.dumps(self.rows, indent=2, ensure_ascii=False))
        return path


def login(email: str, password: str) -> str:
    data = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        API + "/api/auth/login",
        data=data,
        headers={"content-type": "application/json", "user-agent": UA},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())["accessToken"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--system", default="misc")
    ap.add_argument("--get", action="append", default=[], help="path e.g. /api/characters")
    ap.add_argument("--name", default="session")
    args = ap.parse_args()
    email, password = os.getenv("GL_EMAIL", ""), os.getenv("GL_PASSWORD", "")
    if not email or not password:
        print("GL_EMAIL / GL_PASSWORD required")
        return 1
    token = login(email, password)
    cap = RestCapture(token, system=args.system)
    for path in args.get or ["/api/characters"]:
        st, body = cap.request("GET", path)
        print(path, st, type(body).__name__)
    out = cap.save_session(args.name)
    print("saved", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
