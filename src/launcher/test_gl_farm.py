#!/usr/bin/env python3
"""
Test live / perf de scripts/gl_farm.js (Selenium).

  export GL_EMAIL=... GL_PASSWORD=...
  python src/launcher/test_gl_farm.py --fights 5
"""

from __future__ import annotations

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
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "launcher"))
GL_FARM_JS = ROOT / "scripts" / "gl_farm.js"


def load_creds() -> tuple[str, str]:
    email = os.getenv("GL_EMAIL", "").strip()
    password = os.getenv("GL_PASSWORD", "").strip()
    if email and password:
        return email, password
    path = ROOT / "config" / "accounts.json"
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            for a in data.get("accounts") or []:
                if a.get("email") and a.get("password"):
                    return a["email"], a["password"]
        except Exception:
            pass
    return "", ""


def make_driver(headed: bool) -> webdriver.Chrome:
    o = Options()
    if not headed:
        o.add_argument("--headless=new")
    o.add_argument("--no-sandbox")
    o.add_argument("--disable-dev-shm-usage")
    o.add_argument("--disable-gpu")
    o.add_argument("--disable-software-rasterizer")
    o.add_argument("--disable-extensions")
    o.add_argument("--renderer-process-limit=2")
    o.add_argument("--disable-blink-features=AutomationControlled")
    o.add_argument("--window-size=1280,800")
    o.add_argument("--memory-pressure-off")
    o.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    )
    o.add_experimental_option("excludeSwitches", ["enable-automation"])
    o.add_experimental_option("useAutomationExtension", False)
    d = webdriver.Chrome(options=o)
    d.execute_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )
    d.set_page_load_timeout(45)
    return d


def wait_scene(driver, timeout: float = 90) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            ok = driver.execute_script(
                "return !!(window.__grandlineScene && "
                "(window.__grandlineScene.character || window.__grandlineScene.network))"
            )
            if ok:
                return True
        except Exception:
            pass
        time.sleep(0.4)
    return False


def inject(driver) -> None:
    src = GL_FARM_JS.read_text(encoding="utf-8")
    driver.execute_script(
        "window.__glCfg = Object.assign({}, window.__glCfg || {}, { VERBOSE: true, BETWEEN_FIGHTS_MS: 250, NO_PACK_WAIT_MS: 1200 });"
    )
    driver.execute_script(src)
    ok = driver.execute_script(
        "return typeof window.GL === 'object' && typeof window.GL.next === 'function'"
    )
    if not ok:
        raise RuntimeError("GL.next missing after inject")


def scene_info(driver) -> dict:
    return driver.execute_script(
        """
        const s = window.__grandlineScene || {};
        const c = s.character || {};
        const packs = (s.network && s.network.fauna && s.network.fauna.packs) || [];
        return {
          name: c.name, mapId: c.mapId, x: c.x, y: c.y,
          level: c.level, id: c.id, packs: packs.length,
          packIds: packs.slice(0, 6).map(p => p.id)
        };
        """
    )


def run_one_next(driver, timeout: float = 90) -> dict:
    """Lance GL.next() une fois avec timeout Python (évite hang infini)."""
    driver.execute_script(
        """
        window.__GL_ONE = { done: false };
        (async () => {
          const t0 = Date.now();
          try {
            const r = await GL.next();
            window.__GL_ONE = {
              done: true,
              ms: Date.now() - t0,
              result: r,
              stats: (typeof GL.stats === 'function') ? GL.stats() : null,
              pos: (typeof GL.player === 'function') ? GL.player() : null,
            };
          } catch (e) {
            window.__GL_ONE = {
              done: true,
              ms: Date.now() - t0,
              error: String(e && (e.stack || e.message || e)),
            };
          }
        })();
        """
    )
    t0 = time.time()
    while time.time() - t0 < timeout:
        data = driver.execute_script("return window.__GL_ONE")
        if data and data.get("done"):
            return data
        time.sleep(0.8)
    # force unlock busy if hung
    try:
        driver.execute_script(
            "if (window.GL) { try { GL.stop(); } catch(e){} }"
            "window.__GL_ONE = Object.assign(window.__GL_ONE||{}, {done:true, error:'timeout'});"
            # reset internal busy if accessible — best effort
        )
    except Exception:
        pass
    return {"done": True, "error": "timeout", "ms": int((time.time() - t0) * 1000)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fights", type=int, default=5)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--per-fight-timeout", type=int, default=75)
    args = ap.parse_args()

    email, password = load_creds()
    if not email or not password:
        print("ERR: export GL_EMAIL GL_PASSWORD")
        return 1

    import selenium_login as sl

    print("=" * 50)
    print(" GL Farm PERF test")
    print("=" * 50)
    print("account", email, "fights", args.fights)

    driver = make_driver(headed=args.headed)
    t_all = time.time()
    try:
        if not sl.login(driver, email, password):
            return 2
        sl.enter_world(driver)
        if not wait_scene(driver, 90):
            print("ERR no scene")
            return 3

        info = scene_info(driver)
        print("scene", info)
        inject(driver)
        print("-> inject OK, running sequential GL.next()")

        results = []
        for i in range(args.fights):
            print(f"\n--- fight {i+1}/{args.fights} ---")
            # close any leftover UI
            try:
                driver.execute_script(
                    """
                    if (window.GL && GL.closePopup) GL.closePopup();
                    for (const b of document.querySelectorAll('button')) {
                      const t=(b.innerText||'').trim();
                      if (/continuer|fermer|prêt/i.test(t)) try{b.click()}catch(e){}
                    }
                    """
                )
            except Exception:
                pass
            one = run_one_next(driver, timeout=args.per_fight_timeout)
            results.append(one)
            r = one.get("result") if isinstance(one.get("result"), dict) else {}
            st = one.get("stats") or {}
            print(
                f"  ms={one.get('ms')} err={one.get('error')} "
                f"result_keys={list(r.keys())[:8] if r else None} "
                f"wins={st.get('wins')} battles={st.get('battles')} "
                f"walkFails={st.get('walkFails')} pos={one.get('pos')}"
            )
            if one.get("error") == "timeout":
                print("  WARN timeout — continue next")
            time.sleep(0.4)

        total_ms = int((time.time() - t_all) * 1000)
        final_stats = results[-1].get("stats") if results else {}
        # compute from results
        fight_ms = [x.get("ms") or 0 for x in results if not x.get("error")]
        errs = sum(1 for x in results if x.get("error"))
        wins = int((final_stats or {}).get("wins") or 0)
        losses = int((final_stats or {}).get("losses") or 0)
        walk_fails = int((final_stats or {}).get("walkFails") or 0)
        xp = int((final_stats or {}).get("xpDelta") or 0)
        berries = int((final_stats or {}).get("berriesDelta") or 0)
        hp_deltas = []
        for x in results:
            r = x.get("result")
            if isinstance(r, dict) and r.get("hpDelta") is not None:
                hp_deltas.append(r["hpDelta"])

        farm_ms = sum(fight_ms) or total_ms
        minutes = max(farm_ms / 60000.0, 0.001)
        report = {
            "total_ms": total_ms,
            "farm_ms": farm_ms,
            "fights_requested": args.fights,
            "fights_ok_timed": len(fight_ms),
            "timeouts_or_errors": errs,
            "wins": wins,
            "losses": losses,
            "walkFails": walk_fails,
            "hpDeltas": hp_deltas,
            "xpDelta": xp,
            "berriesDelta": berries,
            "xp_per_min": round(xp / minutes, 1),
            "berries_per_min": round(berries / minutes, 1),
            "sec_per_fight": round((farm_ms / 1000.0) / max(len(fight_ms), 1), 1),
            "avg_fight_ms": int(sum(fight_ms) / max(len(fight_ms), 1)),
            "char": info,
            "final_pos": results[-1].get("pos") if results else None,
            "stats": final_stats,
            "results": results,
        }

        path = ROOT / "artifacts" / "gl_farm_perf.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

        print("\n===== PERF REPORT =====")
        for k in (
            "total_ms",
            "fights_requested",
            "wins",
            "losses",
            "walkFails",
            "timeouts_or_errors",
            "hpDeltas",
            "xpDelta",
            "berriesDelta",
            "xp_per_min",
            "berries_per_min",
            "sec_per_fight",
            "avg_fight_ms",
        ):
            print(f"  {k}: {report[k]}")
        print("saved", path)
        return 0 if wins > 0 else 5
    finally:
        try:
            driver.quit()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
