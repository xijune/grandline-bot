/**
 * GrandLine Combat Module v2.2.0
 * Combat API pure — optimisé 0 dégâts (kite avant attaque)
 *
 * Savoir live intégré (31/10–02/11/2026) :
 * - ATTAQUE range 1 serveur ; techniques = geometry.range
 * - characterId obligatoire ; estimates {min,max,critMin,critMax}
 * - Score = avgEst/PA ; focus fire anti-combo multi-mobs
 * - Kite PRIORITAIRE si threatened (avant toute attaque) — 0 dmg
 * - sweet = min(myRange, max(4, enemyPM + enemyRange + margin))
 * - GARDE → status 1 tour ; jamais re-GARDE si déjà actif
 * - LOS Bresenham ; 409 LOS/garde → ban action + side-step / endturn
 * - yourTurn TOP-LEVEL ; action.kind obligatoire
 * - Rest BELLE_ETOILE ; fightQuest(objectifId)
 *
 * Usage (console F12 en jeu) :
 *   GLCombat.arm()                      // auto-fight FAUNE + PvP
 *   GLCombat.fight(battleId)
 *   GLCombat.challenge(targetCharId)    // PvP agressif (lvl >= 30)
 *   GLCombat.join(battleId)             // rejoindre duel / battle ouverte
 *   GLCombat.fightQuest('campagne:pw1-miliciens')
 *   GLCombat.walkToPack(packId)
 *   GLCombat.stats()
 *   GLCombat.stop()
 *
 * PvP : meme boucle engage/move/action/end-turn ; ennemis = team adverse.
 */
(async function () {
  "use strict";

  const API = "https://api.grandline-online.fr";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const key = (c) => `${c.x}:${c.y}`;

  function findToken() {
    const c = [];
    if (window.__freshToken) c.push(window.__freshToken);
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const v = sessionStorage.getItem(sessionStorage.key(i));
        if (v && v.split(".").length === 3 && v.length > 100) c.push(v);
      }
    } catch {}
    for (const t of c) {
      try {
        const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (p.exp > Date.now() / 1000) return t;
      } catch {}
    }
    return sessionStorage.getItem("grandline-token");
  }

  let TOKEN = findToken();
  let CHAR_ID =
    sessionStorage.getItem("__autoCharId") ||
    window.__grandlineScene?.character?.id ||
    null;

  async function api(method, path, body) {
    TOKEN = TOKEN || findToken();
    const r = await fetch(API + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(TOKEN ? { authorization: "Bearer " + TOKEN } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await r.json().catch(() => null);
    return { status: r.status, ok: r.ok, data };
  }

  async function getCharApi() {
    const r = await api("GET", "/api/characters");
    const list = r.data?.characters || r.data;
    const c = Array.isArray(list) ? list.find((x) => x.id === CHAR_ID) || list[0] : r.data;
    return c;
  }

  async function ensureChar() {
    if (CHAR_ID) return CHAR_ID;
    const c = await getCharApi();
    CHAR_ID = c?.id || window.__grandlineScene?.character?.id;
    if (CHAR_ID) sessionStorage.setItem("__autoCharId", CHAR_ID);
    return CHAR_ID;
  }

  const CFG = Object.assign(
    {
      FLEE_HP_PCT: 0.15,
      GUARD_HP_PCT: 0.18,
      GUARD_PA_COST: 0,
      SAFE_DIST_MARGIN: 1,
      KITE_MELEE_ENABLED: true,
      KITE_BEFORE_ATTACK: true, // 0 dmg : reculer AVANT de tirer si threatened
      NEVER_MELEE_IF_RANGED: true, // ignore ATTAQUE range 1 si TIREUR
      PREFER_KILL_COUNT: true,
      AVOID_HAZARDS: true,
      LOS_CHECK: true,
      FINISHER_WEIGHT: 10000,
      FINISHER_2T_WEIGHT: 400,
      FOCUS_LOW_HP_WEIGHT: 220,
      MULTI_KILL_PRIORITY: 350,
      MIN_EFFICIENCY: 6,
      POLL_MS: 260,
      MOVE_DELAY_MS: 360,
      ACT_DELAY_MS: 240,
      AUTO_REST: true,
      MIN_HP_TO_FIGHT: 0.35, // refuse combat / rest si HP < 35%
      ALLOW_PAID_REST: false, // true = auberge si free cap atteint et HP critique
      // PvP
      PVP_AUTO: true,          // arm() prend aussi challenge/join/opened
      PVP_MAX_TICKS: 200,      // duels plus longs que la faune
      PVP_FLEE_HP_PCT: 0.12,   // fuite un peu plus tard en PvP
      VERBOSE: true
    },
    window.__glCombatCfg || {}
  );

  const stats = {
    battles: 0,
    wins: 0,
    losses: 0,
    turns: 0,
    casts: 0,
    moves: 0,
    guards: 0,
    flees: 0,
    dmgDealt: 0,
    dmgTaken: 0,
    berriesDelta: 0,
    crits: 0
  };
  let active = false;

  function log(...a) {
    if (CFG.VERBOSE) console.log("[GLCombat]", ...a);
  }

  function detectArchetype(me) {
    if (me?.armeDeTir) return "RANGED";
    const maxR = Math.max(
      1,
      ...(me?.techniques || []).map((t) => t.range ?? t.geometry?.range ?? 1)
    );
    if (maxR >= 4) return "RANGED";
    if (maxR <= 2) return "MELEE";
    return "HYBRID";
  }

  function enemyMaxRange(e) {
    let m = 1;
    for (const t of e.techniques || []) {
      const r = t.geometry?.range ?? t.range ?? 1;
      if (typeof r === "number" && r > m) m = r;
    }
    return m;
  }

  function avgEst(est) {
    if (!est) return 0;
    let d = (est.min + est.max) / 2;
    if (est.critMin != null && est.critMax != null)
      d = d * 0.85 + ((est.critMin + est.critMax) / 2) * 0.15;
    return d;
  }

  function actionRange(a) {
    if (a.geometry?.range != null) return a.geometry.range;
    if (a.range != null) return a.range;
    if (a.kind === "ATTAQUE") return 1;
    return 1;
  }

  function needsSight(a) {
    return !!(a.geometry?.needsSight);
  }

  /** Bresenham LOS against obstacle set */
  function hasLOS(from, to, obstacleSet) {
    if (!from || !to) return false;
    if (!obstacleSet || !obstacleSet.size) return true;
    let x0 = from.x,
      y0 = from.y,
      x1 = to.x,
      y1 = to.y;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
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

  function myMaxRange(actions) {
    let m = 1;
    for (const a of actions) {
      if (a.kind === "FUITE" || a.kind === "GARDE") continue;
      if (a.usable === false || a.locked) continue;
      m = Math.max(m, actionRange(a));
    }
    return m;
  }

  function sweetSpot(enemies, myRange) {
    if (!enemies.length) return myRange;
    const maxPM = Math.max(...enemies.map((e) => e.caracs?.pm ?? 3));
    const maxER = Math.max(...enemies.map((e) => enemyMaxRange(e)));
    // hors de portée ennemi, mais encore dans notre range de tir
    const safe = Math.max(4, maxPM + maxER + CFG.SAFE_DIST_MARGIN);
    return Math.min(myRange, safe);
  }

  function hasStatus(fighter, id) {
    return (fighter?.statuses || []).some(
      (s) => s.id === id || s.kind === id || /garde/i.test(String(s.id || s.kind || ""))
    );
  }

  function actionPa(a) {
    if (a?.kind === "GARDE" || a?.kind === "FUITE") return 0;
    if (a?.kind === "ATTAQUE") return Math.max(2, a.pa ?? a.cost ?? 2);
    if (a?.pa != null) return a.pa;
    if (a?.cost != null) return a.cost;
    return 99;
  }

  function parseLogDelta(log, meId, fromSeq) {
    const events = (log || []).filter((e) => (e.seq ?? 0) >= (fromSeq ?? 0));
    let dealt = 0,
      taken = 0,
      crits = 0;
    for (const e of events) {
      if (e.type === "DAMAGE") {
        if (e.actorId === meId) {
          dealt += e.amount || 0;
          if (e.critical) crits++;
        }
        if (e.targetId === meId) taken += e.amount || 0;
      }
    }
    return { dealt, taken, crits, events };
  }

  function isMyTurn(s) {
    const meId = s.you || CHAR_ID;
    // Live API : yourTurn est TOP-LEVEL (validé 01/11/2026)
    if (s.yourTurn === true) return true;
    if (s.activeFighterId && s.activeFighterId === meId) return true;
    if (s.tactics?.yourTurn === true) return true;
    return false;
  }

  function decide(s, me) {
    const meId = s.you || CHAR_ID;
    const tactics = s.tactics || {};
    const positions = tactics.positions || {};
    const myPos = positions[meId];
    if (!myPos) return { type: "endturn", reason: "no myPos" };

    const ap = tactics.ap ?? s.ap ?? 6;
    const mp = tactics.mp ?? s.mp ?? 3;
    const actions = (s.actions || []).filter((a) => a.usable !== false && !a.locked);
    const obstacleSet = new Set((tactics.obstacles || []).map((o) => `${o.x}:${o.y}`));
    const hazardSet = new Set((tactics.hazards || []).map((h) => `${h.x}:${h.y}`));

    // FAUNE + PvP : adversaires = autre equipe que la notre
    const myTeam =
      (s.fighters || []).find((f) => f.id === meId)?.team ||
      s.myTeam ||
      "ALLIE";
    const enemies = (s.fighters || [])
      .filter(
        (f) =>
          f.id !== meId &&
          (f.hp || 0) > 0 &&
          (f.team === "ENNEMI" ||
            (f.team && f.team !== myTeam) ||
            (!f.team && f.id !== meId))
      )
      .map((f) => ({
        ...f,
        pos: positions[f.id],
        d: positions[f.id] ? dist(myPos, positions[f.id]) : 99
      }))
      .filter((f) => f.pos);

    if (!enemies.length) return { type: "endturn", reason: "no enemies" };

    const hpPct = (me.hp || 0) / Math.max(me.maxHp || 1, 1);
    const maxR = myMaxRange(actions);
    const sweet = sweetSpot(enemies, maxR);
    const curMin = Math.min(...enemies.map((e) => e.d));
    const multi = enemies.length >= 2;
    const allMelee = enemies.every((e) => enemyMaxRange(e) <= 1);
    const arch = detectArchetype(me);
    const threatened = enemies.some(
      (e) => e.d <= (e.caracs?.pm ?? 3) + enemyMaxRange(e)
    );
    const guarded = hasStatus(me, "GARDE");
    const ranged = arch === "RANGED" || maxR >= 4;

    log(
      `AP=${ap} PM=${mp} dist=${curMin} sweet=${sweet} multi=${multi} arch=${arch} thr=${threatened} hp=${Math.round(hpPct * 100)}%`
    );

    // Emergency flee
    const isPvp = !!(
      s.pvp ||
      s.kind === "PVP" ||
      s.type === "PVP" ||
      (s.fighters || []).some((f) => f.playerId || f.isPlayer || f.type === "PLAYER")
    );
    const fleePct = isPvp ? (CFG.PVP_FLEE_HP_PCT ?? CFG.FLEE_HP_PCT) : CFG.FLEE_HP_PCT;
    if (hpPct < fleePct && actions.some((a) => a.kind === "FUITE")) {
      return {
        type: "flee",
        reason: `FUITE ${Math.round(hpPct * 100)}%${isPvp ? " (pvp)" : ""}`,
      };
    }

    // Guard : une seule fois, HP bas, collé, pas déjà en garde
    if (
      hpPct < CFG.GUARD_HP_PCT &&
      threatened &&
      !guarded &&
      curMin <= 1 &&
      actions.some((a) => a.kind === "GARDE")
    ) {
      return { type: "guard", reason: `GARDE ${Math.round(hpPct * 100)}%` };
    }

    const reachable = (tactics.reachable || []).filter((c) => (c.cost || 0) <= mp);
    const filtered = reachable.filter((c) => {
      if (CFG.AVOID_HAZARDS && hazardSet.has(key(c))) return false;
      return true;
    });
    const pool = filtered.length ? filtered : reachable;

    // ─── PRIORITÉ 1 : DÉGÂTS utiles AVANT kite (AP ne consomme pas les PM) ───
    // Frapper puis reculer le même tour > pure kite-first (tours sans dmg).
    if (ap > 0) {
      let pre = null;
      for (const a of actions) {
        if (a.kind === "FUITE" || a.kind === "GARDE") continue;
        if (CFG.NEVER_MELEE_IF_RANGED && ranged && a.kind === "ATTAQUE") continue;
        const range = actionRange(a);
        const pa = actionPa(a);
        if (pa > ap) continue;
        const sight = needsSight(a) || (a.kind !== "ATTAQUE" && range > 1);
        for (const en of enemies) {
          if (en.d > range) continue;
          if (CFG.LOS_CHECK && sight && !hasLOS(myPos, en.pos, obstacleSet)) continue;
          const est = a.estimates?.[en.id];
          if (!est && a.kind !== "ATTAQUE") continue;
          const dmg = est ? avgEst(est) : 8;
          const isKill = !!(est && est.max >= en.hp);
          const eff = dmg / Math.max(pa, 1);
          if (eff < CFG.MIN_EFFICIENCY && !isKill) continue;
          // Sous sweet : seulement hits qui valent le coup
          if (ranged && threatened && en.d < sweet) {
            const worth =
              isKill ||
              dmg >= Math.max(25, (en.hp || 50) * 0.2) ||
              dmg >= 15 && en.d > 1;
            if (!worth) continue;
          }
          let score = eff;
          if (isKill) score += CFG.FINISHER_WEIGHT;
          else if (dmg * 2 >= en.hp) score += CFG.FINISHER_2T_WEIGHT;
          score += (1 - en.hp / Math.max(en.maxHp || 1, 1)) * CFG.FOCUS_LOW_HP_WEIGHT;
          if (threatened) score += isKill ? 3000 : 500;
          if (!pre || score > pre.score) {
            pre = {
              type: a.kind === "ATTAQUE" ? "attack" : "cast",
              action: a,
              enemy: en,
              dmg,
              score,
              reason: `${threatened ? "HIT-THEN-KITE " : ""}${a.name}→${en.name} d=${en.d} ~${Math.round(dmg)}${isKill ? " KILL" : ""} pa=${pa}/${ap}`
            };
          }
        }
      }
      if (pre) return pre;
    }

    // ─── PRIORITÉ 2 : KITE si threatened et plus de tir rentable ───
    if (
      CFG.KITE_MELEE_ENABLED &&
      mp > 0 &&
      pool.length &&
      ranged &&
      threatened &&
      curMin < sweet
    ) {
      const cx = enemies.reduce((s, e) => s + e.pos.x, 0) / enemies.length;
      const cy = enemies.reduce((s, e) => s + e.pos.y, 0) / enemies.length;
      const dist0 = Math.abs(myPos.x - cx) + Math.abs(myPos.y - cy);
      let kite = null;
      for (const c of pool) {
        if (c.x === myPos.x && c.y === myPos.y) continue;
        const dMin = Math.min(...enemies.map((e) => dist(c, e.pos)));
        const canShoot = enemies.some((e) => dist(c, e.pos) <= maxR);
        const nSafe = enemies.filter((e) => dist(c, e.pos) >= sweet).length;
        const distC = Math.abs(c.x - cx) + Math.abs(c.y - cy);
        const away = distC - dist0;
        const vx = c.x - myPos.x, vy = c.y - myPos.y;
        const ex = myPos.x - cx, ey = myPos.y - cy;
        const align =
          (vx * ex + vy * ey) /
          (Math.max(1, Math.abs(vx) + Math.abs(vy)) *
            Math.max(1, Math.abs(ex) + Math.abs(ey)));
        let score = 0;
        if (dMin >= sweet && dMin <= maxR) {
          score += 12000 + (3 - Math.abs(dMin - sweet)) * 40;
          if (canShoot) score += 400;
        } else if (dMin >= sweet) score += 6000;
        else score += (dMin - curMin) * 120;
        score += nSafe * 90 + away * 35 + align * 80;
        score -= (c.cost || 0) * 8;
        if (!canShoot) score -= 150;
        if (!kite || score > kite.score + 0.01 || (Math.abs(score - kite.score) < 0.01 && dMin > kite.d))
          kite = { cell: { x: c.x, y: c.y }, score, d: dMin };
      }
      if (kite && kite.d > curMin) {
        return {
          type: "move",
          cell: kite.cell,
          reason: `KITE ${curMin}→${kite.d} (sweet ${sweet})`
        };
      }
    }

    // 0 PA → kite restant ou endturn
    if (ap <= 0) {
      if (ranged && threatened && mp > 0 && pool.length) {
        let kite = null;
        for (const c of pool) {
          const dMin = Math.min(...enemies.map((e) => dist(c, e.pos)));
          if (dMin > curMin && (!kite || dMin > kite.d)) kite = { cell: c, d: dMin };
        }
        if (kite) {
          return { type: "move", cell: kite.cell, reason: `AP0 KITE ${curMin}→${kite.d}` };
        }
      }
      return { type: "endturn", reason: `AP=0 endturn (d=${curMin} mp=${mp})` };
    }

    // ─── PRIORITÉ 2 : actions in-range + LOS ───
    let best = null;
    for (const a of actions) {
      if (a.kind === "FUITE" || a.kind === "GARDE") continue;
      if (CFG.NEVER_MELEE_IF_RANGED && ranged && a.kind === "ATTAQUE") continue;
      const range = actionRange(a);
      const pa = actionPa(a);
      if (pa > ap) continue;
      const sight = needsSight(a) || (a.kind !== "ATTAQUE" && range > 1);

      for (const en of enemies) {
        if (en.d > range) continue;
        if (CFG.LOS_CHECK && sight && !hasLOS(myPos, en.pos, obstacleSet)) continue;

        const est = a.estimates?.[en.id];
        if (!est && a.kind !== "ATTAQUE") continue;
        const dmg = est ? avgEst(est) : 8;
        const eff = dmg / Math.max(pa, 1);
        if (eff < CFG.MIN_EFFICIENCY && !(est && est.max >= en.hp)) continue;

        let score = eff;
        if (est && est.max >= en.hp) score += CFG.FINISHER_WEIGHT;
        else if (dmg * 2 >= en.hp) score += CFG.FINISHER_2T_WEIGHT;
        if (multi && CFG.PREFER_KILL_COUNT) {
          score += CFG.MULTI_KILL_PRIORITY * (1 - en.hp / Math.max(en.maxHp || 1, 1));
          if (est && est.max >= en.hp) score += CFG.MULTI_KILL_PRIORITY;
        } else {
          score += (1 - en.hp / Math.max(en.maxHp || 1, 1)) * CFG.FOCUS_LOW_HP_WEIGHT;
        }
        if (a.kind === "TECHNIQUE") score += 2;
        if (ranged && en.d >= sweet) score += 15;
        if (ranged && en.d < sweet) score -= 25;

        if (!best || score > best.score) {
          best = {
            type: a.kind === "ATTAQUE" ? "attack" : "cast",
            action: a,
            enemy: en,
            dmg,
            score,
            reason: `${a.name}→${en.name} d=${en.d} ~${Math.round(dmg)}${est && est.max >= en.hp ? " KILL" : ""} pa=${pa}/${ap}`
          };
        }
      }
    }
    // Attaque ok même en danger (on kitera au tick suivant avec les PM)
    if (best) return best;

    // ─── PRIORITÉ 3 : approche sweet spot (pas contact) ───
    if (mp > 0 && pool.length) {
      let approach = null;
      for (const c of pool) {
        const dMin = Math.min(...enemies.map((e) => dist(c, e.pos)));
        let score = -Math.abs(dMin - sweet) * 10;
        if (ranged && dMin < sweet - 1) score -= 40;
        if (dMin <= maxR && dMin >= (ranged ? sweet : 1)) score += 30;
        if (!approach || score > approach.score) approach = { cell: c, score, d: dMin };
      }
      if (approach && approach.d !== curMin) {
        return {
          type: "move",
          cell: approach.cell,
          reason: `APPROACH ${curMin}→${approach.d} (sweet ${sweet})`
        };
      }
    }

    if (best) return best;

    // Approach to bring best weapon in range
    if (mp > 0 && pool.length && best === null) {
      // find cell that enables a high-eff attack next
      let approach = null;
      for (const c of pool) {
        for (const a of actions) {
          if (a.kind === "FUITE" || a.kind === "GARDE") continue;
          const range = actionRange(a);
          const pa = a.pa ?? 2;
          for (const en of enemies) {
            const d = dist(c, en.pos);
            if (d > range) continue;
            if (CFG.LOS_CHECK && needsSight(a) && !hasLOS(c, en.pos, obstacleSet)) continue;
            const est = a.estimates?.[en.id];
            const dmg = est ? avgEst(est) : 10;
            let score = dmg / pa;
            // Prefer staying at sweet if possible
            if (allMelee && arch !== "MELEE") {
              if (d >= 4 && d <= sweet + 1) score += 5;
              if (d <= 1) score -= 8; // avoid adjacent
            }
            if (est && est.max >= en.hp) score += 50;
            if (!approach || score > approach.score)
              approach = { cell: c, score, d, reason: `APPROACH for ${a.name} d=${d}` };
          }
        }
      }
      if (approach) {
        return { type: "move", cell: approach.cell, reason: approach.reason };
      }

      // Fallback: step toward nearest
      const en = enemies.sort((a, b) => a.d - b.d)[0];
      let cell = null;
      let bestD = en.d;
      for (const c of pool) {
        const d = dist(c, en.pos);
        if (d < bestD) {
          bestD = d;
          cell = c;
        }
      }
      if (cell) return { type: "move", cell, reason: `CLOSE d=${bestD}` };
    }

    return { type: "endturn", reason: "no action" };
  }

  async function execute(bid, decision) {
    const C = await ensureChar();
    if (decision.type === "flee") {
      stats.flees++;
      return api("POST", `/api/battles/${bid}/action`, { characterId: C, kind: "FUITE" });
    }
    if (decision.type === "guard") {
      stats.guards++;
      return api("POST", `/api/battles/${bid}/action`, { characterId: C, kind: "GARDE" });
    }
    if (decision.type === "move") {
      stats.moves++;
      return api("POST", `/api/battles/${bid}/move`, {
        characterId: C,
        cell: { x: decision.cell.x, y: decision.cell.y }
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
        targetCell: en.pos
      });
    }
    return api("POST", `/api/battles/${bid}/end-turn`, { characterId: C });
  }

  /** État HP fiable (GET rest) — currentHp seul n'a pas de maxHp sur /characters */
  async function restState() {
    const C = await ensureChar();
    const r = await api("GET", `/api/world/rest/${C}`);
    if (!r.ok || !r.data) return null;
    const d = r.data;
    const hp = d.hp?.current ?? d.currentHp ?? null;
    const maxHp = d.hp?.max ?? d.maxHp ?? null;
    return {
      raw: d,
      hp,
      maxHp,
      pct: maxHp ? hp / maxHp : null,
      vitality: d.vitality,
      vitalityMax: d.vitalityMax,
      freeSleep: d.freeSleep,
      ship: d.ship,
      rough: d.rough,
      inn: d.inn,
    };
  }

  /**
   * Repos gratuit : NAVIRE puis BELLE_ETOILE (jamais auberge).
   * Boucle jusqu'à seuil ou plus d'option free dispo.
   * Live 02/11 : BELLE = rough (cap forme), NAVIRE = ship cap.
   */
  async function rest(opts = {}) {
    if (!CFG.AUTO_REST && !opts.force) return { skipped: true };
    const C = await ensureChar();
    const targetPct = opts.targetPct ?? Math.max(CFG.MIN_HP_TO_FIGHT || 0.35, 0.95);
    // Belle first if ship unavailable
    let kinds = opts.kinds || ["NAVIRE", "BELLE_ETOILE"];
    const results = [];
    for (let round = 0; round < (CFG.REST_MAX_ROUNDS || 10); round++) {
      const st = await restState();
      if (!st || st.hp == null || st.maxHp == null) {
        log("REST no state", st);
        break;
      }
      const pct = st.hp / st.maxHp;
      const shipCd = (st.freeSleep?.waitMs || 0) > 0 || (st.ship?.waitMs || 0) > 0;
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
        `REST ${round + 1}`,
        `${st.hp}/${st.maxHp} (${Math.round(pct * 100)}%)`,
        `belle=+${belleGain}`,
        `ship=+${shipGain}`
      );
      if (pct >= targetPct) {
        return { ok: true, hp: st.hp, maxHp: st.maxHp, pct, results };
      }
      if (!belleOk && !shipOk) {
        log("REST no free gain left");
        break;
      }
      if (!opts.kinds) {
        kinds = [];
        if (shipOk && shipGain >= belleGain) kinds.push("NAVIRE", "BELLE_ETOILE");
        else if (belleOk) kinds.push("BELLE_ETOILE", "NAVIRE");
        else kinds.push("NAVIRE", "BELLE_ETOILE");
      }
      let did = false;
      for (const kind of kinds) {
        if (kind === "NAVIRE" && !shipOk) continue;
        if (kind === "BELLE_ETOILE" && !belleOk) continue;
        const r = await api("POST", "/api/world/rest", { characterId: C, kind });
        results.push({ kind, status: r.status, data: r.data });
        if (r.ok) {
          log("REST", kind, "+", r.data?.hpRecovered ?? r.data?.recovered, "HP");
          did = true;
          await sleep(350);
          break;
        }
        log("REST fail", kind, r.status, r.data?.error || r.data?.message || "");
      }
      if (!did) break;
    }
    let st2 = await restState();
    // Auberge uniquement si critique + autorisé (sinon free caps: rough~50%, ship~75%)
    if (
      CFG.ALLOW_PAID_REST &&
      st2 &&
      st2.maxHp &&
      st2.hp / st2.maxHp < (CFG.MIN_HP_TO_FIGHT || 0.35) &&
      st2.inn?.available
    ) {
      const r = await api("POST", "/api/world/rest", { characterId: C, kind: "AUBERGE" });
      results.push({ kind: "AUBERGE", status: r.status, data: r.data });
      if (r.ok) log("REST AUBERGE +", r.data?.hpRecovered, "cost", r.data?.cost);
      st2 = await restState();
    }
    return {
      ok: !!(st2 && st2.maxHp && st2.hp / st2.maxHp >= (CFG.MIN_HP_TO_FIGHT || 0.35)),
      hp: st2?.hp,
      maxHp: st2?.maxHp,
      pct: st2?.maxHp ? st2.hp / st2.maxHp : null,
      results,
      note: st2 && st2.maxHp && st2.hp / st2.maxHp < 0.95
        ? "free rest capped (ship/rough) — full heal = auberge/maison"
        : undefined,
    };
  }

  /** Refuse de combattre si HP trop bas — rest d'abord */
  async function ensureHealthy() {
    const st = await restState();
    if (!st || st.maxHp == null) {
      // fallback characters
      const c = await getCharApi();
      const hp = c?.currentHp ?? c?.hp ?? 0;
      if (!hp) return true;
      log("REST state missing, char currentHp=", hp);
      await rest({ force: true, targetPct: 0.85 });
      return true;
    }
    const pct = st.hp / st.maxHp;
    const belleUp =
      st.rough?.available !== false &&
      (st.rough?.hpRecovery > 0 ||
        (st.vitality != null && st.vitality < (st.rough?.cap ?? 50)));
    if (pct < CFG.MIN_HP_TO_FIGHT || (pct < 0.92 && belleUp)) {
      log(`HP ${st.hp}/${st.maxHp} (${Math.round(pct * 100)}%) → REST (belle/ship)`);
      const r = await rest({ force: true, targetPct: 0.95 });
      return pct < CFG.MIN_HP_TO_FIGHT ? !!(r.ok) : true;
    }
    return true;
  }

  async function fight(startOrId) {
    await ensureChar();
    if (!(await ensureHealthy())) {
      log("HP toujours trop bas après rest — abandon");
      return { error: "hp too low" };
    }
    let bid = typeof startOrId === "string" ? startOrId : startOrId?.id || startOrId?.data?.id;
    if (!bid) return { error: "no battle id" };

    active = true;
    stats.battles++;
    const berriesBefore = (await getCharApi())?.berries ?? 0;
    let lastSeq = 0;

    // Engage if needed
    await api("POST", `/api/battles/${bid}/engage`, { characterId: CHAR_ID });
    document.querySelector("button.confirmer-combat")?.click();
    Array.from(document.querySelectorAll("button"))
      .find((b) => /^prêt$/i.test(b.innerText?.trim()))
      ?.click();
    await sleep(350);

    let maxTicks = CFG.PVP_MAX_TICKS || 120;
    for (let tick = 0; tick < maxTicks && active; tick++) {
      const s = (await api("GET", `/api/battles/${bid}`)).data;
      if (s && (s.pvp || s.kind === "PVP" || s.type === "PVP")) {
        maxTicks = Math.max(maxTicks, CFG.PVP_MAX_TICKS || 200);
      }
      if (!s) {
        await sleep(CFG.POLL_MS);
        continue;
      }

      // Track log
      const delta = parseLogDelta(s.log, CHAR_ID, lastSeq);
      stats.dmgDealt += delta.dealt;
      stats.dmgTaken += delta.taken;
      stats.crits += delta.crits;
      for (const e of delta.events) lastSeq = Math.max(lastSeq, e.seq ?? 0);

      if (s.winner || s.finished) {
        if (s.winner === "ALLIE") stats.wins++;
        else stats.losses++;
        break;
      }

      if (s.tactics?.placementDone === false) {
        Array.from(document.querySelectorAll("button"))
          .find((b) => /^prêt$/i.test(b.innerText?.trim()))
          ?.click();
        await sleep(250);
        continue;
      }

      // Fix v2.1 : yourTurn est top-level (live 01/11/2026)
      if (!isMyTurn(s)) {
        await sleep(CFG.POLL_MS);
        continue;
      }

      stats.turns++;
      const me = (s.fighters || []).find((f) => f.id === (s.you || CHAR_ID));
      const decision = decide(s, me || {});
      log(decision.reason || decision.type);

      const r = await execute(bid, decision);
      if (r.data?.log) {
        const d2 = parseLogDelta(r.data.log, CHAR_ID, lastSeq);
        stats.dmgDealt += d2.dealt;
        stats.dmgTaken += d2.taken;
        stats.crits += d2.crits;
        for (const e of d2.events) lastSeq = Math.max(lastSeq, e.seq ?? 0);
      }

      if (r.data?.winner || r.data?.finished) {
        if ((r.data.winner || s.winner) === "ALLIE") stats.wins++;
        else stats.losses++;
        break;
      }

      if (decision.type === "move") await sleep(CFG.MOVE_DELAY_MS);
      else if (decision.type === "cast" || decision.type === "attack")
        await sleep(CFG.ACT_DELAY_MS);
      else await sleep(CFG.POLL_MS);
    }

    const final = (await api("GET", `/api/battles/${bid}`)).data;
    await sleep(700);
    Array.from(document.querySelectorAll("button"))
      .find((b) => /continuer/i.test(b.innerText))
      ?.click();
    await sleep(400);

    const berriesAfter = (await getCharApi())?.berries ?? berriesBefore;
    const bDelta = berriesAfter - berriesBefore;
    stats.berriesDelta += bDelta;

    if (CFG.AUTO_REST) await rest();

    const summary = {
      winner: final?.winner,
      dmgDealt: stats.dmgDealt,
      dmgTaken: stats.dmgTaken,
      berriesDelta: bDelta,
      fighters: (final?.fighters || []).map((f) => ({
        name: f.name,
        team: f.team,
        hp: f.hp
      }))
    };
    log("FIGHT END", summary);
    active = false;
    return summary;
  }

  function extractBattleId(data) {
    if (!data || typeof data !== "object") return null;
    return (
      data.id ||
      data.battleId ||
      data.battle?.id ||
      data.combat?.id ||
      null
    );
  }

  function looksLikeBattle(data) {
    const id = extractBattleId(data);
    if (!id) return null;
    if (data.fighters || data.tactics || data.you || data.pvp || data.kind) return id;
    if (typeof id === "string" && id.length > 8) return id;
    return null;
  }

  function arm() {
    if (window.__glCombatArmed) {
      log("deja arme");
      return;
    }
    window.__glCombatArmed = true;
    const orig = window.fetch;
    window.fetch = async function (url, opts) {
      const res = await orig.apply(this, arguments);
      try {
        const u = typeof url === "string" ? url : url?.url || "";
        const method = (opts?.method || "GET").toUpperCase();
        const isBattleApi = u.includes("/api/battles/");
        const watch =
          isBattleApi &&
          method === "POST" &&
          (u.endsWith("/start") ||
            u.includes("/pvp/challenge") ||
            u.includes("/join") ||
            (CFG.PVP_AUTO && u.includes("/pvp/")));
        if (watch) {
          res
            .clone()
            .json()
            .then((data) => {
              const id = looksLikeBattle(data);
              if (id && !active) {
                log("auto-fight", id, (u.split("/api")[1] || u));
                fight(id);
              }
            })
            .catch(() => {});
        }
      } catch (e) {}
      return res;
    };

    try {
      const scene = window.__grandlineScene;
      const net = scene && scene.network;
      if (net && typeof net.on === "function" && !window.__glCombatSock) {
        window.__glCombatSock = true;
        net.on("battle:opened", (payload) => {
          const id = extractBattleId(payload) || (payload && payload.battleId);
          if (id && !active && CFG.PVP_AUTO) {
            log("socket battle:opened", id);
            fight(id);
          }
        });
      }
    } catch (e) {}

    log("arme - auto-fight FAUNE (/start) + PvP (challenge/join/opened)");
  }

  /** PvP agressif - distance <= 8, meme ile, lvl >= 30 (sinon 409) */
  async function challenge(targetId) {
    await ensureChar();
    if (!targetId) return { error: "targetId required" };
    const r = await api("POST", "/api/battles/pvp/challenge", {
      characterId: CHAR_ID,
      targetId: targetId,
    });
    if (!r.ok) {
      log("challenge FAIL", r.status, r.data && (r.data.error || r.data));
      return { error: (r.data && r.data.error) || "challenge failed", status: r.status, data: r.data };
    }
    const id = extractBattleId(r.data);
    log("challenge OK", id || r.data);
    if (id) return fight(id);
    return r.data;
  }

  /** Rejoindre un battle / duel deja ouvert */
  async function join(battleId) {
    await ensureChar();
    if (!battleId) return { error: "battleId required" };
    const r = await api("POST", "/api/battles/" + battleId + "/join", {
      characterId: CHAR_ID,
    });
    if (!r.ok && r.status !== 409) {
      log("join FAIL", r.status, r.data && (r.data.error || r.data));
    }
    return fight(battleId);
  }

  /** Joueurs proches sur la map pour challenge */
  function nearbyPlayers(maxDist) {
    maxDist = maxDist == null ? 8 : maxDist;
    const scene = window.__grandlineScene;
    if (!scene) return [];
    const me = scene.character;
    const myId = me && me.id;
    const mx = Math.round((scene.entities && scene.entities.get && scene.entities.get(myId) && scene.entities.get(myId).x) || (me && me.x) || 0);
    const my = Math.round((scene.entities && scene.entities.get && scene.entities.get(myId) && scene.entities.get(myId).y) || (me && me.y) || 0);
    const out = [];
    try {
      const ents = scene.entities;
      if (ents && typeof ents.forEach === "function") {
        ents.forEach(function (ent, id) {
          if (!ent || id === myId) return;
          if (ent.kind && /fauna|mob|npc/i.test(ent.kind)) return;
          if (ent.isFauna || ent.packId) return;
          const x = Math.round(ent.x), y = Math.round(ent.y);
          const d = Math.abs(x - mx) + Math.abs(y - my);
          if (d <= maxDist && (ent.name || ent.player || ent.characterId)) {
            out.push({
              id: ent.characterId || ent.id || id,
              name: ent.name || id,
              x: x, y: y, d: d,
            });
          }
        });
      }
    } catch (e) {}
    try {
      const players = (scene.network && scene.network.players) || [];
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (p.id === myId) continue;
        const d = Math.abs((p.x || 0) - mx) + Math.abs((p.y || 0) - my);
        if (d <= maxDist) out.push({ id: p.id, name: p.name, x: p.x, y: p.y, d: d });
      }
    } catch (e) {}
    const seen = {};
    return out.filter(function (p) {
      if (seen[p.id]) return false;
      seen[p.id] = true;
      return true;
    }).sort(function (a, b) { return a.d - b.d; });
  }


  function packDest(pack) {
    const m0 = pack?.mobs?.[0];
    if (m0?.orbit) return { x: Math.round(m0.orbit.cx), y: Math.round(m0.orbit.cy), src: "orbit" };
    if (pack?.ancre) return { x: Math.round(pack.ancre.x), y: Math.round(pack.ancre.y), src: "ancre" };
    return null;
  }

  function buildPath(from, to, maxLen = 12) {
    const path = [{ x: from.x, y: from.y }];
    let x = from.x,
      y = from.y;
    for (let i = 0; i < maxLen; i++) {
      if (x === to.x && y === to.y) break;
      if (x !== to.x) x += Math.sign(to.x - x);
      if (y !== to.y) y += Math.sign(to.y - y);
      path.push({ x, y });
    }
    return path;
  }

  async function walkToPack(packId, maxChunks = 30) {
    const scene = window.__grandlineScene;
    if (!scene) return { ok: false, error: "no scene" };
    const C = (await ensureChar()) || scene.character?.id;
    const packs = () => scene.network?.fauna?.packs || [];

    // Déléguer au pathfinder GLBot si disponible (BFS walkable)
    if (window.GLBot?.walkTo) {
      for (let c = 0; c < maxChunks; c++) {
        const e = scene.entities.get(C);
        if (!e) break;
        while (e.moving) await sleep(200);
        const pack = packs().find((p) => p.id === packId);
        const dest = packDest(pack);
        if (!dest) return { ok: false, error: "no dest" };
        const x = Math.round(e.x);
        const y = Math.round(e.y);
        if (Math.abs(x - dest.x) + Math.abs(y - dest.y) <= 2)
          return { ok: true, pos: { x, y }, dest };
        await window.GLBot.walkTo(dest, { maxChunk: 12, retries: 2, stopDist: 2 });
        await sleep(400);
      }
      const e = scene.entities.get(C);
      return {
        ok: false,
        pos: e ? { x: Math.round(e.x), y: Math.round(e.y) } : null
      };
    }

    for (let c = 0; c < maxChunks; c++) {
      const e = scene.entities.get(C);
      if (!e) break;
      while (e.moving) await sleep(200);
      const pack = packs().find((p) => p.id === packId);
      const dest = packDest(pack);
      if (!dest) return { ok: false, error: "no dest" };
      const x = Math.round(scene.entities.get(C).x);
      const y = Math.round(scene.entities.get(C).y);
      const md = Math.abs(x - dest.x) + Math.abs(y - dest.y);
      if (md <= 2) return { ok: true, pos: { x, y }, dest };
      let path;
      if (Math.abs(dest.x - x) >= Math.abs(dest.y - y))
        path = buildPath({ x, y }, { x: dest.x, y }, 12);
      else path = buildPath({ x, y }, { x, y: dest.y }, 12);
      try {
        await scene.moveLocal(path, null, { courir: true, redresser: true });
      } catch {
        try {
          await scene.moveLocal(buildPath({ x, y }, dest, 8), null, {
            courir: true,
            redresser: true
          });
        } catch {}
      }
      await sleep(2000);
    }
    const e = scene.entities.get(C);
    return { ok: false, pos: { x: Math.round(e.x), y: Math.round(e.y) } };
  }

  function stop() {
    active = false;
    log("stopped");
  }

  /**
   * Combat de quête bout-en-bout (validé live 01/11/2026).
   * @param {string} objectifId ex: "campagne:pw1-miliciens"
   */
  async function fightQuest(objectifId) {
    await ensureChar();
    if (CFG.AUTO_REST) await rest();
    const start = await api("POST", "/api/battles/start", {
      characterId: CHAR_ID,
      objectifId
    });
    if (!start.ok || !start.data?.id) {
      log("fightQuest start FAIL", start.status, start.data?.error);
      return { error: start.data?.error || "start failed", status: start.status };
    }
    log("fightQuest start", start.data.id, objectifId);
    return fight(start.data.id);
  }

  window.GLCombat = {
    arm,
    fight,
    fightQuest,
    challenge,
    join,
    nearbyPlayers,
    walkToPack,
    packDest,
    buildPath,
    stop,
    rest,
    restState,
    ensureHealthy,
    decide,
    hasLOS,
    isMyTurn,
    stats: () => ({ ...stats }),
    cfg: CFG,
    version: "2.3.0-pvp"
  };

  console.log(
    "%cOK GLCombat v2.3 PvP - arm FAUNE+PvP / challenge / join / kite-first",
    "color:#4caf50;font-weight:bold"
  );
})();
