/**
 * GLBot Level Console — coller en console F12 (page jeu authentifiée)
 * Test parallèle sur un autre compte, sans Python.
 *
 * Usage:
 *   await GLBot.status()
 *   await GLBot.plan()
 *   await GLBot.step()          // 1 action autonome
 *   await GLBot.loop(5)         // N steps
 *   await GLBot.farmNearest()
 *   await GLBot.travel("toroa")
 *   await GLBot.sellJunk()
 *   await GLBot.buyRation()
 *   await GLBot.probeTalk(["npc-xxx", ...])
 *   await GLBot.dumpFauna()
 *   GLBot.help()
 */
(async function () {
  "use strict";

  const API = "https://api.grandline-online.fr";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function findToken() {
    if (window.__freshToken) return window.__freshToken;
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        const v = sessionStorage.getItem(k);
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
    const TOKEN = findToken();
    if (!TOKEN) throw new Error("Pas de token — connecte-toi en jeu");
    const r = await fetch(API + path, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + TOKEN,
        accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await r.json();
    } catch {
      data = { raw: await r.text() };
    }
    return { status: r.status, data };
  }

  async function getChar() {
    const { status, data } = await api("GET", "/api/characters");
    if (status !== 200) throw new Error("characters " + status);
    const list = Array.isArray(data) ? data : data.characters || [];
    return list[0];
  }

  const JUNK = [
    "plumes",
    "viande-de-gibier",
    "bois-brut",
    "poisson-commun",
    "peau-tannee",
    "baies-sauvages",
    "algue-marine",
    "ble",
    "sel-marin",
  ];

  function invItems(c) {
    const inv = c.inventory || {};
    if (Array.isArray(inv)) return inv;
    if (Array.isArray(inv.items)) return inv.items;
    return [];
  }

  function countItem(c, id) {
    return invItems(c)
      .filter((it) => it && it.id === id)
      .reduce((s, it) => s + (it.quantity || 0), 0);
  }

  async function sellJunk() {
    const c = await getChar();
    const log = [];
    for (const it of invItems(c)) {
      if (!it || !JUNK.includes(it.id) || !it.quantity) continue;
      const r = await api("POST", "/api/economy/sell", {
        characterId: c.id,
        itemId: it.id,
        quantity: it.quantity,
      });
      log.push({ id: it.id, qty: it.quantity, status: r.status, paid: r.data && r.data.paid });
    }
    console.log("[GLBot] sellJunk", log);
    return log;
  }

  async function buyRation() {
    const c = await getChar();
    if (countItem(c, "ration") >= 1) return { ok: true, already: true };
    await sellJunk();
    const r = await api("POST", `/api/characters/${c.id}/buy`, {
      itemId: "ration",
      shopId: "port",
    });
    console.log("[GLBot] buyRation", r.status, r.data && (r.data.acquired || r.data.error));
    return r;
  }

  async function objectives() {
    const c = await getChar();
    const r = await api("GET", `/api/characters/${c.id}/quest-objectives`);
    return (r.data && r.data.objectifs) || [];
  }

  /** Plan offline-like (mirror level_core priority) */
  async function plan() {
    const c = await getChar();
    const objs = await objectives();
    const hp = c.currentHp,
      maxHp = c.maxHp;
    if (maxHp && hp / maxHp < 0.35) return { type: "rest", reason: "low hp" };
    if (objs.length) {
      const soft = objs.find((o) => ["fouille", "talk", "search"].includes((o.kind || "").toLowerCase()));
      if (soft) return { type: "quest", kind: soft.kind, id: soft.id, objective: soft };
      const hard = objs.find((o) => (o.kind || "").toLowerCase() === "combat");
      if (hard) return { type: "quest", kind: "combat", id: hard.id, objective: hard };
      return { type: "quest", id: objs[0].id, objective: objs[0] };
    }
    const discovered = c.discoveredLocations || [];
    const visited = new Set(c.visitedIslands || []);
    const unvisited = discovered.filter((i) => i && i !== c.mapId && !visited.has(i));
    if (unvisited.length) {
      return { type: "travel", islandId: unvisited[unvisited.length - 1], reason: "unlock" };
    }
    return { type: "farm", reason: "filler" };
  }

  async function rest() {
    const c = await getChar();
    return api("POST", "/api/world/rest", { characterId: c.id, kind: "BELLE_ETOILE" });
  }

  async function talk(npc) {
    const c = await getChar();
    return api("POST", `/api/characters/${c.id}/campaign/talk`, { npc });
  }

  async function probeTalk(list) {
    const hits = [];
    for (const npc of list) {
      const r = await talk(npc);
      const resolved = r.data && r.data.resolved;
      if (r.status === 200 && resolved && resolved.length) {
        hits.push({ npc, resolved });
        console.log("[GLBot] TALK HIT", npc, resolved);
      }
    }
    console.log("[GLBot] probeTalk hits", hits.length);
    return hits;
  }

  async function fightQuest(objectifId) {
    const c = await getChar();
    const start = await api("POST", "/api/battles/start", {
      characterId: c.id,
      objectifId,
    });
    if (start.status !== 200 || !start.data || !start.data.id) return start;
    const bid = start.data.id;
    await api("POST", `/api/battles/${bid}/engage`, { characterId: c.id });
    for (let i = 0; i < 120; i++) {
      const st = await api("GET", `/api/battles/${bid}`);
      const s = st.data;
      if (!s) {
        await sleep(200);
        continue;
      }
      if (s.winner || s.finished) return { winner: s.winner, battleId: bid };
      if (s.tactics && s.tactics.placementDone === false) {
        await api("POST", `/api/battles/${bid}/engage`, { characterId: c.id });
        await sleep(250);
        continue;
      }
      const my = s.yourTurn === true || (s.tactics && s.tactics.yourTurn === true);
      if (!my) {
        await sleep(150);
        continue;
      }
      // simple: end-turn if no smarter client; prefer skip/pass
      const actions = s.actions || s.availableActions || [];
      const atk = actions.find((a) => a.type === "skill" || a.kind === "skill" || a.id);
      if (atk && atk.id) {
        await api("POST", `/api/battles/${bid}/action`, {
          characterId: c.id,
          actionId: atk.id,
          targetId: (s.fighters || []).find((f) => f.team !== "ALLIE" || f.side === "enemy")?.id,
        });
      } else {
        await api("POST", `/api/battles/${bid}/end-turn`, { characterId: c.id });
      }
      await sleep(120);
    }
    return { error: "timeout", battleId: bid };
  }

  async function fightFauna(packId) {
    const c = await getChar();
    const start = await api("POST", "/api/battles/start", {
      characterId: c.id,
      fauna: packId,
    });
    console.log("[GLBot] fauna start", start.status, start.data && (start.data.id || start.data.error));
    if (start.status !== 200 || !start.data?.id) return start;
    const bid = start.data.id;
    await api("POST", `/api/battles/${bid}/engage`, { characterId: c.id });
    for (let i = 0; i < 150; i++) {
      const st = await api("GET", `/api/battles/${bid}`);
      const s = st.data;
      if (!s) {
        await sleep(200);
        continue;
      }
      if (s.winner || s.finished) {
        console.log("[GLBot] fauna winner", s.winner);
        return { winner: s.winner, battleId: bid };
      }
      if (s.tactics && s.tactics.placementDone === false) {
        await api("POST", `/api/battles/${bid}/engage`, { characterId: c.id });
        await sleep(250);
        continue;
      }
      if (!(s.yourTurn || (s.tactics && s.tactics.yourTurn))) {
        await sleep(150);
        continue;
      }
      // Laisse le client de jeu décider si GLBot inject est présent, sinon end-turn
      if (window.GLCombat && typeof window.GLCombat.playTurn === "function") {
        try {
          await window.GLCombat.playTurn(s);
        } catch {
          await api("POST", `/api/battles/${bid}/end-turn`, { characterId: c.id });
        }
      } else {
        await api("POST", `/api/battles/${bid}/end-turn`, { characterId: c.id });
      }
      await sleep(120);
    }
    return { error: "timeout", battleId: bid };
  }

  /** Dump fauna depuis le client Phaser si exposé, sinon message */
  function dumpFauna() {
    const candidates = [
      () => window.__fauna,
      () => window.faunaPacks,
      () => window.game?.scene?.scenes?.[0]?.fauna,
      () => window.glbot?.fauna,
    ];
    for (const fn of candidates) {
      try {
        const v = fn();
        if (v) {
          console.log("[GLBot] fauna", v);
          return v;
        }
      } catch {}
    }
    console.warn(
      "[GLBot] Fauna non exposée en JS. Utilise Network: filtre 'join' / observe packs, ou Python headless_world.fauna_packs()."
    );
    return null;
  }

  async function farmNearest() {
    // Sans coords socket, on tente des packIds connus par île
    const c = await getChar();
    const map = c.mapId;
    const guesses = {
      toroa: ["toroa-groupe-1-g160", "toroa-groupe-2-g182", "toroa-groupe-3-g61", "toroa-groupe-4-g60"],
      ohara: [],
      ilusia: [],
    };
    const list = guesses[map] || [];
    const xp0 = c.xp;
    for (const pid of list) {
      console.log("[GLBot] try pack", pid);
      const r = await fightFauna(pid);
      if (r.winner || (r.data && r.data.id)) {
        const c2 = await getChar();
        console.log("[GLBot] xp", xp0, "→", c2.xp, "Δ", c2.xp - xp0);
        return r;
      }
      if (r.status === 409) console.log("  409", r.data && r.data.error);
    }
    console.warn("[GLBot] aucun pack joignable (approche-toi manuellement d'un groupe puis relance)");
    return null;
  }

  async function travel(islandId) {
    const c = await getChar();
    console.log("[GLBot] travel", c.mapId, "→", islandId);
    await sellJunk();
    await buyRation();

    // try fast travel
    let r = await api("POST", "/api/world/travel", { characterId: c.id, islandId });
    if (r.status === 200) {
      console.log("[GLBot] world.travel OK");
      return r;
    }
    console.log("[GLBot] world.travel", r.status, r.data && r.data.error);

    // sea path
    r = await api("POST", "/api/sea/depart", { characterId: c.id, mode: "navire" });
    if (r.status !== 200) {
      for (const sortie of ["sud", "ouest", "est", "nord"]) {
        r = await api("POST", "/api/sea/depart", {
          characterId: c.id,
          mode: "navire",
          sortie,
        });
        if (r.status === 200) break;
      }
    }
    if (r.status !== 200) {
      console.error("[GLBot] depart fail — place-toi sur le ponton exact");
      return r;
    }
    console.log("[GLBot] atSea");

    const cap = await api("POST", "/api/sea/cap", { characterId: c.id, islandId });
    if (cap.status !== 200) {
      console.error("[GLBot] cap", cap.data);
      return cap;
    }
    const plan = cap.data.plan || {};
    const entry = plan.entry,
      arrival = plan.arrival,
      tiles = plan.tiles || [];
    const dist = plan.distanceCases || 50;
    const N = Math.max(10, Math.floor(dist / 20));
    console.log("[GLBot] plan waypoints", N, "tiles", tiles.length);

    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const ti = tiles.length ? Math.min(tiles.length - 1, Math.round(t * (tiles.length - 1))) : 0;
      const body = {
        characterId: c.id,
        col: tiles[ti] ? tiles[ti].col : entry.col,
        row: tiles[ti] ? tiles[ti].row : entry.row,
        x: entry.x + t * (arrival.x - entry.x),
        y: entry.y + t * (arrival.y - entry.y),
      };
      for (let a = 0; a < 8; a++) {
        const pos = await api("POST", "/api/sea/position", body);
        if (pos.status === 200) break;
        const err = (pos.data && pos.data.error) || "";
        if (String(err).toLowerCase().includes("vite")) await sleep(2400);
        else break;
      }
      await sleep(1800);
    }

    const dock = await api("POST", "/api/sea/dock", { characterId: c.id, islandId });
    console.log("[GLBot] dock", dock.status, dock.data && (dock.data.destinationId || dock.data.error));
    const c2 = await getChar();
    console.log("[GLBot] now", c2.mapId, c2.x, c2.y, "xp", c2.xp, c2.campaign);
    return dock;
  }

  async function step() {
    const c0 = await getChar();
    const p = await plan();
    console.log("[GLBot] plan", p, "|", c0.mapId, "lvl", c0.level, "xp", c0.xp);
    if (p.type === "rest") return rest();
    if (p.type === "quest" && p.kind === "combat") return fightQuest(p.id);
    if (p.type === "quest") {
      // try search then talk patterns
      if (p.objective && p.objective.id) {
        const s = await api("POST", `/api/characters/${c0.id}/quest-search`, {
          objectifId: p.objective.id,
        });
        if (s.status === 200) return s;
      }
      return p;
    }
    if (p.type === "travel") return travel(p.islandId);
    if (p.type === "farm") return farmNearest();
    return p;
  }

  async function loop(n = 5) {
    const log = [];
    for (let i = 0; i < n; i++) {
      console.log(`\n=== STEP ${i + 1}/${n} ===`);
      const r = await step();
      log.push(r);
      await sleep(500);
    }
    const c = await getChar();
    console.log("[GLBot] DONE", c.mapId, "lvl", c.level, "xp", c.xp, c.campaign);
    return log;
  }

  async function status() {
    const c = await getChar();
    const objs = await objectives();
    const daily = await api("GET", `/api/characters/${c.id}/daily`);
    const sea = await api("GET", `/api/sea/${c.id}`);
    const out = {
      name: c.name,
      mapId: c.mapId,
      x: c.x,
      y: c.y,
      level: c.level,
      xp: c.xp,
      hp: c.currentHp,
      campaign: c.campaign,
      discovered: c.discoveredLocations,
      visited: c.visitedIslands,
      objectives: objs,
      dailyClaimed: daily.data && daily.data.claimedToday,
      atSea: sea.data && sea.data.atSea,
      rations: countItem(c, "ration"),
    };
    console.log("[GLBot] status", out);
    return out;
  }

  function help() {
    console.log(`GLBot Level Console
  await GLBot.status()
  await GLBot.plan()
  await GLBot.step()
  await GLBot.loop(5)
  await GLBot.farmNearest()
  await GLBot.travel("toroa")
  await GLBot.sellJunk()
  await GLBot.buyRation()
  await GLBot.probeTalk(["npc-xxx"])
  await GLBot.dumpFauna()
  await GLBot.talk("npc-lucien-le-pelerin")
`);
  }

  window.GLBot = {
    status,
    plan,
    step,
    loop,
    farmNearest,
    travel,
    sellJunk,
    buyRation,
    probeTalk,
    dumpFauna,
    talk,
    fightFauna,
    fightQuest,
    objectives,
    help,
    api,
    getChar,
  };

  console.log("%c[GLBot] Level console prêt — GLBot.help()", "color:#6f6;font-weight:bold");
})();
