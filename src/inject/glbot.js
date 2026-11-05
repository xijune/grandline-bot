/**
 * GrandLine Online Bot - Script injectable
 * Version : 1.2.0 (05/11/2026)
 *
 * Module farm map + combat FAUNE.
 * Pour le combat optimal pure-API, préférer aussi combat-module.js (GLCombat).
 *
 * v1.2 :
 * - Pathfinder A* avec heuristique Manhattan (beaucoup plus rapide et direct que BFS pur)
 * - Délais humanisés (jitter gaussien pour limiter les signatures régulières)
 * - Système d'événements Event Emitter (GLBot.on, GLBot.off, GLBot.emit)
 * - Gestion automatique du Rate-Limiting (HTTP 429) avec backoff exponentiel
 * - Prise en compte des cases piégées/hazards en combat tactique
 *
 * v1.1 :
 * - Pathfinder walkable BFS 4-dir (movementBlocked + blocked)
 * - escapeBlockedCell (sortie eau / case invalide)
 * - walkTo / findPath / debugPath
 *
 * v1.0 :
 * - IA combat decideCombatTurn (sweet spot, kite, finishers, targetCell)
 * - ATTAQUE range 1 serveur (techniques distance)
 * - characterId dans payloads action
 * - Rest BELLE_ETOILE API, berries/loot tracking
 *
 * Usage :
 * 1. Se connecter et entrer en jeu
 * 2. Console F12 → coller ce fichier
 * 3. GLBot.startFarm()
 *    GLBot.walkTo({x,y}) / GLBot.debugPath(x,y) / GLBot.escapeBlockedCell()
 * Optionnel : coller aussi combat-module.js → GLCombat.arm()
 */


(function () {
  "use strict";

  const scene = window.__grandlineScene;
  if (!scene) {
    console.error("[GLBot] ❌ window.__grandlineScene introuvable. Es-tu bien en jeu ?");
    return;
  }

  // ============================================================
  // CONFIG
  // ============================================================
  const CONFIG = {
    attackRange: 6,
    moveStep: 12, // chunks validés live (BFS → moveLocal)
    loopDelayMove: 400,
    loopDelayAttack: 1500,
    loopDelayIdle: 2000,
    maxMonstersLog: 6,

    // Repos / Forme
    hpRestThreshold: 0.35,
    minHpToFight: 30,
    formeRestThreshold: 40,
    preferShipRest: true,
    restEnabled: true,
    belleEtoileCooldownMs: 10 * 60 * 1000, // ~10 min

    // Cibles (filtres packs)
    maxTargetLevelDelta: 2,       // niveau mob <= joueur + delta
    minTargetLevel: 0,            // ignorer les packs trop bas (0 = aucun filtre)
    preferWeakSpecies: true,
    onlyWeakSpecies: false,       // true = ne cible QUE weakSpecies
    weakSpecies: ["rat", "chien", "vautour", "oiseau"],
    avoidSpecies: ["mercenaire"],
    preferLowerLevel: true,       // bonus de score aux packs plus faibles que le joueur

    // Combat AI (inspiré combattourpartour V18)
    guardHpPct: 0.50,
    fleeHpPct: 0.20,
    finisherWeight: 10000,
    focusLowHpWeight: 100,
    kiteMeleeEnabled: true,
    maxConsecutiveKites: 3,
    safeDistMargin: 1,
    combatVerbose: true,

    // Inventaire
    pauseOnFullInventory: true,
    inventoryFullPollMs: 12000,

    // Ground drops (hors combat)
    autoPickupDrops: true,
    pickupRange: 4,

    // Combat
    fleeHpPercent: 0.25,
    combatPollMs: 800,
    combatEndWaitMs: 1500,
    onlyFaune: true,
    maxCombatLoops: 100,

    // Anti-blocage map
    stuckTicksBeforeNudge: 4,
    nudgeSteps: 3
  };

  // ============================================================
  // ÉTAT SESSION
  // ============================================================
  const STATE = { consecutiveKites: 0 };
  const SESSION = {
    startedAt: null,
    fightsWon: 0,
    fightsLost: 0,
    berriesStart: null,
    berriesGained: 0,
    rests: 0,
    skippedEngaged: 0,
    stuckNudges: 0,
    pickups: 0,
    itemsLooted: 0,
    inventoryFullPauses: 0,
    lastBelleEtoileAt: 0,
    lastPos: null,
    stuckTicks: 0,
    blacklistPacks: new Map() // packId -> expireTs
  };

  function sessionStats() {
    const p = getPlayer();
    const berriesNow = p?.berries ?? scene.character?.berries ?? 0;
    if (SESSION.berriesStart == null && berriesNow != null) {
      SESSION.berriesStart = berriesNow;
    }
    const elapsed = SESSION.startedAt
      ? Math.round((Date.now() - SESSION.startedAt) / 1000)
      : 0;
    return {
      elapsedSec: elapsed,
      fightsWon: SESSION.fightsWon,
      fightsLost: SESSION.fightsLost,
      berriesGained: berriesNow - (SESSION.berriesStart ?? berriesNow),
      rests: SESSION.rests,
      skippedEngaged: SESSION.skippedEngaged,
      stuckNudges: SESSION.stuckNudges,
      pickups: SESSION.pickups,
      itemsLooted: SESSION.itemsLooted,
      inventoryFullPauses: SESSION.inventoryFullPauses
    };
  }

  function logSession() {
    const s = sessionStats();
    console.log(
      `[GLBot] 📊 Session ${s.elapsedSec}s | W/L ${s.fightsWon}/${s.fightsLost} | +${s.berriesGained} berries | loot items +${s.itemsLooted} | rests ${s.rests}`
    );
  }

  // ============================================================
  // BYPASS CONFIRMATION
  // ============================================================
  try {
    scene.confirmationDattaqueDemandee = () => false;
  } catch (e) {
    console.warn("[GLBot] Impossible de patcher confirmationDattaqueDemandee");
  }

  // ============================================================
  // LECTURE D'ÉTAT
  // ============================================================
  function getPlayer() {
    const c = scene.character;
    if (!c) return null;

    // Position live = entité (character.x peut être en retard)
    const ent = scene.entities?.get?.(c.id);
    const x = ent?.x ?? c.x;
    const y = ent?.y ?? c.y;
    const moving = !!ent?.moving;

    // Forme : character.vitality peut rester stale après repos UI
    let vitality = Number.isFinite(c.vitality) ? c.vitality : (Number.isFinite(c.hpVitality) ? c.hpVitality : 100);

    // HP affiché UI (source fiable) — character.currentHp reste souvent à 1
    const domHpRaw = document.querySelector("b.coeur-pv")?.textContent?.trim();
    const domHp = domHpRaw != null && /^\d+$/.test(domHpRaw) ? parseInt(domHpRaw, 10) : null;
    const currentHp = domHp ?? c.currentHp ?? c.hp ?? 0;
    // maxHp non exposé clairement ; on approxime via DOM si possible
    const maxHp =
      c.maxHp ??
      c.maxHP ??
      c.hpMax ??
      c.stats?.maxHp ??
      c.stats?.hpMax ??
      (domHp != null ? Math.max(domHp, 200) : Math.max(currentHp, 1));

    const ship = c.ship || null;

    return {
      id: c.id,
      name: c.name,
      x,
      y,
      moving,
      level: c.level,
      berries: (() => {
        // character.berries souvent stale après combat ; UI ฿ est fiable
        const m = document.body.innerText.match(/฿\s*(\d+)/);
        if (m) return parseInt(m[1], 10);
        return c.berries;
      })(),
      bounty: c.bounty,
      dead: c.dead,
      currentHp,
      maxHp,
      vitality,
      formeLabel: formeLabel(vitality),
      hpPercent: maxHp > 0 ? currentHp / maxHp : 1,
      inventory: c.inventory || null,
      shipOwned: !!(ship && ship.owned),
      domHp
    };
  }

  /**
   * Détection inventaire plein – structure réelle client (testée 30/10/2026) :
   *   character.inventory = {
   *     bagCapacity: 24,
   *     bonusCapacity: 0,
   *     fruitCapacity: 0,
   *     items: [ { id, name, quantity }, ... ]
   *   }
   * max = bagCapacity + bonusCapacity
   * used = items.length
   */
  function inspectInventory() {
    const c = scene.character || {};
    const inv = c.inventory;

    // Chemin officiel confirmé en live
    if (inv && typeof inv === "object" && !Array.isArray(inv)) {
      const max =
        (Number(inv.bagCapacity) || 0) + (Number(inv.bonusCapacity) || 0) ||
        inv.max ||
        inv.capacity ||
        inv.slots ||
        null;
      let used = null;
      if (Array.isArray(inv.items)) used = inv.items.length;
      else if (typeof inv.used === "number") used = inv.used;
      else if (typeof inv.count === "number") used = inv.count;

      if (inv.full === true || inv.isFull === true || inv.plein === true) {
        return { full: true, used, max, source: "flag" };
      }
      if (max != null && used != null) {
        return { full: used >= max, used, max, source: "bagCapacity+items" };
      }
    }

    // Fallbacks anciens / autres builds
    for (const cand of [c.items, c.bag, c.sac, scene.network?.inventory].filter(Boolean)) {
      if (Array.isArray(cand)) continue;
      if (typeof cand === "object") {
        const max = cand.max ?? cand.capacity ?? cand.bagCapacity ?? null;
        const used = Array.isArray(cand.items) ? cand.items.length : cand.used ?? null;
        if (max != null && used != null) {
          return { full: used >= max, used, max, source: "fallback" };
        }
      }
    }

    const tip = document.body.innerText || "";
    if (/inventaire plein|sac plein|plus de place|plus assez de place/i.test(tip)) {
      return { full: true, used: null, max: null, source: "dom" };
    }
    return { full: false, used: null, max: null, source: "none" };
  }

  function isInventoryFull() {
    return inspectInventory().full;
  }

  function debugInventory() {
    const info = inspectInventory();
    console.log("%c[GLBot] Inventaire", "color:#ffb74d;font-weight:bold", info);
    console.log("character.inventory =", scene.character?.inventory);
    console.log("character.items =", scene.character?.items);
    console.log("character.bag =", scene.character?.bag);
    return info;
  }

  function formeLabel(v) {
    if (v >= 85) return "En pleine forme";
    if (v >= 60) return "Un peu marqué";
    if (v >= 35) return "Fatigué";
    if (v > 0) return "Épuisé";
    return "À plat";
  }

  function getMonsters() {
    const packs = scene.network?.fauna?.packs || [];
    const engaged = scene.faunaEngagees || scene.network?.fauna?.engagees || null;
    const faunaEntities = scene.faunaEntities; // Map packId -> entity (requis pour attaquer)
    const list = [];
    const now = Date.now();
    // purge blacklist
    for (const [id, exp] of SESSION.blacklistPacks) {
      if (exp < now) SESSION.blacklistPacks.delete(id);
    }

    for (const pack of packs) {
      if (!pack.mobs) continue;
      if (SESSION.blacklistPacks.has(pack.id)) continue;
      const isEngaged =
        (engaged && typeof engaged.has === "function" && engaged.has(pack.id)) ||
        pack.engaged === true ||
        pack.enCombat === true;
      // Seuls les packs présents dans faunaEntities sont attaquables (test live)
      const attackable =
        (faunaEntities && typeof faunaEntities.has === "function" && faunaEntities.has(pack.id)) ||
        (faunaEntities && faunaEntities.get && faunaEntities.get(pack.id) != null);
      for (const mob of pack.mobs) {
        const orbit = mob.orbit || {};
        list.push({
          id: mob.id,
          packId: pack.id,
          espece: mob.espece || "inconnu",
          niveau: mob.niveau || 0,
          engaged: !!isEngaged,
          attackable: !!attackable,
          x: orbit.cx ?? pack.ancre?.x ?? null,
          y: orbit.cy ?? pack.ancre?.y ?? null
        });
      }
    }
    return list;
  }

  function distance(a, b) {
    if (a?.x == null || b?.x == null) return Infinity;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function isWeakSpecies(espece) {
    const e = String(espece || "").toLowerCase();
    return CONFIG.weakSpecies.some(w => e.includes(w));
  }

  function isAvoidSpecies(espece) {
    const e = String(espece || "").toLowerCase();
    return CONFIG.avoidSpecies.some(w => e.includes(w));
  }

  /**
   * Cible valide pour APPROCHE (tous les packs de la map filtrés).
   * Ne requiert PAS attackable — on s'approche jusqu'à chargement faunaEntities.
   */
  function isValidTarget(m, player) {
    if (!m || m.x == null || m.y == null) return false;
    if (m.engaged) return false;
    if (isAvoidSpecies(m.espece)) return false;
    if (CONFIG.onlyWeakSpecies && !isWeakSpecies(m.espece)) return false;

    const pLvl = player?.level || 1;
    const maxLvl = pLvl + CONFIG.maxTargetLevelDelta;
    if (m.niveau > maxLvl) return false;
    if (CONFIG.minTargetLevel > 0 && m.niveau < CONFIG.minTargetLevel) return false;

    return true;
  }

  /** Pack chargé client-side → attaque possible */
  function isAttackable(m) {
    if (!m) return false;
    if (m.attackable === true) return true;
    if (!scene.faunaEntities) return true; // fallback si Map absente
    return !!(
      scene.faunaEntities.has?.(m.packId) ||
      scene.faunaEntities.get?.(m.packId)
    );
  }

  /**
   * Score plus bas = meilleure cible.
   * Priorité aux packs déjà attackable, puis faibles, puis proches.
   */
  function scoreTarget(m, player) {
    let s = distance(player, m);
    if (isAttackable(m)) s -= 25; // fort bonus packs chargés
    if (CONFIG.preferWeakSpecies && isWeakSpecies(m.espece)) s -= 10;
    const pLvl = player?.level || 1;
    if (m.niveau > pLvl) s += (m.niveau - pLvl) * 4;
    else if (CONFIG.preferLowerLevel && m.niveau < pLvl) s -= Math.min(6, (pLvl - m.niveau) * 1.5);
    return s;
  }

  function getClosest(filterFn = null) {
    const player = getPlayer();
    if (!player) return null;
    let monsters = getMonsters().filter(m => isValidTarget(m, player));
    if (typeof filterFn === "function") monsters = monsters.filter(filterFn);
    if (!monsters.length) return null;
    return monsters.reduce((best, m) =>
      scoreTarget(m, player) < scoreTarget(best, player) ? m : best
    );
  }

  function blacklistPack(packId, ms = 30000) {
    if (!packId) return;
    SESSION.blacklistPacks.set(packId, Date.now() + ms);
    SESSION.skippedEngaged++;
  }

  // ============================================================
  // REPOS (Forme + PV) — options gratuites uniquement
  // Kinds réels testés en live :
  //   AUBERGE      → payant / taverne (IGNORÉ)
  //   NAVIRE       → couchette (gratuit, besoin d'un navire)
  //   BELLE_ETOILE → à la belle étoile (gratuit, cap forme ~50)
  // ============================================================

  // ============================================================
  // ÉVÉNEMENTS & DÉLAIS HUMANISÉS
  // ============================================================
  const LISTENERS = new Map();

  function on(event, callback) {
    if (!LISTENERS.has(event)) LISTENERS.set(event, []);
    LISTENERS.get(event).push(callback);
    return () => off(event, callback);
  }

  function off(event, callback) {
    if (!LISTENERS.has(event)) return;
    LISTENERS.set(event, LISTENERS.get(event).filter(cb => cb !== callback));
  }

  function emit(event, data) {
    const list = LISTENERS.get(event) || [];
    for (const cb of list) {
      try { cb(data); } catch (e) { console.error(`[GLBot] Error in listener for ${event}:`, e); }
    }
  }

  /** Variation aléatoire réaliste pour humaniser les délais et briser les signatures d'automatisation */
  function jitter(ms, variancePct = 0.25) {
    const delta = ms * variancePct;
    return Math.max(50, Math.round(ms + (Math.random() * 2 - 1) * delta));
  }

  function sleep(ms, humanize = true) {
    const finalMs = humanize ? jitter(ms) : ms;
    return new Promise(r => setTimeout(r, finalMs));
  }

  /** Ouvre le panneau "Se reposer" via le bouton UI */
  async function openRestPanel() {
    // Déjà ouvert ?
    if (document.querySelector('button[data-rest]')) return true;

    const btn = document.querySelector("button.open-rest");
    if (!btn) return false;
    btn.click();
    await sleep(600);
    return !!document.querySelector('button[data-rest]');
  }

  /** Ferme le panneau de repos */
  async function closeRestPanel() {
    const close =
      document.querySelector(".close-systems") ||
      Array.from(document.querySelectorAll("button")).find(b =>
        /retour au jeu|fermer|×/i.test(b.innerText)
      );
    if (close) {
      close.click();
      await sleep(400);
    }
  }

  /**
   * Liste les options de repos disponibles (non disabled).
   * Ne retourne jamais AUBERGE.
   */
  function listAvailableRests() {
    const buttons = Array.from(document.querySelectorAll("button[data-rest]"));
    const allowed = ["NAVIRE", "BELLE_ETOILE"];
    return buttons
      .filter(b => !b.disabled && allowed.includes(b.getAttribute("data-rest")))
      .map(b => ({
        kind: b.getAttribute("data-rest"),
        el: b
      }));
  }

  /**
   * Effectue un repos via l'UI (fiable).
   * kind optionnel : "NAVIRE" | "BELLE_ETOILE"
   * Si omis → prend la première option gratuite disponible.
   */
  async function doRest(kind = null) {
    const opened = await openRestPanel();
    if (!opened) return { ok: false, error: "panneau Se reposer introuvable" };

    const available = listAvailableRests();
    if (available.length === 0) {
      await closeRestPanel();
      return { ok: false, error: "aucune option gratuite disponible (navire manquant ou forme déjà > 50)" };
    }

    let choice = available[0];
    if (kind) {
      const found = available.find(a => a.kind === kind);
      if (!found) {
        await closeRestPanel();
        return { ok: false, error: `option ${kind} indisponible` };
      }
      choice = found;
    } else if (CONFIG.preferShipRest) {
      const ship = available.find(a => a.kind === "NAVIRE");
      if (ship) choice = ship;
    }

    // Clic réel sur Dormir
    choice.el.click();
    await sleep(1800);

    if (choice.kind === "BELLE_ETOILE") {
      SESSION.lastBelleEtoileAt = Date.now();
      // BELLE_ETOILE plafonne à ~50 forme (confirmé live)
      if (scene.character && Number(scene.character.vitality) < 50) {
        scene.character.vitality = 50;
        scene.character.hpVitality = 50;
      }
    }
    SESSION.rests++;

    await closeRestPanel();
    await sleep(400);
    const player = getPlayer();
    console.log(
      `[GLBot] ✅ Repos ${choice.kind} — HP ${player?.currentHp} (DOM ${player?.domHp}) · Forme ${Math.round(player?.vitality ?? 0)}`
    );
    return { ok: true, kind: choice.kind };
  }

  function canUseBelleEtoile() {
    const elapsed = Date.now() - (SESSION.lastBelleEtoileAt || 0);
    return elapsed >= CONFIG.belleEtoileCooldownMs;
  }

  /**
   * Se repose si HP bas ou Forme basse.
   * Options gratuites uniquement (NAVIRE, BELLE_ETOILE).
   */
  async function tryRestIfNeeded() {
    const player = getPlayer();
    if (!player || player.dead) return false;

    const needHp =
      player.hpPercent < CONFIG.hpRestThreshold ||
      player.currentHp <= 5 ||
      player.currentHp < CONFIG.minHpToFight;
    const needForme = player.vitality < CONFIG.formeRestThreshold;

    if (!needHp && !needForme) return false;

    if (!canUseBelleEtoile()) {
      const left = Math.ceil(
        (CONFIG.belleEtoileCooldownMs - (Date.now() - SESSION.lastBelleEtoileAt)) / 1000
      );
      // NAVIRE peut rester dispo même pendant CD belle étoile
      console.log(`[GLBot] 💤 Belle étoile en CD (~${left}s) — tentative NAVIRE si dispo`);
    }

    console.log(
      `[GLBot] 💤 Repos nécessaire (HP ${player.currentHp} · Forme ${Math.round(player.vitality)}/100 – ${player.formeLabel})`
    );

    // Préférer NAVIRE si belle étoile en CD
    let prefer = null;
    if (!canUseBelleEtoile()) prefer = "NAVIRE";
    const result = await doRest(prefer);
    if (!result.ok && prefer) {
      // si NAVIRE fail et CD ok, retry auto choice
      if (canUseBelleEtoile()) {
        const r2 = await doRest(null);
        if (!r2.ok) console.warn("[GLBot] Repos impossible:", r2.error);
        return r2.ok;
      }
      console.warn("[GLBot] Repos impossible:", result.error);
      return false;
    }
    if (!result.ok) console.warn("[GLBot] Repos impossible:", result.error);
    return result.ok;
  }

  // ============================================================
  // PATHFINDER WALKABLE (BFS 4-dir)
  // ============================================================
  /**
   * Sources de blocage (ordre de priorité) :
   * 1. scene.movementBlocked  — Set "x:y" (client, authoritative)
   * 2. scene.blocked / mapData.blocked — array ou set
   * 3. Hors bounds mapData.width/height
   *
   * Les passages (scene.passages) sont marchables sauf règle client
   * déjà intégrée dans movementBlocked.
   */
  const DIRS4 = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];

  function cellKey(x, y) {
    return `${x}:${y}`;
  }

  function mapBounds() {
    const md = scene.mapData || {};
    return {
      w: md.width || 256,
      h: md.height || 256,
      maxSteps: md.maxSteps || 24
    };
  }

  /** True si la case est interdite à la marche */
  function isBlocked(x, y, { allowStart = false, start = null } = {}) {
    const { w, h } = mapBounds();
    if (x < 0 || y < 0 || x >= w || y >= h) return true;
    if (allowStart && start && x === start.x && y === start.y) return false;

    const k = cellKey(x, y);

    // 1. movementBlocked (Set)
    const mb = scene.movementBlocked;
    if (mb && typeof mb.has === "function" && mb.has(k)) return true;

    // 2. blocked — Set, Map, Array de "x:y", ou grille
    const blocked = scene.blocked || scene.mapData?.blocked;
    if (blocked) {
      if (typeof blocked.has === "function" && blocked.has(k)) return true;
      if (Array.isArray(blocked)) {
        // array of strings or {x,y}
        for (let i = 0; i < blocked.length; i++) {
          const b = blocked[i];
          if (typeof b === "string" && b === k) return true;
          if (b && b.x === x && b.y === y) return true;
        }
        // dense grid? blocked[y*w+x] — rare, skip if huge
      }
      if (blocked[k]) return true;
    }

    return false;
  }

  /** Case libre (marchable) */
  function isWalkable(x, y, opts) {
    return !isBlocked(x, y, opts);
  }

  /**
   * Pathfinder A* avec heuristique de Manhattan et seuil adaptatif.
   * Amplement plus rapide que le BFS pur sur les longues distances et contournements.
   * @returns {Array<{x,y}>|null} chemin incluant départ et arrivée
   */
  function findPath(from, to, maxLen = 140) {
    if (!from || !to || from.x == null || to.x == null) return null;
    const sx = Math.round(from.x);
    const sy = Math.round(from.y);
    let tx = Math.round(to.x);
    let ty = Math.round(to.y);

    if (sx === tx && sy === ty) return [{ x: sx, y: sy }];

    // Cible bloquée → case libre la plus proche
    if (isBlocked(tx, ty)) {
      const alt = nearestWalkable({ x: tx, y: ty }, 8);
      if (alt) {
        tx = alt.x;
        ty = alt.y;
      }
    }

    const { w, h } = mapBounds();
    const startKey = cellKey(sx, sy);
    const goalKey = cellKey(tx, ty);

    // File avec scores f = g + h
    const openSet = [{ x: sx, y: sy, g: 0, f: Math.abs(sx - tx) + Math.abs(sy - ty) }];
    const came = new Map();
    came.set(startKey, null);
    const gScore = new Map();
    gScore.set(startKey, 0);

    let found = null;
    let iterations = 0;
    const maxIterations = maxLen * 20;

    while (openSet.length > 0 && iterations++ < maxIterations) {
      // Noeud avec plus faible score f
      let bestIdx = 0;
      for (let i = 1; i < openSet.length; i++) {
        if (openSet[i].f < openSet[bestIdx].f) bestIdx = i;
      }
      const cur = openSet.splice(bestIdx, 1)[0];
      const ck = cellKey(cur.x, cur.y);

      if (ck === goalKey) {
        found = cur;
        break;
      }

      if (cur.g >= maxLen) continue;

      for (const d of DIRS4) {
        const nx = cur.x + d.x;
        const ny = cur.y + d.y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

        const nk = cellKey(nx, ny);
        if (isBlocked(nx, ny) && nk !== startKey) continue;

        const tentativeG = cur.g + 1;
        if (!gScore.has(nk) || tentativeG < gScore.get(nk)) {
          came.set(nk, cur);
          gScore.set(nk, tentativeG);
          const hScore = Math.abs(nx - tx) + Math.abs(ny - ty);
          const fScore = tentativeG + hScore;

          const inOpen = openSet.find(n => n.x === nx && n.y === ny);
          if (inOpen) {
            inOpen.g = tentativeG;
            inOpen.f = fScore;
          } else {
            openSet.push({ x: nx, y: ny, g: tentativeG, f: fScore });
          }
        }
      }
    }

    if (!found) return null;

    const path = [];
    let cur = found;
    while (cur) {
      path.push({ x: cur.x, y: cur.y });
      cur = came.get(cellKey(cur.x, cur.y));
    }
    path.reverse();
    return path;
  }

  /** Plus proche case walkable autour d'un point (spirale / BFS local) */
  function nearestWalkable(center, radius = 12) {
    const cx = Math.round(center.x);
    const cy = Math.round(center.y);
    if (isWalkable(cx, cy)) return { x: cx, y: cy };

    const { w, h } = mapBounds();
    const queue = [{ x: cx, y: cy }];
    const seen = new Set([cellKey(cx, cy)]);
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const dist = Math.abs(cur.x - cx) + Math.abs(cur.y - cy);
      if (dist > radius) continue;
      if (dist > 0 && isWalkable(cur.x, cur.y)) return { x: cur.x, y: cur.y };
      for (const d of DIRS4) {
        const nx = cur.x + d.x;
        const ny = cur.y + d.y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nk = cellKey(nx, ny);
        if (seen.has(nk)) continue;
        seen.add(nk);
        queue.push({ x: nx, y: ny });
      }
    }
    return null;
  }

  /**
   * Si le joueur est sur une case bloquée (eau…), sortir vers la terre.
   * @returns {Promise<boolean>}
   */
  async function escapeBlockedCell() {
    const player = getPlayer();
    if (!player) return false;
    const x = Math.round(player.x);
    const y = Math.round(player.y);
    if (!isBlocked(x, y)) return true;

    console.log(`[GLBot] 🌊 Case bloquée (${x},${y}) — recherche sortie…`);
    const safe = nearestWalkable({ x, y }, 20);
    if (!safe) {
      console.warn("[GLBot] Aucune case walkable proche");
      return false;
    }
    console.log(`[GLBot] → sortie vers (${safe.x},${safe.y})`);
    return walkTo(safe, { maxChunk: 8, retries: 3 });
  }

  /**
   * Tronque un chemin long en segment ≤ maxChunk cases (hors départ).
   */
  function chunkPath(path, maxChunk = 12) {
    if (!path || path.length < 2) return path;
    if (path.length - 1 <= maxChunk) return path;
    return path.slice(0, maxChunk + 1);
  }

  /** Attend la fin du mouvement en cours */
  async function waitUntilStopped(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const p = getPlayer();
      if (!p?.moving) return true;
      await sleep(150);
    }
    return false;
  }

  /**
   * Exécute moveLocal sur un path, avec redresserLeChemin si dispo.
   */
  async function executePath(path, { courir = true } = {}) {
    if (!path || path.length < 2) return false;

    let p = path.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y) }));

    // Dédupliquer cases consécutives
    p = p.filter((c, i) => i === 0 || c.x !== p[i - 1].x || c.y !== p[i - 1].y);
    if (p.length < 2) return false;

    if (typeof scene.redresserLeChemin === "function") {
      try {
        const fixed = scene.redresserLeChemin(p);
        if (Array.isArray(fixed) && fixed.length >= 2) p = fixed;
      } catch (_) {}
    }

    try {
      await scene.moveLocal(p, null, { courir, redresser: true });
      await waitUntilStopped(Math.min(600 + p.length * 220, 8000));
      return true;
    } catch (e) {
      console.warn("[GLBot] moveLocal:", e.message || e);
      return false;
    }
  }

  /**
   * Marche vers une cible en chemins BFS walkable, par chunks.
   * Gère case départ bloquée (eau).
   *
   * @param {{x,y}} target
   * @param {{maxChunk?:number, retries?:number, stopDist?:number}} opts
   */
  async function walkTo(target, opts = {}) {
    const maxChunk = opts.maxChunk ?? Math.max(CONFIG.moveStep, 8);
    const retries = opts.retries ?? 5;
    const stopDist = opts.stopDist ?? 1;

    let player = getPlayer();
    if (!player || !target || target.x == null) return false;

    // Case PNJ souvent dans movementBlocked → viser case libre adjacente
    let goal = { x: Math.round(target.x), y: Math.round(target.y) };
    if (isBlocked(goal.x, goal.y)) {
      const alt = nearestWalkable(goal, 8);
      if (alt) goal = alt;
    }

    // Sortir de l'eau / case bloquée d'abord
    if (isBlocked(Math.round(player.x), Math.round(player.y))) {
      const escaped = await escapeBlockedCell();
      if (!escaped) return false;
      player = getPlayer();
    }

    for (let attempt = 0; attempt < retries; attempt++) {
      player = getPlayer();
      if (!player) return false;
      if (player.moving) await waitUntilStopped(2000);

      const from = { x: Math.round(player.x), y: Math.round(player.y) };
      const to = goal;
      const dist = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      if (dist <= stopDist) return true;

      let path = findPath(from, to, 120);
      if (!path || path.length < 2) {
        // Fallback : ligne droite X puis Y (ancien comportement)
        path = buildGridPathFallback(from, to, maxChunk + 2);
        console.warn("[GLBot] BFS échec — fallback ligne", from, "→", to);
      }

      const segment = chunkPath(path, maxChunk);
      if (!segment || segment.length < 2) return false;

      const ok = await executePath(segment, { courir: dist > 6 });
      if (!ok) {
        // Petit nudge aléatoire pour débloquer
        const nudge = nearestWalkable(
          {
            x: from.x + (Math.random() > 0.5 ? 2 : -2),
            y: from.y + (Math.random() > 0.5 ? 2 : -2)
          },
          4
        );
        if (nudge) await executePath([from, nudge], { courir: false });
        await sleep(300);
        continue;
      }

      player = getPlayer();
      const nd = Math.abs(Math.round(player.x) - to.x) + Math.abs(Math.round(player.y) - to.y);
      if (nd <= stopDist) return true;
    }

    player = getPlayer();
    const finalDist =
      Math.abs(Math.round(player.x) - Math.round(target.x)) +
      Math.abs(Math.round(player.y) - Math.round(target.y));
    return finalDist <= stopDist + 2;
  }

  /** Ancien builder X-puis-Y (fallback sans obstacles) */
  function buildGridPathFallback(from, to, maxSteps = 24) {
    const path = [{ x: from.x, y: from.y }];
    let x = from.x;
    let y = from.y;
    const tx = Math.round(to.x);
    const ty = Math.round(to.y);
    let steps = 0;
    while (x !== tx && steps < maxSteps) {
      x += Math.sign(tx - x);
      path.push({ x, y });
      steps++;
    }
    while (y !== ty && steps < maxSteps) {
      y += Math.sign(ty - y);
      path.push({ x, y });
      steps++;
    }
    return path;
  }

  /**
   * Déplacement vers une cible (monstre, drop, PNJ…).
   * Utilise le pathfinder walkable.
   */
  async function moveToward(target, maxSteps = CONFIG.moveStep) {
    if (!target || target.x == null) return false;
    const player = getPlayer();
    if (!player) return false;
    const dist = distance(player, target);
    if (dist <= 2) return true;

    // Un seul chunk vers la cible (comportement farm loop)
    return walkTo(target, {
      maxChunk: maxSteps + 4,
      retries: 3,
      stopDist: 2
    });
  }

  /** Debug pathfinder */
  function debugPath(toX, toY) {
    const p = getPlayer();
    if (!p) return null;
    const from = { x: Math.round(p.x), y: Math.round(p.y) };
    const to = { x: Math.round(toX), y: Math.round(toY) };
    const path = findPath(from, to, 120);
    const info = {
      from,
      to,
      blockedHere: isBlocked(from.x, from.y),
      targetBlocked: isBlocked(to.x, to.y),
      pathLen: path?.length ?? 0,
      path: path?.slice(0, 30),
      movementBlockedSize: scene.movementBlocked?.size ?? null,
      nearestSafe: nearestWalkable(from, 15)
    };
    console.log("[GLBot] debugPath", info);
    return info;
  }

  async function attackPack(packId) {
    if (!packId) return false;
    try {
      scene.confirmationDattaqueDemandee = () => false;
      // Préférer onFaunaAttack si l'entité est chargée (plus direct)
      const hasEnt =
        scene.faunaEntities?.has?.(packId) ||
        scene.faunaEntities?.get?.(packId) != null;
      if (hasEnt && typeof scene.onFaunaAttack === "function") {
        scene.onFaunaAttack(packId);
      } else {
        await scene.attackFaunaPack(packId);
      }
      await sleep(500);
      document.querySelector("button.confirmer-combat")?.click();
      await sleep(700);
      return !!scene.combat;
    } catch (e) {
      console.warn("[GLBot] attackFaunaPack:", e.message || e);
      return false;
    }
  }

  // ============================================================
  // COMBAT TOUR PAR TOUR (style Dofus) — FAUNE uniquement
  // ============================================================
  function getCombatState() {
    return scene.combatState || null;
  }

  function isInCombat() {
    return !!scene.combat && !!scene.combatState && !scene.combatState.finished;
  }

  function isFauneCombat(cs = getCombatState()) {
    return cs && cs.kind === "FAUNE";
  }

  /** Phase placement : cliquer Prêt */
  async function handlePlacement() {
    const cs = getCombatState();
    // Essayer de se placer plus près de l'ennemi avant Prêt
    if (cs && cs.tactics && cs.tactics.placementDone === false) {
      const cells = cs.tactics.placementCells || [];
      const enemyId = (cs.fighters || []).find(f => f.team === "ENNEMI")?.id;
      const enemyPos =
        cs.tactics.positions?.[enemyId] ||
        (cs.tactics.placementCellsAdverses || [])[0];
      if (cells.length && enemyPos && scene.combat?.click) {
        let best = null;
        let bestD = 999;
        for (const c of cells) {
          const d = manhattan(c, enemyPos);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        if (best) {
          try {
            scene.combat.click({ x: best.x, y: best.y });
            console.log(`[GLBot] 📍 Placement case (${best.x},${best.y}) dist ${bestD}`);
            await sleep(400);
          } catch (_) {}
        }
      }
    }

    const btn = Array.from(document.querySelectorAll("button")).find(b =>
      /^prêt$/i.test(b.innerText.trim())
    );
    if (btn) {
      btn.click();
      console.log("[GLBot] 📍 Placement → Prêt");
      await sleep(800);
      return true;
    }
    return false;
  }

  /** Choisit la meilleure action offensive (max dégâts estimés) */
  function manhattan(a, b) {
    if (!a || !b) return 999;
    return Math.abs((a.x ?? 0) - (b.x ?? 0)) + Math.abs((a.y ?? 0) - (b.y ?? 0));
  }

  function actionRange(action) {
    if (!action) return 1;
    if (action.geometry?.range != null) return action.geometry.range;
    if (action.range != null) return action.range;
    if (action.kind === "ATTAQUE") {
      const cs = getCombatState();
      const me = (cs?.fighters || []).find(f => f.id === cs.you || f.team === "ALLIE");
      if (me?.armeDeTir) return 6;
      return 1;
    }
    return 1;
  }

  function maxOffensiveRange(cs) {
    let maxR = 1;
    for (const a of cs?.actions || []) {
      if (a.kind === "FUITE" || a.kind === "GARDE") continue;
      if (a.usable === false || a.locked) continue;
      maxR = Math.max(maxR, actionRange(a));
    }
    return maxR;
  }

  function getEnemyMaxRange(enemy) {
    let maxR = 1;
    for (const t of enemy.techniques || []) {
      const r = t.geometry?.range ?? t.range ?? 1;
      if (r > maxR) maxR = r;
    }
    return maxR;
  }

  function detectArchetype(me) {
    if (me?.armeDeTir === true) return "RANGED";
    const maxR = Math.max(
      1,
      ...(me?.techniques || []).map(t => t.range ?? 1),
      maxOffensiveRange(getCombatState() || {})
    );
    if (maxR >= 4) return "RANGED";
    if (maxR <= 2) return "MELEE";
    return "HYBRID";
  }

  function avgEstimate(est) {
    if (!est) return 0;
    let d = (est.min + est.max) / 2;
    if (est.critMin != null && est.critMax != null) {
      d = d * 0.85 + ((est.critMin + est.critMax) / 2) * 0.15;
    }
    return d;
  }

  /** Sweet spot : dist idéale en fin de tour (kite / approach) */
  function computeSweetSpot(enemies, myMaxRange) {
    if (!enemies.length) return myMaxRange;
    const maxPM = Math.max(...enemies.map(e => e.caracs?.pm ?? 3));
    const maxER = Math.max(...enemies.map(e => getEnemyMaxRange(e)));
    const idealAtk = maxPM + myMaxRange;
    const safe = maxPM + maxER + (CONFIG.safeDistMargin || 1);
    return Math.max(idealAtk, safe);
  }

  function pickReachableToward(cs, targetPos, preferDist) {
    const reachable = (cs.tactics?.reachable || []).filter(
      c => (c.cost || 0) <= (cs.tactics?.mp || 0)
    );
    if (!reachable.length || !targetPos) return null;
    const meId = cs.you || scene.character?.id;
    const from = cs.tactics.positions[meId];
    const curD = from ? manhattan(from, targetPos) : 999;
    const scored = reachable
      .map(c => ({ x: c.x, y: c.y, cost: c.cost || 0, d: manhattan(c, targetPos) }))
      .filter(c => c.d < curD);
    if (!scored.length) return null;
    if (preferDist != null) {
      scored.sort(
        (a, b) =>
          Math.abs(a.d - preferDist) - Math.abs(b.d - preferDist) || b.d - a.d
      );
    } else {
      scored.sort((a, b) => a.d - b.d);
    }
    return scored[0];
  }

  function pickKiteCell(cs, enemies) {
    const mp = cs.tactics?.mp || 0;
    const reachable = (cs.tactics?.reachable || []).filter(c => (c.cost || 0) <= mp);
    if (!reachable.length) return null;
    const withPos = enemies.filter(e => e.pos);
    if (!withPos.length) return null;
    let best = null;
    for (const c of reachable) {
      if (withPos.some(e => manhattan(c, e.pos) <= 1)) continue;
      const minD = Math.min(...withPos.map(e => manhattan(c, e.pos)));
      const curMin = Math.min(...withPos.map(e => e.dist));
      if (minD <= curMin) continue;
      if (!best || minD > best.minD || (minD === best.minD && c.cost < best.cost)) {
        best = { x: c.x, y: c.y, cost: c.cost || 0, minD };
      }
    }
    return best;
  }

  /**
   * Décision de tour complète (inspirée combattourpartour V18).
   * Retourne { type, action?, enemy?, cell?, reason, dmg? }
   */
  function decideCombatTurn(cs) {
    const meId = cs.you || scene.character?.id;
    const me = (cs.fighters || []).find(f => f.id === meId);
    if (!me) return { type: "endturn", reason: "pas de me" };

    const myPos = cs.tactics?.positions?.[meId];
    const ap = cs.tactics?.ap ?? 0;
    const mp = cs.tactics?.mp ?? 0;
    const enemies = (cs.fighters || [])
      .filter(f => f.team === "ENNEMI" && (f.hp ?? 0) > 0)
      .map(f => ({
        ...f,
        pos: cs.tactics?.positions?.[f.id],
        dist: myPos && cs.tactics?.positions?.[f.id]
          ? manhattan(myPos, cs.tactics.positions[f.id])
          : 99
      }));

    if (!enemies.length) return { type: "endturn", reason: "aucun ennemi" };

    const actions = (cs.actions || []).filter(a => a.usable !== false && !a.locked);
    const damageActs = actions.filter(
      a => a.kind === "ATTAQUE" || a.kind === "TECHNIQUE"
    );
    const hasGuard = actions.some(a => a.kind === "GARDE");
    const hasFlee = actions.some(a => a.kind === "FUITE");
    const myMaxRange = maxOffensiveRange(cs);
    const archetype = detectArchetype(me);
    const sweet = computeSweetSpot(enemies, myMaxRange);
    const curMinDist = Math.min(...enemies.map(e => e.dist));
    const allMelee = enemies.every(e => getEnemyMaxRange(e) <= 1);
    const hpPct = (me.hp ?? 0) / Math.max(me.maxHp || 1, 1);

    if (CONFIG.combatVerbose) {
      console.log(
        `[GLBot] 📋 AP=${ap} PM=${mp} dist=${curMinDist} sweet=${sweet} arch=${archetype} hp=${Math.round(hpPct * 100)}%`
      );
    }

    // FUITE si HP critique
    if (hpPct < (CONFIG.fleeHpPct || 0.2) && hasFlee) {
      return { type: "flee", reason: `FUITE (${Math.round(hpPct * 100)}%)` };
    }

    // GARDE proactif
    const threatened = enemies.some(
      e => e.dist <= (e.caracs?.pm ?? 3) + getEnemyMaxRange(e)
    );
    if (
      hpPct < (CONFIG.guardHpPct || 0.5) &&
      hasGuard &&
      threatened &&
      ap >= 2
    ) {
      return { type: "guard", reason: `GARDE (${Math.round(hpPct * 100)}%)` };
    }

    // Meilleure attaque à portée
    let bestAtk = null;
    for (const a of damageActs) {
      const range = actionRange(a);
      const pa = a.pa ?? a.cost ?? (a.kind === "ATTAQUE" ? 2 : 99);
      if (pa > ap) continue;
      for (const en of enemies) {
        if (!en.pos) continue;
        if (en.dist > range) continue;
        const est = a.estimates?.[en.id];
        const dmg = avgEstimate(est) || (a.kind === "ATTAQUE" ? 15 : 0);
        if (!dmg) continue;
        let score = dmg / Math.max(pa, 1);
        if (est && est.max >= en.hp) score += CONFIG.finisherWeight || 10000;
        else if (dmg * 2 >= en.hp) score += 1000;
        score += (1 - en.hp / Math.max(en.maxHp || 1, 1)) * (CONFIG.focusLowHpWeight || 100);
        if (!bestAtk || score > bestAtk.score) {
          bestAtk = {
            type: a.kind === "ATTAQUE" ? "attack" : "cast",
            action: a,
            enemy: en,
            dmg,
            score,
            reason: `${a.name} → ${en.name} (~${Math.round(dmg)}${est && est.max >= en.hp ? " KILL" : ""})`
          };
        }
      }
    }
    if (bestAtk) {
      STATE.consecutiveKites = 0;
      return bestAtk;
    }

    // KITE si tirailleur vs mêlée et trop proche
    if (
      CONFIG.kiteMeleeEnabled &&
      mp > 0 &&
      allMelee &&
      (archetype === "RANGED" || archetype === "HYBRID") &&
      curMinDist < sweet
    ) {
      const kite = pickKiteCell(cs, enemies);
      if (kite) {
        STATE.consecutiveKites = (STATE.consecutiveKites || 0) + 1;
        return {
          type: "move",
          cell: { x: kite.x, y: kite.y },
          reason: `KITE (${curMinDist}→${kite.minD})`
        };
      }
    }

    // APPROCHE vers sweet spot / range
    if (mp > 0) {
      const target = [...enemies].sort((a, b) => a.dist - b.dist)[0];
      if (target?.pos && target.dist > myMaxRange) {
        const cell = pickReachableToward(cs, target.pos, Math.min(sweet, myMaxRange));
        if (cell) {
          STATE.consecutiveKites = 0;
          return {
            type: "move",
            cell: { x: cell.x, y: cell.y },
            reason: `Approche (${target.dist}→${cell.d}, range=${myMaxRange})`
          };
        }
      }
    }

    // FORCE approach after too many kites
    if ((STATE.consecutiveKites || 0) >= (CONFIG.maxConsecutiveKites || 3) && mp > 0) {
      const target = [...enemies].sort((a, b) => a.dist - b.dist)[0];
      if (target?.pos) {
        const cell = pickReachableToward(cs, target.pos, myMaxRange);
        if (cell) {
          STATE.consecutiveKites = 0;
          return {
            type: "move",
            cell: { x: cell.x, y: cell.y },
            reason: `FORCE-ATK approche (${target.dist}→${cell.d})`
          };
        }
      }
    }

    // Garde d'attente
    if (hasGuard && threatened && ap >= 2) {
      return { type: "guard", reason: "GARDE attente" };
    }

    return { type: "endturn", reason: `attente AP=${ap} PM=${mp} dist=${curMinDist}` };
  }

  /** Compat : meilleure action offensive pure */
  function pickBestAction(cs) {
    const d = decideCombatTurn(cs);
    if (d.type === "attack" || d.type === "cast") {
      return { action: d.action, enemy: d.enemy, dmg: d.dmg, dist: d.enemy?.dist, range: actionRange(d.action) };
    }
    return null;
  }

    /** Peut-on engager un combat map ? (HP DOM / forme) */
  function canEngageCombat(player) {
    if (!player || player.dead) return { ok: false, reason: "mort" };
    // currentHp JS est souvent stale (1) — privilégier DOM coeur-pv
    const hp = player.domHp ?? player.currentHp ?? 0;
    if (hp < CONFIG.minHpToFight) {
      return { ok: false, reason: `HP trop bas (${hp} < ${CONFIG.minHpToFight})` };
    }
    if (player.vitality < 15) {
      return { ok: false, reason: `Forme critique (${Math.round(player.vitality)})` };
    }
    return { ok: true };
  }

  /** Attend la fin réelle du combat (finished + disparition éventuelle) */
  async function waitCombatEnd(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const cs = getCombatState();
      if (!cs || cs.finished || !scene.combat) {
        await sleep(CONFIG.combatEndWaitMs);
        return cs;
      }
      await sleep(300);
    }
    return getCombatState();
  }

  function getBattleAuth() {
    const cs = getCombatState();
    const token = sessionStorage.getItem("grandline-token");
    const characterId = scene.character?.id;
    const battleId = cs?.id;
    return { token, characterId, battleId };
  }

  /**
   * API combat : POST /api/battles/:id/action
   * Payload : { kind, id, targetId?, targetCell? }
   */
  async function battleActionApi(payload) {
    const { token, characterId, battleId } = getBattleAuth();
    if (!token || !characterId || !battleId) {
      return { ok: false, error: "auth/battle manquant" };
    }
    try {
      const res = await fetch(
        `https://api.grandline-online.fr/api/battles/${battleId}/action`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          credentials: "include",
          body: JSON.stringify({ characterId, ...payload })
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn("[GLBot] battleAction HTTP", res.status, data);
        return { ok: false, error: `HTTP ${res.status}`, data };
      }
      // Sync combatState if server returns updated state
      if (data && (data.fighters || data.yourTurn != null)) {
        try {
          Object.assign(scene.combatState || {}, data);
        } catch (_) {}
      }
      return { ok: true, data };
    } catch (e) {
      console.warn("[GLBot] battleAction error:", e.message);
      return { ok: false, error: e.message };
    }
  }

  async function battleMoveApi(cell) {
    const { token, characterId, battleId } = getBattleAuth();
    if (!token || !characterId || !battleId) return { ok: false };
    try {
      const res = await fetch(
        `https://api.grandline-online.fr/api/battles/${battleId}/move`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          credentials: "include",
          body: JSON.stringify({ characterId, cell })
        }
      );
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function battleEndTurnApi() {
    const { token, characterId, battleId } = getBattleAuth();
    if (!token || !characterId || !battleId) return { ok: false };
    try {
      const res = await fetch(
        `https://api.grandline-online.fr/api/battles/${battleId}/end-turn`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          credentials: "include",
          body: JSON.stringify({ characterId })
        }
      );
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Multi-pas PM vers l'ennemi jusqu'à portée cible ou PM=0 */
  async function approachEnemyInCombat(cs, desiredRange = 1) {
    let movedAny = false;
    let guard = 0;
    while (guard < 6) {
      guard++;
      cs = getCombatState() || cs;
      const tactics = cs.tactics;
      if (!tactics?.positions || !(tactics.mp > 0)) break;

      const meId = cs.you || scene.character.id;
      const enemy = (cs.fighters || []).find(f => f.team === "ENNEMI" && f.hp > 0);
      if (!enemy) break;

      const from = tactics.positions[meId];
      const to = tactics.positions[enemy.id];
      if (!from || !to) break;

      const dist = manhattan(from, to);
      if (dist <= desiredRange) break;

      // Préférer tactics.reachable (cases légales avec cost PM)
      const reachable = tactics.reachable || [];
      let step = null;
      let bestD = dist;
      for (const c of reachable) {
        if ((c.cost || 0) > (tactics.mp || 0)) continue;
        const d = manhattan(c, to);
        if (d < bestD) {
          bestD = d;
          step = { x: c.x, y: c.y };
        }
      }
      if (!step) {
        step = { x: from.x, y: from.y };
        if (to.x !== from.x) step.x = from.x + Math.sign(to.x - from.x);
        else step.y = from.y + Math.sign(to.y - from.y);
      }

      // 1) screen.cellClick (chemin officiel client)
      // 2) API battleMove fallback
      let ok = false;
      const screen = scene.combat?.screen;
      if (screen && typeof screen.cellClick === "function") {
        try {
          await screen.cellClick(step);
          ok = true;
          console.log(`[GLBot] 👟 cellClick → (${step.x},${step.y}) distEnnemi ${bestD}`);
        } catch (e) {
          console.warn("[GLBot] cellClick:", e.message);
        }
      }
      if (!ok) {
        const r = await battleMoveApi(step);
        ok = !!r.ok;
        if (ok) console.log(`[GLBot] 👟 API move → (${step.x},${step.y})`);
      }
      if (!ok) break;
      movedAny = true;
      await sleep(500);
    }
    return movedAny;
  }

  function pickGuardAction(cs) {
    return (cs.actions || []).find(a => a.kind === "GARDE" && a.usable !== false);
  }

  /** Action via API (fallback UI) */
  async function playAction(choice) {
    if (!choice) return false;
    const { action, enemy } = choice;

    const payload = { kind: action.kind, id: action.id };
    if (action.kind !== "GARDE" && action.kind !== "FUITE") {
      payload.targetId = enemy.id;
      const enPos = getCombatState()?.tactics?.positions?.[enemy.id];
      if (enPos) payload.targetCell = { x: enPos.x, y: enPos.y };
    }

    const api = await battleActionApi(payload);
    if (api.ok) {
      console.log(`[GLBot] ✅ API action ${action.name}`);
      await sleep(500);
      return true;
    }
    console.warn("[GLBot] API action échouée, fallback UI:", api.error);

    // Sélection UI de l'action
    if (action.kind === "ATTAQUE") {
      Array.from(document.querySelectorAll("button"))
        .find(b => b.innerText.trim() === "Attaque")?.click();
    } else if (action.kind === "GARDE") {
      Array.from(document.querySelectorAll("button"))
        .find(b => b.innerText.trim() === "Garde")?.click();
      return true;
    } else if (action.kind === "FUITE") {
      Array.from(document.querySelectorAll("button"))
        .find(b => /fuir/i.test(b.innerText))?.click();
      return true;
    } else {
      const techs = (getCombatState()?.actions || []).filter(a => a.kind === "TECHNIQUE");
      const idx = techs.findIndex(t => t.id === action.id);
      if (idx >= 0 && idx < 9) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: String(idx + 1), bubbles: true })
        );
      }
    }
    await sleep(250);

    // Validation cible via screen.fighterClick / cellClick (chemin client)
    const cs2 = getCombatState();
    const enPos = cs2?.tactics?.positions?.[enemy?.id];
    const screen = scene.combat?.screen;
    try {
      if (screen?.fighterClick && enemy) {
        await screen.fighterClick(enemy, enPos);
        console.log("[GLBot] fighterClick cible");
      } else if (screen?.cellClick && enPos) {
        await screen.cellClick(enPos);
        console.log("[GLBot] cellClick cible");
      } else if (enPos && scene.combat?.click) {
        scene.combat.click(enPos);
      }
    } catch (e) {
      console.warn("[GLBot] target click:", e.message);
    }
    await sleep(500);
    return true;
  }

  async function endTurn() {
    const api = await battleEndTurnApi();
    if (api.ok) {
      console.log("[GLBot] ⏭ Fin du tour (API)");
      await sleep(800);
      return true;
    }
    const btn = Array.from(document.querySelectorAll("button")).find(b =>
      /fin du tour/i.test(b.innerText)
    );
    if (btn) {
      btn.click();
      console.log("[GLBot] ⏭ Fin du tour (UI)");
      await sleep(1000);
      return true;
    }
    return false;
  }

  async function fleeCombat() {
    const api = await battleActionApi({ kind: "FUITE", id: "flee" });
    if (api.ok) {
      console.log("[GLBot] 🏃 Fuite (API)");
      await sleep(800);
      return true;
    }
    const btn = Array.from(document.querySelectorAll("button")).find(b =>
      /^fuir$/i.test(b.innerText.trim()) || b.innerText.includes("Fuir")
    );
    if (btn) {
      btn.click();
      console.log("[GLBot] 🏃 Fuite (UI)");
      await sleep(1000);
      return true;
    }
    return false;
  }

  /**
   * Boucle de combat jusqu'à la fin.
   * Ne traite que kind === "FAUNE".
   */

  function inventorySnapshot() {
    const inv = scene.character?.inventory;
    const items = Array.isArray(inv?.items) ? inv.items : [];
    const map = {};
    for (const it of items) {
      const id = it.id || it.name || "?";
      map[id] = (map[id] || 0) + (Number(it.quantity) || 1);
    }
    return {
      berries: scene.character?.berries ?? 0,
      itemCount: items.length,
      items: map,
      full: inspectInventory().full
    };
  }

  function diffInventory(before, after) {
    const gained = [];
    const afterItems = after?.items || {};
    const beforeItems = before?.items || {};
    for (const [id, qty] of Object.entries(afterItems)) {
      const prev = beforeItems[id] || 0;
      if (qty > prev) gained.push({ id, qty: qty - prev });
    }
    return {
      berriesDelta: (after?.berries ?? 0) - (before?.berries ?? 0),
      itemCountDelta: (after?.itemCount ?? 0) - (before?.itemCount ?? 0),
      gained
    };
  }

  async function runCombat() {
    console.log("[GLBot] ⚔ Entrée en combat FAUNE");
    const snapBefore = inventorySnapshot();

    let safety = 0;
    while (safety < CONFIG.maxCombatLoops) {
      safety++;
      const cs = getCombatState();

      // Fin réelle
      if (!cs || cs.finished || !scene.combat) break;

      if (CONFIG.onlyFaune && cs.kind && cs.kind !== "FAUNE") {
        console.warn("[GLBot] Combat non-FAUNE détecté → abandon");
        await fleeCombat();
        break;
      }

      // Placement
      if (cs.tactics && cs.tactics.placementDone === false) {
        await handlePlacement();
        await sleep(CONFIG.combatPollMs);
        continue;
      }
      if (await handlePlacement()) {
        await sleep(CONFIG.combatPollMs);
        continue;
      }

      // Notre tour ?
      if (cs.yourTurn || cs.tactics?.yourTurn) {
        const me = (cs.fighters || []).find(f => f.id === cs.you || f.team === "ALLIE");
        const hpPct = me && me.maxHp ? me.hp / me.maxHp : 1;

        if (hpPct < CONFIG.fleeHpPercent) {
          await fleeCombat();
          break;
        }

        // Estimer la meilleure portée utile parmi les sorts
        let maxUsefulRange = 1;
        for (const a of cs.actions || []) {
          if (a.kind === "FUITE" || a.kind === "GARDE") continue;
          if (a.usable === false || a.locked) continue;
          maxUsefulRange = Math.max(maxUsefulRange, actionRange(a));
        }

        const decision = decideCombatTurn(cs);
        console.log(`[GLBot] → ${decision.reason}`);

        if (decision.type === "move" && decision.cell) {
          let moved = false;
          const screen = scene.combat?.screen;
          if (screen?.cellClick) {
            try {
              await screen.cellClick(decision.cell);
              moved = true;
              console.log(`[GLBot] 👟 cellClick (${decision.cell.x},${decision.cell.y})`);
            } catch (_) {}
          }
          if (!moved) {
            const r = await battleMoveApi(decision.cell);
            if (r.ok) console.log(`[GLBot] 👟 API move (${decision.cell.x},${decision.cell.y})`);
          }
          await sleep(500);
          // Ne pas end-turn si on peut encore jouer après move
          const cs2 = getCombatState() || cs;
          if ((cs2.tactics?.ap || 0) > 0) {
            const d2 = decideCombatTurn(cs2);
            if (d2.type === "attack" || d2.type === "cast") {
              await playAction({ action: d2.action, enemy: d2.enemy });
            } else if (d2.type === "guard") {
              await playAction({ action: { kind: "GARDE", id: "guard", name: "Garde" }, enemy: null });
            }
          }
        } else if (decision.type === "attack" || decision.type === "cast") {
          await playAction({ action: decision.action, enemy: decision.enemy });
        } else if (decision.type === "guard") {
          await playAction({ action: { kind: "GARDE", id: "guard", name: "Garde" }, enemy: null });
        } else if (decision.type === "flee") {
          await playAction({ action: { kind: "FUITE", id: "flee", name: "Fuir" }, enemy: null });
        } else {
          console.log("[GLBot] Aucune action — fin de tour");
        }
        await endTurn();

      }

      await sleep(CONFIG.combatPollMs);
    }

    // Attendre la fin réelle côté serveur / UI (loot + berries crédités auto si victoire)
    const finalCs = await waitCombatEnd(6000);
    await sleep(800); // laisser le serveur pousser inventaire / berries
    const snapAfter = inventorySnapshot();
    const diff = diffInventory(snapBefore, snapAfter);

    // Heuristique win : winner ALLIE, ou gain berries/items, ou plus d'ennemis vivants
    const winFlag = finalCs?.winner === "ALLIE";
    const lossFlag = finalCs?.winner === "ENNEMI";
    const lootWin = diff.berriesDelta > 0 || diff.itemCountDelta > 0 || diff.gained.length > 0;
    const win = winFlag || (!lossFlag && lootWin);

    if (win) {
      SESSION.fightsWon++;
      if (diff.berriesDelta > 0) SESSION.berriesGained += diff.berriesDelta;
      const lootedQty = diff.gained.reduce((s, g) => s + g.qty, 0);
      if (lootedQty > 0) SESSION.itemsLooted += lootedQty;
      emit("combat_win", { diff, winner: finalCs?.winner });
    } else if (lossFlag) {
      SESSION.fightsLost++;
      emit("combat_loss", { finalCs });
    }

    const lootStr = diff.gained.length
      ? diff.gained.map(g => `${g.id} x${g.qty}`).join(", ")
      : (win ? "aucun item (ou stack existant)" : "-");

    console.log(
      `[GLBot] ⚔ Combat terminé — winner=${finalCs?.winner ?? "?"}` +
      (diff.berriesDelta ? ` | +${diff.berriesDelta} berries` : "") +
      ` | inv ${snapBefore.itemCount}→${snapAfter.itemCount}` +
      (diff.gained.length ? ` | loot: ${lootStr}` : "")
    );
    if (snapAfter.full) {
      console.warn("[GLBot] 🎒 Inventaire plein après combat — prochains farms en pause");
    }
    logSession();
    await sleep(CONFIG.combatEndWaitMs);
    return finalCs;
  }

  // ============================================================
  // BOUCLE DE FARM
  // ============================================================
  let running = false;
  let loopTimer = null;

  async function nudgeRandom() {
    const p = getPlayer();
    if (!p) return;
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 }
    ];
    const d = dirs[Math.floor(Math.random() * dirs.length)];
    const to = {
      x: Math.round(p.x) + d.x * CONFIG.nudgeSteps,
      y: Math.round(p.y) + d.y * CONFIG.nudgeSteps
    };
    console.log(`[GLBot] 🔄 Anti-blocage nudge → (${to.x},${to.y})`);
    SESSION.stuckNudges++;
    await moveToward(to, CONFIG.nudgeSteps + 1);
  }

  // ============================================================
  // GROUND DROPS (hors combat)
  // ============================================================
  function getGroundDrops() {
    const raw =
      scene.network?.groundDrops ||
      scene.groundDrops ||
      scene.network?.drops ||
      [];
    const list = Array.isArray(raw) ? raw : Object.values(raw || {});
    return list
      .map(d => ({
        id: d.id || d.dropId || d.uid,
        x: d.x ?? d.pos?.x ?? d.position?.x,
        y: d.y ?? d.pos?.y ?? d.position?.y,
        name: d.name || d.itemName || d.nom || "drop",
        raw: d
      }))
      .filter(d => d.x != null && d.y != null);
  }

  function getClosestDrop(maxDist = CONFIG.pickupRange) {
    const player = getPlayer();
    if (!player) return null;
    const drops = getGroundDrops();
    let best = null;
    let bestD = maxDist + 0.01;
    for (const d of drops) {
      const dist = distance(player, d);
      if (dist < bestD) {
        bestD = dist;
        best = { ...d, dist };
      }
    }
    return best;
  }

  /**
   * Tente de ramasser le drop le plus proche.
   * Essaie d'abord les méthodes internes connues, sinon clic / move.
   */
  async function tryPickupClosestDrop() {
    if (!CONFIG.autoPickupDrops || isInCombat()) return false;
    const drop = getClosestDrop(CONFIG.pickupRange);
    if (!drop) return false;

    console.log(`[GLBot] 💎 Drop proche : ${drop.name} dist=${drop.dist.toFixed(1)}`);

    // 1) Méthode interne confirmée live : scene.pickupGroundDrop
    try {
      if (typeof scene.pickupGroundDrop === "function") {
        await scene.pickupGroundDrop(drop.id);
        SESSION.pickups++;
        console.log(`[GLBot] ✅ pickupGroundDrop(${drop.id})`);
        await sleep(400);
        return true;
      }
      if (typeof scene.network?.pickupDrop === "function") {
        await scene.network.pickupDrop(drop.id);
        SESSION.pickups++;
        return true;
      }
      if (scene.network?.socket?.emitWithAck) {
        const r = await scene.network.socket.emitWithAck("ground-drop:pickup", {
          dropId: drop.id
        });
        if (r && r.ok !== false) {
          SESSION.pickups++;
          return true;
        }
      }
    } catch (e) {
      console.warn("[GLBot] pickup API:", e.message);
    }

    // 2) Approche + clic
    if (drop.dist > 1.5) {
      await moveToward(drop, 4);
    }
    try {
      if (typeof scene.handleClick === "function") {
        const screen = scene.toScreen?.(drop.x, drop.y);
        if (screen) {
          scene.handleClick({ x: screen.x, y: screen.y, worldX: drop.x, worldY: drop.y });
          SESSION.pickups++;
          await sleep(400);
          return true;
        }
      }
    } catch (_) {}

    return false;
  }

  async function farmTick() {
    if (!running) return;

    try {
      const player = getPlayer();
      if (!player) {
        loopTimer = setTimeout(farmTick, CONFIG.loopDelayIdle);
        return;
      }

      if (player.dead) {
        console.warn("[GLBot] Personnage mort – arrêt");
        stopFarm();
        return;
      }

      // Inventaire plein
      if (CONFIG.pauseOnFullInventory && isInventoryFull()) {
        SESSION.inventoryFullPauses++;
        const info = inspectInventory();
        console.warn(
          `[GLBot] 🎒 Inventaire plein (${info.used ?? "?"}/${info.max ?? "?"} via ${info.source}) — pause. Vide ton sac puis le bot reprend.`
        );
        loopTimer = setTimeout(farmTick, CONFIG.inventoryFullPollMs);
        return;
      }

      // Anti-blocage position
      const posKey = `${Math.round(player.x)},${Math.round(player.y)}`;
      if (SESSION.lastPos === posKey && !player.moving && !isInCombat()) {
        SESSION.stuckTicks++;
      } else {
        SESSION.stuckTicks = 0;
        SESSION.lastPos = posKey;
      }
      if (SESSION.stuckTicks >= CONFIG.stuckTicksBeforeNudge) {
        SESSION.stuckTicks = 0;
        await nudgeRandom();
        loopTimer = setTimeout(farmTick, CONFIG.loopDelayMove);
        return;
      }

      // --- Repos si besoin ---
      if (CONFIG.restEnabled) {
        const rested = await tryRestIfNeeded();
        if (rested) {
          loopTimer = setTimeout(farmTick, 4000);
          return;
        }
      }

      // Déjà en combat FAUNE ?
      if (isInCombat()) {
        if (isFauneCombat()) await runCombat();
        else {
          console.warn("[GLBot] Combat non-FAUNE → fuite");
          await fleeCombat();
        }
        loopTimer = setTimeout(farmTick, CONFIG.loopDelayAttack);
        return;
      }

      // Ramassage drops au sol (hors combat)
      if (CONFIG.autoPickupDrops) {
        const picked = await tryPickupClosestDrop();
        if (picked) {
          loopTimer = setTimeout(farmTick, 600);
          return;
        }
      }

      const target = getClosest();
      if (!target) {
        console.log("[GLBot] Aucun monstre valide (filtre niveau/espèce/engagé)");
        loopTimer = setTimeout(farmTick, CONFIG.loopDelayIdle);
        return;
      }

      const dist = distance(player, target);
      console.log(
        `[GLBot] → ${target.espece} n${target.niveau} | dist ${dist.toFixed(1)} | HP ${player.currentHp} | Forme ${Math.round(player.vitality)}`
      );

      const engage = canEngageCombat(player);
      if (!engage.ok) {
        console.warn(`[GLBot] ⛔ Pas d'engagement : ${engage.reason}`);
        if (CONFIG.restEnabled) {
          const rested = await tryRestIfNeeded();
          if (!rested) {
            const r = await doRest(null);
            if (!r.ok) console.warn("[GLBot] Repos forcé impossible:", r.error);
          }
          loopTimer = setTimeout(farmTick, 4000);
          return;
        }
        loopTimer = setTimeout(farmTick, CONFIG.loopDelayIdle);
        return;
      }

      // Pas encore chargé dans faunaEntities → s'approcher davantage
      if (!isAttackable(target)) {
        console.log(
          `[GLBot] 📍 Approche ${target.espece} n${target.niveau} (pas encore chargé, dist ${dist.toFixed(1)})`
        );
        await moveToward(target);
        loopTimer = setTimeout(farmTick, CONFIG.loopDelayMove);
        return;
      }

      if (dist > CONFIG.attackRange) {
        console.log(`[GLBot] 🚶 Marche vers ${target.espece} dist ${dist.toFixed(1)}`);
        await moveToward(target);
        loopTimer = setTimeout(farmTick, CONFIG.loopDelayMove);
      } else {
        console.log(`[GLBot] ⚔ Attaque FAUNE ${target.espece} (${target.packId}) attackable=yes`);
        const started = await attackPack(target.packId);
        await sleep(1200);

        const body = document.body.innerText || "";
        if (/se bat déjà|déjà avec ces bêtes/i.test(body)) {
          console.warn("[GLBot] Pack engagé — blacklist 30s");
          blacklistPack(target.packId, 30000);
          loopTimer = setTimeout(farmTick, 800);
          return;
        }

        if (isInCombat()) {
          if (CONFIG.onlyFaune && !isFauneCombat()) {
            console.warn("[GLBot] Pas un combat FAUNE — abandon");
            await fleeCombat();
            await waitCombatEnd(4000);
          } else {
            await runCombat();
          }
        } else if (!started) {
          console.warn("[GLBot] Combat non démarré — rapprochement / blacklist 12s");
          blacklistPack(target.packId, 12000);
          await moveToward(target, 3);
        }
        loopTimer = setTimeout(farmTick, CONFIG.loopDelayAttack);
      }
    } catch (e) {
      console.error("[GLBot] Erreur farmTick:", e);
      loopTimer = setTimeout(farmTick, 2000);
    }
  }

  function startFarm() {
    if (running) {
      console.log("[GLBot] Déjà en cours");
      return;
    }
    running = true;
    SESSION.startedAt = Date.now();
    SESSION.berriesStart = scene.character?.berries ?? null;
    SESSION.fightsWon = 0;
    SESSION.fightsLost = 0;
    SESSION.berriesGained = 0;
    SESSION.stuckTicks = 0;
    SESSION.pickups = 0;
    SESSION.inventoryFullPauses = 0;
    console.log(
      "%c[GLBot] ▶ Farm v1.0 — filtres renforcés, inventaire, groundDrops",
      "color:#81c784;font-weight:bold"
    );
    farmTick();
  }

  function stopFarm() {
    running = false;
    if (loopTimer) {
      clearTimeout(loopTimer);
      loopTimer = null;
    }
    console.log("%c[GLBot] ■ Farm arrêté", "color:#e57373;font-weight:bold");
  }

  // ============================================================
  // STATUS
  // ============================================================
  function status() {
    const player = getPlayer();
    const monsters = getMonsters().filter(m => isValidTarget(m, player));
    const closest = getClosest();
    const inv = inspectInventory();
    const drops = getGroundDrops();
    const s = sessionStats();

    console.clear();
    console.log("%c=== GLBot Status v1.0 ===", "color:#4fc3f7;font-weight:bold;font-size:14px");
    console.log(`Joueur : ${player?.name ?? "?"} (Nv.${player?.level ?? "?"})`);
    console.log(`Position : (${Math.round(player?.x ?? 0)}, ${Math.round(player?.y ?? 0)})`);
    console.log(`HP      : ${player?.currentHp} / ${player?.maxHp} (${Math.round((player?.hpPercent || 0) * 100)}%)`);
    console.log(`Forme   : ${Math.round(player?.vitality ?? 0)}/100 – ${player?.formeLabel}`);
    console.log(`Berries : ${player?.berries ?? "?"}`);
    console.log(`Invent. : ${inv.full ? "PLEIN" : "ok"} (${inv.used ?? "?"}/${inv.max ?? "?"} via ${inv.source})`);
    console.log(`Monstres valides : ${monsters.length} | Drops sol : ${drops.length}`);
    if (SESSION.startedAt) {
      console.log(
        `Session : ${s.elapsedSec}s | W/L ${s.fightsWon}/${s.fightsLost} | +${s.berriesGained} berries | pickups ${s.pickups}`
      );
    }
    console.log("--------------------------------");

    if (closest) {
      monsters
        .map(m => ({ ...m, dist: distance(player, m), score: scoreTarget(m, player) }))
        .sort((a, b) => a.score - b.score)
        .slice(0, CONFIG.maxMonstersLog)
        .forEach((m, i) => {
          const weak = isWeakSpecies(m.espece) ? "★" : " ";
          console.log(
            `${i + 1}.${weak} ${String(m.espece).padEnd(14)} n${m.niveau}  dist=${m.dist.toFixed(1)}  score=${m.score.toFixed(1)}`
          );
        });
    } else {
      console.log("(aucun monstre valide selon filtres)");
    }

    console.log("--------------------------------");
    console.log("Commandes :");
    console.log("  GLBot.startFarm() / GLBot.stopFarm()");
    console.log("  GLBot.status() / GLBot.logSession()");
    console.log("  GLBot.debugInventory()");
    console.log("  GLBot.tryRestIfNeeded() / GLBot.doRest('NAVIRE'|'BELLE_ETOILE')");
    console.log("  GLBot.config.maxTargetLevelDelta = 3  (exemple runtime)");
  }

  // ============================================================
  // EXPORT
  // ============================================================
  window.GLBot = {
    version: "1.2.0",
    config: CONFIG,
    getPlayer,
    getMonsters,
    getClosest,
    isAttackable,
    distance,
    // Navigation walkable & A*
    isBlocked,
    isWalkable,
    findPath,
    nearestWalkable,
    escapeBlockedCell,
    walkTo,
    moveToward,
    debugPath,
    attackPack,
    doRest,
    tryRestIfNeeded,
    // Timing & Events
    jitter,
    sleep,
    on,
    off,
    emit,
    // Combat FAUNE
    isInCombat,
    isFauneCombat,
    getCombatState,
    runCombat,
    decideCombatTurn,
    fleeCombat,
    canEngageCombat,
    pickBestAction,
    battleActionApi,
    waitCombatEnd,
    sessionStats,
    logSession,
    isInventoryFull,
    inspectInventory,
    debugInventory,
    getGroundDrops,
    getClosestDrop,
    tryPickupClosestDrop,
    blacklistPack,
    SESSION,
    startFarm,
    stopFarm,
    status,
    scene
  };

  status();
  console.log(
    "%c[GLBot] v1.2.0 — Pathfinder A* · Jitter anti-détection · Event Emitter · voir aussi GLCombat",
    "color:#ffb74d;font-weight:bold"
  );
})();
