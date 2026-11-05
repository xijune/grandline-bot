#!/usr/bin/env python3
"""Replay decide() sur une fixture battle (0 réseau)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from decide_core import decide  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("fixture", type=str, help="path to fixture JSON")
    ap.add_argument("--char", type=str, default="", help="characterId override")
    args = ap.parse_args()
    path = Path(args.fixture)
    data = json.loads(path.read_text())
    state = data.get("state") or data
    char_id = args.char or data.get("meta", {}).get("characterId") or state.get("you") or ""
    if not char_id:
        # try first ALLIE fighter
        for f in state.get("fighters") or []:
            if f.get("team") == "ALLIE":
                char_id = f["id"]
                break
    d = decide(state, char_id)
    print(json.dumps(d, indent=2, ensure_ascii=False, default=str))
    if data.get("decision"):
        print("--- annotated ---")
        print(json.dumps(data["decision"], indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
