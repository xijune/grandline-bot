(async () => {
  function findToken() {
    const c = [];
    if (window.__freshToken) c.push(window.__freshToken);
    if (window.GN?.TOKEN) c.push(window.GN.TOKEN);
    try { for (let i = 0; i < sessionStorage.length; i++) { const v = sessionStorage.getItem(sessionStorage.key(i)); if (v && v.split(".").length === 3 && v.length > 100) c.push(v); } } catch {}
    try { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)); if (v && v.split(".").length === 3 && v.length > 100) c.push(v); } } catch {}
    for (const t of c) { try { const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); if (p.exp > Date.now()/1000) return t; } catch {} }
    return null;
  }
  const TOKEN = findToken();
  if (!TOKEN) { console.error("❌ Token"); return; }
  const H = { authorization: "Bearer " + TOKEN, "content-type": "application/json" };
  const API = "https://api.grandline-online.fr";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let tokenDead = false;

  const api = async (m, p, b) => {
    if (tokenDead) return { status: 401, unauthorized: true };
    try {
      const r = await fetch(API + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
      if (r.status === 401) { tokenDead = true; return { status: 401, unauthorized: true }; }
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch { return { status: 0, body: null }; }
  };

  let C = sessionStorage.getItem("__autoCharId");
  if (!C) {
    const r = await api("GET", "/api/characters");
    const chars = Array.isArray(r.body?.characters) ? r.body.characters : Array.isArray(r.body) ? r.body : null;
    C = chars?.[0]?.id ?? r.body?.id ?? JSON.parse(atob(TOKEN.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))).sub;
    sessionStorage.setItem("__autoCharId", C);
  }

  const CFG = Object.assign({
    GUARD_HP_PCT: 0.50,
    FLEE_HP_PCT: 0.20,
    AOE_MIN_TARGETS: 2,
    FLEE_MAX_ATTEMPTS: 2,
    FINISHER_WEIGHT: 10000,
    FINISHER_2T_WEIGHT: 1000,
    FOCUS_LOW_HP_WEIGHT: 100,
    GUARD_PA_COST: 2,
    FLEE_SIM_MARGIN: 0.9,
    KITE_MELEE_ENABLED: true,
    KITE_PARTIAL_HP: 0.30,            // kite partiel si HP < 30%
    MAX_CONSECUTIVE_KITES: 3,         // anti-boucle (plus permissif car kite est bon maintenant)
    SAFE_DIST_MARGIN: 1,
    VERBOSE: true,
  }, window.__cfg || {});

  const DECK_INFO = {};
  async function preloadDeck() {
    const r = await api("GET", `/api/characters/${C}/techniques`);
    for (const a of (r.body?.actions || [])) {
      DECK_INFO[a.id] = {
        pa: a.pa ?? a.reach?.cost ?? (a.kind === "ATTAQUE" ? 2 : a.kind === "GARDE" ? 2 : 0),
        range: a.reach?.range ?? a.geometry?.range ?? a.range ?? null,
        minRange: a.geometry?.minRange ?? a.minRange ?? 0,
        shape: a.geometry?.shape ?? a.shape ?? "single",
        power: a.power ?? 0, heal: a.heal ?? 0, type: a.type,
        needsSight: a.geometry?.needsSight ?? true,
      };
    }
    if (!DECK_INFO.guard) DECK_INFO.guard = { pa: 2, range: null, shape: "self" };
    if (!DECK_INFO.attack) DECK_INFO.attack = { pa: 2, range: 1, shape: "single" };
    if (!DECK_INFO.flee) DECK_INFO.flee = { pa: 0, range: null, shape: "self" };
    console.log(`📚 DECK_INFO: ${Object.keys(DECK_INFO).length} sorts`);
  }
  await preloadDeck();

  window.__stats = { battles: 0, wins: 0, losses: 0, casts: 0, aoe: 0, attack: 0, guards: 0, guardFallbacks: 0, flees: 0, fleeCancels: 0, moves: 0, endTurns: 0, turns: 0, finishers: 0, kills_verified: 0, loopBreaks: 0, meleeKites: 0, escapedKites: 0, futileKites: 0, forcedAttacks: 0, positions: 0 };
  window.__active = false;
  window.__consecutiveKites = 0;
  window.__stopAll = () => { window.__active = false; console.log("🛑 Stop"); };

  function tryContinue() {
    document.querySelectorAll("button, [role='button']").forEach(b => {
      const t = (b.textContent || "").toLowerCase().trim();
      const r = b.getBoundingClientRect();
      if (/^(continuer|fermer|ok|suivant|valider)$/.test(t) && r.width > 0 && r.height > 0) b.click();
    });
  }
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType === 1 && /resultat|victoire|combat termin/i.test(n.textContent || "")) [200, 600, 1500].forEach(d => setTimeout(tryContinue, d));
  }))).observe(document.body, { childList: true, subtree: true });

  async function autoHeal() {
    const { body: h } = await api("POST", "/api/world/rest", { characterId: C, kind: "BELLE_ETOILE" });
    if (h?.hpRecovered !== undefined) { console.log(`💚 +${h.hpRecovered}HP`); return; }
    if (h?.error?.includes("Dormir par terre")) {
      await sleep(60000);
      const r2 = await api("POST", "/api/world/rest", { characterId: C, kind: "BELLE_ETOILE" });
      if (r2.body?.hpRecovered !== undefined) console.log(`💚 +${r2.body.hpRecovered}HP`);
    }
  }

  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  function bresenham(x0, y0, x1, y1) {
    const cells = [];
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      cells.push({ x: x0, y: y0 });
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
    return cells;
  }
  function hasLOS(from, to, obstacles) {
    if (!from || !to) return true;
    if (from.x === to.x && from.y === to.y) return true;
    const obsSet = new Set((obstacles || []).map(o => `${o.x},${o.y}`));
    const cells = bresenham(from.x, from.y, to.x, to.y);
    for (let i = 1; i < cells.length - 1; i++) if (obsSet.has(`${cells[i].x},${cells[i].y}`)) return false;
    return true;
  }
  function cellsInShape(shape, center, radius) {
    if (shape.startsWith("circle")) {
      const out = [];
      for (let dx = -radius; dx <= radius; dx++)
        for (let dy = -radius; dy <= radius; dy++)
          if (Math.abs(dx) + Math.abs(dy) <= radius) out.push({ x: center.x + dx, y: center.y + dy });
      return out;
    }
    if (shape.startsWith("cross")) {
      const out = [{ x: center.x, y: center.y }];
      for (let r = 1; r <= radius; r++) {
        out.push({ x: center.x + r, y: center.y }, { x: center.x - r, y: center.y });
        out.push({ x: center.x, y: center.y + r }, { x: center.x, y: center.y - r });
      }
      return out;
    }
    if (shape.startsWith("line")) return [{ x: center.x, y: center.y }];
    return [{ x: center.x, y: center.y }];
  }

  function parseAction(a, me) {
    const info = DECK_INFO[a.id] || {};
    const ft = (me.techniques || []).find(t => t.id === a.id) || {};
    const pa = a.pa ?? info.pa ?? ft.pa ?? (a.kind === "ATTAQUE" || a.kind === "GARDE" ? 2 : 0);
    const range = a.geometry?.range ?? a.range ?? ft.range ?? info.range ?? (a.kind === "ATTAQUE" ? 1 : null);
    const minRange = a.geometry?.minRange ?? a.minRange ?? ft.minRange ?? info.minRange ?? 0;
    const shape = a.geometry?.shape ?? a.shape ?? ft.shape ?? info.shape ?? "single";
    const power = a.power ?? ft.power ?? info.power ?? 0;
    const heal = a.heal ?? ft.heal ?? info.heal ?? 0;
    const type = a.type ?? ft.type ?? info.type;
    const needsSight = a.geometry?.needsSight ?? ft.needsSight ?? info.needsSight ?? true;
    let category;
    if (a.kind === "FUITE") category = "flee";
    else if (a.kind === "GARDE") category = "guard";
    else if (a.kind === "ATTAQUE") category = "basic";
    else if (type === "SOUTIEN" || shape === "self" || heal > 0) category = "support";
    else if (/^(circle|cross|line)\d+$/.test(shape)) category = "aoe";
    else category = "damage";
    const radius = parseInt(shape.match(/(\d+)$/)?.[1] || "0");
    return { id: a.id, kind: a.kind, name: a.name, pa, range, minRange, shape, radius, power, heal, type, needsSight,
             estimates: a.estimates || {}, cd: a.cooldownLeft ?? 0, category, raw: a };
  }

  function detectArchetype(me) {
    if (me.armeDeTir === true) return "RANGED";
    const maxRange = Math.max(1, ...(me.techniques || []).map(t => t.range ?? t.reach?.range ?? 1));
    if (maxRange >= 4) return "RANGED";
    if (maxRange <= 2) return "MELEE";
    return "HYBRID";
  }

  function getEnemyMaxRange(enemy) {
    let maxRange = 1;
    for (const t of (enemy.techniques || [])) {
      const r = t.geometry?.range ?? t.range ?? t.reach?.range ?? 1;
      if (r > maxRange) maxRange = r;
    }
    return maxRange;
  }

  function getEnemies(s, myPos, killedIds) {
    return s.fighters
      .filter(f => f.team !== "ALLIE" && (f.hp ?? 0) > 0 && !killedIds.has(f.id))
      .map(f => ({
        ...f,
        pos: s.tactics.positions[f.id],
        dist: (myPos && s.tactics.positions[f.id]) ? dist(myPos, s.tactics.positions[f.id]) : 99,
        maxRange: getEnemyMaxRange(f),
        pm: f.caracs?.pm ?? 3,
      }));
  }

  function getTurnInfo(s, myId) {
    const order = s.order || [];
    const myIdx = order.indexOf(myId);
    if (myIdx < 0) return { actorsAfterMe: [], hasOrderInfo: false };
    const actorsAfterMe = [];
    for (let i = 1; i < order.length; i++) actorsAfterMe.push(order[(myIdx + i) % order.length]);
    return { actorsAfterMe, hasOrderInfo: true };
  }

  // ⬇️ NOUVEAU : sweet spot = distance idéale en fin de tour
  // = max(enemy.pm + my_range [enemy walks into my range], enemy.pm + enemy.range + margin [je reste safe])
  function computeSweetSpot(alive, myMaxRange) {
    const enemies = alive.filter(e => e.pos);
    if (!enemies.length) return myMaxRange;
    const maxPM = Math.max(...enemies.map(e => e.pm ?? 3));
    const maxRange = Math.max(...enemies.map(e => e.maxRange ?? 1));
    const idealForAttack = maxPM + myMaxRange;
    const safeDist = maxPM + maxRange + CFG.SAFE_DIST_MARGIN;
    return Math.max(idealForAttack, safeDist);
  }

  function simulateThisTurn(ap, alive, damageActs, myPos, obstacles) {
    const simHp = {};
    for (const e of alive) simHp[e.id] = e.hp;
    const pool = damageActs.filter(a => a.pa <= ap).map(a => {
      const ests = alive.map(t => {
        const est = a.estimates[t.id];
        return est ? { id: t.id, avg: (est.min + est.max) / 2 } : null;
      }).filter(Boolean);
      if (!ests.length) return null;
      return { action: a, eff: Math.max(...ests.map(e => e.avg)) / Math.max(a.pa, 1) };
    }).filter(Boolean).sort((a, b) => b.eff - a.eff);

    let simAp = ap, totalDmg = 0, guard = 0;
    const plan = [];
    while (simAp > 0 && guard < 20) {
      guard++;
      let best = null;
      for (const p of pool) {
        if (p.action.pa > simAp) continue;
        const target = alive
          .filter(t => simHp[t.id] > 0 && t.pos)
          .filter(t => {
            const est = p.action.estimates[t.id];
            return est && t.dist <= p.action.range;
          })
          .sort((a, b) => simHp[a.id] - simHp[b.id])[0];
        if (!target) continue;
        const est = p.action.estimates[target.id];
        const dmg = (est.min + est.max) / 2;
        if (!best || dmg / p.action.pa > best.eff) best = { action: p.action, target, dmg, eff: dmg / p.action.pa };
      }
      if (!best) break;
      simHp[best.target.id] -= best.dmg;
      totalDmg += best.dmg;
      simAp -= best.action.pa;
      plan.push({ spell: best.action.id, target: best.target.name, dmg: Math.round(best.dmg) });
    }
    return { totalDmg, canKillAll: Object.values(simHp).every(h => h <= 0), plan };
  }

  function pickBestSingle(actions, alive, myPos, obstacles, ap) {
    let best = null;
    for (const a of actions) {
      if (a.category !== "damage" && a.category !== "basic") continue;
      if (a.pa == null || a.pa > ap) continue;
      for (const t of alive) {
        if (!t.pos) continue;
        if (a.range != null && t.dist > a.range) continue;
        if (a.minRange && t.dist < a.minRange) continue;
        if (a.needsSight && !hasLOS(myPos, t.pos, obstacles)) continue;
        const est = a.estimates[t.id];
        if (!est) continue;
        const avgDmg = (est.min + est.max) / 2, maxDmg = est.max;
        let score = avgDmg / Math.max(a.pa, 1);
        if (maxDmg >= t.hp) score += CFG.FINISHER_WEIGHT;
        else if (avgDmg * 2 >= t.hp) score += CFG.FINISHER_2T_WEIGHT;
        score += (1 - t.hp / (t.maxHp || 1)) * CFG.FOCUS_LOW_HP_WEIGHT;
        if (!best || score > best.score) best = { action: a, target: t, score, avgDmg, maxDmg };
      }
    }
    return best;
  }

  function pickBestAoe(actions, alive, allies, myPos, obstacles, ap) {
    let best = null;
    for (const a of actions) {
      if (a.category !== "aoe") continue;
      if (a.pa > ap) continue;
      for (const center of alive) {
        if (!center.pos) continue;
        const d = dist(myPos, center.pos);
        if (a.range != null && d > a.range) continue;
        if (a.minRange && d < a.minRange) continue;
        if (a.needsSight && !hasLOS(myPos, center.pos, obstacles)) continue;
        const affectedCells = cellsInShape(a.shape, center.pos, a.radius);
        const set = new Set(affectedCells.map(c => `${c.x},${c.y}`));
        const targets = alive.filter(e => e.pos && set.has(`${e.pos.x},${e.pos.y}`));
        if (allies.some(al => al.pos && set.has(`${al.pos.x},${al.pos.y}`))) continue;
        if (targets.length < CFG.AOE_MIN_TARGETS) continue;
        let totalDmg = 0, killCount = 0, valid = true;
        for (const e of targets) {
          const est = a.estimates[e.id];
          if (!est) { valid = false; break; }
          totalDmg += (est.min + est.max) / 2;
          if (est.max >= e.hp) killCount++;
        }
        if (!valid) continue;
        const score = totalDmg / Math.max(a.pa, 1) + killCount * CFG.FINISHER_WEIGHT + targets.length * 50;
        if (!best || score > best.score) best = { action: a, center, targets, score, totalDmg };
      }
    }
    return best;
  }

  function kiteCellMaxDist(s, myPos, alive, mp) {
    if (!myPos || mp <= 0) return null;
    const reachable = (s.tactics.reachable || []).filter(c => c.cost <= mp);
    if (!reachable.length) return null;
    const candidates = [];
    for (const c of reachable) {
      if (alive.some(e => e.pos && dist(c, e.pos) <= 1)) continue;
      const nearest = alive.filter(e => e.pos).sort((a, b) => dist(c, a.pos) - dist(c, b.pos))[0];
      if (!nearest) continue;
      const newDist = dist(c, nearest.pos);
      const gain = newDist - nearest.dist;
      if (gain <= 0) continue;
      const minDist = Math.min(...alive.filter(e => e.pos).map(e => dist(c, e.pos)));
      candidates.push({ x: c.x, y: c.y, minDist, gain, cost: c.cost });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.minDist - a.minDist || a.cost - b.cost);
    return candidates[0];
  }

  // ⬇️ NOUVEAU : approche en visant sweet spot (pas le contact)
  function approachToSweetSpot(s, target, mp, sweetSpot) {
    if (!target?.pos || mp <= 0) return null;
    const reachable = (s.tactics.reachable || []).filter(c => c.cost <= mp);
    if (!reachable.length) return null;
    const candidates = reachable
      .map(c => ({ ...c, d: dist(c, target.pos) }))
      .filter(c => c.d < target.dist);
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const diff = Math.abs(a.d - sweetSpot) - Math.abs(b.d - sweetSpot);
      if (diff !== 0) return diff;
      return b.d - a.d;  // tie : préférer plus loin (safe)
    });
    return candidates[0];
  }

  function closeToCell(s, target, mp, stopAtRange) {
    if (!target?.pos || mp <= 0) return null;
    const reachable = (s.tactics.reachable || []).filter(c => c.cost <= mp);
    if (!reachable.length) return null;
    const candidates = reachable.map(c => ({ ...c, d: dist(c, target.pos) })).filter(c => c.d < target.dist);
    if (!candidates.length) return null;
    const inRange = candidates.filter(c => c.d <= stopAtRange);
    if (inRange.length) {
      if (stopAtRange >= 2) {
        inRange.sort((a, b) => Math.abs(a.d - stopAtRange) - Math.abs(b.d - stopAtRange));
      } else {
        inRange.sort((a, b) => a.d - b.d);
      }
      return inRange[0];
    }
    candidates.sort((a, b) => a.d - b.d);
    return candidates[0];
  }

  function makeGuard(reason) {
    window.__stats.guardFallbacks++;
    return { type: "guard", reason: `GARDE fallback (${reason})`, _fallback: true };
  }

  function decideAction(s, myPos, archetype, me, guardedThisTurn, fleeAttempts) {
    const ap = s.tactics.ap, mp = s.tactics.mp;
    const killedIds = window.__killedIds || new Set();
    const alive = getEnemies(s, myPos, killedIds);
    const allies = s.fighters.filter(f => f.team === "ALLIE" && f.id !== me.id && (f.hp ?? 0) > 0)
      .map(f => ({ ...f, pos: s.tactics.positions[f.id] }));
    const myHP = me.hp ?? 0, maxHP = me.maxHp ?? 9999;
    const raw = s.actions || [];
    const actions = raw.map(a => parseAction(a, me));
    const hasFlee = actions.some(a => a.category === "flee");
    const hasGuard = actions.some(a => a.category === "guard");
    const damageActs = actions.filter(a => a.category === "damage" || a.category === "basic");
    const aoeActs = actions.filter(a => a.category === "aoe");
    const allEnemiesMelee = alive.every(e => e.maxRange <= 1);
    const myMaxRange = Math.max(1, ...damageActs.map(a => a.range ?? 1));

    const sweetSpot = computeSweetSpot(alive, myMaxRange);
    const currentMinDist = alive.filter(e => e.pos).length > 0
      ? Math.min(...alive.filter(e => e.pos).map(e => e.dist))
      : 99;

    const canAttackNow = damageActs.some(a =>
      a.pa <= ap && alive.some(t => t.pos && t.dist <= a.range && a.estimates[t.id] && (!a.needsSight || hasLOS(myPos, t.pos, s.tactics.obstacles || [])))
    );
    const canApproachAndAttack = !canAttackNow && mp > 0 && damageActs.some(a =>
      a.pa <= ap && alive.some(t => t.pos && t.dist <= a.range + mp && a.estimates[t.id])
    );

    if (CFG.VERBOSE) {
      console.log(`  📋 ap=${ap} mp=${mp} | cur=${currentMinDist} sweet=${sweetSpot} | canAtk=${canAttackNow?"Y":"N"} canApprox=${canApproachAndAttack?"Y":"N"} kites=${window.__consecutiveKites}`);
    }

    let fleeCanceled = false;
    if (myHP < maxHP * CFG.FLEE_HP_PCT && hasFlee && fleeAttempts < CFG.FLEE_MAX_ATTEMPTS) {
      const sim = simulateThisTurn(ap, alive, damageActs, myPos, { });
      const totalEnemyHP = alive.reduce((s, e) => s + e.hp, 0);
      if (sim.canKillAll || sim.totalDmg >= totalEnemyHP * CFG.FLEE_SIM_MARGIN) {
        window.__stats.fleeCancels++;
        fleeCanceled = true;
        console.log(`  ⚡ FLEE ANNULÉ (sim ${Math.round(sim.totalDmg)} ≥ ${totalEnemyHP}hp)`);
      } else {
        return { type: "flee", reason: `FUITE (${Math.round(myHP/maxHP*100)}%)` };
      }
    }

    if (!alive.length) return { type: "endturn", reason: "aucun ennemi" };

    // GUARD proactif (HP < 50% ET menacé)
    const canBeHitNextTurn = alive.some(e => e.dist <= e.pm + e.maxRange);
    if (!fleeCanceled && myHP < maxHP * CFG.GUARD_HP_PCT && hasGuard && !guardedThisTurn && ap >= CFG.GUARD_PA_COST && canBeHitNextTurn) {
      return { type: "guard", reason: `GARDE (${Math.round(myHP/maxHP*100)}%)` };
    }

    // AOE
    if (alive.length >= CFG.AOE_MIN_TARGETS && aoeActs.length) {
      const best = pickBestAoe(aoeActs, alive, allies, myPos, s.tactics.obstacles || [], ap);
      if (best) {
        window.__stats.aoe++;
        window.__consecutiveKites = 0;
        return { type: "cast", spell: best.action.id, targetId: best.targets[0].id, targetCell: best.center.pos,
                 reason: `AOE ${best.action.id} (${best.targets.length} cibles, ~${Math.round(best.totalDmg)})` };
      }
    }

    // ATTACK (depuis position actuelle)
    if (damageActs.length) {
      const best = pickBestSingle(damageActs, alive, myPos, s.tactics.obstacles || [], ap);
      if (best) {
        const isFinisher = best.maxDmg >= best.target.hp;
        window.__consecutiveKites = 0;
        return {
          type: best.action.kind === "ATTAQUE" ? "attack" : "cast",
          spell: best.action.kind === "ATTAQUE" ? null : best.action.id,
          targetId: best.target.id, targetCell: best.target.pos,
          reason: `${best.action.name} → ${best.target.name} (~${Math.round(best.avgDmg)}${isFinisher ? " 🎯KILL" : ""})`,
          _finisher: isFinisher,
        };
      }
    }

    // ⬇️ KITE to sweet spot (toujours si ça atteint la sécurité)
    if (mp > 0 && allEnemiesMelee && CFG.KITE_MELEE_ENABLED) {
      const nearest = [...alive].sort((a, b) => a.dist - b.dist)[0];
      if (nearest && nearest.dist < sweetSpot) {
        const kite = kiteCellMaxDist(s, myPos, alive, mp);
        if (kite) {
          const achievesSafety = kite.minDist >= sweetSpot;
          const hpLow = myHP < maxHP * CFG.KITE_PARTIAL_HP;
          if (achievesSafety || hpLow) {
            if (archetype === "MELEE" || archetype === "HYBRID") {
              window.__stats.meleeKites++;
              if (achievesSafety) window.__stats.escapedKites++;
              else window.__stats.futileKites++;
            }
            window.__consecutiveKites++;
            const suffix = achievesSafety ? `✓` : `⚠ partial`;
            return { type: "move", cell: { x: kite.x, y: kite.y }, reason: `KITE (${nearest.dist}→${kite.minDist}) ${suffix}` };
          }
        }
      }
    }

    // ⬇️ APPROACH-BURST si burst kill réalisable
    if (canApproachAndAttack && mp > 0) {
      const sim = simulateThisTurn(ap, alive, damageActs, myPos, {});
      if (sim.canKillAll) {
        const target = [...alive].sort((a, b) => a.dist - b.dist)[0];
        const cell = closeToCell(s, target, mp, myMaxRange);
        if (cell) {
          window.__consecutiveKites = 0;
          return { type: "move", cell: { x: cell.x, y: cell.y }, reason: `Approche-BURST (${target.dist}→${cell.d}) 🎯` };
        }
      }
    }

    // ⬇️ APPROACH to sweet spot (si trop loin)
    if (mp > 0 && (archetype === "MELEE" || archetype === "HYBRID")) {
      const closest = [...alive].sort((a, b) => a.dist - b.dist)[0];
      if (closest?.pos && closest.dist > sweetSpot) {
        const cell = approachToSweetSpot(s, closest, mp, sweetSpot);
        if (cell) {
          window.__stats.positions++;
          window.__consecutiveKites = 0;
          return { type: "move", cell: { x: cell.x, y: cell.y }, reason: `Positionnement (${closest.dist}→${cell.d}, sweet=${sweetSpot})` };
        }
      }
    }

    // ⬇️ FORCE-ATK anti-boucle
    if (window.__consecutiveKites >= CFG.MAX_CONSECUTIVE_KITES && mp > 0) {
      const target = [...alive].sort((a, b) => a.dist - b.dist)[0];
      if (target?.pos && target.dist > myMaxRange) {
        const cell = closeToCell(s, target, mp, myMaxRange);
        if (cell) {
          window.__stats.forcedAttacks++;
          window.__consecutiveKites = 0;
          return { type: "move", cell: { x: cell.x, y: cell.y }, reason: `🚨 FORCE-ATK (${target.dist}→${cell.d})` };
        }
      }
    }

    // GUARD fallback (attente active)
    if (hasGuard && !guardedThisTurn && ap >= CFG.GUARD_PA_COST && canBeHitNextTurn) {
      return makeGuard(`attente`);
    }

    return { type: "endturn", reason: `attente (ap=${ap} mp=${mp} sweet=${sweetSpot})` };
  }

  async function executeAction(bid, action) {
    if (action.type === "flee") return api("POST", `/api/battles/${bid}/action`, { characterId: C, kind: "FUITE" });
    if (action.type === "guard") return api("POST", `/api/battles/${bid}/action`, { characterId: C, kind: "GARDE" });
    if (action.type === "cast") return api("POST", `/api/battles/${bid}/action`, { characterId: C, kind: "TECHNIQUE", id: action.spell, targetId: action.targetId, targetCell: action.targetCell });
    if (action.type === "attack") return api("POST", `/api/battles/${bid}/action`, { characterId: C, kind: "ATTAQUE", targetId: action.targetId, targetCell: action.targetCell });
    if (action.type === "move") return api("POST", `/api/battles/${bid}/move`, { characterId: C, cell: action.cell });
    if (action.type === "endturn") return api("POST", `/api/battles/${bid}/end-turn`, { characterId: C });
    return null;
  }

  async function runBattle(start) {
    if (window.__active) return;
    if (!start?.id || !start?.fighters) return;
    window.__active = true;
    window.__stats.battles++;
    window.__killedIds = new Set();
    window.__consecutiveKites = 0;
    const bid = start.id;
    console.log(`\n🎬 Battle ${bid.slice(0, 8)}`);
    const me0 = start.fighters.find(f => f.id === C);
    if (!me0) { window.__active = false; return; }

    const archetype = detectArchetype(me0);
    console.log(`🧠 Archétype: ${archetype} | armeDeTir: ${me0.armeDeTir} | aspiration: ${me0.aspiration}`);
    console.log(`   Moi: ${me0.hp}/${me0.maxHp}HP | PA:${me0.caracs?.pa} PM:${me0.caracs?.pm}`);

    await api("POST", `/api/battles/${bid}/engage`, { characterId: C });
    await sleep(800);

    let noTurn = 0, waitWin = 0, endTurnWithoutAction = 0;
    let guardedTurn = "", fleeAttempts = 0;
    let hitsTaken = 0, lastMyHP = me0.hp ?? 0;

    for (let tick = 0; tick < 400; tick++) {
      if (tokenDead || !window.__active) { window.__active = false; return; }
      const { status, body: s, unauthorized } = await api("GET", `/api/battles/${bid}`);
      if (unauthorized) { window.__active = false; return; }
      if (status === 404) break;
      if (!s?.fighters) { await sleep(400); continue; }

      if (s.winner) {
        if (s.winner === "ALLIE") { window.__stats.wins++; console.log(`✅ WIN`); }
        else { window.__stats.losses++; console.log(`❌ LOSS`); }
        console.log(`   💔 Dégâts subis: ${hitsTaken}`);
        await sleep(600); await autoHeal(); break;
      }

      const aliveCheck = s.fighters.filter(f => f.team !== "ALLIE" && (f.hp ?? 0) > 0 && !window.__killedIds.has(f.id));
      if (!aliveCheck.length) {
        waitWin++;
        if (waitWin === 2) await api("POST", `/api/battles/${bid}/end-turn`, { characterId: C });
        if (waitWin > 8) break;
        await sleep(800); continue;
      }
      waitWin = 0;

      if (!s.tactics?.yourTurn) { noTurn++; if (noTurn > 80) break; await sleep(400); continue; }
      noTurn = 0;
      window.__stats.turns++;

      const curMyF = s.fighters.find(f => f.id === C);
      const curHP = curMyF?.hp ?? 0;
      if (curHP < lastMyHP) hitsTaken += lastMyHP - curHP;
      lastMyHP = curHP;

      if (endTurnWithoutAction >= 5) {
        console.log(`🚨 5 end-turn, FUITE`);
        await api("POST", `/api/battles/${bid}/action`, { characterId: C, kind: "FUITE" });
        window.__stats.losses++;
        await sleep(1000); await autoHeal(); break;
      }

      const myPos = s.tactics.positions[C];
      const turnKey = `${s.round}-${s.turn}`;
      const curGuarded = guardedTurn === turnKey;

      if ((!s.tactics.reachable || s.tactics.reachable.length === 0) && s.tactics.mp > 0) {
        await sleep(400);
        const retry = await api("GET", `/api/battles/${bid}`);
        if (retry.body?.tactics?.reachable?.length > 0) {
          Object.assign(s.tactics, retry.body.tactics);
          Object.assign(s, { fighters: retry.body.fighters, actions: retry.body.actions });
        }
      }

      const decision = decideAction(s, myPos, archetype, curMyF, curGuarded, fleeAttempts);
      console.log(`  → ${decision.reason}`);

      const r = await executeAction(bid, decision);
      if (!r) { await sleep(300); continue; }
      if (r.unauthorized) { window.__active = false; return; }

      if (r.status >= 400) {
        const err = (r.body?.error ?? "").slice(0, 100);
        window.__stats.turns--;
        console.log(`  ⚠️ ${r.status}: "${err}"`);
        if ((err.includes("cible") && err.includes("introuvable")) || err.includes("hors de combat")) {
          if (decision.targetId) window.__killedIds.add(decision.targetId);
        }
        if (err.includes("PA (reste") || err.includes("déjà en garde") || err.includes("déjà utilisé") || err.includes("déjà effectué")) {
          console.log(`  🔧 Loop-break`);
          window.__stats.loopBreaks++;
          await api("POST", `/api/battles/${bid}/end-turn`, { characterId: C });
          endTurnWithoutAction++;
          await sleep(400);
          continue;
        }
        await sleep(500); continue;
      }

      if (decision.targetId && r.body?.fighters) {
        const t = r.body.fighters.find(f => f.id === decision.targetId);
        if (t && (t.hp ?? 0) <= 0) {
          window.__killedIds.add(decision.targetId);
          window.__stats.kills_verified++;
        }
      }
      if (decision._finisher) await sleep(300);

      if (decision.type === "cast") window.__stats.casts++;
      else if (decision.type === "attack") window.__stats.attack++;
      else if (decision.type === "guard") { window.__stats.guards++; guardedTurn = turnKey; }
      else if (decision.type === "flee") { window.__stats.flees++; fleeAttempts++; }
      else if (decision.type === "move") window.__stats.moves++;
      else if (decision.type === "endturn") { window.__stats.endTurns++; endTurnWithoutAction++; }

      if (decision.type !== "endturn") endTurnWithoutAction = 0;
      if (decision._finisher && r.status < 300) window.__stats.finishers++;

      await sleep(decision.type === "move" ? 500 : 250);
    }

    window.__active = false;
    const st = window.__stats;
    console.log(`📊 ${st.wins}W/${st.losses}L | ${st.casts}⚡ ${st.finishers}🎯 | ${st.guards}🛡(${st.guardFallbacks}fb) ${st.flees}💨(${st.fleeCancels}annul) | ${st.positions}📍 ${st.meleeKites}🏃(${st.escapedKites}✓/${st.futileKites}⚠) ${st.forcedAttacks}🚨 | 💔 ${hitsTaken}dmg | ${st.turns}T`);
  }

  const of = window.fetch;
  window.fetch = async function(url, opts) {
    const res = await of.apply(this, arguments);
    if (typeof url === "string" && url.includes("/battles/start") && res.ok) {
      try { const d = await res.clone().json(); setTimeout(() => runBattle(d), 200); } catch {}
    }
    return res;
  };

  console.log("═══════════════════════════════════════════════════════════");
  console.log("✅ V18.8 — Sweet spot (enemy walks into MY range)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🔧 #1 Sweet spot = enemy.pm + my_maxRange (ex: 3+2=5)");
  console.log("🔧 #2 Approche cible sweet spot, pas contact");
  console.log("🔧 #3 Kite prioritaire (pas seulement si HP bas)");
  console.log("🔧 #4 Anti-boucle : 3 kites stériles max");
  console.log("═══════════════════════════════════════════════════════════");
})();