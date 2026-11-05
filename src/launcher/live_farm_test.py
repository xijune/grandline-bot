#!/usr/bin/env python3
"""
Live farm test - headless Chrome + injection + N combats API.
Usage:
  export GL_EMAIL=junymine4 GL_PASSWORD=...
  python src/launcher/live_farm_test.py --fights 10
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
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[2]
EMAIL = os.getenv("GL_EMAIL", "")
PASSWORD = os.getenv("GL_PASSWORD", "")

# Script injecté : farm N combats, kite-first, rest, logs JSON dans window.__GL_FARM_RESULT
INJECT = r"""
window.__GL_FARM_RESULT = null;
(async () => {
  const N = window.__GL_FARM_N || 8;
  const API = "https://api.grandline-online.fr";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dist = (a, b) => Math.abs((a?.x ?? 0) - (b?.x ?? 0)) + Math.abs((a?.y ?? 0) - (b?.y ?? 0));
  const token = () => sessionStorage.getItem("grandline-token") || window.__freshToken;
  const scene = () => window.__grandlineScene;
  const charId = () => scene()?.character?.id;

  async function api(method, path, body) {
    const r = await fetch(API + path, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  }

  function actionRange(a) {
    if (a?.kind === "ATTAQUE") return 1;
    return a?.geometry?.range ?? a?.range ?? 1;
  }
  function actionPa(a) {
    if (a?.kind === "GARDE" || a?.kind === "FUITE") return 0;
    if (a?.kind === "ATTAQUE") return Math.max(2, a.pa ?? a.cost ?? 2);
    return a?.pa ?? a?.cost ?? 99;
  }
  function avgEst(est) {
    if (!est) return 0;
    return ((est.min ?? 0) + (est.max ?? 0)) / 2;
  }
  function enemyMaxRange(e) {
    let m = 1;
    for (const t of e.techniques || []) {
      const r = t.geometry?.range ?? t.range ?? 1;
      if (r > m) m = r;
    }
    return m;
  }
  function myMaxRange(actions) {
    let m = 1;
    for (const a of actions) {
      if (a.kind === "FUITE" || a.kind === "GARDE" || a.kind === "ATTAQUE") continue;
      m = Math.max(m, actionRange(a));
    }
    return Math.max(m, 1);
  }
  function hasLOS(from, to, obs) {
    if (!from || !to) return false;
    if (!obs || !obs.size) return true;
    let x0 = from.x, y0 = from.y, x1 = to.x, y1 = to.y;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (!(x0 === x1 && y0 === y1)) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
      if (x0 === x1 && y0 === y1) break;
      if (obs.has(x0 + ":" + y0)) return false;
    }
    return true;
  }
  function myTurn(s) {
    return s?.yourTurn === true || s?.tactics?.yourTurn === true;
  }

  function decide(s, me, banned) {
    banned = banned || new Set();
    const meId = s.you || charId();
    const tactics = s.tactics || {};
    const positions = tactics.positions || {};
    const myPos = positions[meId];
    if (!myPos) return { type: "endturn", reason: "no pos" };
    const ap = Number(tactics.ap ?? 0), mp = Number(tactics.mp ?? 0);
    const actions = (s.actions || []).filter((a) => a.usable !== false && !a.locked);
    const obs = new Set((tactics.obstacles || []).map((o) => o.x + ":" + o.y));
    const enemies = (s.fighters || [])
      .filter((f) => f.team === "ENNEMI" && (f.hp || 0) > 0)
      .map((f) => ({ ...f, pos: positions[f.id], d: positions[f.id] ? dist(myPos, positions[f.id]) : 99 }))
      .filter((f) => f.pos)
      .sort((a, b) => a.d - b.d);
    if (!enemies.length) return { type: "endturn", reason: "no enemies" };
    const maxR = myMaxRange(actions);
    const maxPM = Math.max(...enemies.map((e) => e.caracs?.pm ?? 3));
    const maxER = Math.max(...enemies.map((e) => enemyMaxRange(e)));
    const sweet = Math.min(maxR, Math.max(4, maxPM + maxER + 1));
    const curMin = enemies[0].d;
    const threatened = enemies.some((e) => e.d <= (e.caracs?.pm ?? 3) + enemyMaxRange(e));
    const reachable = (tactics.reachable || []).filter((c) => (c.cost || 0) <= mp);
    const ranged = maxR >= 4;

    if (threatened && mp > 0 && reachable.length && ranged) {
      let best = null;
      for (const c of reachable) {
        const dMin = Math.min(...enemies.map((e) => dist(c, e.pos)));
        let score = dMin >= sweet ? 1000 + dMin : dMin > curMin ? dMin * 10 : dMin;
        if (enemies.some((e) => dist(c, e.pos) <= maxR)) score += 50;
        if (!best || score > best.score) best = { cell: c, score, d: dMin };
      }
      if (best && best.d > curMin)
        return { type: "move", cell: best.cell, reason: `KITE ${curMin}->${best.d}` };
    }
    if (ap <= 0) return { type: "endturn", reason: `AP0 d=${curMin}` };

    let best = null;
    for (const a of actions) {
      if (a.kind === "FUITE" || a.kind === "GARDE") continue;
      if (ranged && a.kind === "ATTAQUE") continue;
      const range = actionRange(a), pa = actionPa(a);
      if (pa > ap) continue;
      const needsSight = a.kind !== "ATTAQUE" && (a.geometry?.needsSight !== false || range > 1);
      for (const en of enemies) {
        const banKey = `${a.id}:${en.id}`;
        if (banned.has(banKey)) continue;
        if (en.d > range) continue;
        if (needsSight && !hasLOS(myPos, en.pos, obs)) continue;
        const est = a.estimates?.[en.id];
        if (!est && a.kind !== "ATTAQUE") continue;
        const dmg = est ? avgEst(est) : 10;
        let score = dmg / Math.max(pa, 1);
        if (est && est.max >= en.hp) score += 10000;
        if (enemies.length >= 2) score += 350 * (1 - en.hp / Math.max(en.maxHp || 1, 1));
        if (a.kind === "TECHNIQUE") score += 3;
        if (threatened) score -= 40;
        if (en.d >= sweet) score += 15;
        if (!best || score > best.score)
          best = {
            type: a.kind === "ATTAQUE" ? "attack" : "cast",
            action: a,
            enemy: en,
            banKey,
            reason: `${a.name}->${en.name} d=${en.d} ~${Math.round(dmg)}`,
          };
      }
    }
    if (best && (!threatened || mp <= 0)) return best;
    if (best && threatened && mp <= 0) return best;

    if (mp > 0 && reachable.length) {
      let approach = null;
      for (const c of reachable) {
        const dMin = Math.min(...enemies.map((e) => dist(c, e.pos)));
        let score = -Math.abs(dMin - sweet) * 10;
        if (ranged && dMin < sweet - 1) score -= 40;
        if (dMin <= maxR && dMin >= (ranged ? sweet : 1)) score += 30;
        if (!approach || score > approach.score) approach = { cell: c, score, d: dMin };
      }
      if (approach && approach.d !== curMin)
        return { type: "move", cell: approach.cell, reason: `APPROACH ${curMin}->${approach.d}` };
    }
    if (best) return best;
    return { type: "endturn", reason: `idle d=${curMin}` };
  }

  async function execute(bid, decision) {
    const C = charId();
    if (decision.type === "move")
      return api("POST", `/api/battles/${bid}/move`, { characterId: C, cell: { x: decision.cell.x, y: decision.cell.y } });
    if (decision.type === "cast" || decision.type === "attack") {
      const a = decision.action, en = decision.enemy;
      return api("POST", `/api/battles/${bid}/action`, {
        characterId: C, kind: a.kind, id: a.id, targetId: en.id, targetCell: { x: en.pos.x, y: en.pos.y },
      });
    }
    return api("POST", `/api/battles/${bid}/end-turn`, { characterId: C });
  }

  async function closePopups() {
    for (const b of document.querySelectorAll("button")) {
      const t = (b.innerText || "").trim();
      if (/continuer|fermer|passer le guide|je reste|prêt/i.test(t)) {
        try { b.click(); } catch {}
      }
    }
  }

  async function restIfNeeded() {
    const r = await api("GET", "/api/characters");
    const list = Array.isArray(r.data) ? r.data : r.data?.characters || [];
    const me = list.find((c) => c.id === charId()) || list[0];
    const hp = me?.hp ?? 0, maxHp = me?.maxHp || 1;
    if (hp / maxHp < 0.4) {
      const rest = await api("POST", "/api/world/rest", { characterId: charId(), kind: "BELLE_ETOILE" });
      return { rested: true, hpBefore: hp, recovered: rest.data?.hpRecovered, hpAfter: rest.data?.character?.hp };
    }
    return { rested: false, hp };
  }

  function blocked(x, y) {
    const mb = scene()?.movementBlocked;
    return mb && typeof mb.has === "function" && (mb.has(x + "," + y) || mb.has(x + ":" + y));
  }

  async function walkTo(tx, ty) {
    const sc = scene();
    const C = charId();
    const k = (x, y) => x + "," + y;
    const from = { x: Math.round(sc.entities.get(C).x), y: Math.round(sc.entities.get(C).y) };
    const q = [[from.x, from.y]];
    const prev = new Map([[k(from.x, from.y), null]]);
    while (q.length && prev.size < 8000) {
      const [x, y] = q.shift();
      if (x === tx && y === ty) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, kk = k(nx, ny);
        if (prev.has(kk) || blocked(nx, ny)) continue;
        prev.set(kk, [x, y]);
        q.push([nx, ny]);
      }
    }
    let end = k(tx, ty);
    if (!prev.has(end)) {
      let best = null, bd = 1e9;
      for (const kk of prev.keys()) {
        const [x, y] = kk.split(",").map(Number);
        const d = Math.abs(x - tx) + Math.abs(y - ty);
        if (d < bd) { bd = d; best = kk; }
      }
      end = best;
    }
    if (!end || !prev.has(end)) return false;
    const full = [];
    let cur = end;
    while (cur) {
      const [x, y] = cur.split(",").map(Number);
      full.push({ x, y });
      const p = prev.get(cur);
      cur = p ? k(p[0], p[1]) : null;
    }
    full.reverse();
    for (let g = 0; g < full.length + 40; g++) {
      const ent = sc.entities.get(C);
      const c = { x: Math.round(ent.x), y: Math.round(ent.y) };
      if (Math.abs(c.x - tx) + Math.abs(c.y - ty) <= 1) return true;
      while (ent.moving) await sleep(20);
      let idx = 0, best = 1e9;
      for (let j = 0; j < full.length; j++) {
        const d = Math.abs(full[j].x - c.x) + Math.abs(full[j].y - c.y);
        if (d < best) { best = d; idx = j; }
      }
      const slice = full.slice(idx, Math.min(idx + 12, full.length));
      const chunk = [{ x: c.x, y: c.y }];
      for (const p of slice) {
        if (p.x === c.x && p.y === c.y) continue;
        chunk.push(p);
      }
      if (chunk.length < 2) {
        chunk.push({
          x: c.x + Math.sign(tx - c.x),
          y: c.y + (Math.sign(tx - c.x) === 0 ? Math.sign(ty - c.y) : 0),
        });
      }
      try {
        await sc.moveLocal(chunk, null, { courir: true, redresser: true });
      } catch {}
      await sleep(90);
    }
    return true;
  }

  function listPacks() {
    const sc = scene();
    const pl = sc.entities.get(charId());
    const pos = { x: Math.round(pl.x), y: Math.round(pl.y) };
    const f = sc.network?.fauna || {};
    const now = Date.now();
    const weak = /chien|chat|ecureuil|rat|oiseau|hibou|vautour|lapin/i;
    return (f.packs || [])
      .map((p) => {
        const ox = Math.round(p.mobs?.[0]?.orbit?.cx ?? p.ancre?.x);
        const oy = Math.round(p.mobs?.[0]?.orbit?.cy ?? p.ancre?.y);
        const mort = f.morts?.[p.id];
        const eng = (f.engagees || []).includes(p.id);
        const espece = (p.mobs || []).map((m) => m.espece);
        if (espece.some((s) => /mercenaire|bucheron/i.test(s))) return null;
        if (!espece.every((s) => weak.test(s))) return null;
        return {
          id: p.id, ox, oy,
          d: Math.abs(ox - pos.x) + Math.abs(oy - pos.y),
          espece, ok: !(mort && mort > now) && !eng,
        };
      })
      .filter(Boolean)
      .filter((p) => p.ok)
      .sort((a, b) => a.d - b.d);
  }

  async function fight(bid) {
    const logs = [];
    const C = charId();
    const before = await api("GET", "/api/characters");
    const list = Array.isArray(before.data) ? before.data : before.data?.characters || [];
    const me0 = list.find((c) => c.id === C) || list[0];
    const hpB = me0?.hp ?? 0;

    await api("POST", `/api/battles/${bid}/engage`, { characterId: C });
    await closePopups();
    const banned = new Set();
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      await closePopups();
      const r = await api("GET", `/api/battles/${bid}`);
      const s = r.data;
      if (!s) { await sleep(200); continue; }
      if (s.winner || s.finished) {
        logs.push("WINNER " + s.winner);
        break;
      }
      if (s.tactics?.placementDone === false) {
        await closePopups();
        await sleep(400);
        continue;
      }
      if (!myTurn(s)) { await sleep(200); continue; }
      const me = (s.fighters || []).find((f) => f.id === (s.you || C)) || {};
      const decision = decide(s, me, banned);
      logs.push(decision.reason || decision.type);
      const res = await execute(bid, decision);
      if (res.status === 409) {
        logs.push("409:" + String(res.data?.error || "").slice(0, 60));
        if (decision.banKey) banned.add(decision.banKey);
        banned.add(decision.type);
        await sleep(300);
        continue;
      }
      if (res.data?.winner || res.data?.finished) {
        logs.push("WINNER " + (res.data.winner || s.winner));
        break;
      }
      await sleep(decision.type === "move" ? 320 : 220);
    }
    await sleep(400);
    await closePopups();
    await sleep(400);
    await closePopups();
    const after = await api("GET", "/api/characters");
    const list2 = Array.isArray(after.data) ? after.data : after.data?.characters || [];
    const me1 = list2.find((c) => c.id === C) || list2[0];
    const hpA = me1?.hp ?? hpB;
    return {
      bid,
      logs: logs.slice(0, 40),
      hpBefore: hpB,
      hpAfter: hpA,
      hpDelta: hpA - hpB,
      winner: (logs.find((l) => String(l).startsWith("WINNER")) || "").replace("WINNER ", ""),
    };
  }

  async function oneFight() {
    await closePopups();
    const packs = listPacks();
    if (!packs.length) return { error: "no pack" };
    const target = packs[0];
    await walkTo(target.ox, target.oy);
    await sleep(400);
    const sc = scene();
    sc.confirmationDattaqueDemandee = () => false;

    // try API start then UI fallback
    let start = await api("POST", "/api/battles/start", { characterId: charId(), fauna: target.id });
    if (!start.ok) {
      try { sc.onFaunaAttack(target.id); } catch {}
      await sleep(1200);
      await closePopups();
      let bid = sc.combatState?.id;
      for (let i = 0; i < 15 && !bid; i++) {
        await sleep(200);
        bid = sc.combatState?.id;
      }
      if (!bid) return { error: "start failed", start, target };
      return { target, ...(await fight(bid)) };
    }
    return { target, ...(await fight(start.data.id)) };
  }

  // wait scene
  for (let i = 0; i < 40 && !scene(); i++) await sleep(250);
  if (!scene()) {
    window.__GL_FARM_RESULT = { error: "no scene" };
    return;
  }
  await closePopups();
  const restInfo = await restIfNeeded();
  const results = [];
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const r = await oneFight();
    results.push(r);
    if (r.error && r.error !== "start failed") break;
    await restIfNeeded();
    await sleep(800);
  }
  window.__GL_FARM_RESULT = {
    ok: true,
    n: results.length,
    ms: Date.now() - t0,
    restInfo,
    results,
  };
})();
"""


def make_driver(headless: bool = True) -> webdriver.Chrome:
    o = Options()
    if headless:
        o.add_argument("--headless=new")
    o.add_argument("--no-sandbox")
    o.add_argument("--disable-dev-shm-usage")
    o.add_argument("--disable-blink-features=AutomationControlled")
    o.add_argument("--window-size=1400,900")
    o.add_experimental_option("excludeSwitches", ["enable-automation"])
    o.add_experimental_option("useAutomationExtension", False)
    d = webdriver.Chrome(options=o)
    d.execute_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )
    d.set_page_load_timeout(45)
    return d


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fights", type=int, default=8)
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()
    if not EMAIL or not PASSWORD:
        print("Set GL_EMAIL and GL_PASSWORD")
        return 1

    driver = make_driver(headless=not args.headed)
    wait = WebDriverWait(driver, 25)
    try:
        print("-> API login")
        import urllib.request

        req = urllib.request.Request(
            "https://api.grandline-online.fr/api/auth/login",
            data=json.dumps({"email": EMAIL, "password": PASSWORD}).encode(),
            headers={
                "content-type": "application/json",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "accept": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            login = json.loads(resp.read().decode())
        token = login.get("accessToken")
        if not token:
            print("ERR login failed", login)
            return 2
        print("-> token OK")

        print("-> open site")
        driver.get("https://grandline-online.fr/")
        time.sleep(2)
        driver.execute_script(
            "sessionStorage.setItem('grandline-token', arguments[0]); window.__freshToken = arguments[0];",
            token,
        )
        driver.get("https://grandline-online.fr/")
        time.sleep(4)

        # Click JOUER if hub visible
        try:
            buttons = driver.find_elements(By.TAG_NAME, "button")
            for b in buttons:
                t = (b.text or "").strip()
                if t.startswith("JOUER") or t == "JOUER":
                    b.click()
                    print("-> JOUER")
                    break
        except Exception as e:
            print("hub click", e)

        # wait scene
        print("-> wait scene...")
        for i in range(40):
            time.sleep(1)
            # dismiss popups
            try:
                driver.execute_script(
                    """
                    for (const b of document.querySelectorAll('button')) {
                      const t=(b.innerText||'').trim();
                      if (/Passer le guide|Retour au jeu|Je reste|Suivant|Continuer/i.test(t)) b.click();
                    }
                    """
                )
            except Exception:
                pass
            has = driver.execute_script("return !!window.__grandlineScene")
            if has:
                print("-> scene OK")
                break
        else:
            print("ERR no scene")
            return 3

        driver.execute_script(f"window.__GL_FARM_N = {args.fights};")
        print(f"-> inject farm ({args.fights} fights)")
        driver.execute_script(INJECT)

        # poll result up to 6 min
        deadline = time.time() + 360
        while time.time() < deadline:
            time.sleep(3)
            try:
                driver.execute_script(
                    """
                    for (const b of document.querySelectorAll('button')) {
                      const t=(b.innerText||'').trim();
                      if (/Passer le guide|Retour au jeu|Je reste|Continuer|Prêt/i.test(t)) b.click();
                    }
                    """
                )
            except Exception:
                pass
            res = driver.execute_script("return window.__GL_FARM_RESULT")
            if res:
                out = ROOT / "artifacts" / "live_farm_result.json"
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(json.dumps(res, indent=2, ensure_ascii=False))
                print(json.dumps(res, indent=2, ensure_ascii=False)[:4000])
                print(f"\n-> saved {out}")
                wins = sum(1 for r in res.get("results", []) if r.get("winner") == "ALLIE")
                dmg = [r.get("hpDelta") for r in res.get("results", []) if "hpDelta" in r]
                print(f"wins={wins}/{len(res.get('results',[]))} hpDeltas={dmg} ms={res.get('ms')}")
                return 0
            print("... running")
        print("ERR timeout")
        return 4
    finally:
        driver.quit()


if __name__ == "__main__":
    sys.exit(main())
