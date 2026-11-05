/**
 * GL API Farm — console F12 (NOUVEAU script, indépendant de GL / gl_farm.js)
 */
(() => {
  "use strict";

  const scene = window.__grandlineScene;
  if (!scene) return console.error("[GLApi] Pas de scène — entre en jeu d’abord");

  const API = "https://api.grandline-online.fr";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dist = (a, b) =>
    Math.abs((a?.x ?? 0) - (b?.x ?? 0)) + Math.abs((a?.y ?? 0) - (b?.y ?? 0));
  const key = (c) => `${c?.x}:${c?.y}`;
  const kxy = (x, y) => `${x},${y}`;

  const CFG = Object.assign(
    {
      FLEE_HP_PCT: 0.15,
      KITE_MARGIN: 2,
      NEVER_MELEE_IF_RANGED: true,
      MIN_EFFICIENCY: 6,
      FINISHER: 10000,
      POLL_MS: 140,
      MOVE_MS: 180,
      ACT_MS: 120,
      END_MS: 180,
      RATE_MIN_MS: 40,        // anti-burst local, reste rapide
      RATE_429_BASE_MS: 800,  // backoff seulement si 429
      RATE_429_MAX_MS: 8000,
      WALK_SLICE: 16,
      WALK_CHUNK_MS: 70,
      BFS_LIMIT: 16000,
      APPROACH_OK_D: 4,        // start combat si d <= 4
      APPROACH_GIVEUP_D: 80,    // marcher jusqu'à 80 (sinon trop loin)
      MAX_LEVEL_DELTA: 99,
      BLACKLIST_MS: 8000,
      NO_PACK_WAIT_MS: 1600,
      BETWEEN_FIGHTS_MS: 280,
      BATTLE_TIMEOUT_MS: 150000,
      REST_HP_PCT: 0.9,
      SELL_THRESHOLD: 0.85,
      STACK_MAX: 20, // pile max jeu
      // Whitelist stricte — seuls ces IDs sont vendus. Override: window.__glApiCfg.SELL_JUNK
      SELL_JUNK: [
        "plumes",
        "viande-de-gibier",
        "bois-brut",
        "poisson-commun",
        "peau-tannee",
        "baies-sauvages",
        "algue-marine",
        "ble",
        "sel-marin",
        "os-de-gibier",
        "fourrure",
        "ecaille-de-poisson",
        "minerai-fer",
        "corne-de-bete",
        "acier-trempe",
        "or-massif",
        "fibre-vegetale",
        "encre-de-poulpe",
        "resine",
        "charbon",
        "fil-d-araignee-geante",
      ],
      VERBOSE: true,
    },
    window.__glApiCfg || {}
  );

  const stats = {
    battles: 0,
    wins: 0,
    losses: 0,
    flees: 0,
    casts: 0,
    moves: 0,
    sells: 0,
    walkFails: 0,
    berriesDelta: 0,
    xpDelta: 0,
  };

  let TOKEN =
    sessionStorage.getItem("grandline-token") ||
    localStorage.getItem("grandline-token") ||
    window.__freshToken ||
    "";
  let CHAR_ID =
    scene.character?.id ||
    sessionStorage.getItem("__autoCharId") ||
    null;
  let farming = false;
  let busy = false;
  let active = false;
  const blacklist = new Map();

  const log = (...a) =>
    CFG.VERBOSE && console.log("%c[GLApi]", "color:#0f8;font-weight:bold", ...a);

  function findToken() {
    if (window.__freshToken) return window.__freshToken;
    for (const store of [sessionStorage, localStorage]) {
      try {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          const v = store.getItem(k);
          if (v && v.split(".").length === 3 && v.length > 80) {
            try {
              const p = JSON.parse(
                atob(v.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
              );
              if (p.exp > Date.now() / 1000) return v;
            } catch {}
          }
        }
      } catch {}
    }
    return sessionStorage.getItem("grandline-token") || TOKEN;
  }

  let _apiLast = 0;
  let _apiBackoff = 0;
  const _rateKey = "glapi_rate_until";

  function sharedRateWait() {
    try {
      const until = parseInt(localStorage.getItem(_rateKey) || "0", 10);
      return Math.max(0, until - Date.now());
    } catch {
      return 0;
    }
  }
  function sharedRateSet(ms) {
    try {
      const until = Date.now() + ms;
      const prev = parseInt(localStorage.getItem(_rateKey) || "0", 10);
      if (until > prev) localStorage.setItem(_rateKey, String(until));
    } catch {}
  }

  async function api(method, path, body, opts) {
    opts = opts || {};
    const retries = opts.retries ?? 4;
    TOKEN = findToken() || TOKEN;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const minGap = CFG.RATE_MIN_MS || 40;
      const waitGap = Math.max(0, _apiLast + minGap - Date.now(), sharedRateWait());
      if (waitGap > 0) await sleep(waitGap);
      if (_apiBackoff > 0) {
        const b = _apiBackoff;
        _apiBackoff = 0;
        await sleep(b);
      }

      let r, data;
      try {
        r = await fetch(API + path, {
          method,
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...(TOKEN ? { authorization: "Bearer " + TOKEN } : {}),
          },
          body: body != null ? JSON.stringify(body) : undefined,
        });
        data = await r.json().catch(() => null);
      } catch (e) {
        // réseau — petit backoff
        await sleep(300 + attempt * 200);
        if (attempt === retries) return { status: 0, ok: false, data: { error: String(e) } };
        continue;
      }
      _apiLast = Date.now();

      if (r.status !== 429) {
        return { status: r.status, ok: r.ok, data };
      }

      // 429 Too Many Requests — respect Retry-After si présent
      let ra = 0;
      try {
        const h = r.headers.get("retry-after");
        if (h) ra = parseFloat(h) * (parseFloat(h) < 100 ? 1000 : 1);
      } catch {}
      const base = CFG.RATE_429_BASE_MS || 1500;
      const max = CFG.RATE_429_MAX_MS || 12000;
      const backoff = Math.min(max, ra || base * Math.pow(1.5, attempt) + Math.random() * 300);
      _apiBackoff = backoff;
      sharedRateSet(backoff); // autres onglets attendent aussi (évite tempête 429)
      if (CFG.VERBOSE)
        log("429", method, path, `wait ${Math.round(backoff)}ms`);
      await sleep(backoff);
    }
    return { status: 429, ok: false, data: { error: "rate limited" } };
  }

  async function ensureChar() {
    if (CHAR_ID) return CHAR_ID;
    const r = await api("GET", "/api/characters");
    const list = Array.isArray(r.data) ? r.data : r.data?.characters || [];
    CHAR_ID = list[0]?.id || scene.character?.id;
    if (CHAR_ID) sessionStorage.setItem("__autoCharId", CHAR_ID);
    return CHAR_ID;
  }

  async function getChar() {
    await ensureChar();
    // GET liste
    let r = await api("GET", "/api/characters");
    let list = Array.isArray(r.data) ? r.data : r.data?.characters || [];
    let apiChar = list.find((c) => c.id === CHAR_ID) || list[0] || null;

    // GET détail si dispo (souvent inventaire plus frais)
    if (CHAR_ID) {
      const r2 = await api("GET", `/api/characters/${CHAR_ID}`);
      if (r2.ok && r2.data && (r2.data.inventory || r2.data.id)) {
        apiChar = r2.data.inventory ? r2.data : { ...apiChar, ...r2.data };
      }
    }

    // Source de vérité = API (scène dérive après long farm)
    try {
      if (apiChar?.inventory && scene.character) {
        scene.character.inventory = apiChar.inventory;
        if (apiChar.equipment) scene.character.equipment = apiChar.equipment;
        if (apiChar.berries != null) scene.character.berries = apiChar.berries;
      }
    } catch {}
    return apiChar || scene.character;
  }

  function playerPos() {
    const id = scene.character?.id;
    const e = id && scene.entities?.get?.(id);
    return {
      x: Math.round(e?.x ?? scene.character?.x ?? 0),
      y: Math.round(e?.y ?? scene.character?.y ?? 0),
      mapId: scene.character?.mapId,
      level: scene.character?.level || 1,
      moving: !!(e?.moving),
    };
  }

  function blocked(x, y) {
    try {
      if (typeof scene.movementBlocked === "function")
        return !!scene.movementBlocked(x, y);
    } catch {}
    return false;
  }

  function nearestWalkable(tx, ty, rad = 8) {
    tx = Math.round(tx);
    ty = Math.round(ty);
    if (!blocked(tx, ty)) return { x: tx, y: ty };
    for (let r = 1; r <= rad; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) + Math.abs(dy) !== r) continue;
          const x = tx + dx,
            y = ty + dy;
          if (!blocked(x, y)) return { x, y };
        }
      }
    }
    return { x: tx, y: ty };
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
        const nx = x + dx,
          ny = y + dy,
          kk = kxy(nx, ny);
        if (prev.has(kk) || blocked(nx, ny)) continue;
        prev.set(kk, [x, y]);
        q.push([nx, ny]);
      }
    }

    let end = kxy(goal.x, goal.y);
    if (!prev.has(end)) {
      let best = null,
        bd = 1e9;
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
    if (!end || !prev.has(end)) {
      stats.walkFails++;
      return false;
    }

    const full = [];
    let cur = end;
    while (cur) {
      const [x, y] = cur.split(",").map(Number);
      full.push({ x, y });
      const p = prev.get(cur);
      cur = p ? kxy(p[0], p[1]) : null;
    }
    full.reverse();

    for (let g = 0; g < full.length + 40; g++) {
      const c = playerPos();
      if (Math.abs(c.x - goal.x) + Math.abs(c.y - goal.y) <= 1) return true;
      let wait = 0;
      while (playerPos().moving && wait < 40) {
        await sleep(20);
        wait++;
      }
      let idx = 0,
        best = 1e9;
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
      if (chunk.length < 2) break;
      try {
        await scene.moveLocal(chunk, null, { courir: true, redresser: true });
      } catch {
        try {
          await scene.moveLocal(chunk.slice(0, 3), null, {
            courir: true,
            redresser: true,
          });
        } catch {}
      }
      await sleep(CFG.WALK_CHUNK_MS);
    }
    const endPos = playerPos();
    const ok = Math.abs(endPos.x - goal.x) + Math.abs(endPos.y - goal.y) <= 2;
    if (!ok) stats.walkFails++;
    return ok;
  }

  function faunaState() {
    return (
      scene.network?.fauna ||
      scene.fauna ||
      scene.network?.world?.fauna ||
      {}
    );
  }

  /** true si pack mort / en respawn / déjà engagé */
  function isPackUnavailable(packId, now = Date.now()) {
    if (!packId) return true;
    if (blacklist.has(packId) && blacklist.get(packId) > now) return true;

    const fauna = faunaState();
    const morts = fauna.morts || fauna.dead || fauna.deaths || {};
    const mortUntil = morts[packId];
    if (typeof mortUntil === "number" && mortUntil > now) return true;
    if (mortUntil && typeof mortUntil === "object") {
      const ts = Number(mortUntil.respawnAt || mortUntil.until || mortUntil.at || 0);
      if (ts > now) return true;
    }

    const engagees = fauna.engagees || fauna.engaged || [];
    if (Array.isArray(engagees) && engagees.includes(packId)) return true;
    if (engagees && typeof engagees === "object" && !Array.isArray(engagees)) {
      if (engagees[packId]) return true;
    }

    // Map client faunaEntities parfois absente = non chargé / mort
    try {
      if (scene.faunaEntities instanceof Map && scene.faunaEntities.size > 0) {
        // si la map existe et le pack n'y est pas, souvent mort/despawn
        // (ne pas skip si map vide = pas encore synchro)
        if (!scene.faunaEntities.has(packId)) {
          // seulement si morts le signale ou blacklist récente — sinon laisser tenter
        }
      }
    } catch {}

    return false;
  }

  /** Après kill / 409 missing : skip jusqu'au respawn connu ou fallback */
  function markPackDown(packId, msOrUntil) {
    if (!packId) return;
    const now = Date.now();
    let until = now + (CFG.BLACKLIST_MS || 8000);
    if (typeof msOrUntil === "number") {
      until = msOrUntil > 1e12 ? msOrUntil : now + msOrUntil;
    }
    const fauna = faunaState();
    const morts = fauna.morts || {};
    const mortUntil = morts[packId];
    if (typeof mortUntil === "number" && mortUntil > until) until = mortUntil;
    if (mortUntil && typeof mortUntil === "object") {
      const ts = Number(mortUntil.respawnAt || mortUntil.until || 0);
      if (ts > until) until = ts;
    }
    blacklist.set(packId, until);
    const sec = Math.round((until - now) / 1000);
    log("pack down", packId, sec + "s");
  }

  function packs() {
    const fauna = faunaState();
    const raw =
      fauna.packs ||
      scene.network?.fauna?.packs ||
      scene.fauna?.packs ||
      scene.network?.packs ||
      [];
    const pl = playerPos();
    const now = Date.now();
    let skippedDead = 0;
    const list = raw
      .map((p) => {
        if (!p?.id) return null;
        if (isPackUnavailable(p.id, now)) {
          skippedDead++;
          return null;
        }
        // statut explicite sur le pack
        const st = (p.statut || p.status || p.state || "").toString().toLowerCase();
        if (/mort|dead|respawn|cooldown|down/i.test(st)) {
          skippedDead++;
          return null;
        }
        if (p.respawnAt && Number(p.respawnAt) > now) {
          skippedDead++;
          return null;
        }
        const mobs = p.mobs || p.members || [];
        // pack vide = déjà clean
        if (Array.isArray(mobs) && mobs.length === 0) {
          skippedDead++;
          return null;
        }
        const alive = mobs.filter((m) => (m.hp ?? m.currentHp ?? 1) > 0);
        if (mobs.length && alive.length === 0) {
          skippedDead++;
          return null;
        }
        const ancre = p.ancre || p.anchor || mobs[0]?.orbit || {};
        const ox = Math.round(ancre.x ?? ancre.cx ?? p.x ?? 0);
        const oy = Math.round(ancre.y ?? ancre.cy ?? p.y ?? 0);
        const d = Math.abs(ox - pl.x) + Math.abs(oy - pl.y);
        const levels = mobs.map((m) => Number(m.niveau ?? m.level ?? 1) || 1);
        const maxLvl = levels.length ? Math.max(...levels) : 1;
        if (maxLvl > pl.level + CFG.MAX_LEVEL_DELTA) return null;
        const especes = mobs.map((m) => m.espece || m.species || m.name || "?");
        return {
          id: p.id,
          ox,
          oy,
          d,
          maxLvl,
          n: Math.max(alive.length || mobs.length, 1),
          especes,
          score: d + maxLvl * 0.2 + Math.max(mobs.length, 1) * 0.5,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score || a.d - b.d);
    if (CFG.VERBOSE && skippedDead)
      log("packs skip dead/respawn/engaged:", skippedDead, "alive:", list.length);
    return list;
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
    const name = (a?.name || a?.id || "") + "";
    if (/hissatsu|tori|boshi|kaen|tetsu/i.test(name)) return 6;
    if (a?.kind === "TECHNIQUE" && actionRange(a) >= 5) return 2;
    return 0;
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
  function hasLOS(from, to, obstacleSet) {
    if (!from || !to) return false;
    let x0 = from.x,
      y0 = from.y,
      x1 = to.x,
      y1 = to.y;
    const dx = Math.abs(x1 - x0),
      dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1,
      sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (!(x0 === x1 && y0 === y1)) {
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
      if (x0 === x1 && y0 === y1) break;
      if (obstacleSet.has(`${x0}:${y0}`)) return false;
    }
    return true;
  }

  function decide(s, banned) {
    banned = banned || new Set();
    const meId = s.you || CHAR_ID;
    const tactics = s.tactics || {};
    const positions = tactics.positions || {};
    const myPos = positions[meId];
    if (!myPos) return { type: "endturn", reason: "no myPos" };

    const ap = Number(tactics.ap ?? 0);
    const mp = Number(tactics.mp ?? 0);
    const actions = (s.actions || []).filter((a) => a.usable !== false && !a.locked);
    const obstacleSet = new Set((tactics.obstacles || []).map((o) => `${o.x}:${o.y}`));
    const me = (s.fighters || []).find((f) => f.id === meId) || {};
    const enemies = (s.fighters || [])
      .filter((f) => f.id !== meId && (f.hp || 0) > 0 && f.team === "ENNEMI")
      .map((f) => ({
        ...f,
        pos: positions[f.id],
        d: positions[f.id] ? dist(myPos, positions[f.id]) : 99,
      }))
      .filter((f) => f.pos)
      .sort((a, b) => a.d - b.d);
    if (!enemies.length) return { type: "endturn", reason: "no enemies" };

    const maxR = myMaxRange(actions);
    const ranged = maxR >= 4 || !!me.armeDeTir;
    const maxPM = Math.max(...enemies.map((e) => e.caracs?.pm ?? 3));
    const maxER = Math.max(...enemies.map(enemyMaxRange));
    const safe = Math.min(Math.max(2, maxPM + maxER + CFG.KITE_MARGIN), maxR);
    const curMin = enemies[0].d;
    const inDanger = curMin < safe;
    const reachable = (tactics.reachable || []).filter((c) => (c.cost || 0) <= mp);
    const pool = reachable;
    const hpPct = (me.hp || 0) / Math.max(me.maxHp || 1, 1);

    if (hpPct < CFG.FLEE_HP_PCT && actions.some((a) => a.kind === "FUITE")) {
      return { type: "flee", reason: `FUITE ${Math.round(hpPct * 100)}%` };
    }

    // KITE first under safe
    if (ranged && inDanger && mp > 0 && pool.length) {
      let best = null;
      for (const c of pool) {
        if (c.x === myPos.x && c.y === myPos.y) continue;
        const dMin = Math.min(...enemies.map((e) => dist(c, e.pos)));
        const canShoot = enemies.some((e) => dist(c, e.pos) <= maxR);
        let score = dMin >= safe && dMin <= maxR ? 12000 + dMin : dMin * 20;
        if (canShoot) score += 300;
        if (dMin > curMin) score += 50;
        if (!best || score > best.score) best = { cell: c, score, d: dMin };
      }
      if (best && best.d > curMin) {
        return {
          type: "move",
          cell: { x: best.cell.x, y: best.cell.y },
          reason: `KITE ${curMin}→${best.d} (safe=${safe})`,
        };
      }
    }

    if (ap <= 0) {
      if (ranged && inDanger && mp > 0 && pool.length) {
        let best = null;
        for (const c of pool) {
          const dMin = Math.min(...enemies.map((e) => dist(c, e.pos)));
          if (dMin > curMin && (!best || dMin > best.d))
            best = { cell: c, d: dMin };
        }
        if (best)
          return {
            type: "move",
            cell: { x: best.cell.x, y: best.cell.y },
            reason: `AP0 KITE ${curMin}→${best.d}`,
          };
      }
      return { type: "endturn", reason: `AP0 d=${curMin}` };
    }

    // Attacks in valid min/max range, not under safe if can kite
    let best = null;
    for (const a of actions) {
      if (a.kind === "FUITE" || a.kind === "GARDE") continue;
      if (CFG.NEVER_MELEE_IF_RANGED && ranged && a.kind === "ATTAQUE") continue;
      const range = actionRange(a);
      const minR = actionMinRange(a);
      const pa = actionPa(a);
      if (pa > ap) continue;
      const needsSight =
        a.kind !== "ATTAQUE" && (a.geometry?.needsSight !== false || range > 1);
      for (const en of enemies) {
        if (en.d > range || en.d < minR) continue;
        if (ranged && en.d < safe && mp > 0) continue;
        if (needsSight && !hasLOS(myPos, en.pos, obstacleSet)) continue;
        const banKey = `${a.kind}:${a.id}:${en.id}`;
        if (banned.has(banKey)) continue;
        const est = a.estimates?.[en.id];
        if (!est && a.kind !== "ATTAQUE") continue;
        const dmg = est ? avgEst(est) : 12;
        const isKill = !!(est && est.max >= en.hp);
        const eff = dmg / Math.max(pa, 1);
        if (eff < CFG.MIN_EFFICIENCY && !isKill) continue;
        let score = dmg + eff * 8 + (isKill ? CFG.FINISHER : 0);
        if (!best || score > best.score) {
          best = {
            type: a.kind === "ATTAQUE" ? "attack" : "cast",
            action: a,
            enemy: en,
            score,
            banKey,
            reason: `${a.name || a.kind}→${en.name} d=${en.d} ~${Math.round(dmg)}${isKill ? " KILL" : ""}`,
          };
        }
      }
    }
    if (best) return best;

    // Chase if too far
    if (mp > 0 && pool.length && curMin > maxR) {
      let approach = null;
      for (const c of pool) {
        const dMin = Math.min(...enemies.map((e) => dist(c, e.pos)));
        if (ranged && dMin < safe) continue;
        const score = -dMin * 30 + (dMin < curMin ? 80 : 0);
        if (!approach || score > approach.score)
          approach = { cell: c, score, d: dMin };
      }
      if (approach && approach.d < curMin)
        return {
          type: "move",
          cell: { x: approach.cell.x, y: approach.cell.y },
          reason: `CHASE ${curMin}→${approach.d}`,
        };
    }

    return { type: "endturn", reason: `idle d=${curMin} ap=${ap} mp=${mp}` };
  }

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

  /** API farm : pas de spam Fermer UI. Seulement level-up / résumé combat visible. */
  async function closePopups() {
    const blob = (document.body?.innerText || "").slice(0, 4000);
    const need =
      /continuer|monte[s]?\s+de\s+niveau|level\s*up|niveau supérieur|victoire|défaite|récompenses/i.test(
        blob
      );
    if (!need) return;

    for (let i = 0; i < 3; i++) {
      const buttons = [...document.querySelectorAll("button, [role=button]")];
      // JAMAIS le chrome "×Fermer" permanent — seulement Continuer / OK level-up
      const btn = buttons.find((b) => {
        const tx = (b.innerText || b.textContent || "").trim();
        return /^(continuer|ok|super|génial|parfait|suivant)$/i.test(tx);
      });
      if (!btn) break;
      try {
        btn.click();
        log("popup:", (btn.innerText || "").trim());
      } catch {}
      await sleep(280);
    }
  }

  /** Items qui n'occupent pas de case de sac (clé / navigation / UI). */
  function takesNoBagSlot(id, name) {
    const s = (id + " " + (name || "")).toLowerCase();
    const list = CFG.NO_SLOT_ITEMS || [
      "log-pose",
      "notebook",
      "vivre-card",
      "menottes",
    ];
    if (list.includes(id)) return true;
    return /log-?pose|carnet de fouilles|notebook|vivre\s*card|menottes de la marine/i.test(
      s
    );
  }

  /**
   * Cases sac :
   *  - stack 20 : ceil(qty / 20)
   *  - items clé (log-pose, carnet…) = 0 case (validé : 60-4=56)
   *  - équipement reste listé dans items et COMPTE dans le sac
   */
  function slotsFor(it, _equipCountById) {
    const id = it.id;
    if (takesNoBagSlot(id, it.name)) return 0;
    const q = Math.max(0, Number(it.quantity ?? it.qty ?? 1) || 0);
    if (q <= 0) return 0;
    const max =
      Number(
        it.maxStack ||
          it.stackMax ||
          it.stackSize ||
          it.pileMax ||
          it.maxQuantity ||
          CFG.STACK_MAX ||
          20
      ) || 20;
    return Math.max(1, Math.ceil(q / max));
  }

  /** Uniquement les IDs listés dans CFG.SELL_JUNK (whitelist stricte). */
  function isJunkId(id, name) {
    if (!id) return false;
    const list = CFG.SELL_JUNK || [];
    if (list.includes(id)) return true;
    // alias éventuel name exact si tu mets le nom FR dans la liste
    if (name && list.includes(name)) return true;
    return false;
  }

  function listItems(inv) {
    if (!inv) return [];
    if (Array.isArray(inv)) return inv;
    const out = [];
    // sources possibles dans le même objet inventory
    for (const key of [
      "items",
      "bag",
      "sac",
      "contenu",
      "materials",
      "materiaux",
      "ressources",
      "fruits",
      "consumables",
      "questItems",
      "slots",
    ]) {
      const arr = inv[key];
      if (Array.isArray(arr)) {
        for (const it of arr) {
          if (it && it.id) out.push(it);
        }
      }
    }
    // parfois inventory est un dict id -> qty
    if (!out.length && typeof inv === "object") {
      for (const [k, v] of Object.entries(inv)) {
        if (["bagCapacity", "bonusCapacity", "fruitCapacity", "max", "capacity"].includes(k))
          continue;
        if (typeof v === "number" && v > 0) out.push({ id: k, quantity: v });
        if (v && typeof v === "object" && v.id) out.push(v);
      }
    }
    return out;
  }

  function parseInv(inv) {
    if (!inv) return null;
    const raw = listItems(inv);
    const items = raw
      .filter((it) => it && it.id && (Number(it.quantity ?? it.qty ?? 1) || 0) > 0)
      .map((it) => {
        const quantity = Number(it.quantity ?? it.qty ?? 1) || 1;
        const row = { id: it.id, name: it.name || it.id, quantity };
        row.slots = slotsFor(row);
        return row;
      });
    const cap =
      Number(inv.bagCapacity || inv.capacity || inv.maxSlots || inv.max || 0) +
      Number(inv.bonusCapacity || 0);
    const usedSlots = items.reduce((s, it) => s + slotsFor(it), 0);
    const sumQty = items.reduce((s, it) => s + it.quantity, 0);
    return {
      items,
      cap,
      used: items.length,
      usedSlots,
      sumQty,
      keys: inv && typeof inv === "object" ? Object.keys(inv) : [],
    };
  }

  function countEquipment(char) {
    const sources = [
      char?.equipment,
      char?.equipement,
      scene.character?.equipment,
      scene.character?.equipement,
    ].filter(Boolean);
    const items = [];
    const seen = new Set();
    for (const eq of sources) {
      if (Array.isArray(eq)) {
        for (const it of eq) {
          if (!it) continue;
          const id = typeof it === "string" ? it : it.id || it.itemId;
          if (!id || seen.has(id + ":arr")) continue;
          seen.add(id + ":arr");
          items.push(typeof it === "string" ? { id: it } : { ...it, id });
        }
      } else if (typeof eq === "object") {
        for (const [slot, it] of Object.entries(eq)) {
          if (it == null || it === "" || it === false) continue;
          const id = typeof it === "string" ? it : it.id || it.itemId || slot;
          const key = slot + ":" + id;
          if (seen.has(key)) continue;
          seen.add(key);
          if (typeof it === "string") items.push({ id: it, slot });
          else items.push({ ...it, id, slot });
        }
      }
    }
    return { n: items.length, items };
  }

  /** Snapshot inventaire — priorité API (char), scène seulement si API absente. */
  function inventoryFill(char) {
    // Ne PAS merger max(qty API, qty scène) : la scène devient fausse après long farm
    const primary = char?.inventory ? parseInv(char.inventory) : null;
    const fallback =
      !primary || !primary.items.length
        ? parseInv(scene.character?.inventory)
        : null;
    const parsed = primary || fallback;
    if (!parsed) {
      return {
        used: 0,
        cap: 1,
        pct: 0,
        stacks: 0,
        usedSlots: 0,
        sumQty: 0,
        items: [],
        junk: [],
        junkSlots: 0,
        equipment: 0,
      };
    }

    const eq = countEquipment(char || scene.character);
    const equipCountById = new Map();
    for (const e of eq.items) {
      equipCountById.set(e.id, (equipCountById.get(e.id) || 0) + 1);
    }

    const items = parsed.items.map((it) => ({
      ...it,
      slots: slotsFor(it, equipCountById),
      equipped: equipCountById.get(it.id) || 0,
    }));
    const stacks = items.filter((it) => it.slots > 0).length;
    const usedSlots = items.reduce(
      (s, it) => s + slotsFor(it, equipCountById),
      0
    );
    const sumQty = items.reduce((s, it) => s + it.quantity, 0);
    const bagCap = parsed.cap || 1;
    const bagUsed = usedSlots;
    const junk = items.filter((it) => isJunkId(it.id, it.name));

    return {
      used: bagUsed,
      cap: bagCap,
      pct: bagUsed / bagCap,
      stacks,
      usedSlots,
      bagOnly: bagUsed,
      sumQty,
      stackMax: CFG.STACK_MAX || 20,
      equipment: eq.n,
      equipItems: eq.items,
      uiGuess: bagUsed,
      items,
      junk,
      junkSlots: junk.length,
      invKeys: parsed.keys || [],
      source: primary ? "api" : "scene",
    };
  }

  async function sellIfNearFull(force = false) {
    // Toujours recharger l'inventaire API (scène souvent stale → 409 quantité)
    const c = await getChar();
    const fill = inventoryFill(c);
    log(
      "inv",
      `${fill.used}/${fill.cap}`,
      `sac=${fill.bagOnly ?? fill.usedSlots}`,
      `equip=${fill.equipment || 0}`,
      `junk=${fill.junkSlots || 0}`,
      `qtyΣ=${fill.sumQty}`
    );
    const th = CFG.SELL_THRESHOLD ?? 0.85;
    const junkPressure = (fill.junkSlots || 0) >= (CFG.SELL_JUNK_MIN_STACKS || 10);
    if (!force && fill.cap > 0 && fill.pct < th && !junkPressure) {
      if (CFG.VERBOSE)
        log(
          "sell skip",
          `${fill.used}/${fill.cap} (${Math.round(fill.pct * 100)}% < ${Math.round(th * 100)}%)`,
          `junk=${fill.junkSlots || 0}`
        );
      return { skipped: true, ...fill };
    }

    const C = await ensureChar();
    // 2e lecture API pure (items serveur uniquement)
    const fresh = await api("GET", "/api/characters");
    const list = Array.isArray(fresh.data) ? fresh.data : fresh.data?.characters || [];
    const apiChar = list.find((x) => x.id === C) || list[0];
    const apiItems = apiChar?.inventory?.items || [];
    const byId = new Map();
    for (const it of apiItems) {
      if (it?.id && (it.quantity || 0) > 0) byId.set(it.id, Number(it.quantity) || 0);
    }

    const junkIds = (CFG.SELL_JUNK || []).filter((id) => byId.has(id) && byId.get(id) > 0);
    if (!junkIds.length) {
      log("sell nothing junk (API qty=0)", `${fill.used}/${fill.cap}`);
      return { sold: 0, ...fill };
    }

    log(
      "sell near full",
      `${fill.used}/${fill.cap} (${Math.round(fill.pct * 100)}%)`,
      `junk stacks=${junkIds.length}`
    );

    let sold = 0;
    let berries = 0;
    for (const id of junkIds) {
      // re-read qty each item (ventes précédentes peuvent changer le sac)
      const r0 = await api("GET", "/api/characters");
      const lst = Array.isArray(r0.data) ? r0.data : r0.data?.characters || [];
      const ch = lst.find((x) => x.id === C) || lst[0];
      const row = (ch?.inventory?.items || []).find((x) => x.id === id);
      const qty = Number(row?.quantity) || 0;
      if (qty <= 0) {
        log("sell skip empty", id);
        continue;
      }
      // vendre par paquets ≤ STACK_MAX pour coller au serveur
      const chunk = Math.min(qty, CFG.STACK_MAX || 20);
      const r = await api("POST", "/api/economy/sell", {
        characterId: C,
        itemId: id,
        quantity: chunk,
      });
      if (r.ok) {
        sold++;
        stats.sells++;
        const paid = r.data?.paid ?? r.data?.total ?? 0;
        berries += paid;
        log("sell OK", id, "x" + chunk, "฿" + paid);
        // s'il en reste, enchaîner les chunks
        let left = qty - chunk;
        while (left > 0) {
          const n = Math.min(left, CFG.STACK_MAX || 20);
          const r2 = await api("POST", "/api/economy/sell", {
            characterId: C,
            itemId: id,
            quantity: n,
          });
          if (!r2.ok) {
            log("sell stop chunk", id, r2.status, r2.data?.error || "");
            break;
          }
          sold++;
          stats.sells++;
          const paid2 = r2.data?.paid ?? r2.data?.total ?? 0;
          berries += paid2;
          log("sell OK", id, "x" + n, "฿" + paid2);
          left -= n;
          await sleep(100);
        }
      } else {
        const err = (r.data?.error || r.data?.message || r.data?.code || "") + "";
        log("sell fail", id, r.status, err, "tried", chunk, "apiQty", qty);
        if (/quantit/i.test(err)) {
          // tenter 1 par 1
          let ok1 = false;
          for (let i = 0; i < Math.min(qty, 5); i++) {
            const r1 = await api("POST", "/api/economy/sell", {
              characterId: C,
              itemId: id,
              quantity: 1,
            });
            if (!r1.ok) {
              log("sell x1 fail", id, r1.status, r1.data?.error || "");
              break;
            }
            ok1 = true;
            sold++;
            stats.sells++;
            berries += r1.data?.paid ?? r1.data?.total ?? 0;
            log("sell OK", id, "x1", "฿" + (r1.data?.paid ?? 0));
            await sleep(80);
          }
          if (!ok1) continue;
        }
        await sleep(80);
        continue;
      }
      await sleep(100);
    }
    log("sell done", `stacks=${sold}`, `฿${berries}`);
    return { sold, berries, ...fill };
  }

  async function restIfNeeded(force = false) {
    const C = await ensureChar();
    const st = await api("GET", `/api/world/rest/${C}`);
    if (!st.ok || !st.data?.hp) return { skipped: true };
    const hp = st.data.hp.current;
    const max = st.data.hp.max;
    const pct = hp / max;
    if (!force && pct >= CFG.REST_HP_PCT) return { skipped: true, hp, max, pct };

    const results = [];
    for (let i = 0; i < 8; i++) {
      const cur = await api("GET", `/api/world/rest/${C}`);
      if (!cur.ok) break;
      const d = cur.data;
      const h = d.hp?.current,
        m = d.hp?.max;
      if (h != null && m && h / m >= 0.92) break;
      const ship = d.ship || {};
      const rough = d.rough || {};
      const shipCd = (d.freeSleep?.waitMs || 0) > 0 || (ship.waitMs || 0) > 0;
      const shipOk = ship.available && !shipCd && (ship.hpRecovery || 0) > 0;
      const belleOk =
        rough.available !== false && (rough.hpRecovery || 0) > 0;
      if (!shipOk && !belleOk) break;
      const kinds = shipOk
        ? ["NAVIRE", "BELLE_ETOILE"]
        : ["BELLE_ETOILE", "NAVIRE"];
      let did = false;
      for (const kind of kinds) {
        if (kind === "NAVIRE" && !shipOk) continue;
        if (kind === "BELLE_ETOILE" && !belleOk) continue;
        const r = await api("POST", "/api/world/rest", {
          characterId: C,
          kind,
        });
        results.push({ kind, status: r.status, recovered: r.data?.hpRecovered });
        if (r.ok) {
          log("REST", kind, "+", r.data?.hpRecovered);
          did = true;
          await sleep(300);
          break;
        }
      }
      if (!did) break;
    }
    return { results };
  }

  /** Combat 100% API */
  async function fightApi(packId) {
    await ensureChar();
    const before = await getChar();
    const berriesBefore = before?.berries ?? 0;
    const xpBefore = before?.xp ?? 0;

    const start = await api("POST", "/api/battles/start", {
      characterId: CHAR_ID,
      fauna: packId,
    });
    if (!start.ok || !start.data?.id) {
      const msg = (start.data?.error || start.data?.message || start.data?.code || "") + "";
      log("start fail", start.status, msg);
      const kind = /trop loin/i.test(msg)
        ? "too far"
        : /n.existe pas|CONFLIT|groupe|pas ici/i.test(msg)
          ? "missing"
          : "start";
      if (kind === "missing") markPackDown(packId, CFG.RESPAWN_FALLBACK_MS || 45000);
      else if (kind === "too far") blacklist.set(packId, Date.now() + 4000);
      else markPackDown(packId, 12000);
      return {
        error: kind,
        status: start.status,
        msg: msg.slice(0, 120),
        retry: true,
      };
    }
    const bid = start.data.id;
    log("battle", bid);
    stats.battles++;
    active = true;

    const eng = await api("POST", `/api/battles/${bid}/engage`, {
      characterId: CHAR_ID,
    });
    await sleep(80);

    const banned = new Set();
    let lastTurn = "";
    const t0 = Date.now();
    // Réutilise le body des POST (move/action/end-turn) → beaucoup moins de GET
    let s =
      (eng.data && (eng.data.tactics || eng.data.fighters) && eng.data) ||
      (start.data && (start.data.tactics || start.data.fighters) && start.data) ||
      null;

    function pickState(data) {
      if (!data) return null;
      // parfois { battle: {...} } ou état direct
      if (data.tactics || data.fighters || data.winner != null) return data;
      if (data.battle && (data.battle.tactics || data.battle.fighters))
        return data.battle;
      if (data.state && (data.state.tactics || data.state.fighters)) return data.state;
      return null;
    }

    async function refreshState(force) {
      // Préfère scene.combatState si même battle (0 requête)
      try {
        const cs =
          scene.combatState ||
          scene.network?.battle ||
          scene.battle ||
          null;
        if (
          cs &&
          (cs.id === bid || cs.battleId === bid) &&
          (cs.tactics || cs.fighters)
        ) {
          if (!force) return cs;
        }
      } catch {}
      const r = await api("GET", `/api/battles/${bid}`);
      if (r.status === 429) return null;
      const st = pickState(r.data) || r.data;
      return st || null;
    }

    while (active && Date.now() - t0 < CFG.BATTLE_TIMEOUT_MS) {
      if (!s || !(s.tactics || s.fighters)) {
        s = await refreshState(true);
        if (!s) {
          await sleep(CFG.POLL_MS || 140);
          continue;
        }
      }
      if (s.winner || s.finished) {
        if (s.winner === "ALLIE") stats.wins++;
        else stats.losses++;
        break;
      }
      if (s.tactics?.placementDone === false) {
        const res = await api("POST", `/api/battles/${bid}/end-turn`, {
          characterId: CHAR_ID,
        });
        s = pickState(res.data) || null; // force GET suivant si pas d'état
        await sleep(CFG.END_MS);
        continue;
      }
      const yourTurn =
        s.yourTurn === true ||
        s.tactics?.yourTurn === true ||
        s.activeFighterId === CHAR_ID ||
        s.tactics?.activeFighterId === CHAR_ID;
      if (!yourTurn) {
        // Attente tour adverse : 1 GET espacé, pas un spam
        await sleep(CFG.POLL_MS || 140);
        s = await refreshState(true);
        continue;
      }

      const turnKey = `${s.round}-${s.tactics?.ap}-${s.tactics?.mp}`;
      if (turnKey !== lastTurn) {
        banned.clear();
        lastTurn = turnKey;
      }

      const decision = decide(s, banned);
      log(decision.reason || decision.type);
      const banKey =
        decision.banKey ||
        (decision.action
          ? `${decision.action.kind}:${decision.action.id}:${decision.enemy?.id}`
          : decision.type);

      if (banned.has(banKey)) {
        const res = await execute(bid, { type: "endturn" });
        s = pickState(res.data) || null;
        await sleep(CFG.END_MS);
        continue;
      }

      const res = await execute(bid, decision);
      if (res.status === 409) {
        const msg = (res.data?.error || "") + "";
        log("409", msg);
        banned.add(banKey);
        s = pickState(res.data) || null; // souvent état à jour même en 409
        if (/trop pr[eè]s|au moins/i.test(msg)) {
          await sleep(CFG.ACT_MS);
          continue;
        }
        if (/\bPA\b/i.test(msg)) {
          const r2 = await execute(bid, { type: "endturn" });
          s = pickState(r2.data) || null;
          await sleep(CFG.END_MS);
        }
        continue;
      }
      // État suivant = réponse action (évite GET)
      s = pickState(res.data) || null;
      await sleep(
        decision.type === "move"
          ? CFG.MOVE_MS
          : decision.type === "endturn"
            ? CFG.END_MS
            : CFG.ACT_MS
      );
    }

    active = false;
    await closePopups();
    // pack down jusqu'au respawn (morts[] ou fallback)
    markPackDown(packId, CFG.RESPAWN_FALLBACK_MS || 45000);

    await sleep(200); // laisse le serveur commit loot inventaire
    const after = await getChar();
    const berriesAfter = after?.berries ?? berriesBefore;
    const xpAfter = after?.xp ?? xpBefore;
    const bDelta = berriesAfter - berriesBefore;
    const xDelta = xpAfter - xpBefore;
    stats.berriesDelta += bDelta;
    stats.xpDelta += xDelta;

    await sellIfNearFull(false);
    await restIfNeeded(false);
    await closePopups();

    return {
      bid,
      winner: "done",
      berriesDelta: bDelta,
      xpDelta: xDelta,
    };
  }

  async function next() {
    if (busy) return { error: "busy" };
    busy = true;
    try {
      const list = packs();
      if (!list.length) {
        log("no pack");
        return { error: "no pack" };
      }
      const tgt = list[0];
      log(
        "cible",
        tgt.id,
        tgt.especes?.join(",") || "",
        "lvl" + tgt.maxLvl,
        "d=" + tgt.d
      );

      let dNow = tgt.d;
      if (dNow > CFG.APPROACH_GIVEUP_D) {
        log("skip too far", tgt.id, "d=" + dNow);
        blacklist.set(tgt.id, Date.now() + Math.min(CFG.BLACKLIST_MS, 5000));
        return { error: "too far", retry: true, d: dNow };
      }

      // Toujours marcher si hors de portée de start API
      if (dNow > CFG.APPROACH_OK_D) {
        log("walk →", tgt.id, `@(${tgt.ox},${tgt.oy}) d=${dNow}`);
        const ok = await walkTo(tgt.ox, tgt.oy);
        const pl = playerPos();
        dNow = Math.abs(tgt.ox - pl.x) + Math.abs(tgt.oy - pl.y);
        log("walk done", ok ? "ok" : "partial", "d=" + dNow, `pos=(${pl.x},${pl.y})`);
        await sleep(120);
      }

      if (dNow > CFG.APPROACH_OK_D + 4) {
        // encore loin après walk → retenter walk une fois
        log("re-walk d=" + dNow);
        await walkTo(tgt.ox, tgt.oy);
        const pl2 = playerPos();
        dNow = Math.abs(tgt.ox - pl2.x) + Math.abs(tgt.oy - pl2.y);
        log("re-walk done d=" + dNow);
      }

      if (dNow > 12) {
        log("still far after walk", "d=" + dNow, "→ blacklist short");
        blacklist.set(tgt.id, Date.now() + 3000);
        return { error: "too far", retry: true, d: dNow };
      }

      log("start combat API d=" + dNow);
      const r = await fightApi(tgt.id);
      // fightApi gère déjà blacklist 409
      return r;
    } finally {
      busy = false;
    }
  }

  async function farm(n = 5) {
    const out = [];
    for (let i = 0; i < n; i++) {
      log(`── farm ${i + 1}/${n} ──`);
      const r = await next();
      out.push(r);
      if (r?.error === "no pack") await sleep(CFG.NO_PACK_WAIT_MS);
      else if (r?.retry) await sleep(120);
      else await sleep(CFG.BETWEEN_FIGHTS_MS);
    }
    console.table(out);
    return out;
  }

  async function start() {
    if (farming) return log("déjà en farm");
    farming = true;
    log("▶ START API-farm", playerPos().mapId, "lvl" + playerPos().level);
    while (farming) {
      try {
        const r = await next();
        if (r?.error === "no pack") await sleep(CFG.NO_PACK_WAIT_MS);
        else if (r?.error === "missing") await sleep(600);
        else if (r?.retry || r?.error === "too far") await sleep(250);
        else await sleep(CFG.BETWEEN_FIGHTS_MS);
      } catch (e) {
        console.error("[GLApi]", e);
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

  window.GLApi = {
    start,
    stop,
    next,
    farm,
    walkTo,
    packs,
    isPackUnavailable,
    markPackDown,
    fightApi,
    sell: sellIfNearFull,
    inv: async () => {
      const c = await getChar();
      const fill = inventoryFill(c);
      log(
        "INV DETAIL",
        `sac ${fill.used}/${fill.cap}`,
        `equip ${fill.equipment}`,
        `uiGuess ${fill.uiGuess}`,
        `junk ${fill.junkSlots}`,
        fill.invKeys
      );
      console.table(
        (fill.items || []).map((it) => ({
          id: it.id,
          name: it.name,
          qty: it.quantity,
          eq: it.equipped || 0,
          slots: it.slots,
          junk: isJunkId(it.id, it.name),
        }))
      );
      if (fill.equipment) {
        const eq = countEquipment(c);
        console.log("equipment", eq.items);
      }
      return fill;
    },
    dumpInv: async () => {
      const c = await getChar();
      const inv = c?.inventory || scene.character?.inventory;
      console.log("inventory keys", inv && Object.keys(inv));
      console.log("inventory raw", inv);
      console.log("equipment", c?.equipment || c?.equipement || scene.character?.equipment);
      console.log("character keys", c && Object.keys(c));
      return inventoryFill(c);
    },
    rest: restIfNeeded,
    stats: () => (console.table(stats), { ...stats }),
    CFG,
    version: "1.0.0-api-farm",
  };

  console.log(
    "%c✅ GLApi v1 — marche client + combat FULL API + sell@85%\n" +
      "  GLApi.start() / stop() / next() / farm(5)\n" +
      "  GLApi.inv() / sell(true) / stats()",
    "color:#0f8;font-weight:bold"
  );
})();
