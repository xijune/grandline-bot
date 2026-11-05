/**
 * Îles → niveaux (console F12)
 *
 * Coller en jeu, puis :
 *   GLIslands.list()           // tableau résumé
 *   GLIslands.forLevel(12)     // recommandations pour ton lvl
 *   GLIslands.forMe()          // auto depuis le perso
 *   GLIslands.sea("west")      // filtre mer
 *   GLIslands.search("ohara")  // cherche un nom/id
 *
 * Source: GET /api/world/atlas (fallback table West Blue si offline)
 */
(() => {
  "use strict";

  const API = "https://api.grandline-online.fr";
  const WINDOW = 3;
  const SEA = {
    east: "East Blue",
    west: "West Blue",
    north: "North Blue",
    south: "South Blue",
    grandline: "Grand Line",
    newworld: "New World",
  };

  // Fallback minimal si l'API atlas échoue (West Blue connu live)
  const FALLBACK = [
    { id: "ilusia", name: "Royaume d’Ilusia", sea: "west", level: 1, rencontre: 1, route: 1 },
    { id: "ohara", name: "Ohara", sea: "west", level: 8, rencontre: 8, route: 2 },
    { id: "toroa", name: "Île Toroa", sea: "west", level: 10, rencontre: 10, route: 6 },
  ];

  let CACHE = null;

  function token() {
    return (
      sessionStorage.getItem("grandline-token") ||
      localStorage.getItem("grandline-token") ||
      window.__freshToken ||
      ""
    );
  }

  function playerLevel() {
    const c = window.__grandlineScene?.character;
    return Number(c?.level || c?.niveau || 1) || 1;
  }

  function playerMap() {
    return window.__grandlineScene?.character?.mapId || "?";
  }

  async function fetchAtlas() {
    if (CACHE) return CACHE;
    const t = token();
    try {
      const r = await fetch(API + "/api/world/atlas", {
        headers: {
          accept: "application/json",
          ...(t ? { authorization: "Bearer " + t } : {}),
        },
      });
      const data = await r.json();
      const list = data?.islands || data?.iles || data?.data?.islands || [];
      if (Array.isArray(list) && list.length) {
        CACHE = list
          .filter((i) => i?.id && i.id !== "event-pvp")
          .map((i) => ({
            id: i.id,
            name: i.name || i.id,
            sea: i.sea || "?",
            level: Number(i.level || 0),
            rencontre: Number(i.niveauRencontre || i.level || 0),
            route: Number(i.niveauDeRoute || 0),
            danger: Number(i.danger || 0),
            pvp: !!i.pvp,
            faction: i.faction || "",
          }))
          .sort((a, b) => a.rencontre - b.rencontre || a.name.localeCompare(b.name));
        return CACHE;
      }
    } catch (e) {
      console.warn("[GLIslands] atlas API fail → fallback", e);
    }
    CACHE = FALLBACK.slice();
    return CACHE;
  }

  function recommend(islands, level, sea) {
    const lo = Math.max(1, level - WINDOW);
    const hi = level + WINDOW;
    return islands
      .filter((i) => (!sea || i.sea === sea) && i.rencontre >= lo && i.rencontre <= hi)
      .map((i) => ({
        ...i,
        delta: i.rencontre - level,
        score: Math.abs(i.rencontre - level) * 10 + (i.pvp ? 5 : 0) + (i.danger || 0),
      }))
      .sort((a, b) => a.score - b.score || a.rencontre - b.rencontre);
  }

  function row(i) {
    return {
      lvl: i.rencontre,
      delta: i.delta != null ? (i.delta >= 0 ? "+" + i.delta : String(i.delta)) : "",
      id: i.id,
      name: i.name,
      mer: SEA[i.sea] || i.sea,
      route: i.route,
      danger: i.danger,
      pvp: i.pvp ? "oui" : "-",
    };
  }

  async function list() {
    const islands = await fetchAtlas();
    const by = {};
    for (const i of islands) {
      (by[i.rencontre] ||= []).push(`${i.id} (${(SEA[i.sea] || i.sea).split(" ")[0]})`);
    }
    const summary = Object.keys(by)
      .map(Number)
      .sort((a, b) => a - b)
      .map((lvl) => ({
        lvl,
        iles: by[lvl].slice(0, 6).join(", ") + (by[lvl].length > 6 ? ` +${by[lvl].length - 6}` : ""),
      }));
    console.log(`%c[GLIslands] ${islands.length} îles — niveau de rencontre`, "color:#6cf;font-weight:bold");
    console.table(summary);
    return summary;
  }

  async function forLevel(level, sea) {
    level = Number(level) || playerLevel();
    const islands = await fetchAtlas();
    const picks = recommend(islands, level, sea ? String(sea).toLowerCase() : null);
    console.log(
      `%c[GLIslands] recommandé pour lvl ${level} (±${WINDOW})` +
        (sea ? ` · mer=${sea}` : ""),
      "color:#7f7;font-weight:bold"
    );
    console.table(picks.slice(0, 20).map(row));
    return picks;
  }

  async function forMe(sea) {
    const lvl = playerLevel();
    console.log(`%c[GLIslands] perso lvl ${lvl} · map ${playerMap()}`, "color:#fc6");
    return forLevel(lvl, sea);
  }

  async function sea(name) {
    const islands = await fetchAtlas();
    const s = String(name || "").toLowerCase();
    const rows = islands.filter((i) => i.sea === s).map(row);
    console.log(`%c[GLIslands] mer ${SEA[s] || s}`, "color:#6cf;font-weight:bold");
    console.table(rows);
    return rows;
  }

  async function search(q) {
    const islands = await fetchAtlas();
    const qq = String(q || "").toLowerCase();
    const rows = islands
      .filter((i) => i.id.includes(qq) || i.name.toLowerCase().includes(qq))
      .map(row);
    console.table(rows);
    return rows;
  }

  window.GLIslands = { list, forLevel, forMe, sea, search, fetchAtlas, WINDOW };
  console.log(
    "%c✅ GLIslands\n" +
      "  GLIslands.forMe()          → îles pour ton niveau\n" +
      "  GLIslands.forLevel(12)     → îles pour un lvl\n" +
      "  GLIslands.list()           → résumé lvl → îles\n" +
      "  GLIslands.sea('west')      → West Blue\n" +
      "  GLIslands.search('toroa')",
    "color:#7f7;font-weight:bold"
  );
})();
