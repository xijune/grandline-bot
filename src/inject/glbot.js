/**
 * GrandLine Online - GLBot / GLApi v1.4.0
 * Moteur d'automatisation FULL API & Mini-HUD In-Game (F2)
 *
 * Architecture :
 *   • Déplacement carte : BFS local client (scene.moveLocal) vers les packs
 *   • Combat : 100% API REST (/api/battles/start, engage, move, action, end-turn)
 *   • Repos : 100% API REST (/api/world/rest) — NAVIRE (CD 10 min) ou BELLE_ETOILE (aucun CD, gratuit)
 *   • Vente junk : 100% API (/api/economy/sell) si sac >= 85% plein (whitelist stricte, rations protégées)
 *   • Anti-blocage : gestion popups automatique (continuer/level-up) & backoff 429
 *   • Mini-HUD Flottant : interactif, draggable, raccourci F2 pour afficher/masquer
 *
 * Utilisation en console F12 :
 *   GLBot.start()           // Démarre la boucle continue
 *   GLBot.stop()            // Arrête la boucle
 *   GLBot.next()            // Exécute 1 cycle complet (marche + combat API)
 *   GLBot.farm(5)           // Enchaîne N combats
 *   GLBot.rest()            // Lance un repos API si nécessaire
 *   GLBot.sell(true)        // Force la vente du junk
 *   GLBot.inv()             // Affiche le sac et les slots
 *   GLBot.stats()           // Affiche les métriques de combat & gains
 *   GLBot.toggleHud()       // Affiche / masque le Mini-HUD
 */
(() => {
  "use strict";

  const scene = window.__grandlineScene;
  if (!scene) {
    console.error("%c[GLBot] ❌ window.__grandlineScene introuvable. Entre d'abord en jeu sur GrandLine Online !", "color:#f87171;font-weight:bold");
    return;
  }

  const API = "https://api.grandline-online.fr";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dist = (a, b) =>
    Math.abs((a?.x ?? 0) - (b?.x ?? 0)) + Math.abs((a?.y ?? 0) - (b?.y ?? 0));
  const kxy = (x, y) => `${x},${y}`;

  // ============================================================
  // CONFIGURATION
  // ============================================================
  const CFG = Object.assign(
    {
      // Combat & Survie
      FLEE_HP_PCT: 0.15,
      KITE_MARGIN: 2,
      NEVER_MELEE_IF_RANGED: true,
      MIN_EFFICIENCY: 6,
      FINISHER: 10000,

      // Timings API
      POLL_MS: 140,
      MOVE_MS: 180,
      ACT_MS: 120,
      END_MS: 180,
      RATE_MIN_MS: 40,
      RATE_429_BASE_MS: 800,
      RATE_429_MAX_MS: 8000,

      // Déplacement carte
      WALK_SLICE: 16,
      WALK_CHUNK_MS: 70,
      BFS_LIMIT: 16000,
      APPROACH_OK_D: 4,        // Portée de lancement combat API
      APPROACH_GIVEUP_D: 80,   // Distance max pour marcher vers un pack

      // Cibles & Blacklist
      MAX_LEVEL_DELTA: 99,
      BLACKLIST_MS: 8000,
      RESPAWN_FALLBACK_MS: 45000,
      NO_PACK_WAIT_MS: 1600,
      BETWEEN_FIGHTS_MS: 280,
      BATTLE_TIMEOUT_MS: 150000,

      // Repos & Économie (Règles officielles vérifiées)
      REST_HP_PCT: 0.85,       // Se reposer uniquement si HP < 85%
      SELL_THRESHOLD: 0.85,    // Vendre uniquement si sac >= 85% plein
      STACK_MAX: 20,           // Taille pile serveur

      // Whitelist stricte des objets vendus (JAMAIS de rations, kits de réparation ou équipements)
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
      HUD_ENABLED: true,
    },
    window.__glBotCfg || window.__glApiCfg || {}
  );

  // ============================================================
  // ÉTAT & STATISTIQUES
  // ============================================================
  const stats = {
    startedAt: Date.now(),
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
    lastAction: "Initialisé",
  };

  let TOKEN = "";
  let CHAR_ID = null;
  let farming = false;
  let busy = false;
  let activeCombat = false;
  const blacklist = new Map();

  const log = (...a) => {
    if (CFG.VERBOSE) {
      console.log("%c[GLBot]", "color:#38bdf8;font-weight:bold", ...a);
    }
  };

  // ============================================================
  // GESTION DU TOKEN D'AUTHENTIFICATION & RATE LIMIT
  // ============================================================
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
    return sessionStorage.getItem("grandline-token") || localStorage.getItem("grandline-token") || TOKEN;
  }

  let _apiLast = 0;
  let _apiBackoff = 0;
  const _rateKey = "glbot_rate_until";

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

  async function api(method, path, body, opts = {}) {
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
        await sleep(300 + attempt * 200);
        if (attempt === retries) return { status: 0, ok: false, data: { error: String(e) } };
        continue;
      }
      _apiLast = Date.now();

      if (r.status !== 429) {
        return { status: r.status, ok: r.ok, data };
      }

      // Backoff intelligent HTTP 429
      let ra = 0;
      try {
        const h = r.headers.get("retry-after");
        if (h) ra = parseFloat(h) * (parseFloat(h) < 100 ? 1000 : 1);
      } catch {}
      const base = CFG.RATE_429_BASE_MS || 1500;
      const max = CFG.RATE_429_MAX_MS || 10000;
      const backoff = Math.min(max, ra || base * Math.pow(1.5, attempt) + Math.random() * 300);
      _apiBackoff = backoff;
      sharedRateSet(backoff);
      log(`⚠️ 429 Rate Limit [${method} ${path}] — pause ${Math.round(backoff)}ms`);
      await sleep(backoff);
    }
    return { status: 429, ok: false, data: { error: "rate limited" } };
  }

  async function ensureChar() {
    if (CHAR_ID) return CHAR_ID;
    if (scene.character?.id) {
      CHAR_ID = scene.character.id;
      sessionStorage.setItem("__autoCharId", CHAR_ID);
      return CHAR_ID;
    }
    const r = await api("GET", "/api/characters");
    const list = Array.isArray(r.data) ? r.data : r.data?.characters || [];
    CHAR_ID = list[0]?.id || sessionStorage.getItem("__autoCharId") || null;
    if (CHAR_ID) sessionStorage.setItem("__autoCharId", CHAR_ID);
    return CHAR_ID;
  }

  async function getChar() {
    await ensureChar();
    let r = await api("GET", "/api/characters");
    let list = Array.isArray(r.data) ? r.data : r.data?.characters || [];
    let apiChar = list.find((c) => c.id === CHAR_ID) || list[0] || null;

    if (CHAR_ID) {
      const r2 = await api("GET", `/api/characters/${CHAR_ID}`);
      if (r2.ok && r2.data && (r2.data.inventory || r2.data.id)) {
        apiChar = r2.data.inventory ? r2.data : { ...apiChar, ...r2.data };
      }
    }

    // Garde scene.character synchronisé pour l'affichage visuel
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
    const id = scene.character?.id || CHAR_ID;
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
      if (typeof scene.movementBlocked === "function") {
        return !!scene.movementBlocked(x, y);
      }
      if (scene.movementBlocked?.has) {
        return scene.movementBlocked.has(`${x}:${y}`);
      }
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
          const x = tx + dx, y = ty + dy;
          if (!blocked(x, y)) return { x, y };
        }
      }
    }
    return { x: tx, y: ty };
  }

  // ============================================================
  // PATHFINDING & DÉPLACEMENT LOCAL CARTE
  // ============================================================
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
      if (chunk.length < 2) break;
      try {
        await scene.moveLocal(chunk, null, { courir: true, redresser: true });
      } catch {
        try {
          await scene.moveLocal(chunk.slice(0, 3), null, { courir: true, redresser: true });
        } catch {}
      }
      await sleep(CFG.WALK_CHUNK_MS);
    }
    const endPos = playerPos();
    const ok = Math.abs(endPos.x - goal.x) + Math.abs(endPos.y - goal.y) <= 2;
    if (!ok) stats.walkFails++;
    return ok;
  }

  // ============================================================
  // GESTION DES PACKS DE FAUNE (MONSTRES)
  // ============================================================
  function faunaState() {
    return (
      scene.network?.fauna ||
      scene.fauna ||
      scene.network?.world?.fauna ||
      {}
    );
  }

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

    return false;
  }

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
    const list = raw
      .map((p) => {
        if (!p?.id) return null;
        if (isPackUnavailable(p.id, now)) return null;

        const st = (p.statut || p.status || p.state || "").toString().toLowerCase();
        if (/mort|dead|respawn|cooldown|down/i.test(st)) return null;
        if (p.respawnAt && Number(p.respawnAt) > now) return null;

        const mobs = p.mobs || p.members || [];
        if (Array.isArray(mobs) && mobs.length === 0) return null;
        const alive = mobs.filter((m) => (m.hp ?? m.currentHp ?? 1) > 0);
        if (mobs.length && alive.length === 0) return null;

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
    return list;
  }

  // ============================================================
  // IA DE COMBAT TIREUR & CALCUL DE TOURS (DOFUS-LIKE)
  // ============================================================
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
    let x0 = from.x, y0 = from.y, x1 = to.x, y1 = to.y;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
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

  function decide(s, banned = new Set()) {
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
    const hpPct = (me.hp || 0) / Math.max(me.maxHp || 1, 1);

    if (hpPct < CFG.FLEE_HP_PCT && actions.some((a) => a.kind === "FUITE")) {
      return { type: "flee", reason: `FUITE HP critique ${Math.round(hpPct * 100)}%` };
    }

    // 1. KITE si classe à distance et ennemi trop proche
    if (ranged && inDanger && mp > 0 && reachable.length) {
      let best = null;
      for (const c of reachable) {
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
      if (ranged && inDanger && mp > 0 && reachable.length) {
        let best = null;
        for (const c of reachable) {
          const dMin = Math.min(...enemies.map((e) => dist(c, e.pos)));
          if (dMin > curMin && (!best || dMin > best.d)) best = { cell: c, d: dMin };
        }
        if (best) {
          return {
            type: "move",
            cell: { x: best.cell.x, y: best.cell.y },
            reason: `AP0 KITE ${curMin}→${best.d}`,
          };
        }
      }
      return { type: "endturn", reason: `AP=0 d=${curMin}` };
    }

    // 2. Meilleure attaque ou compétence à portée
    let best = null;
    for (const a of actions) {
      if (a.kind === "FUITE" || a.kind === "GARDE") continue;
      if (CFG.NEVER_MELEE_IF_RANGED && ranged && a.kind === "ATTAQUE") continue;
      const range = actionRange(a);
      const minR = actionMinRange(a);
      const pa = actionPa(a);
      if (pa > ap) continue;
      const needsSight = a.kind !== "ATTAQUE" && (a.geometry?.needsSight !== false || range > 1);

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
            reason: `${a.name || a.kind}→${en.name} d=${en.d} ~${Math.round(dmg)}${isKill ? " 🎯 KILL" : ""}`,
          };
        }
      }
    }
    if (best) return best;

    // 3. Poursuite si trop loin
    if (mp > 0 && reachable.length && curMin > maxR) {
      let approach = null;
      for (const c of reachable) {
        const dMin = Math.min(...enemies.map((e) => dist(c, e.pos)));
        if (ranged && dMin < safe) continue;
        const score = -dMin * 30 + (dMin < curMin ? 80 : 0);
        if (!approach || score > approach.score) approach = { cell: c, score, d: dMin };
      }
      if (approach && approach.d < curMin) {
        return {
          type: "move",
          cell: { x: approach.cell.x, y: approach.cell.y },
          reason: `CHASE ${curMin}→${approach.d}`,
        };
      }
    }

    return { type: "endturn", reason: `idle d=${curMin} ap=${ap} mp=${mp}` };
  }

  async function executeCombatAction(bid, decision) {
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

  // ============================================================
  // NETTOYAGE DES POPUPS UI (Continuer / Level-up / Victoire)
  // ============================================================
  async function closePopups() {
    const blob = (document.body?.innerText || "").slice(0, 4000);
    const need = /continuer|monte[s]?\s+de\s+niveau|level\s*up|niveau supérieur|victoire|défaite|récompenses/i.test(blob);
    if (!need) return;

    for (let i = 0; i < 3; i++) {
      const buttons = [...document.querySelectorAll("button, [role=button]")];
      const btn = buttons.find((b) => {
        const tx = (b.innerText || b.textContent || "").trim();
        return /^(continuer|ok|super|génial|parfait|suivant)$/i.test(tx);
      });
      if (!btn) break;
      try {
        btn.click();
        log("Fermeture popup:", (btn.innerText || "").trim());
      } catch {}
      await sleep(280);
    }
  }

  // ============================================================
  // GESTION INVENTAIRE & VENTE JUNK (WHITELIST STRICTE)
  // ============================================================
  function takesNoBagSlot(id, name) {
    const s = (id + " " + (name || "")).toLowerCase();
    const list = [
      "log-pose",
      "notebook",
      "vivre-card",
      "menottes",
      "carnet-de-fouilles"
    ];
    if (list.includes(id)) return true;
    return /log-?pose|carnet de fouilles|notebook|vivre\s*card|menottes/i.test(s);
  }

  function slotsFor(it) {
    const id = it.id;
    if (takesNoBagSlot(id, it.name)) return 0;
    const q = Math.max(0, Number(it.quantity ?? it.qty ?? 1) || 0);
    if (q <= 0) return 0;
    const max = Number(it.maxStack || it.stackMax || CFG.STACK_MAX || 20) || 20;
    return Math.max(1, Math.ceil(q / max));
  }

  function isJunkId(id, name) {
    if (!id) return false;
    const list = CFG.SELL_JUNK || [];
    return list.includes(id) || (name && list.includes(name));
  }

  function parseInv(inv) {
    if (!inv) return null;
    let raw = [];
    if (Array.isArray(inv)) raw = inv;
    else if (Array.isArray(inv.items)) raw = inv.items;
    else if (Array.isArray(inv.bag)) raw = inv.bag;

    const items = raw
      .filter((it) => it && it.id && (Number(it.quantity ?? it.qty ?? 1) || 0) > 0)
      .map((it) => {
        const quantity = Number(it.quantity ?? it.qty ?? 1) || 1;
        const row = { id: it.id, name: it.name || it.id, quantity };
        row.slots = slotsFor(row);
        return row;
      });

    const cap = Number(inv.bagCapacity || inv.capacity || inv.maxSlots || 24) + Number(inv.bonusCapacity || 0);
    const usedSlots = items.reduce((s, it) => s + slotsFor(it), 0);
    const sumQty = items.reduce((s, it) => s + it.quantity, 0);
    return { items, cap, usedSlots, sumQty };
  }

  async function inventoryFill() {
    const c = await getChar();
    const parsed = parseInv(c?.inventory) || parseInv(scene.character?.inventory) || { items: [], cap: 24, usedSlots: 0, sumQty: 0 };
    const junk = parsed.items.filter((it) => isJunkId(it.id, it.name));
    return {
      used: parsed.usedSlots,
      cap: parsed.cap,
      pct: parsed.cap > 0 ? parsed.usedSlots / parsed.cap : 0,
      items: parsed.items,
      junk,
      junkSlots: junk.length,
    };
  }

  async function sellIfNearFull(force = false) {
    const fill = await inventoryFill();
    const th = CFG.SELL_THRESHOLD ?? 0.85;
    if (!force && fill.pct < th) return { skipped: true, ...fill };

    const C = await ensureChar();
    const fresh = await api("GET", "/api/characters");
    const list = Array.isArray(fresh.data) ? fresh.data : fresh.data?.characters || [];
    const apiChar = list.find((x) => x.id === C) || list[0];
    const apiItems = apiChar?.inventory?.items || [];
    const junkRows = apiItems.filter((it) => isJunkId(it.id, it.name) && (Number(it.quantity) || 0) > 0);

    if (!junkRows.length) return { sold: 0, ...fill };
    log(`📦 Vente junk auto (${fill.used}/${fill.cap} slots, ${Math.round(fill.pct * 100)}%)`);

    let sold = 0;
    let berries = 0;
    for (const it of junkRows) {
      let left = Number(it.quantity) || 0;
      while (left > 0) {
        const chunk = Math.min(left, CFG.STACK_MAX || 20);
        const r = await api("POST", "/api/economy/sell", {
          characterId: C,
          itemId: it.id,
          quantity: chunk,
        });
        if (r.ok) {
          sold++;
          stats.sells++;
          const paid = r.data?.paid ?? r.data?.total ?? 0;
          berries += paid;
          log(`✅ Vendu ${it.id} x${chunk} (+${paid} ฿)`);
          left -= chunk;
          await sleep(100);
        } else {
          break;
        }
      }
    }
    stats.berriesDelta += berries;
    updateHud();
    return { sold, berries, ...fill };
  }

  // ============================================================
  // REPOS API PUR (Règles officielles vérifiées)
  //   - NAVIRE : Cooldown de 10 min
  //   - BELLE_ETOILE : Aucun cooldown (gratuit, toujours disponible)
  //   - AUBERGE : Payante (strictement évitée)
  // ============================================================
  async function restIfNeeded(force = false) {
    const C = await ensureChar();
    const st = await api("GET", `/api/world/rest/${C}`);
    if (!st.ok || !st.data?.hp) return { skipped: true };

    const hp = st.data.hp.current;
    const max = st.data.hp.max;
    const pct = max > 0 ? hp / max : 1;

    // RÈGLE : Ne JAMAIS se reposer si déjà à >= 85% HP !
    if (!force && pct >= CFG.REST_HP_PCT) {
      return { skipped: true, hp, max, pct };
    }

    log(`💤 Repos nécessaire (HP: ${hp}/${max} - ${Math.round(pct * 100)}%)`);
    updateHudStatus("REPOS EN COURS", "#38bdf8");

    const results = [];
    for (let i = 0; i < 8; i++) {
      const cur = await api("GET", `/api/world/rest/${C}`);
      if (!cur.ok) break;
      const d = cur.data;
      const h = d.hp?.current, m = d.hp?.max;
      if (h != null && m && h / m >= 0.92) break;

      const ship = d.ship || {};
      const rough = d.rough || {};
      const shipCd = (d.freeSleep?.waitMs || 0) > 0 || (ship.waitMs || 0) > 0;
      const shipOk = ship.available && !shipCd && (ship.hpRecovery || 0) > 0;
      const belleOk = rough.available !== false && (rough.hpRecovery || 0) > 0;

      if (!shipOk && !belleOk) break;

      const kinds = shipOk ? ["NAVIRE", "BELLE_ETOILE"] : ["BELLE_ETOILE", "NAVIRE"];
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
          log(`✅ Repos API ${kind} : +${r.data?.hpRecovered} HP`);
          did = true;
          await sleep(300);
          break;
        }
      }
      if (!did) break;
    }

    updateHud();
    return { results };
  }

  // ============================================================
  // COMBAT FULL API SANS UI MODALS
  // ============================================================
  async function fightApi(packId) {
    await ensureChar();
    const before = await getChar();
    const berriesBefore = before?.berries ?? 0;
    const xpBefore = before?.xp ?? 0;

    log(`⚔️ Lancement du combat API contre le pack ${packId}…`);
    updateHudStatus("COMBAT ENGAGÉ", "#ef4444");

    const start = await api("POST", "/api/battles/start", {
      characterId: CHAR_ID,
      fauna: packId,
    });

    if (!start.ok || !start.data?.id) {
      const msg = (start.data?.error || start.data?.message || start.data?.code || "") + "";
      log(`⚠️ Échec start battle [${start.status}]: ${msg}`);
      if (/trop loin/i.test(msg)) {
        blacklist.set(packId, Date.now() + 4000);
        return { error: "too far", retry: true };
      } else if (/n.existe pas|conflit|groupe|pas ici/i.test(msg)) {
        markPackDown(packId, CFG.RESPAWN_FALLBACK_MS || 45000);
        return { error: "missing", retry: false };
      } else {
        markPackDown(packId, 12000);
        return { error: "start_fail", retry: true };
      }
    }

    const bid = start.data.id;
    stats.battles++;
    activeCombat = true;
    log(`⚔️ Combat #${bid} initialisé. Engagement automatique…`);

    // Engagement direct (bypass écran de placement "Prêt")
    const eng = await api("POST", `/api/battles/${bid}/engage`, {
      characterId: CHAR_ID,
    });
    await sleep(80);

    const banned = new Set();
    let lastTurn = "";
    const t0 = Date.now();
    let s =
      (eng.data && (eng.data.tactics || eng.data.fighters) && eng.data) ||
      (start.data && (start.data.tactics || start.data.fighters) && start.data) ||
      null;

    function pickState(data) {
      if (!data) return null;
      if (data.tactics || data.fighters || data.winner != null) return data;
      if (data.battle && (data.battle.tactics || data.battle.fighters)) return data.battle;
      if (data.state && (data.state.tactics || data.state.fighters)) return data.state;
      return null;
    }

    async function refreshState(force = false) {
      try {
        const cs = scene.combatState || scene.network?.battle || scene.battle || null;
        if (cs && (cs.id === bid || cs.battleId === bid) && (cs.tactics || cs.fighters)) {
          if (!force) return cs;
        }
      } catch {}
      const r = await api("GET", `/api/battles/${bid}`);
      if (r.status === 429) return null;
      return pickState(r.data) || r.data || null;
    }

    while (activeCombat && Date.now() - t0 < CFG.BATTLE_TIMEOUT_MS) {
      if (!s || !(s.tactics || s.fighters)) {
        s = await refreshState(true);
        if (!s) {
          await sleep(CFG.POLL_MS || 140);
          continue;
        }
      }

      if (s.winner || s.finished) {
        if (s.winner === "ALLIE") {
          stats.wins++;
          log(`🏆 VICTOIRE Combat #${bid} !`);
        } else {
          stats.losses++;
          log(`💀 DÉFAITE Combat #${bid}`);
        }
        break;
      }

      if (s.tactics?.placementDone === false) {
        const res = await api("POST", `/api/battles/${bid}/end-turn`, { characterId: CHAR_ID });
        s = pickState(res.data) || null;
        await sleep(CFG.END_MS);
        continue;
      }

      const yourTurn =
        s.yourTurn === true ||
        s.tactics?.yourTurn === true ||
        s.activeFighterId === CHAR_ID ||
        s.tactics?.activeFighterId === CHAR_ID;

      if (!yourTurn) {
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
      log(`🎯 Tour action : ${decision.reason || decision.type}`);

      const banKey =
        decision.banKey ||
        (decision.action
          ? `${decision.action.kind}:${decision.action.id}:${decision.enemy?.id}`
          : decision.type);

      if (banned.has(banKey)) {
        const res = await executeCombatAction(bid, { type: "endturn" });
        s = pickState(res.data) || null;
        await sleep(CFG.END_MS);
        continue;
      }

      const res = await executeCombatAction(bid, decision);
      if (res.status === 409) {
        const msg = (res.data?.error || "") + "";
        banned.add(banKey);
        s = pickState(res.data) || null;
        if (/trop pr[eè]s|au moins/i.test(msg)) {
          await sleep(CFG.ACT_MS);
          continue;
        }
        if (/\bPA\b/i.test(msg)) {
          const r2 = await executeCombatAction(bid, { type: "endturn" });
          s = pickState(r2.data) || null;
          await sleep(CFG.END_MS);
        }
        continue;
      }

      // Prochain état reçu directement dans la réponse de l'action
      s = pickState(res.data) || null;
      await sleep(
        decision.type === "move"
          ? CFG.MOVE_MS
          : decision.type === "endturn"
          ? CFG.END_MS
          : CFG.ACT_MS
      );
    }

    activeCombat = false;
    await closePopups();
    markPackDown(packId, CFG.RESPAWN_FALLBACK_MS || 45000);

    await sleep(250);
    const after = await getChar();
    const berriesAfter = after?.berries ?? berriesBefore;
    const xpAfter = after?.xp ?? xpBefore;
    const bDelta = berriesAfter - berriesBefore;
    const xDelta = xpAfter - xpBefore;
    stats.berriesDelta += bDelta;
    stats.xpDelta += xDelta;

    if (bDelta > 0 || xDelta > 0) {
      log(`💰 Récompenses : +${bDelta} ฿ | +${xDelta} XP`);
    }

    await sellIfNearFull(false);
    await restIfNeeded(false);
    await closePopups();
    updateHud();

    return {
      bid,
      winner: s?.winner || "done",
      berriesDelta: bDelta,
      xpDelta: xDelta,
    };
  }

  // ============================================================
  // CYCLE UNIQUE (MARCHE VERS LE PACK + COMBAT API)
  // ============================================================
  async function next() {
    if (busy) return { error: "busy" };
    busy = true;
    try {
      const list = packs();
      if (!list.length) {
        log("🔍 Aucun pack de faune valide détecté aux alentours");
        updateHudStatus("EN ATTENTE DE SPAWN", "#94a3b8");
        return { error: "no pack" };
      }

      const tgt = list[0];
      const targetLabel = `${tgt.especes?.join("/") || "Monstre"} n${tgt.maxLvl}`;
      updateHudTarget(`${targetLabel} (${tgt.d}m)`);

      let dNow = tgt.d;
      if (dNow > CFG.APPROACH_GIVEUP_D) {
        log(`Pack ${tgt.id} trop éloigné (${dNow}m), ignoré temporairement`);
        blacklist.set(tgt.id, Date.now() + 5000);
        return { error: "too far", retry: true, d: dNow };
      }

      // Marche vers le monstre si hors de portée API (d > 4)
      if (dNow > CFG.APPROACH_OK_D) {
        log(`🚶 Marche vers ${targetLabel} @(${tgt.ox},${tgt.oy}) [dist: ${dNow}m]`);
        updateHudStatus("DÉPLACEMENT", "#38bdf8");
        await walkTo(tgt.ox, tgt.oy);
        const pl = playerPos();
        dNow = Math.abs(tgt.ox - pl.x) + Math.abs(tgt.oy - pl.y);
        await sleep(120);
      }

      if (dNow > CFG.APPROACH_OK_D + 4) {
        await walkTo(tgt.ox, tgt.oy);
        const pl2 = playerPos();
        dNow = Math.abs(tgt.ox - pl2.x) + Math.abs(tgt.oy - pl2.y);
      }

      if (dNow > 12) {
        blacklist.set(tgt.id, Date.now() + 3000);
        return { error: "too far", retry: true, d: dNow };
      }

      return await fightApi(tgt.id);
    } finally {
      busy = false;
    }
  }

  // ============================================================
  // BOUCLE DE FARM CONTINUE
  // ============================================================
  async function start() {
    if (farming) return log("Le farm est déjà actif");
    farming = true;
    const pl = playerPos();
    log(`▶ DÉMARRAGE FARM API v1.4.0 — Carte: ${pl.mapId || "Actuelle"} | Niveau: ${pl.level}`);
    updateHudStatus("FARM EN COURS", "#22c55e");

    while (farming) {
      try {
        const r = await next();
        if (r?.error === "no pack") await sleep(CFG.NO_PACK_WAIT_MS);
        else if (r?.error === "missing") await sleep(600);
        else if (r?.retry || r?.error === "too far") await sleep(250);
        else await sleep(CFG.BETWEEN_FIGHTS_MS);
      } catch (e) {
        console.error("[GLBot] Erreur dans la boucle principale:", e);
        await sleep(2000);
      }
    }
    log("■ Farm arrêté");
    updateHudStatus("ARRÊTÉ", "#ef4444");
  }

  function stop() {
    farming = false;
    activeCombat = false;
    log("Arrêt demandé par l'utilisateur");
    updateHudStatus("ARRÊTÉ", "#ef4444");
  }

  async function farm(n = 5) {
    const out = [];
    log(`── Démarrage de ${n} combats consécutifs ──`);
    for (let i = 0; i < n; i++) {
      if (!farming && i > 0 && busy === false) {
        // Permet l'interruption
      }
      log(`── Combat ${i + 1}/${n} ──`);
      const r = await next();
      out.push(r);
      if (r?.error === "no pack") await sleep(CFG.NO_PACK_WAIT_MS);
      else if (r?.retry) await sleep(150);
      else await sleep(CFG.BETWEEN_FIGHTS_MS);
    }
    console.table(out);
    return out;
  }

  // ============================================================
  // MINI-HUD IN-GAME FLOTTANT (Raccourci F2, Draggable)
  // ============================================================
  function updateHudStatus(txt, color = "#22c55e") {
    const el = document.getElementById("glbot-hud-status");
    if (el) {
      el.innerText = txt;
      el.style.color = color;
      el.style.background = `${color}22`;
    }
  }

  function updateHudTarget(txt) {
    const el = document.getElementById("glbot-hud-target");
    if (el) el.innerText = txt;
  }

  function updateHud() {
    if (!CFG.HUD_ENABLED || typeof document === "undefined") return;
    const hud = document.getElementById("glbot-hud");
    if (!hud) return;

    // HP live
    const c = scene.character;
    const domHp = document.querySelector("b.coeur-pv")?.textContent?.trim();
    const curHp = domHp && /^\d+$/.test(domHp) ? parseInt(domHp, 10) : (c?.currentHp ?? c?.hp ?? 0);
    const maxHp = c?.maxHp ?? c?.maxHP ?? c?.hpMax ?? Math.max(curHp, 1);
    const hpRatio = Math.max(0, Math.min(1, maxHp > 0 ? curHp / maxHp : 1));

    const hpTxt = document.getElementById("glbot-hud-hp-txt");
    const hpBar = document.getElementById("glbot-hud-hp-bar");
    if (hpTxt) hpTxt.innerText = `${curHp} / ${maxHp} (${Math.round(hpRatio * 100)}%)`;
    if (hpBar) {
      hpBar.style.width = `${Math.round(hpRatio * 100)}%`;
      hpBar.style.background = hpRatio < 0.25 ? "#ef4444" : hpRatio < 0.5 ? "#f59e0b" : "#22c55e";
    }

    // Stats
    const wl = document.getElementById("glbot-hud-wl");
    if (wl) wl.innerText = `${stats.wins}V / ${stats.losses}D`;

    const berries = document.getElementById("glbot-hud-berries");
    if (berries) {
      const bTotal = c?.berries ?? 0;
      berries.innerText = `${bTotal} ฿ (+${stats.berriesDelta})`;
    }

    const toggleBtn = document.getElementById("glbot-hud-toggle");
    if (toggleBtn) {
      toggleBtn.innerText = farming ? "⏹ Stopper" : "▶ Démarrer";
      toggleBtn.style.background = farming ? "#ef4444" : "#0284c7";
    }
  }

  function createInGameHud() {
    if (typeof document === "undefined") return;
    const old = document.getElementById("glbot-hud");
    if (old) old.remove();

    const hud = document.createElement("div");
    hud.id = "glbot-hud";
    hud.style.cssText = `
      position: fixed;
      top: 18px;
      right: 18px;
      width: 270px;
      background: rgba(11, 15, 23, 0.95);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(56, 189, 248, 0.4);
      border-radius: 12px;
      padding: 12px 14px;
      z-index: 999999;
      box-shadow: 0 12px 32px rgba(0,0,0,0.75);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #f8fafc;
      font-size: 11px;
      user-select: none;
      transition: all 0.2s ease;
    `;

    hud.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:6px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-weight:800;color:#38bdf8;font-size:12px;">🏴‍☠️ GLBot</span>
          <span style="font-size:9px;color:#94a3b8;background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:4px;">API v1.4</span>
        </div>
        <div style="display:flex;gap:4px;">
          <button id="glbot-hud-min" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 5px;" title="Réduire">−</button>
          <button id="glbot-hud-close" style="background:transparent;border:none;color:#f87171;cursor:pointer;font-size:12px;padding:0 5px;" title="Masquer (F2)">✕</button>
        </div>
      </div>

      <div id="glbot-hud-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span id="glbot-hud-status" style="padding:2px 8px;border-radius:20px;font-weight:700;font-size:9px;background:rgba(239,68,68,0.2);color:#fca5a5;">ARRÊTÉ</span>
          <button id="glbot-hud-toggle" style="background:#0284c7;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-weight:700;cursor:pointer;font-size:10px;">▶ Démarrer</button>
        </div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;">
            <span style="color:#94a3b8;">Santé Joueur</span>
            <strong id="glbot-hud-hp-txt" style="color:#4ade80;">-- / --</strong>
          </div>
          <div style="width:100%;height:6px;background:#1e293b;border-radius:3px;overflow:hidden;">
            <div id="glbot-hud-hp-bar" style="width:100%;height:100%;background:#22c55e;transition:width 0.3s;"></div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;font-size:10px;">
          <div style="background:rgba(255,255,255,0.03);padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.05);">
            <div style="color:#94a3b8;font-size:9px;">Victoires / Défaites</div>
            <strong id="glbot-hud-wl" style="color:#fff;">0V / 0D</strong>
          </div>
          <div style="background:rgba(255,255,255,0.03);padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.05);">
            <div style="color:#94a3b8;font-size:9px;">Berries</div>
            <strong id="glbot-hud-berries" style="color:#facc15;">-- ฿</strong>
          </div>
        </div>

        <div style="font-size:10px;background:rgba(255,255,255,0.02);padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.04);margin-bottom:8px;">
          <span style="color:#94a3b8;">Cible :</span>
          <span id="glbot-hud-target" style="color:#e2e8f0;font-weight:600;margin-left:4px;">Aucune</span>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;font-size:9px;color:#64748b;">
          <span>Raccourci : <strong>F2</strong></span>
          <span style="color:#38bdf8;cursor:pointer;" id="glbot-hud-rest-btn">💤 Se reposer</span>
        </div>
      </div>
    `;

    document.body.appendChild(hud);

    // Événements boutons
    document.getElementById("glbot-hud-toggle")?.addEventListener("click", () => {
      if (farming) stop();
      else start();
    });

    document.getElementById("glbot-hud-rest-btn")?.addEventListener("click", () => {
      restIfNeeded(true);
    });

    let minimized = false;
    document.getElementById("glbot-hud-min")?.addEventListener("click", () => {
      minimized = !minimized;
      const b = document.getElementById("glbot-hud-body");
      if (b) b.style.display = minimized ? "none" : "block";
      const minBtn = document.getElementById("glbot-hud-min");
      if (minBtn) minBtn.innerText = minimized ? "+" : "−";
    });

    document.getElementById("glbot-hud-close")?.addEventListener("click", () => {
      hud.style.display = "none";
    });

    updateHud();
  }

  function toggleHud() {
    const hud = document.getElementById("glbot-hud");
    if (!hud) {
      createInGameHud();
      return;
    }
    hud.style.display = hud.style.display === "none" ? "block" : "none";
    updateHud();
  }

  // Écouteur touche F2
  window.addEventListener("keydown", (e) => {
    if (e.key === "F2") {
      e.preventDefault();
      toggleHud();
    }
  });

  // ============================================================
  // EXPOSITION GLOBALE
  // ============================================================
  const botAPI = {
    start,
    stop,
    next,
    farm,
    walkTo,
    packs,
    fightApi,
    sell: sellIfNearFull,
    rest: restIfNeeded,
    inv: inventoryFill,
    stats: () => (console.table(stats), { ...stats }),
    createInGameHud,
    toggleHud,
    CFG,
    version: "1.4.0-api-farm",
  };

  window.GLBot = botAPI;
  window.GLApi = botAPI;
  window.GL = botAPI;

  if (CFG.HUD_ENABLED) {
    createInGameHud();
  }

  console.log(
    "%c✅ [GLBot v1.4.0] Prêt ! (Marche client + Combat FULL API + Repos vérifié)\n" +
    "  • GLBot.start()  : Démarrer le farm automatique\n" +
    "  • GLBot.stop()   : Arrêter le bot\n" +
    "  • GLBot.farm(5)  : Enchaîner 5 combats\n" +
    "  • GLBot.rest()   : Forcer un repos API (Navire / Belle Étoile)\n" +
    "  • Touche F2      : Afficher / Masquer le Mini-HUD",
    "color:#38bdf8;font-weight:bold"
  );
})();
