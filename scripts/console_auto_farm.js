/**
 * GLBot Auto-Farm FAUNE — console F12 (n'importe quelle mer / île)
 * East Blue, West Blue, etc. : utilise les packs de la map courante.
 *
 * Prérequis : être EN JEU (pas seulement login).
 *
 * Usage :
 *   1. Coller tout ce script
 *   2. Farm.start()
 *   3. Farm.stop()
 *   4. Farm.status()
 *
 * Options :
 *   Farm.config.maxLevelDelta = 3   // mob <= level joueur + 3
 *   Farm.config.attackRange = 7
 *   Farm.config.restHpPct = 0.35
 */
(async function () {
  "use strict";

  function findScene() {
    if (window.__grandlineScene) return window.__grandlineScene;
    // fallback Phaser 3
    try {
      const g = window.game || window.phaserGame || window.Phaser?.GAMES?.[0];
      const scenes = g?.scene?.scenes || [];
      for (const sc of scenes) {
        if (sc?.network?.fauna || sc?.character || sc?.moveLocal) {
          window.__grandlineScene = sc;
          return sc;
        }
      }
    } catch (_) {}
    return null;
  }

  const scene = findScene();
  if (!scene) {
    console.error(
      "%c[Farm] Scène introuvable. Entre en jeu (monde), puis re-colle le script.",
      "color:#f66;font-weight:bold"
    );
    return;
  }

  // Désactive la conf UI d'attaque si possible
  try {
    scene.confirmationDattaqueDemandee = () => false;
  } catch (_) {}

  const API = "https://api.grandline-online.fr";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function token() {
    if (window.__freshToken) return window.__freshToken;
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const v = sessionStorage.getItem(sessionStorage.key(i));
        if (v && v.split(".").length === 3 && v.length > 80) {
          try {
            const p = JSON.parse(atob(v.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
            if (p.exp > Date.now() / 1000) return v;
          } catch {}
        }
      }
    } catch {}
    return localStorage.getItem("grandline-token") || sessionStorage.getItem("grandline-token");
  }

  async function api(method, path, body) {
    const t = token();
    if (!t) throw new Error("no token");
    const r = await fetch(API + path, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + t,
        accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await r.json();
    } catch {
      data = null;
    }
    return { status: r.status, data };
  }

  const CFG = {
    attackRange: 7,
    moveChunk: 6,
    maxLevelDelta: 4,
    minLevel: 0,
    restHpPct: 0.35,
    loopMs: 900,
    combatPollMs: 180,
    blacklistMs: 20000,
    onlyWeak: false,
    weak: [
      "rat",
      "chien",
      "chat",
      "oiseau",
      "vautour",
      "hibou",
      "ecureuil",
      "poule",
      "colombe",
      "lapin",
      "cerf",
      "pigeon",
    ],
    avoid: ["mercenaire", "marine", "garde"],
  };

  const SESSION = {
    running: false,
    timer: null,
    wins: 0,
    losses: 0,
    skips: 0,
    blacklist: new Map(), // packId -> until
    xpStart: null,
    startedAt: null,
  };

  function player() {
    const c = scene.character;
    if (!c) return null;
    const ent = scene.entities?.get?.(c.id);
    return {
      id: c.id,
      name: c.name,
      x: ent?.x ?? c.x,
      y: ent?.y ?? c.y,
      level: c.level || 1,
      moving: !!ent?.moving,
      mapId: c.mapId,
      currentHp: c.currentHp ?? c.hp,
      maxHp: c.maxHp ?? c.hpMax ?? 1,
      xp: c.xp,
    };
  }

  function dist(a, b) {
    return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
  }

  function isBlocked(x, y) {
    const k = `${x},${y}`;
    if (scene.movementBlocked?.has?.(k) || scene.movementBlocked?.has?.(`${x}|${y}`)) return true;
    if (scene.blocked?.has?.(k)) return true;
    return false;
  }

  function packsLive() {
    const packs = scene.network?.fauna?.packs || [];
    const morts = scene.network?.fauna?.morts || {};
    const engagees = scene.network?.fauna?.engagees || [];
    const engSet =
      engagees instanceof Set
        ? engagees
        : new Set(Array.isArray(engagees) ? engagees : []);
    const now = Date.now();
    const out = [];
    for (const p of packs) {
      if (!p?.id) continue;
      if (SESSION.blacklist.has(p.id) && SESSION.blacklist.get(p.id) > now) continue;
      const mort = morts[p.id];
      if (mort && mort > now) continue;
      if (engSet.has(p.id) || p.engaged || p.enCombat) continue;
      const mobs = p.mobs || [];
      if (!mobs.length) continue;
      const levels = mobs.map((m) => m.niveau || m.level || 1);
      const maxLvl = Math.max(...levels);
      const especes = mobs.map((m) => String(m.espece || "").toLowerCase());
      const ancre = p.ancre || {};
      const ox = ancre.x ?? mobs[0]?.orbit?.cx;
      const oy = ancre.y ?? mobs[0]?.orbit?.cy;
      if (ox == null || oy == null) continue;
      out.push({
        id: p.id,
        x: Number(ox),
        y: Number(oy),
        maxLvl,
        levels,
        especes,
        mobs,
      });
    }
    return out;
  }

  function isValidTarget(pack, pl) {
    if (pack.maxLvl > pl.level + CFG.maxLevelDelta) return false;
    if (pack.maxLvl < CFG.minLevel) return false;
    if (pack.especes.some((e) => CFG.avoid.some((a) => e.includes(a)))) return false;
    if (CFG.onlyWeak) {
      return pack.especes.every((e) => CFG.weak.some((w) => e.includes(w)));
    }
    return true;
  }

  function scorePack(pack, pl) {
    const d = dist(pl, pack);
    let s = d;
    s += Math.max(0, pack.maxLvl - pl.level) * 2;
    if (pack.maxLvl <= pl.level) s -= 2;
    const weak = pack.especes.every((e) => CFG.weak.some((w) => e.includes(w)));
    if (weak) s -= 3;
    return s;
  }

  function pickTarget() {
    const pl = player();
    if (!pl) return null;
    const list = packsLive().filter((p) => isValidTarget(p, pl));
    if (!list.length) return null;
    list.sort((a, b) => scorePack(a, pl) - scorePack(b, pl));
    return list[0];
  }

  async function waitStop(ms = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (!player()?.moving) return true;
      await sleep(120);
    }
    return false;
  }

  async function walkToward(tx, ty, chunk = CFG.moveChunk) {
    const pl = player();
    if (!pl) return false;
    const d = dist(pl, { x: tx, y: ty });
    if (d <= 2) return true;

    // goal may be blocked (pack anchor) → adjacent free cell
    let gx = Math.round(tx),
      gy = Math.round(ty);
    if (isBlocked(gx, gy)) {
      for (const [dx, dy] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
        [1, 1],
        [-1, -1],
      ]) {
        if (!isBlocked(gx + dx, gy + dy)) {
          gx += dx;
          gy += dy;
          break;
        }
      }
    }

    const r = Math.min(chunk / Math.max(d, 1), 1);
    let nx = Math.round(pl.x + (gx - pl.x) * r);
    let ny = Math.round(pl.y + (gy - pl.y) * r);
    // try small sidesteps if blocked
    if (isBlocked(nx, ny)) {
      for (const [dx, dy] of [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
      ]) {
        if (!isBlocked(nx + dx, ny + dy)) {
          nx += dx;
          ny += dy;
          break;
        }
      }
    }

    try {
      if (typeof scene.moveLocal === "function") {
        await scene.moveLocal(
          [
            { x: Math.round(pl.x), y: Math.round(pl.y) },
            { x: nx, y: ny },
          ],
          null,
          { courir: true, redresser: true }
        );
        await waitStop(2500);
        return true;
      }
    } catch (e) {
      console.warn("[Farm] moveLocal", e.message || e);
    }
    return false;
  }

  function inCombat() {
    if (scene.network?.battle?.id) return true;
    if (scene.battle?.id) return true;
    if (scene.combatState) return true;
    if (document.querySelector(".combat, .fenetre-combat, [class*=combat]")) {
      // weak DOM signal
    }
    return !!(scene.network?.battle || scene.enCombat);
  }

  async function attackPack(packId) {
    // Client native (best)
    if (typeof scene.attackFaunaPack === "function") {
      try {
        await scene.attackFaunaPack(packId);
        await sleep(400);
        document.querySelector("button.confirmer-combat")?.click();
        return true;
      } catch (e) {
        console.warn("[Farm] attackFaunaPack", e.message || e);
      }
    }
    // API fallback
    const pl = player();
    if (!pl) return false;
    const r = await api("POST", "/api/battles/start", {
      characterId: pl.id,
      fauna: packId,
    });
    if (r.status !== 200) {
      console.warn("[Farm] start", r.status, r.data?.error || r.data);
      return false;
    }
    const bid = r.data?.id;
    if (bid) await api("POST", `/api/battles/${bid}/engage`, { characterId: pl.id });
    return !!bid;
  }

  async function playCombatApi() {
    const pl = player();
    if (!pl) return null;
    // find battle id
    let bid =
      scene.network?.battle?.id ||
      scene.battle?.id ||
      null;
    if (!bid) {
      // poll character pending
      await sleep(500);
      bid = scene.network?.battle?.id || scene.battle?.id;
    }
    if (!bid) {
      // last resort: wait UI combat then end-turns via API if we can find id from network
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        bid = scene.network?.battle?.id || scene.battle?.id;
        if (bid) break;
        await sleep(200);
      }
    }
    if (!bid) {
      // pure wait for client combat resolution
      const t0 = Date.now();
      while (Date.now() - t0 < 45000) {
        if (!inCombat() && !document.querySelector("button.confirmer-combat")) {
          // maybe finished
          await sleep(600);
          if (!inCombat()) return { winner: "?" };
        }
        // click obvious UI buttons
        document.querySelector("button.fin-de-tour, button.end-turn")?.click();
        await sleep(300);
      }
      return null;
    }

    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      const st = await api("GET", `/api/battles/${bid}`);
      const s = st.data;
      if (!s) {
        await sleep(200);
        continue;
      }
      if (s.winner || s.finished) return { winner: s.winner, battleId: bid };
      if (s.tactics && s.tactics.placementDone === false) {
        await api("POST", `/api/battles/${bid}/engage`, { characterId: pl.id });
        await sleep(250);
        continue;
      }
      const my = s.yourTurn === true || (s.tactics && s.tactics.yourTurn === true);
      if (!my) {
        await sleep(CFG.combatPollMs);
        continue;
      }
      // Prefer client combat AI if present
      if (window.GLCombat && typeof window.GLCombat.playTurn === "function") {
        try {
          await window.GLCombat.playTurn(s);
        } catch {
          await api("POST", `/api/battles/${bid}/end-turn`, { characterId: pl.id });
        }
      } else {
        // Minimal: try first offensive action else end-turn
        const actions = s.actions || s.availableActions || s.tactics?.actions || [];
        const atk = actions.find(
          (a) =>
            a &&
            (a.kind === "SKILL" ||
              a.kind === "ATTAQUE" ||
              a.type === "skill" ||
              a.category === "OFFENSIF")
        );
        const enemies = (s.fighters || []).filter(
          (f) => f.team === "ENNEMI" || f.side === "enemy" || f.camp === "ENNEMI"
        );
        const enemy = enemies.sort((a, b) => (a.hp || 0) - (b.hp || 0))[0];
        if (atk && enemy) {
          const body = {
            characterId: pl.id,
            actionId: atk.id || atk.actionId,
            targetId: enemy.id,
          };
          if (atk.targetCell) body.cell = atk.targetCell;
          const ar = await api("POST", `/api/battles/${bid}/action`, body);
          if (ar.status >= 400) {
            await api("POST", `/api/battles/${bid}/end-turn`, { characterId: pl.id });
          }
        } else {
          await api("POST", `/api/battles/${bid}/end-turn`, { characterId: pl.id });
        }
      }
      await sleep(CFG.combatPollMs);
    }
    return { error: "timeout", battleId: bid };
  }

  async function restIfNeeded() {
    const pl = player();
    if (!pl || !pl.maxHp) return false;
    if (pl.currentHp / pl.maxHp >= CFG.restHpPct) return false;
    console.log("[Farm] rest HP", pl.currentHp, "/", pl.maxHp);
    await api("POST", "/api/world/rest", {
      characterId: pl.id,
      kind: "BELLE_ETOILE",
    });
    await sleep(800);
    return true;
  }

  async function tick() {
    if (!SESSION.running) return;
    try {
      const pl = player();
      if (!pl) {
        SESSION.timer = setTimeout(tick, 1500);
        return;
      }
      if (SESSION.xpStart == null) SESSION.xpStart = pl.xp;

      await restIfNeeded();

      if (inCombat()) {
        console.log("[Farm] combat en cours…");
        const res = await playCombatApi();
        if (res?.winner === "ALLIE") SESSION.wins++;
        else if (res?.winner === "ENNEMI") SESSION.losses++;
        console.log("[Farm] fin combat", res);
        SESSION.timer = setTimeout(tick, 1200);
        return;
      }

      const target = pickTarget();
      if (!target) {
        SESSION.skips++;
        console.log("[Farm] aucun pack valide sur", pl.mapId, "— wait");
        SESSION.timer = setTimeout(tick, 2000);
        return;
      }

      const d = dist(pl, target);
      console.log(
        `[Farm] → ${target.especes.join("+")} lvl${target.maxLvl} d=${d.toFixed(1)} @(${target.x},${target.y}) ${target.id}`
      );

      if (d > CFG.attackRange) {
        await walkToward(target.x, target.y);
        SESSION.timer = setTimeout(tick, CFG.loopMs);
        return;
      }

      const ok = await attackPack(target.id);
      await sleep(600);
      if (inCombat() || ok) {
        const res = await playCombatApi();
        if (res?.winner === "ALLIE") SESSION.wins++;
        else if (res?.winner === "ENNEMI") SESSION.losses++;
        else SESSION.blacklist.set(target.id, Date.now() + CFG.blacklistMs);
        console.log("[Farm] result", res);
      } else {
        console.warn("[Farm] start fail — blacklist court");
        SESSION.blacklist.set(target.id, Date.now() + 12000);
        await walkToward(target.x, target.y, 3);
      }
    } catch (e) {
      console.error("[Farm] tick error", e);
    }
    SESSION.timer = setTimeout(tick, CFG.loopMs);
  }

  function start() {
    if (SESSION.running) return console.log("[Farm] déjà lancé");
    SESSION.running = true;
    SESSION.startedAt = Date.now();
    SESSION.wins = SESSION.losses = SESSION.skips = 0;
    SESSION.xpStart = player()?.xp ?? null;
    console.log(
      "%c[Farm] ▶ START auto-farm FAUNE map=" + (player()?.mapId || "?"),
      "color:#6f6;font-weight:bold"
    );
    tick();
  }

  function stop() {
    SESSION.running = false;
    if (SESSION.timer) clearTimeout(SESSION.timer);
    SESSION.timer = null;
    console.log("%c[Farm] ■ STOP", "color:#f66;font-weight:bold");
    status();
  }

  function status() {
    const pl = player();
    const list = packsLive();
    const out = {
      map: pl?.mapId,
      pos: pl ? [pl.x, pl.y] : null,
      level: pl?.level,
      xp: pl?.xp,
      xpDelta: pl && SESSION.xpStart != null ? pl.xp - SESSION.xpStart : null,
      packs: list.length,
      sample: list.slice(0, 5).map((p) => ({
        id: p.id,
        especes: p.especes,
        lvl: p.maxLvl,
        d: pl ? +dist(pl, p).toFixed(1) : null,
      })),
      wins: SESSION.wins,
      losses: SESSION.losses,
      running: SESSION.running,
    };
    console.log("[Farm] status", out);
    return out;
  }

  window.Farm = {
    start,
    stop,
    status,
    config: CFG,
    packs: packsLive,
    pickTarget,
    player,
  };

  console.log(
    "%c[Farm] Auto-farm prêt (île courante, toutes mers). Farm.start() / Farm.stop() / Farm.status()",
    "color:#6f6;font-weight:bold"
  );
  status();
})();
