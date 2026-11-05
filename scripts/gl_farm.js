/**
 * GL Farm hybrid — console F12
 *   • Marche = client (scene.moveLocal) vers les packs
 *   • Combat = FULL API (start/engage/move/action/end-turn) — plus rapide
 *   • Vente junk = seulement si inventaire >= SELL_THRESHOLD (défaut 85%)
 *   • Rest = API (BELLE_ETOILE / NAVIRE), pas d'UI
 *
 * Coller en jeu puis :
 *   GL.start()   // farm continu
 *   GL.stop()
 *   GL.next()    // 1 cycle
 *   GL.farm(5)
 *   GL.stats()
 *   GL.inv()     // remplissage inventaire
 *   GL.sell(true)// forcer vente junk
 *
 * Config : window.__glCfg = { SELL_THRESHOLD: 0.85, MAX_LEVEL_DELTA: 8, VERBOSE: true }
 */

(() => {
  "use strict";

  const scene = window.__grandlineScene;
  if (!scene) return console.error("Pas de scène — entre en jeu d’abord");

  const API = "https://api.grandline-online.fr";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dist = (a, b) =>
    Math.abs((a?.x ?? 0) - (b?.x ?? 0)) + Math.abs((a?.y ?? 0) - (b?.y ?? 0));
  const key = (c) => `${c?.x}:${c?.y}`;
  const kxy = (x, y) => `${x},${y}`;

  // ═══════════════════════════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════════════════════════
  const CFG = Object.assign(
    {
      // Combat (0-dmg kite-first validé API)
      FLEE_HP_PCT: 0.15,
      GUARD_HP_PCT: 0.18,
      KITE_MARGIN: 2,
      KITE_BEFORE_ATTACK: true,
      NEVER_MELEE_IF_RANGED: true,
      MIN_EFFICIENCY: 6,
      FINISHER: 10000,
      FINISHER_2T: 450,
      FOCUS_LOW: 250,
      MULTI_KILL: 400,

      // Timing (serrés — validés pure_api ~150-220ms)
      POLL_MS: 160,
      MOVE_MS: 200,
      ACT_MS: 150,
      END_MS: 220,
      WALK_SLICE: 16,
      WALK_CHUNK_MS: 70,
      WALK_RATE_BACKOFF_MS: 500,
      BFS_LIMIT: 18000,

      // Farm map (XP/min : proche > faible > petit)
      APPROACH_RANGE: 1,
      APPROACH_OK_D: 6,       // distance max pour tenter start
      APPROACH_GIVEUP_D: 10,  // au-delà → autre pack
      MAX_LEVEL_DELTA: 99,
      MIN_LEVEL: 0,
      AVOID_SPECIES: [/mercenaire/i],
      PREFER_WEAK: true,
      PREFER_SMALL_PACKS: true,
      WEAK_SPECIES: [
        /rat/i, /chien/i, /chat/i, /oiseau/i, /vautour/i, /hibou/i,
        /ecureuil/i, /poule/i, /colombe/i, /lapin/i, /cerf/i, /sanglier/i, /loup/i,
      ],
      BLACKLIST_MS: 2500,
      NO_PACK_WAIT_MS: 1800,
      BETWEEN_FIGHTS_MS: 320,

      // Confort — rest seulement si HP bas (pas à chaque chip damage)
      AUTO_REST: true,
      REST_HP_PCT: 0.92, // reposer dès que HP < 92% si rest free dispo
      REST_FORCE_PCT: 0.55, // sous 55% → force même si options limitées
      ALLOW_PAID_REST: false,
      SELL_ON_FULL: true,
      SELL_THRESHOLD: 0.85, // vendre seulement si inventaire >= 85% plein
      SELL_JUNK: [
        "plumes", "viande-de-gibier", "bois-brut", "poisson-commun",
        "peau-tannee", "baies-sauvages", "algue-marine", "ble", "sel-marin",
        "os-de-gibier", "fourrure", "plume-de-vautour", "viande",
      ],
      POPUP_TRIES: 10,
      POPUP_MS: 280,
      BATTLE_TIMEOUT_MS: 150000,
      VERBOSE: true,
    },
    window.__glCfg || {}
  );

  // ═══════════════════════════════════════════════════════════
  // AUTH / API
  // ═══════════════════════════════════════════════════════════
  function findToken() {
    if (window.__freshToken) return window.__freshToken;
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const v = sessionStorage.getItem(sessionStorage.key(i));
        if (v && v.split(".").length === 3 && v.length > 100) {
          try {
            const p = JSON.parse(
              atob(v.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
            );
            if (p.exp > Date.now() / 1000) return v;
          } catch {}
        }
      }
    } catch {}
    return (
      sessionStorage.getItem("grandline-token") ||
      localStorage.getItem("grandline-token")
    );
  }

  let TOKEN = findToken();
  let CHAR_ID =
    sessionStorage.getItem("__autoCharId") || scene.character?.id || null;

  async function api(method, path, body) {
    TOKEN = TOKEN || findToken();
    const r = await fetch(API + path, {
      method,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(TOKEN ? { authorization: "Bearer " + TOKEN } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  }

  async function ensureChar() {
    if (CHAR_ID) return CHAR_ID;
    const r = await api("GET", "/api/characters");
    const list = r.data?.characters || r.data;
    const c = Array.isArray(list) ? list[0] : r.data;
    CHAR_ID = c?.id || scene.character?.id;
    if (CHAR_ID) sessionStorage.setItem("__autoCharId", CHAR_ID);
    return CHAR_ID;
  }

  async function getChar() {
    const r = await api("GET", "/api/characters");
    const list = r.data?.characters || r.data;
    if (Array.isArray(list))
      return list.find((x) => x.id === CHAR_ID) || list[0];
    return r.data;
  }

  // ═══════════════════════════════════════════════════════════
  // MAP
  // ═══════════════════════════════════════════════════════════
  function playerEnt() {
    try {
      return scene.entities?.get?.(scene.character?.id) || null;
    } catch {
      return null;
    }
  }

  function playerPos() {
    const e = playerEnt();
    const c = scene.character;
    return {
      x: Math.round(e?.x ?? c?.x ?? 0),
      y: Math.round(e?.y ?? c?.y ?? 0),
      moving: !!e?.moving,
      level: c?.level || 1,
      id: c?.id,
      mapId: c?.mapId,
    };
  }

  function blocked(x, y) {
    const mb = scene.movementBlocked;
    if (!mb || typeof mb.has !== "function") return false;
    return mb.has(x + "," + y) || mb.has(x + ":" + y) || mb.has(`${x}|${y}`);
  }

  function nearestWalkable(tx, ty, radius = 8) {
    if (!blocked(tx, ty)) return { x: tx, y: ty };
    let best = null;
    let bd = 1e9;
    for (let r = 1; r <= radius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) + Math.abs(dy) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (blocked(x, y)) continue;
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < bd) {
            bd = d;
            best = { x, y };
          }
        }
      }
      if (best) return best;
    }
    return { x: tx, y: ty };
  }

  const blacklist = new Map();

  function packs() {
    const f = scene.network?.fauna || {};
    const now = Date.now();
    const pl = playerPos();
    const engRaw = f.engagees || [];
    const engSet =
      engRaw instanceof Set
        ? engRaw
        : new Set(Array.isArray(engRaw) ? engRaw : []);

    return (f.packs || [])
      .map((p) => {
        if (!p?.id) return null;
        if (blacklist.has(p.id) && blacklist.get(p.id) > now) return null;

        const mobs = p.mobs || [];
        if (!mobs.length) return null;

        const ox = Math.round(mobs[0]?.orbit?.cx ?? p.ancre?.x);
        const oy = Math.round(mobs[0]?.orbit?.cy ?? p.ancre?.y);
        if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;

        const mort = f.morts?.[p.id];
        if (mort && mort > now) return null;
        if (engSet.has(p.id) || p.engaged || p.enCombat) return null;

        const espece = mobs.map((m) => m.espece || "");
        if (CFG.AVOID_SPECIES.some((re) => espece.some((s) => re.test(s))))
          return null;

        const niveaux = mobs.map((m) => Number(m.niveau ?? m.level ?? 1) || 1);
        const maxLvl = Math.max(...niveaux);
        if (maxLvl > pl.level + CFG.MAX_LEVEL_DELTA) return null;
        if (maxLvl < CFG.MIN_LEVEL) return null;

        const weak = espece.every((s) =>
          CFG.WEAK_SPECIES.some((re) => re.test(s))
        );

        return {
          id: p.id,
          ox,
          oy,
          d: Math.abs(ox - pl.x) + Math.abs(oy - pl.y),
          espece,
          niveaux,
          maxLvl,
          nMobs: mobs.length,
          weak,
        };
      })
      .filter(Boolean)
      .map((p) => {
        // score bas = mieux. Distance domine ; faible/petit = bonus léger
        let score = p.d;
        if (CFG.PREFER_WEAK && p.weak) score -= 8;
        if (CFG.PREFER_SMALL_PACKS) score += (p.nMobs - 1) * 2.5;
        score += Math.abs(p.maxLvl - pl.level) * 0.3;
        return { ...p, score };
      })
      .sort((a, b) => a.score - b.score || a.d - b.d);
  }

  async function walkTo(tx, ty) {
    const goal = nearestWalkable(Math.round(tx), Math.round(ty), 8);
    const from0 = playerPos();
    const q = [[from0.x, from0.y]];
    const prev = new Map([[kxy(from0.x, from0.y), null]]);

    while (q.length && prev.size < CFG.BFS_LIMIT) {
      const [x, y] = q.shift();
      if (x === goal.x && y === goal.y) break;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx, ny = y + dy, kk = kxy(nx, ny);
        if (prev.has(kk) || blocked(nx, ny)) continue;
        prev.set(kk, [x, y]);
        q.push([nx, ny]);
      }
    }

    let end = kxy(goal.x, goal.y);
    if (!prev.has(end)) {
      let best = null, bd = 1e9;
      for (const kk of prev.keys()) {
        const [x, y] = kk.split(",").map(Number);
        const d = Math.abs(x - goal.x) + Math.abs(y - goal.y);
        if (d < bd) {
          bd = d;
          best = kk;
        }
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
      cur = p ? kxy(p[0], p[1]) : null;
    }
    full.reverse();

    for (let g = 0; g < full.length + 60; g++) {
      const c = playerPos();
      if (Math.abs(c.x - goal.x) + Math.abs(c.y - goal.y) <= 1) return true;

      let wait = 0;
      while (playerPos().moving && wait < 50) {
        await sleep(20);
        wait++;
      }

      // resync index on live pos (évite Path start mismatch)
      let idx = 0, best = 1e9;
      for (let j = 0; j < full.length; j++) {
        const d = Math.abs(full[j].x - c.x) + Math.abs(full[j].y - c.y);
        if (d < best) {
          best = d;
          idx = j;
        }
      }

      const live = playerPos();
      const slice = full.slice(idx, Math.min(idx + CFG.WALK_SLICE, full.length));
      const chunk = [{ x: live.x, y: live.y }];
      for (const p of slice) {
        if (p.x === live.x && p.y === live.y) continue;
        chunk.push(p);
      }

      if (chunk.length < 2) {
        const step = {
          x: live.x + Math.sign(goal.x - live.x),
          y:
            live.y +
            (Math.sign(goal.x - live.x) === 0 ? Math.sign(goal.y - live.y) : 0),
        };
        if (blocked(step.x, step.y)) {
          step.x = live.x;
          step.y = live.y + Math.sign(goal.y - live.y);
        }
        if (blocked(step.x, step.y)) return false;
        chunk.push(step);
      }

      // force start = position live exacte
      chunk[0] = { x: playerPos().x, y: playerPos().y };
      if (chunk.length < 2) return false;

      try {
        await scene.moveLocal(chunk, null, { courir: true, redresser: true });
      } catch (e) {
        const msg = String(e?.message || e || "");
        console.warn("[GL] moveLocal", msg);
        if (/rate|exceeded|trop/i.test(msg)) {
          await sleep(CFG.WALK_RATE_BACKOFF_MS || 900);
        }
        // un pas simple de secours après resync
        await sleep(200);
        const p = playerPos();
        const step = {
          x: p.x + Math.sign(goal.x - p.x),
          y: p.y + (Math.sign(goal.x - p.x) === 0 ? Math.sign(goal.y - p.y) : 0),
        };
        if (!blocked(step.x, step.y)) {
          try {
            await scene.moveLocal(
              [
                { x: p.x, y: p.y },
                step,
              ],
              null,
              { courir: true }
            );
          } catch {
            await sleep(CFG.WALK_RATE_BACKOFF_MS || 900);
            return false;
          }
        } else return false;
      }
      // attendre fin de mouvement (polling court) + petit gap anti-rate
      let w = 0;
      while (playerPos().moving && w < 25) {
        await sleep(30);
        w++;
      }
      await sleep(CFG.WALK_CHUNK_MS || 120);
    }
    return Math.abs(playerPos().x - goal.x) + Math.abs(playerPos().y - goal.y) <= 2;
  }

  async function attackPack(packId) {
    try {
      scene.confirmationDattaqueDemandee = () => false;
    } catch {}
    log("onFaunaAttack", packId);
    if (typeof scene.onFaunaAttack === "function") {
      return scene.onFaunaAttack(packId);
    }
    if (typeof scene.attackFaunaPack === "function") {
      return scene.attackFaunaPack(packId);
    }
    const C = await ensureChar();
    return api("POST", "/api/battles/start", { characterId: C, fauna: packId });
  }

  // ═══════════════════════════════════════════════════════════
  // COMBAT HELPERS
  // ═══════════════════════════════════════════════════════════
  const stats = {
    battles: 0,
    wins: 0,
    losses: 0,
    turns: 0,
    casts: 0,
    moves: 0,
    guards: 0,
    flees: 0,
    berriesDelta: 0,
    xpDelta: 0,
    walkFails: 0,
    startedAt: null,
  };

  let active = false;
  let farming = false;
  let busy = false; // empêche GL.next() en parallèle
  let chaseStreak = 0; // tours hors de portée (mobs qui kittent)
  let lastChaseD = null;

  const log = (...a) =>
    CFG.VERBOSE && console.log("%c[GL]", "color:#6cf;font-weight:bold", ...a);

  function myTurn(s) {
    return s?.yourTurn === true || s?.tactics?.yourTurn === true;
  }
  function actionRange(a) {
    if (a?.kind === "ATTAQUE") return 1;
    return a?.geometry?.range ?? a?.range ?? 1;
  }
  function actionMinRange(a) {
    if (a?.kind === "ATTAQUE") return 1;
    const g = a?.geometry || {};
    let m = Number(g.minRange ?? g.min_range ?? g.min ?? a?.minRange ?? 0) || 0;
    if (m > 0) return m;
    // Heuristique si geometry.minRange absent (évite 409 Trop près)
    const name = (a?.name || a?.id || "") + "";
    if (/hissatsu|tori|boshi|kaen|tetsu/i.test(name)) return 6;
    const maxR = actionRange(a);
    if (a?.kind === "TECHNIQUE" && maxR >= 5) return 2;
    return 0;
  }
  function actionPa(a) {
    if (a?.kind === "GARDE" || a?.kind === "FUITE") return 0;
    if (a?.kind === "ATTAQUE") return Math.max(2, a.pa ?? a.cost ?? 2);
    if (a?.pa != null) return a.pa;
    if (a?.cost != null) return a.cost;
    return 99;
  }
  function avgEst(est) {
    if (!est) return 0;
    return ((est.min ?? 0) + (est.max ?? 0)) / 2;
  }
  function enemyMaxRange(e) {
    let m = 1;
    for (const t of e.techniques || []) {
      const r = t.geometry?.range ?? t.range ?? 1;
      if (typeof r === "number" && r > m) m = r;
    }
    return m;
  }
  function myMaxRange(actions) {
    let m = 1;
    for (const a of actions || []) {
      if (a.kind === "FUITE" || a.kind === "GARDE") continue;
      if (CFG.NEVER_MELEE_IF_RANGED && a.kind === "ATTAQUE") continue;
      m = Math.max(m, actionRange(a));
    }
    return Math.max(m, 1);
  }
  function isRanged(me, actions) {
    if (me?.armeDeTir) return true;
    return myMaxRange(actions) >= 4;
  }
  function safeDist(enemies) {
    let need = 2;
    for (const e of enemies) {
      const threat =
        (e.caracs?.pm ?? 3) + enemyMaxRange(e) + CFG.KITE_MARGIN;
      if (threat > need) need = threat;
    }
    return need;
  }
  function hasLOS(from, to, obstacleSet) {
    if (!from || !to) return false;
    let x0 = from.x, y0 = from.y, x1 = to.x, y1 = to.y;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (!(x0 === x1 && y0 === y1)) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
      if (x0 === x1 && y0 === y1) break;
      if (obstacleSet.has(`${x0}:${y0}`)) return false;
    }
    return true;
  }
  function hasGuard(me) {
    const st = me?.status || me?.etats || me?.states || [];
    if (Array.isArray(st)) {
      return st.some((x) => {
        const n = (x?.id || x?.kind || x?.nom || x?.name || x || "").toString();
        return /garde/i.test(n);
      });
    }
    return !!(me?.garde || me?.guarding);
  }

  // ═══════════════════════════════════════════════════════════
  // DÉCISION — kite obligatoire si d < safe
  // ═══════════════════════════════════════════════════════════
  function decide(s, me, banned) {
    banned = banned || new Set();
    const meId = s.you || CHAR_ID;
    const tactics = s.tactics || {};
    const positions = tactics.positions || {};
    const myPos = positions[meId];
    if (!myPos) return { type: "endturn", reason: "no myPos" };

    const ap = Number(tactics.ap ?? s.ap ?? 0);
    const mp = Number(tactics.mp ?? s.mp ?? 0);
    const actions = (s.actions || []).filter(
      (a) => a.usable !== false && !a.locked
    );
    const hazardSet = new Set((tactics.hazards || []).map((h) => key(h)));
    const obstacleSet = new Set(
      (tactics.obstacles || []).map((o) => `${o.x}:${o.y}`)
    );

    const myTeam =
      (s.fighters || []).find((f) => f.id === meId)?.team || "ALLIE";
    const enemies = (s.fighters || [])
      .filter(
        (f) =>
          f.id !== meId &&
          (f.hp || 0) > 0 &&
          (f.team === "ENNEMI" || (f.team && f.team !== myTeam))
      )
      .map((f) => ({
        ...f,
        pos: positions[f.id],
        d: positions[f.id] ? dist(myPos, positions[f.id]) : 99,
        eRange: enemyMaxRange(f),
      }))
      .filter((f) => f.pos)
      .sort((a, b) => a.d - b.d);

    if (!enemies.length) return { type: "endturn", reason: "no enemies" };

    const hpPct = (me?.hp || 0) / Math.max(me?.maxHp || 1, 1);
    const ranged = isRanged(me, actions);
    const maxR = myMaxRange(actions);
    const safe = Math.min(Math.max(safeDist(enemies), 2), maxR);
    const curMin = enemies[0].d;
    const multi = enemies.length >= 2;
    const inDanger = curMin < safe;

    const reachable = (tactics.reachable || []).filter(
      (c) => (c.cost || 0) <= mp
    );
    const cells = reachable.filter((c) => !hazardSet.has(key(c)));
    const pool = cells.length ? cells : reachable;

    function pickKiteCell(minImprove = 1) {
      // Kite intelligent : safe + LOS/tir + éloignement du pack (pas un coin fixe)
      const cx =
        enemies.reduce((s, e) => s + e.pos.x, 0) / enemies.length;
      const cy =
        enemies.reduce((s, e) => s + e.pos.y, 0) / enemies.length;
      const primary = enemies[0]; // plus proche
      const dist0 = dist(myPos, { x: cx, y: cy });

      let safeBest = null;
      let anyBest = null;

      for (const c of pool) {
        if (c.x === myPos.x && c.y === myPos.y) continue;
        const dMin = Math.min(...enemies.map((e) => dist(c, e.pos)));
        const dSum = enemies.reduce((s, e) => s + dist(c, e.pos), 0);
        const nSafe = enemies.filter((e) => dist(c, e.pos) >= safe).length;
        const dPrimary = primary ? dist(c, primary.pos) : dMin;
        const canShoot = enemies.some((e) => dist(c, e.pos) <= maxR);
        // LOS vers la menace principale si possible
        let losPrimary = true;
        if (primary && obstacleSet.size) {
          losPrimary = hasLOS(c, primary.pos, obstacleSet);
        }
        // s'éloigner du centroïde du pack (évite de longer toujours +x/+y)
        const distC = Math.abs(c.x - cx) + Math.abs(c.y - cy);
        const away = distC - dist0;
        // alignement : mouvement dans le sens opposé aux ennemis
        const vx = c.x - myPos.x;
        const vy = c.y - myPos.y;
        const ex = myPos.x - cx;
        const ey = myPos.y - cy;
        const align =
          (vx * ex + vy * ey) /
          (Math.max(1, Math.abs(vx) + Math.abs(vy)) *
            Math.max(1, Math.abs(ex) + Math.abs(ey)));
        const cost = c.cost || 0;

        let score = 0;
        // 1) sweet spot : juste au-delà de safe, encore dans range de tir
        if (dMin >= safe && dMin <= maxR) {
          score += 12000;
          // idéal : safe ou safe+1 (pas fuir trop loin hors range)
          score += (3 - Math.abs(dMin - safe)) * 40;
          if (canShoot) score += 400;
          if (losPrimary && dPrimary <= maxR) score += 250;
        } else if (dMin >= safe) {
          score += 6000 + Math.min(dMin, maxR + 3) * 5;
          if (canShoot) score += 200;
        } else {
          // retrait partiel
          score += (dMin - curMin) * 120;
          if (dMin <= curMin) score -= 200;
        }

        score += nSafe * 90;
        score += away * 35; // loin du pack
        score += align * 80; // direction anti-pack
        score += dSum * 2;
        score -= cost * 8; // économiser PM si égalité
        if (!canShoot) score -= 150;
        if (canShoot && !losPrimary) score -= 40;

        // léger malus coin de map extrême seulement si on a mieux
        // (pas de biais droite/bas : pas de tie-break sur x/y croissant)

        const cand = {
          cell: { x: c.x, y: c.y },
          score,
          d: dMin,
          canShoot,
          cost,
        };
        const better = (a, b) => {
          if (!a) return true;
          if (Math.abs(b.score - a.score) > 0.01) return b.score > a.score;
          // tie-break : plus loin du pack, puis moins de cost, puis plus proche du sweet
          if (b.d !== a.d) return b.d > a.d;
          return (b.cost || 0) < (a.cost || 0);
        };
        if (dMin >= safe && canShoot) {
          if (better(safeBest, cand)) safeBest = cand;
        }
        if (better(anyBest, cand)) anyBest = cand;
      }

      if (safeBest) return safeBest;
      if (anyBest && anyBest.d >= curMin + minImprove) return anyBest;
      if (anyBest && anyBest.d > curMin) return anyBest;
      return null;
    }

    if (
      !banned.has("flee") &&
      hpPct < CFG.FLEE_HP_PCT &&
      actions.some((a) => a.kind === "FUITE")
    ) {
      return { type: "flee", reason: `FUITE ${Math.round(hpPct * 100)}%` };
    }

    if (
      !banned.has("guard") &&
      !hasGuard(me) &&
      hpPct < CFG.GUARD_HP_PCT &&
      curMin <= 1 &&
      mp <= 0 &&
      actions.some((a) => a.kind === "GARDE")
    ) {
      return { type: "guard", reason: `GARDE ${Math.round(hpPct * 100)}%` };
    }

    // AP = 0 → kite d'abord (plus d'attaque possible)
    if (ap <= 0) {
      if (ranged && inDanger && mp > 0 && pool.length) {
        const k = pickKiteCell(1);
        if (k) {
          return {
            type: "move",
            cell: k.cell,
            reason: `AP0 KITE ${curMin}→${k.d}`,
          };
        }
      }
      if (ranged && curMin < safe && mp > 0 && pool.length) {
        const k = pickKiteCell(0);
        if (k && k.d > curMin) {
          return {
            type: "move",
            cell: k.cell,
            reason: `AP0 STEP ${curMin}→${k.d}`,
          };
        }
      }
      return {
        type: "endturn",
        reason: `AP=0 endturn (d=${curMin} safe=${safe} mp=${mp})`,
      };
    }

    // Score une attaque candidate (null si invalide)
    function scoreAttack(a, en, opts = {}) {
      const allowUnderSafe = opts.allowUnderSafe === true;
      const finisherOnly = opts.finisherOnly === true;
      if (CFG.NEVER_MELEE_IF_RANGED && ranged && a.kind === "ATTAQUE") return null;
      const range = actionRange(a);
      const pa = actionPa(a);
      if (pa > ap) return null;
      const needsSight =
        a.kind !== "ATTAQUE" &&
        (a.geometry?.needsSight !== false || range > 1);
      const banKey = `${a.kind === "ATTAQUE" ? "attack" : "cast"}:${a.id}:${en.id}`;
      if (banned.has(banKey)) return null;
      if (en.d > range) return null;
      if (en.d < actionMinRange(a)) return null;
      if (needsSight && !hasLOS(myPos, en.pos, obstacleSet)) return null;
      if (ranged && en.d < safe && !allowUnderSafe) return null;

      const est = a.estimates?.[en.id];
      // fallback sans estimates : autoriser ATTAQUE + techniques si on a encore des PA
      if (!est && a.kind !== "ATTAQUE" && a.kind !== "TECHNIQUE") return null;
      const dmg = est ? avgEst(est) : a.kind === "ATTAQUE" ? 12 : 40;
      const isKill = !!(est && est.max >= en.hp);
      if (finisherOnly && !isKill) return null;
      const eff = dmg / Math.max(pa, 1);
      // seuil souple si peu de PA restants (évite idle ap=2)
      const minEff = ap <= 3 ? Math.min(CFG.MIN_EFFICIENCY, 3) : CFG.MIN_EFFICIENCY;
      if (eff < minEff && !isKill && est) return null;

      let score = dmg + eff * 8; // favorise gros hits (Hi no Tori / Balle)
      if (isKill) score += CFG.FINISHER;
      else if (dmg * 2 >= en.hp) score += CFG.FINISHER_2T;
      // surplus de PA gaspillé = léger malus (préfère fill intelligent via re-decide)
      score -= Math.max(0, ap - pa) * 0.5;
      score += (1 - en.hp / Math.max(en.maxHp || 1, 1)) * CFG.FOCUS_LOW;
      if (multi && isKill) score += CFG.MULTI_KILL;
      if (a.kind === "TECHNIQUE") score += 5;
      if (ranged && en.d >= safe && en.d <= maxR) score += 40;
      if (en.d < safe && isKill) score += 500;
      if (en.d <= 2 && isKill) score += 200;
      // gros burst si cible encore tanky
      if (!isKill && (en.hp || 0) > dmg * 1.2) score += dmg * 0.15;

      return {
        type: a.kind === "ATTAQUE" ? "attack" : "cast",
        action: a,
        enemy: en,
        score,
        banKey,
        isKill,
        reason: `${a.name || a.kind}→${en.name} d=${en.d} ~${Math.round(dmg)}${isKill ? " KILL" : ""} pa=${pa}/${ap}`,
      };
    }

    // ══════════════════════════════════════════════
    // PRIORITÉ 1 — KITE si sous safe + PM (0 dmg, évite 409 Trop près)
    // ══════════════════════════════════════════════
    if (ranged && inDanger && mp > 0 && pool.length) {
      const k = pickKiteCell(1);
      if (k && k.d > curMin) {
        return {
          type: "move",
          cell: k.cell,
          reason: `KITE ${curMin}→${k.d} (safe=${safe})`,
        };
      }
      const k2 = pickKiteCell(0);
      if (k2 && k2.d > curMin) {
        return {
          type: "move",
          cell: k2.cell,
          reason: `KITE-STEP ${curMin}→${k2.d}`,
        };
      }
    }

    // ══════════════════════════════════════════════
    // PRIORITÉ 2 — Attaques valides (minRange..maxRange), pas sous safe si PM
    // ══════════════════════════════════════════════
    // ══════════════════════════════════════════════
    // PRIORITÉ 3 — Attaques zone safe / fallback
    // ══════════════════════════════════════════════
    let best = null;
    for (const a of actions) {
      if (a.kind === "FUITE" || a.kind === "GARDE") continue;
      for (const en of enemies) {
        const allowUnder = !(ranged && mp > 0 && inDanger);
        const cand = scoreAttack(a, en, { allowUnderSafe: allowUnder });
        if (cand && (!best || cand.score > best.score)) best = cand;
      }
    }
    if (best) return best;

    // LOS step — sans descendre sous safe
    if (mp > 0 && pool.length && ranged) {
      let losStep = null;
      for (const a of actions) {
        if (a.kind === "FUITE" || a.kind === "GARDE" || a.kind === "ATTAQUE")
          continue;
        const range = actionRange(a);
        const pa = actionPa(a);
        if (pa > ap) continue;
        for (const en of enemies) {
          for (const c of pool) {
            const d = dist(c, en.pos);
            // marge : ne pas se placer pile à safe (ennemi PM→contact)
            if (d > range || d < safe + 1) continue;
            if (!hasLOS(c, en.pos, obstacleSet)) continue;
            const score =
              100 - Math.abs(d - (safe + 1)) + (avgEst(a.estimates?.[en.id]) || 0);
            if (!losStep || score > losStep.score)
              losStep = {
                cell: c,
                score,
                d,
                reason: `LOS-step d=${d} for ${a.name}`,
              };
          }
        }
      }
      if (losStep)
        return { type: "move", cell: losStep.cell, reason: losStep.reason };
    }

    // Range de tir (tous skills payables + max absolu pour chase)
    let shootRange = 1;
    let maxSkillRange = 1;
    for (const a of actions) {
      if (a.kind === "FUITE" || a.kind === "GARDE") continue;
      if (CFG.NEVER_MELEE_IF_RANGED && ranged && a.kind === "ATTAQUE") continue;
      const r = actionRange(a);
      maxSkillRange = Math.max(maxSkillRange, r);
      if (actionPa(a) > ap) continue;
      shootRange = Math.max(shootRange, r);
    }
    if (shootRange < 1) shootRange = maxSkillRange;

    // Stalemate : mobs qui reculent → on ne ferme plus
    if (curMin > shootRange) {
      if (lastChaseD != null && curMin >= lastChaseD - 1) chaseStreak++;
      else chaseStreak = Math.max(0, chaseStreak - 1);
      lastChaseD = curMin;
    } else {
      chaseStreak = 0;
      lastChaseD = curMin;
    }
    const chaseMode = chaseStreak >= 2 || enemies.length <= 1;

    // Si PA restants et cible déjà à portée (min+max) → tirer avant APPROACH
    if (ap > 0) {
      let shot = null;
      for (const a of actions) {
        if (a.kind === "FUITE" || a.kind === "GARDE") continue;
        if (CFG.NEVER_MELEE_IF_RANGED && ranged && a.kind === "ATTAQUE") continue;
        const pa = actionPa(a);
        if (pa > ap) continue;
        const range = actionRange(a);
        const minR = actionMinRange(a);
        const needsSight =
          a.kind !== "ATTAQUE" &&
          (a.geometry?.needsSight !== false || range > 1);
        for (const en of enemies) {
          if (en.d > range || en.d < minR) continue;
          if (needsSight && !hasLOS(myPos, en.pos, obstacleSet)) continue;
          const banKey = `${a.kind === "ATTAQUE" ? "attack" : "cast"}:${a.id}:${en.id}`;
          if (banned.has(banKey)) continue;
          const est = a.estimates?.[en.id];
          const dmg = est ? avgEst(est) : 25;
          const score = dmg + (est && est.max >= en.hp ? 1000 : 0);
          if (!shot || score > shot.score) {
            shot = {
              type: a.kind === "ATTAQUE" ? "attack" : "cast",
              action: a,
              enemy: en,
              score,
              banKey,
              reason: `SHOOT ${a.name || a.kind}→${en.name} d=${en.d} ~${Math.round(dmg)} pa=${pa}/${ap}`,
            };
          }
        }
      }
      if (shot) return shot;
    }

    // Approach / CHASE si hors de portée de tir
    // - normal : viser fenêtre [safe .. shootRange]
    // - chaseMode (mobs kittent) : minimiser la distance, autoriser sous safe jusqu'à minR
    if (mp > 0 && pool.length && curMin > shootRange) {
      const floorD = chaseMode
        ? Math.max(2, Math.min(4, shootRange - 2))
        : safe;
      const targetRange = ranged
        ? Math.min(shootRange, Math.max(floorD, Math.min(safe + 1, shootRange)))
        : 1;

      let approach = null;
      for (const c of pool) {
        const dMin = Math.min(...enemies.map((e) => dist(c, e.pos)));
        // hors chase : ne pas rentrer sous safe
        if (ranged && !chaseMode && dMin < safe) continue;
        // chase : ne pas coller sous 2
        if (ranged && chaseMode && dMin < floorD) continue;

        let score;
        if (curMin > shootRange) {
          // priorité : se rapprocher au max (anti kite mob)
          score = -dMin * 30;
          if (dMin < curMin) score += 80;
          if (dMin <= shootRange) score += 500;
          if (dMin <= shootRange && dMin >= floorD) score += 200;
        } else {
          score = -Math.abs(dMin - targetRange) * 10;
        }
        score -= (c.cost || 0) * 2;
        if (!approach || score > approach.score)
          approach = { cell: c, score, d: dMin };
      }
      if (approach && approach.d < curMin) {
        return {
          type: "move",
          cell: approach.cell,
          reason: `${chaseMode ? "CHASE" : "APPROACH"} ${curMin}→${approach.d} (shoot≤${shootRange} floor=${floorD})`,
        };
      }
    }

    // Micro-reposition dans la fenêtre de tir (sans osciller)
    if (
      mp > 0 &&
      pool.length &&
      ranged &&
      curMin >= safe &&
      curMin <= shootRange &&
      curMin < safe + 0 // disabled micro
    ) {
      /* no-op : rester et tirer */
    }

    if (ranged && curMin < safe && mp > 0 && pool.length) {
      const k = pickKiteCell(0);
      if (k && k.d > curMin) {
        return {
          type: "move",
          cell: k.cell,
          reason: `LAST KITE ${curMin}→${k.d}`,
        };
      }
    }

    // Dernier recours : dépenser les PA restants (anti idle ap=2/4)
    if (ap > 0) {
      let desperation = null;
      for (const a of actions) {
        if (a.kind === "FUITE" || a.kind === "GARDE") continue;
        if (CFG.NEVER_MELEE_IF_RANGED && ranged && a.kind === "ATTAQUE") continue;
        const pa = actionPa(a);
        if (pa > ap) continue;
        const range = actionRange(a);
        const needsSight =
          a.kind !== "ATTAQUE" &&
          (a.geometry?.needsSight !== false || range > 1);
        for (const en of enemies) {
          if (en.d > range || en.d < actionMinRange(a)) continue;
          if (needsSight && !hasLOS(myPos, en.pos, obstacleSet)) continue;
          const banKey = `${a.kind === "ATTAQUE" ? "attack" : "cast"}:${a.id}:${en.id}`;
          if (banned.has(banKey)) continue;
          const est = a.estimates?.[en.id];
          const dmg = est ? avgEst(est) : 20;
          // préfère skills qui matchent exactement les PA restants
          let score = dmg + (pa === ap ? 30 : 0);
          if (est && est.max >= en.hp) score += 500;
          if (!desperation || score > desperation.score) {
            desperation = {
              type: a.kind === "ATTAQUE" ? "attack" : "cast",
              action: a,
              enemy: en,
              score,
              banKey,
              reason: `FILL-AP ${a.name || a.kind}→${en.name} d=${en.d} ~${Math.round(dmg)} pa=${pa}/${ap}`,
            };
          }
        }
      }
      if (desperation) return desperation;
    }

    return {
      type: "endturn",
      reason: `idle d=${curMin} ap=${ap} mp=${mp} safe=${safe}`,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // EXÉCUTION
  // ═══════════════════════════════════════════════════════════
  async function execute(bid, decision) {
    const C = await ensureChar();
    if (decision.type === "flee") {
      stats.flees++;
      return api("POST", `/api/battles/${bid}/action`, {
        characterId: C,
        kind: "FUITE",
        id: "flee",
      });
    }
    if (decision.type === "guard") {
      stats.guards++;
      return api("POST", `/api/battles/${bid}/action`, {
        characterId: C,
        kind: "GARDE",
        id: "guard",
      });
    }
    if (decision.type === "move") {
      stats.moves++;
      return api("POST", `/api/battles/${bid}/move`, {
        characterId: C,
        cell: { x: decision.cell.x, y: decision.cell.y },
      });
    }
    if (decision.type === "cast" || decision.type === "attack") {
      stats.casts++;
      const a = decision.action;
      const en = decision.enemy;
      return api("POST", `/api/battles/${bid}/action`, {
        characterId: C,
        kind: a.kind,
        id: a.id,
        targetId: en.id,
        targetCell: { x: en.pos.x, y: en.pos.y },
      });
    }
    return api("POST", `/api/battles/${bid}/end-turn`, { characterId: C });
  }

  async function handlePlacement(s) {
    if (s?.tactics?.placementDone !== false) return;
    const cells = s.tactics?.placementCells || [];
    const enemyPos =
      (s.fighters || [])
        .filter((f) => f.team === "ENNEMI")
        .map((f) => s.tactics?.positions?.[f.id])
        .filter(Boolean)[0] || (s.tactics?.placementCellsAdverses || [])[0];

    const me =
      (s.fighters || []).find((f) => f.id === (s.you || CHAR_ID)) || {};
    if (cells.length && enemyPos && scene.combat?.click) {
      const ranged = isRanged(me, s.actions || []);
      let best = null, bestScore = -1e9;
      for (const c of cells) {
        const d = dist(c, enemyPos);
        const score = ranged ? d : -d;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best) {
        try {
          scene.combat.click({ x: best.x, y: best.y });
        } catch {}
        await sleep(350);
      }
    }
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /^prêt$/i.test(b.innerText?.trim())
    );
    if (btn) {
      btn.click();
      log("Placement → Prêt");
      await sleep(500);
    } else if (s?.id) {
      await api("POST", `/api/battles/${s.id}/engage`, {
        characterId: await ensureChar(),
      });
      await sleep(400);
    }
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0")
        return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch {
      return true;
    }
  }

  function popupButtons() {
    return [
      ...document.querySelectorAll(
        "button, [role=button], a.btn, .btn, .modal button, [class*=modal] button, [class*=popup] button, [class*=dialog] button"
      ),
    ].filter(isVisible);
  }

  function popupTextBlob() {
    try {
      const nodes = document.querySelectorAll(
        "[class*=modal], [class*=popup], [class*=dialog], [class*=level], [class*=niveau], [class*=overlay]"
      );
      let s = "";
      for (const n of nodes) {
        if (isVisible(n)) s += " " + (n.innerText || "");
      }
      return s;
    } catch {
      return document.body?.innerText || "";
    }
  }

  /** Ferme résumé combat + level-up + modales bloquantes (ne dépend PAS de scene.combat) */
  async function closeSummaryPopup() {
    const tries = Math.min(CFG.POPUP_TRIES || 10, 12);
    let closed = false;
    for (let i = 0; i < tries; i++) {
      const buttons = popupButtons();
      const labels = buttons.map((b) => (b.innerText || b.textContent || "").trim());
      const blob = popupTextBlob();
      const isLevelUp =
        /niveau|level\s*up|monte[s]?\s+de\s+niveau|nouveau niveau|lvl\s*up/i.test(
          blob + " " + labels.join(" ")
        );

      // Priorité boutons d'acquittement (level-up + fin combat)
      const patterns = [
        /^continuer$/i,
        /^ok$/i,
        /^okay$/i,
        /^super\.?!?$/i,
        /^génial\.?!?$/i,
        /^parfait\.?!?$/i,
        /^compris\.?!?$/i,
        /^merci\.?!?$/i,
        /^fermer$/i,
        /^(×|✕|x)$/i,
        /passer/i,
        /suivant/i,
        /valider/i,
        /confirmer/i,
      ];

      let clicked = false;
      for (const re of patterns) {
        const btn = buttons.find((b) =>
          re.test((b.innerText || b.textContent || "").trim())
        );
        if (btn) {
          try {
            btn.click();
            log("popup:", (btn.innerText || "").trim() || re.toString(), isLevelUp ? "(lvl-up?)" : "");
            closed = true;
            clicked = true;
          } catch {}
          await sleep(isLevelUp ? 450 : 280);
          break;
        }
      }

      // Level-up : parfois un seul gros bouton sans label standard
      if (!clicked && isLevelUp) {
        const modalBtns = [
          ...document.querySelectorAll(
            "[class*=modal] button, [class*=level] button, [class*=niveau] button, [class*=popup] button"
          ),
        ].filter(isVisible);
        if (modalBtns.length === 1) {
          try {
            modalBtns[0].click();
            log("popup: unique modal btn (lvl-up)");
            closed = true;
            clicked = true;
          } catch {}
          await sleep(450);
        } else if (modalBtns.length) {
          // clique le plus bas / principal
          const main =
            modalBtns.find((b) => /continuer|ok|fermer|super/i.test(b.innerText || "")) ||
            modalBtns[modalBtns.length - 1];
          try {
            main.click();
            log("popup: modal", (main.innerText || "").trim());
            closed = true;
            clicked = true;
          } catch {}
          await sleep(450);
        }
      }

      try {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        );
        document.dispatchEvent(
          new KeyboardEvent("keyup", { key: "Escape", bubbles: true })
        );
      } catch {}

      await sleep(CFG.POPUP_MS || 200);

      // stop si plus de combat ET plus de modal level-up visible
      const stillLevel =
        /niveau|level\s*up|monte[s]?\s+de\s+niveau/i.test(popupTextBlob());
      if (!scene.combat && !stillLevel && !scene.combatState?.id) {
        return true;
      }
      if (!clicked && !stillLevel && !scene.combat) return true;
    }
    return closed || !scene.combat;
  }

  function inventoryFill(char) {
    const inv = char?.inventory;
    if (!inv) return { used: 0, cap: 0, pct: 0, items: [] };
    const items = Array.isArray(inv) ? inv : inv.items || [];
    const used = items.filter((it) => it && (it.quantity > 0 || it.id)).length;
    const cap =
      Number(inv.bagCapacity || inv.capacity || inv.maxSlots || inv.max || 0) +
      Number(inv.bonusCapacity || 0);
    const pct = cap > 0 ? used / cap : 0;
    return { used, cap, pct, items };
  }

  /** Vente junk uniquement si inventaire presque plein (évite spam sell 409). */
  async function sellJunkIfNeeded(char, force = false) {
    if (!CFG.SELL_ON_FULL || !char) return { skipped: true };
    const C = await ensureChar();
    // refresh char si possible
    let c = char;
    try {
      const r = await api("GET", "/api/characters");
      const list = Array.isArray(r.data) ? r.data : r.data?.characters || [];
      const found = list.find((x) => x.id === C) || list[0];
      if (found) c = found;
    } catch {}
    const fill = inventoryFill(c);
    const th = CFG.SELL_THRESHOLD ?? 0.85;
    if (!force && fill.cap > 0 && fill.pct < th) {
      if (CFG.VERBOSE)
        log("sell skip", `${fill.used}/${fill.cap} (${Math.round(fill.pct * 100)}% < ${Math.round(th * 100)}%)`);
      return { skipped: true, ...fill };
    }
    log("sell inventory near full", `${fill.used}/${fill.cap || "?"}`);
    let sold = 0;
    for (const it of fill.items) {
      if (!it?.id || !it.quantity) continue;
      const junk =
        CFG.SELL_JUNK.includes(it.id) ||
        /plume|viande|bois|peau|baie|os|fourrure|algue|sel|ble|poisson|gibier/i.test(
          it.id + " " + (it.name || "")
        );
      if (!junk) continue;
      const r = await api("POST", "/api/economy/sell", {
        characterId: C,
        itemId: it.id,
        quantity: it.quantity,
      });
      if (r.ok) {
        sold++;
        log("sell", it.id, "x" + it.quantity, r.data?.paid);
      } else if (r.status === 409) break;
      await sleep(80);
    }
    return { sold, ...fill };
  }

  function readHpDom() {
    const sels = [
      "b.coeur-pv",
      ".coeur-pv",
      "[class*=coeur]",
      "[class*=pv]",
      ".hp-value",
      ".player-hp",
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      const raw = el?.textContent?.trim();
      if (raw) {
        const n = parseInt(raw.replace(/[^0-9]/g, ""), 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    const txt = document.body.innerText || "";
    for (const re of [/❤\s*(\d+)/, /PV\s*[:=]?\s*(\d+)/i, /HP\s*[:=]?\s*(\d+)/i]) {
      const m = txt.match(re);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  function readMaxHp(char) {
    const c = char || scene.character || {};
    const candidates = [
      c.maxHp, c.hpMax, c.max_hp,
      c.stats?.maxHp, c.stats?.hpMax,
      scene.character?.maxHp, scene.character?.hpMax,
      stats._hpPeak,
    ];
    for (const v of candidates) {
      if (Number.isFinite(v) && v > 0) return v;
    }
    return 0;
  }

  // 3 options : AUBERGE (payant) | NAVIRE (gratuit, CD) | BELLE_ETOILE (gratuit, forme)
  // JAMAIS AUBERGE.
  const REST_FREE = ["NAVIRE", "BELLE_ETOILE"];
  const REST_PAID = ["AUBERGE", "TAVERNE", "INN", "HOTEL"];
  const restCd = { NAVIRE: 0, BELLE_ETOILE: 0 }; // timestamps until

  function isPaidRestBtn(b) {
    const kind = (b.getAttribute("data-rest") || "").toUpperCase();
    if (REST_PAID.includes(kind)) return true;
    if (REST_FREE.includes(kind)) return false;
    const label = (b.innerText || b.textContent || b.title || "").toLowerCase();
    if (/auberge|taverne|inn|hôtel|hotel/.test(label)) return true;
    if (/฿|berr|pièce|piece|\bor\b|payant|gold/.test(label)) return true;
    return false;
  }

  async function closeRestPanel() {
    /* API-only rest — no UI panel */
  }

  function readHpDom() {
    const sels = [
      "b.coeur-pv",
      ".coeur-pv",
      "[class*=coeur]",
      "[class*=pv]",
      ".hp-value",
      ".player-hp",
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      const raw = el?.textContent?.trim();
      if (raw) {
        const n = parseInt(raw.replace(/[^0-9]/g, ""), 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    const txt = document.body.innerText || "";
    for (const re of [/❤\s*(\d+)/, /PV\s*[:=]?\s*(\d+)/i, /HP\s*[:=]?\s*(\d+)/i]) {
      const m = txt.match(re);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  function readMaxHp(char) {
    const c = char || scene.character || {};
    for (const v of [
      c.maxHp, c.hpMax, c.max_hp,
      c.stats?.maxHp, c.stats?.hpMax,
      scene.character?.maxHp, scene.character?.hpMax,
      stats._hpPeak,
    ]) {
      if (Number.isFinite(v) && v > 0) return v;
    }
    return 0;
  }

  function parseRestCdMs(msg) {
    const m = String(msg || "").match(/encore\s+(\d+)\s*min/i);
    if (m) return parseInt(m[1], 10) * 60 * 1000 + 5000;
    const s = String(msg || "").match(/encore\s+(\d+)\s*s/i);
    if (s) return parseInt(s[1], 10) * 1000 + 1000;
    return 8 * 60 * 1000; // défaut 8 min si 429
  }

  // UI rest désactivé — uniquement API (GET/POST /api/world/rest)
  async function restViaUi(_preferKind) {
    log("REST UI skip — API only");
    return { ok: false, skipped: "api-only" };
  }

  async function restState() {
    const C = await ensureChar();
    const r = await api("GET", `/api/world/rest/${C}`);
    if (!r.ok || !r.data) return null;
    const d = r.data;
    return {
      raw: d,
      hp: d.hp?.current ?? null,
      maxHp: d.hp?.max ?? null,
      vitality: d.vitality,
      ship: d.ship,
      rough: d.rough,
      inn: d.inn,
      freeSleep: d.freeSleep,
    };
  }

  async function restIfNeeded(char, force = false) {
    if (!CFG.AUTO_REST && !force) return { skipped: true };

    // Source fiable : GET /api/world/rest/:id (pas /characters — pas de maxHp)
    let st = await restState();
    let hp = st?.hp;
    let max = st?.maxHp;

    if (hp == null || max == null) {
      // fallback
      const domHp = readHpDom();
      hp = domHp ?? char?.currentHp ?? char?.hp ?? scene.character?.currentHp ?? scene.character?.hp;
      max = readMaxHp(char) || stats._hpPeak || 0;
      if (hp != null && hp > (stats._hpPeak || 0)) stats._hpPeak = hp;
      if (!max && stats._hpPeak) max = stats._hpPeak;
    } else {
      if (hp > (stats._hpPeak || 0)) stats._hpPeak = max; // peak = max known
      stats._hpPeak = Math.max(stats._hpPeak || 0, max);
    }

    const pct = max && hp != null ? hp / max : null;
    const notFull = pct != null && pct < 0.99;
    const lowHp = pct != null && pct < (CFG.REST_FORCE_PCT ?? 0.55);
    const wantRest = pct != null && pct < (CFG.REST_HP_PCT ?? 0.92);

    // Opportuniste : belle/navire dispo + gain HP possible
    const belleReady =
      st?.rough?.available !== false &&
      (st?.rough?.hpRecovery > 0 ||
        (st?.vitality != null && st.vitality < (st?.rough?.cap ?? 50)));
    const shipReady =
      st?.ship?.available === true &&
      (st?.ship?.hpRecovery > 0 ||
        (st?.vitality != null && st.vitality < (st?.ship?.cap ?? 75)));
    // freeSleep.waitMs = CD navire global parfois
    const shipOnCd =
      (st?.freeSleep?.waitMs || 0) > 0 || (st?.ship?.waitMs || 0) > 0;
    const freeAvailable = belleReady || (shipReady && !shipOnCd);

    if (CFG.VERBOSE) {
      log("REST check", {
        hp, max,
        pct: pct != null ? Math.round(pct * 100) + "%" : "?",
        wantRest, lowHp, force,
        belleReady, shipReady, shipOnCd,
        threshold: Math.round((CFG.REST_HP_PCT ?? 0.92) * 100) + "%",
      });
    }

    if (hp != null && max && hp >= max) {
      return { ok: true, skipped: "full", hp, max };
    }
    // Ne skip que si full-ish OU (pas envie de rest ET pas force)
    // → si belle dispo et pas full, on tente
    if (!force && !lowHp && !(wantRest && freeAvailable) && !belleReady) {
      return { ok: true, skipped: "ok", hp, max, pct };
    }
    if (!force && !notFull) {
      return { ok: true, skipped: "ok", hp, max, pct };
    }

    const C = await ensureChar();
    const results = [];
    const maxRounds = CFG.REST_MAX_ROUNDS || 10;
    const targetPct = force ? 0.99 : (CFG.REST_HP_PCT ?? 0.92);

    for (let round = 0; round < maxRounds; round++) {
      st = await restState();
      if (!st || st.hp == null || st.maxHp == null) {
        log("REST no state");
        break;
      }
      hp = st.hp;
      max = st.maxHp;
      const pctNow = hp / max;
      const shipCd =
        (st.freeSleep?.waitMs || 0) > 0 || (st.ship?.waitMs || 0) > 0;
      const belleGain = st.rough?.hpRecovery ?? 0;
      const shipGain = st.ship?.hpRecovery ?? 0;
      const belleOk =
        st.rough?.available !== false &&
        (belleGain > 0 ||
          (st.vitality != null && st.vitality < (st.rough?.cap ?? 50)));
      const shipOk =
        st.ship?.available === true &&
        !shipCd &&
        (shipGain > 0 ||
          (st.vitality != null && st.vitality < (st.ship?.cap ?? 75)));

      log(
        `REST round ${round + 1}/${maxRounds}`,
        `${hp}/${max} (${Math.round(pctNow * 100)}%)`,
        `belle=${belleOk ? "+" + belleGain : "no"}`,
        `ship=${shipOk ? "+" + shipGain : "no"}`
      );

      if (pctNow >= targetPct) {
        log("REST target reached", Math.round(pctNow * 100) + "%");
        break;
      }
      if (!belleOk && !shipOk) {
        log("REST stop — no free gain left");
        break;
      }

      // ordre : plus gros gain d'abord, sinon belle si ship CD
      const kinds = [];
      if (shipOk && shipGain >= belleGain) kinds.push("NAVIRE", "BELLE_ETOILE");
      else if (belleOk) kinds.push("BELLE_ETOILE", "NAVIRE");
      else if (shipOk) kinds.push("NAVIRE");
      else kinds.push("BELLE_ETOILE", "NAVIRE");

      let did = false;
      for (const kind of kinds) {
        // CD local seulement après erreur serveur (pas après succès)
        if (Date.now() < (restCd[kind] || 0)) {
          log("REST skip local CD", kind);
          continue;
        }
        if (kind === "NAVIRE" && !shipOk) continue;
        if (kind === "BELLE_ETOILE" && !belleOk) continue;

        const r = await api("POST", "/api/world/rest", { characterId: C, kind });
        results.push({
          kind,
          status: r.status,
          ok: r.ok,
          recovered: r.data?.hpRecovered ?? r.data?.recovered,
        });
        if (r.ok) {
          const gained = r.data?.hpRecovered ?? r.data?.recovered ?? 0;
          log("REST API", kind, "+", gained, "vit", r.data?.vitality);
          try {
            if (scene.character) {
              if (r.data?.character?.currentHp != null)
                scene.character.currentHp = r.data.character.currentHp;
              else if (Number.isFinite(gained))
                scene.character.currentHp = Math.min(
                  max,
                  (hp || 0) + gained
                );
            }
          } catch {}
          did = true;
          // court délai anti rate-limit — PAS de CD 10 min
          await sleep(350);
          break;
        }
        const err = (r.data?.error || r.data?.message || "") + "";
        log("REST API fail", kind, r.status, err);
        if (r.status === 429 || /à peine de dormir|encore \d+/i.test(err)) {
          restCd[kind] = Date.now() + parseRestCdMs(err);
        } else if (
          r.status === 409 &&
          /ne t.apportera plus rien|vrai lit|forme/i.test(err)
        ) {
          // plus de gain pour ce kind — CD court pour ne pas spammer
          restCd[kind] = Date.now() + 60 * 1000;
        } else if (r.status === 409) {
          restCd[kind] = Date.now() + 15 * 1000;
        }
      }
      if (!did) {
        log("REST round no success");
        break;
      }
    }

    // Auberge API si encore critique et autorisé
    st = await restState();
    if (
      CFG.ALLOW_PAID_REST &&
      st &&
      st.maxHp &&
      st.hp / st.maxHp < (CFG.REST_FORCE_PCT ?? 0.55) &&
      st.inn?.available
    ) {
      const r = await api("POST", "/api/world/rest", {
        characterId: C,
        kind: "AUBERGE",
      });
      log("REST AUBERGE API", r.status, r.data?.hpRecovered, "cost", r.data?.cost);
      results.push({
        kind: "AUBERGE",
        status: r.status,
        ok: r.ok,
        recovered: r.data?.hpRecovered,
      });
      st = await restState();
    }

    st = await restState();
    log(
      "REST done (API)",
      st ? `${st.hp}/${st.maxHp}` : "?",
      results.map((x) => `${x.kind}:${x.status}${x.recovered != null ? ":+" + x.recovered : ""}`)
    );
    return {
      ok: !!(st && st.maxHp && st.hp / st.maxHp >= Math.min(CFG.REST_HP_PCT ?? 0.92, 0.5)),
      hp: st?.hp ?? hp,
      max: st?.maxHp ?? max,
      results,
    };
  }

  async function fight(startOrId) {
    await ensureChar();
    let bid =
      typeof startOrId === "string"
        ? startOrId
        : startOrId?.id || startOrId?.data?.id || scene.combatState?.id;

    if (!bid) {
      const t0 = Date.now();
      while (!bid && Date.now() - t0 < 8000) {
        await sleep(200);
        bid =
          scene.combatState?.id ||
          scene.network?.battle?.id ||
          scene.battle?.id;
        document.querySelector("button.confirmer-combat")?.click();
      }
    }
    if (!bid) {
      log("pas de battleId");
      return { error: "no battleId" };
    }

    active = true;
    stats.battles++;
    chaseStreak = 0;
    lastChaseD = null;
    const before = await getChar();
    const berriesBefore = before?.berries ?? 0;
    const xpBefore = before?.xp ?? 0;
    const hpBefore = before?.hp ?? before?.currentHp ?? 0;

    document.querySelector("button.confirmer-combat")?.click();
    await sleep(260);
    await api("POST", `/api/battles/${bid}/engage`, { characterId: CHAR_ID });
    await sleep(180);

    const banned = new Set();
    let lastTurnKey = "";
    let lastReason = "";
    const t0 = Date.now();

    while (active && Date.now() - t0 < CFG.BATTLE_TIMEOUT_MS) {
      const r = await api("GET", `/api/battles/${bid}`);
      const s = r.data;
      if (!s) {
        await sleep(CFG.POLL_MS);
        continue;
      }
      try {
        Object.assign(scene.combatState || {}, s);
      } catch {}

      if (s.winner || s.finished) {
        if (s.winner === "ALLIE") stats.wins++;
        else stats.losses++;
        break;
      }
      if (s.tactics?.placementDone === false) {
        await handlePlacement(s);
        continue;
      }
      if (!myTurn(s)) {
        await sleep(CFG.POLL_MS);
        continue;
      }

      const tactics = s.tactics || {};
      const turnKey = `${s.round ?? s.turn ?? ""}-${tactics.ap}-${tactics.mp}`;
      if (turnKey !== lastTurnKey) {
        banned.clear();
        lastTurnKey = turnKey;
      }

      stats.turns++;
      const me =
        (s.fighters || []).find((f) => f.id === (s.you || CHAR_ID)) || {};
      const decision = decide(s, me, banned);
      if (decision.reason !== lastReason) {
        log(decision.reason || decision.type);
        lastReason = decision.reason;
      }

      const banKey =
        decision.banKey ||
        (decision.type === "cast" || decision.type === "attack"
          ? `${decision.type}:${decision.action?.id}:${decision.enemy?.id}`
          : decision.type);

      if (banned.has(banKey) || banned.has(decision.type)) {
        const retry = decide(s, me, banned);
        const rk =
          retry.banKey ||
          (retry.type === "cast" || retry.type === "attack"
            ? `${retry.type}:${retry.action?.id}:${retry.enemy?.id}`
            : retry.type);
        if (
          retry &&
          (retry.type === "move" || retry.type === "endturn" || rk !== banKey) &&
          !banned.has(rk) &&
          !(retry.type === "cast" && banned.has("cast") && retry.type === decision.type)
        ) {
          if (retry.type !== "endturn" && !banned.has(retry.type)) {
            log("ban → alt", retry.reason || retry.type);
            await execute(bid, retry);
            await sleep(CFG.ACT_MS);
            continue;
          }
        }
        log("skip ban → endturn");
        await execute(bid, { type: "endturn", reason: "ban" });
        await sleep(CFG.END_MS);
        continue;
      }

      const res = await execute(bid, decision);
      if (res.status === 409) {
        const msg = (res.data?.error || res.data?.message || "") + "";
        log("409", msg);
        banned.add(banKey);
        // PA désync : endturn
        if (/\bPA\b|points? d.action|reste 0/i.test(msg)) {
          banned.add(decision.type);
          await execute(bid, { type: "endturn", reason: "PA 409 → end" });
          await sleep(CFG.END_MS);
          continue;
        }
        // Trop près = minRange (ex. Hissatsu 6) — ban skill only, next tick kite
        if (/trop pr[eè]s|au moins \d+/i.test(msg)) {
          log("minRange ban", decision.action?.name || banKey);
          await sleep(CFG.ACT_MS);
          continue;
        }
        if (/ligne de vue|LOS|sight|coupée/i.test(msg)) {
          const mp = Number(tactics.mp ?? 0);
          const reachable = (tactics.reachable || []).filter(
            (c) => (c.cost || 0) <= mp
          );
          const meId = s.you || CHAR_ID;
          const myPos = tactics.positions?.[meId];
          const en = decision.enemy;
          const obstacleSet = new Set(
            (tactics.obstacles || []).map((o) => `${o.x}:${o.y}`)
          );
          let side = null;
          if (en?.pos && myPos) {
            for (const c of reachable) {
              if (
                hasLOS(c, en.pos, obstacleSet) &&
                dist(c, en.pos) <= actionRange(decision.action || {})
              ) {
                side = c;
                break;
              }
            }
          }
          if (side) {
            log("LOS → side step", side);
            await execute(bid, {
              type: "move",
              cell: side,
              reason: "LOS step",
            });
            await sleep(CFG.MOVE_MS);
          } else {
            await execute(bid, {
              type: "endturn",
              reason: "LOS blocked → end",
            });
            await sleep(CFG.END_MS);
          }
        } else if (/garde/i.test(msg)) {
          banned.add("guard");
          await execute(bid, {
            type: "endturn",
            reason: "déjà garde → end",
          });
          await sleep(CFG.END_MS);
        } else {
          await sleep(350);
        }
        continue;
      }

      if (res.data?.winner || res.data?.finished) {
        if ((res.data.winner || s.winner) === "ALLIE") stats.wins++;
        else stats.losses++;
        break;
      }

      if (decision.type === "move") await sleep(CFG.MOVE_MS);
      else if (decision.type === "cast" || decision.type === "attack")
        await sleep(CFG.ACT_MS);
      else await sleep(CFG.END_MS);
    }

    await sleep(350);
    await closeSummaryPopup();
    await sleep(250);
    await closeSummaryPopup();

    const after = await getChar();
    const bDelta = (after?.berries ?? berriesBefore) - berriesBefore;
    const xDelta = (after?.xp ?? xpBefore) - xpBefore;
    const hpAfter = after?.hp ?? after?.currentHp ?? hpBefore;
    stats.berriesDelta += bDelta;
    stats.xpDelta += xDelta;

    await sellJunkIfNeeded(after);
    await restIfNeeded(after, false); // uniquement si HP < max / seuil

    const summary = {
      berriesDelta: bDelta,
      xpDelta: xDelta,
      hpDelta: hpAfter - hpBefore,
    };
    log("END", summary);
    active = false;
    return summary;
  }

  // ═══════════════════════════════════════════════════════════
  // FARM LOOP
  // ═══════════════════════════════════════════════════════════
  async function next() {
    if (busy || active) {
      log("busy — ignore next()");
      return { error: "busy" };
    }
    busy = true;
    try {
      await ensureChar();
      // si un combat client est encore ouvert, le finir d'abord
      if (scene.combat || scene.combatState?.id) {
        log("combat UI encore ouvert → close + wait");
        await closeSummaryPopup();
        await sleep(800);
      }

      const list = packs();
      const tgt = list[0];
      if (!tgt) {
        log(
          "aucun pack valide (live=" +
            (scene.network?.fauna?.packs || []).length +
            ")"
        );
        return { error: "no pack" };
      }
      log(
        "cible",
        tgt.id,
        tgt.espece?.join(","),
        "lvl" + tgt.maxLvl,
        "n=" + tgt.nMobs,
        "d=" + tgt.d,
        "score=" + (tgt.score != null ? tgt.score.toFixed(1) : "?")
      );

      // Une seule approche (évite double walkTo)
      async function refreshPackPos(id) {
        const f = scene.network?.fauna?.packs || [];
        const p = f.find((x) => x.id === id);
        if (!p) return null;
        const mobs = p.mobs || [];
        const ox = Math.round(mobs[0]?.orbit?.cx ?? p.ancre?.x);
        const oy = Math.round(mobs[0]?.orbit?.cy ?? p.ancre?.y);
        if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;
        return { ox, oy };
      }

      async function approachPack(id, ox, oy) {
        const okD = CFG.APPROACH_OK_D ?? 6;
        const giveUp = CFG.APPROACH_GIVEUP_D ?? 10;
        let x = ox, y = oy;
        for (let attempt = 0; attempt < 4; attempt++) {
          const live = await refreshPackPos(id);
          if (live) {
            x = live.ox;
            y = live.oy;
          }
          const pl = playerPos();
          const d = Math.abs(x - pl.x) + Math.abs(y - pl.y);
          if (d <= okD) return { ok: true, d, x, y };
          log("approche", id, "d=" + d, "try", attempt + 1);
          const ok = await walkTo(x, y);
          if (!ok) {
            stats.walkFails++;
            // essayer case adjacente walkable autour de l'ancre
            const alt = nearestWalkable(x, y, 4);
            if (alt.x !== x || alt.y !== y) await walkTo(alt.x, alt.y);
            else await sleep(60);
          }
          await sleep(60);
        }
        const pl = playerPos();
        const d = Math.abs(x - pl.x) + Math.abs(y - pl.y);
        return { ok: d <= giveUp, d, x, y };
      }

      const appr = await approachPack(tgt.id, tgt.ox, tgt.oy);
      if (!appr.ok) {
        blacklist.set(tgt.id, Date.now() + 1500);
        log("trop loin d=" + appr.d + " → autre pack");
        return { error: "too far", retry: true };
      }

      let started = false;
      for (let tryAtk = 0; tryAtk < 3 && !started; tryAtk++) {
        // re-sync position pack (ils bougent)
        const live = await refreshPackPos(tgt.id);
        if (live) {
          const pl = playerPos();
          const d = Math.abs(live.ox - pl.x) + Math.abs(live.oy - pl.y);
          if (d > 8) {
            log("pack a bougé d=" + d + " → re-walk");
            await walkTo(live.ox, live.oy);
            await sleep(120);
          }
        }

        try {
          await attackPack(tgt.id);
        } catch (e) {
          log("attack error", e?.message || e);
        }

        await sleep(500);
        document.querySelector("button.confirmer-combat")?.click();

        // battleId apparu ?
        const t0 = Date.now();
        while (Date.now() - t0 < 2500) {
          if (
            scene.combatState?.id ||
            scene.network?.battle?.id ||
            scene.battle?.id
          ) {
            started = true;
            break;
          }
          document.querySelector("button.confirmer-combat")?.click();
          await sleep(200);
        }
        if (!started) {
          log("pas de battleId try", tryAtk + 1, "→ re-approche");
          const live2 = await refreshPackPos(tgt.id);
          if (live2) await walkTo(live2.ox, live2.oy);
          await sleep(150);
        }
      }

      let battleId = scene.combatState?.id || scene.network?.battle?.id || scene.battle?.id || null;

      // Fallback API si le client n'a pas ouvert le combat (souvent headless / confirmation)
      if (!started || !battleId) {
        const C = await ensureChar();
        const st = await api("POST", "/api/battles/start", {
          characterId: C,
          fauna: tgt.id,
        });
        if (st.ok && st.data?.id) {
          battleId = st.data.id;
          started = true;
          log("start API OK", battleId);
        } else {
          const msg = (st.data?.error || st.data?.message || st.status || "") + "";
          log("start API fail", st.status, msg);
          blacklist.set(tgt.id, Date.now() + 2000);
          await closeSummaryPopup();
          return {
            error: /trop loin/i.test(msg) ? "too far" : "no battleId",
            retry: true,
            apiStatus: st.status,
            apiMsg: msg.slice(0, 120),
          };
        }
      }

      const r = await fight(battleId);
      return r;
    } finally {
      busy = false;
    }
  }

  async function farm(n = 5) {
    const out = [];
    for (let i = 0; i < n; i++) {
      log(`── farm ${i + 1}/${n} ──`);
      await closeSummaryPopup();
      const r = await next();
      await closeSummaryPopup();
      out.push(r);
      if (r?.error === "no pack") await sleep(CFG.NO_PACK_WAIT_MS);
      else if (r?.retry || r?.error === "too far" || r?.error === "no battleId")
        await sleep(120);
      else await sleep(CFG.BETWEEN_FIGHTS_MS);
    }
    console.table(out);
    return out;
  }

  async function start() {
    if (farming) return log("déjà en farm");
    farming = true;
    stats.startedAt = Date.now();
    log("▶ START farm continu", playerPos().mapId, "lvl" + playerPos().level);
    while (farming) {
      try {
        await closeSummaryPopup(); // lvl-up / résumé avant chaque cycle
        const r = await next();
        await closeSummaryPopup(); // lvl-up après combat
        if (r?.error === "no pack") await sleep(CFG.NO_PACK_WAIT_MS);
        else if (r?.retry || r?.error === "too far" || r?.error === "no battleId")
          await sleep(120); // retry immédiat — packs mobiles
        else await sleep(CFG.BETWEEN_FIGHTS_MS);
      } catch (e) {
        console.error("[GL] farm loop", e);
        await closeSummaryPopup();
        await sleep(2000);
      }
    }
    log("■ STOP");
  }

  function stop() {
    farming = false;
    active = false;
    log("stop demandé");
  }

  function arm() {
    if (window.__glArmed) return log("deja arme");
    window.__glArmed = true;
    const orig = window.fetch;
    window.fetch = async function (url, opts) {
      const res = await orig.apply(this, arguments);
      try {
        const u = typeof url === "string" ? url : url?.url || "";
        const method = (opts?.method || "GET").toUpperCase();
        const watch =
          u.includes("/api/battles/") &&
          method === "POST" &&
          (u.includes("/start") ||
            u.includes("/pvp/challenge") ||
            u.includes("/join"));
        if (watch) {
          res
            .clone()
            .json()
            .then((data) => {
              const id = data?.id || data?.battleId || data?.battle?.id;
              if (id && !active) {
                log("auto-fight", id);
                fight(id);
              }
            })
            .catch(() => {});
        }
      } catch {}
      return res;
    };
    log("arme - auto-fight FAUNE + PvP");
  }

  window.GL = {
    packs,
    walkTo,
    attackPack,
    fight,
    next,
    farm,
    start,
    stop,
    arm,
    rest: (force) => restIfNeeded(null, !!force),
    restState,
    sell: (force) => sellJunkIfNeeded(null, !!force),
    inv: () => inventoryFill(scene.character),
    stats: () => (console.table(stats), stats),
    closePopup: closeSummaryPopup,
    player: playerPos,
    CFG,
  };

  console.log(
    "%c✅ GL v2.1 optimal (scripts/gl_farm.js)\n" +
      "  GL.start() / GL.stop()\n" +
      "  GL.next() · GL.farm(5) · GL.arm()\n" +
      "  GL.stats() · GL.packs()",
    "color:#7f7;font-weight:bold"
  );
})();
