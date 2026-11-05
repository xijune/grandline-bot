/**
 * Îles avec FORGE (craft qui nécessite une forge)
 *
 * Coller en F12 console, puis :
 *   GLForge.list()              // toutes les forges
 *   GLForge.near(level)         // proches de ton niveau
 *   GLForge.forMe()             // selon ton perso
 *   GLForge.sea("east")         // filtre mer
 *
 * Source: GET /api/world/atlas (services contient "FORGE")
 */
(() => {
  "use strict";
  const API = "https://api.grandline-online.fr";
  const SEA = {
    east: "East Blue",
    west: "West Blue",
    north: "North Blue",
    south: "South Blue",
    grandline: "Grand Line",
    newworld: "New World",
  };

  // Fallback si API KO (atlas projet 2026)
  const FALLBACK = [
    { id: "loguetown", name: "Loguetown", sea: "east", level: 35 },
    { id: "germa", name: "Royaume de Germa", sea: "north", level: 60 },
    { id: "water7", name: "Water Seven", sea: "grandline", level: 153 },
    { id: "marineford", name: "Marineford", sea: "grandline", level: 280 },
    { id: "namakura", name: "Île Namakura", sea: "grandline", level: 153 },
    { id: "karakuri", name: "Île Karakuri", sea: "grandline", level: 165 },
    { id: "g1", name: "G-1", sea: "grandline", level: 200 },
    { id: "zou", name: "Zou", sea: "newworld", level: 520 },
    { id: "wano", name: "Pays des Wa", sea: "newworld", level: 680 },
    { id: "egghead", name: "Egghead", sea: "newworld", level: 760 },
    { id: "elbaf", name: "Elbaf", sea: "newworld", level: 840 },
    { id: "new_marineford", name: "Nouveau Marineford", sea: "newworld", level: 760 },
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
    return Number(c?.level || 1) || 1;
  }

  function playerMap() {
    return window.__grandlineScene?.character?.mapId || "?";
  }

  function hasForge(i) {
    const services = i.services || i.shops || [];
    if (services.some((s) => String(s).toUpperCase() === "FORGE")) return true;
    const blob = JSON.stringify(i).toLowerCase();
    return blob.includes('"forge"') || /\bforge\b/.test(blob);
  }

  async function fetchForges() {
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
          .filter(hasForge)
          .map((i) => ({
            id: i.id,
            name: i.name || i.id,
            sea: i.sea || "?",
            level: Number(i.niveauRencontre || i.level || 0),
            danger: Number(i.danger || 0),
            services: i.services || [],
          }))
          .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
        return CACHE;
      }
    } catch (e) {
      console.warn("[GLForge] atlas fail → fallback", e);
    }
    CACHE = FALLBACK.map((x) => ({ ...x, services: ["FORGE"] }));
    return CACHE;
  }

  function row(i) {
    return {
      lvl: i.level,
      id: i.id,
      name: i.name,
      mer: SEA[i.sea] || i.sea,
      danger: i.danger ?? "",
      services: (i.services || []).join(", "),
    };
  }

  async function list() {
    const forges = await fetchForges();
    console.log(
      `%c[GLForge] ${forges.length} îles avec FORGE`,
      "color:#fc6;font-weight:bold"
    );
    console.table(forges.map(row));
    return forges;
  }

  async function sea(name) {
    const s = String(name || "").toLowerCase();
    const forges = (await fetchForges()).filter((i) => i.sea === s);
    console.log(`%c[GLForge] mer ${SEA[s] || s}`, "color:#6cf;font-weight:bold");
    console.table(forges.map(row));
    return forges;
  }

  async function near(level, window = 40) {
    level = Number(level) || playerLevel();
    const forges = await fetchForges();
    const ranked = forges
      .map((i) => ({ ...i, delta: i.level - level, abs: Math.abs(i.level - level) }))
      .filter((i) => i.abs <= window)
      .sort((a, b) => a.abs - b.abs || a.level - b.level);
    console.log(
      `%c[GLForge] forges près du lvl ${level} (±${window})`,
      "color:#7f7;font-weight:bold"
    );
    console.table(
      ranked.map((i) => ({
        ...row(i),
        delta: (i.delta >= 0 ? "+" : "") + i.delta,
      }))
    );
    if (!ranked.length) {
      console.log("Aucune dans la fenêtre — élargis window ou vois GLForge.list()");
      // suggest closest anyway
      const closest = forges
        .map((i) => ({ ...i, abs: Math.abs(i.level - level) }))
        .sort((a, b) => a.abs - b.abs)
        .slice(0, 5);
      console.table(closest.map((i) => ({ ...row(i), distLvl: i.abs })));
    }
    return ranked;
  }

  async function forMe(window = 50) {
    console.log(
      `%c[GLForge] perso lvl ${playerLevel()} · map ${playerMap()}`,
      "color:#fc6"
    );
    return near(playerLevel(), window);
  }

  window.GLForge = { list, sea, near, forMe, fetchForges };
  console.log(
    "%c✅ GLForge\n" +
      "  GLForge.list()         → toutes les îles FORGE\n" +
      "  GLForge.forMe()        → selon ton niveau\n" +
      "  GLForge.near(35)       → autour d'un lvl\n" +
      "  GLForge.sea('east')    → East Blue",
    "color:#7f7;font-weight:bold"
  );
})();
