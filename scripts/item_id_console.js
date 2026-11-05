/**
 * Trouver l'id d'un objet par son nom (pour SELL_JUNK)
 *
 * Coller en F12 en jeu, puis :
 *   ItemId.find("plume")
 *   ItemId.find("peau")
 *   ItemId.list()           // tout l'inventaire
 *   ItemId.junkCandidates() // ids + noms (copie facile)
 */
(() => {
  "use strict";

  const API = "https://api.grandline-online.fr";

  function token() {
    return (
      window.__freshToken ||
      sessionStorage.getItem("grandline-token") ||
      localStorage.getItem("grandline-token") ||
      ""
    );
  }

  async function apiGet(path) {
    const r = await fetch(API + path, {
      headers: {
        accept: "application/json",
        ...(token() ? { authorization: "Bearer " + token() } : {}),
      },
    });
    return r.json().catch(() => null);
  }

  function fromScene() {
    const inv = window.__grandlineScene?.character?.inventory;
    const items = inv?.items || (Array.isArray(inv) ? inv : []) || [];
    return items
      .filter((it) => it && it.id)
      .map((it) => ({
        id: it.id,
        name: it.name || it.id,
        quantity: Number(it.quantity) || 0,
      }));
  }

  async function fromApi() {
    const data = await apiGet("/api/characters");
    const list = Array.isArray(data) ? data : data?.characters || [];
    const sceneId = window.__grandlineScene?.character?.id;
    const ch =
      list.find((c) => c.id === sceneId) ||
      list[0] ||
      null;
    if (!ch) return [];
    // détail si possible
    let full = ch;
    try {
      const d = await apiGet("/api/characters/" + ch.id);
      if (d?.inventory) full = d;
    } catch {}
    const items = full.inventory?.items || [];
    return items
      .filter((it) => it && it.id)
      .map((it) => ({
        id: it.id,
        name: it.name || it.id,
        quantity: Number(it.quantity) || 0,
      }));
  }

  async function allItems() {
    const a = fromScene();
    const b = await fromApi();
    const map = new Map();
    for (const it of [...a, ...b]) {
      const prev = map.get(it.id);
      if (!prev || it.quantity > prev.quantity) map.set(it.id, it);
    }
    return [...map.values()].sort((x, y) =>
      (x.name || "").localeCompare(y.name || "")
    );
  }

  async function find(query) {
    const q = String(query || "")
      .trim()
      .toLowerCase();
    if (!q) {
      console.warn("Usage: ItemId.find(\"plume\")");
      return [];
    }
    const items = await allItems();
    const hits = items.filter(
      (it) =>
        it.id.toLowerCase().includes(q) ||
        (it.name || "").toLowerCase().includes(q)
    );
    if (!hits.length) {
      console.log("%c[ItemId] aucun résultat pour: " + q, "color:#f66");
      return [];
    }
    console.log(
      `%c[ItemId] ${hits.length} résultat(s) pour "${q}"`,
      "color:#7f7;font-weight:bold"
    );
    console.table(hits);
    console.log(
      "SELL_JUNK ids:",
      hits.map((h) => h.id)
    );
    console.log(
      "À coller:\n" + hits.map((h) => `  "${h.id}", // ${h.name}`).join("\n")
    );
    return hits;
  }

  async function list() {
    const items = await allItems();
    console.log(`%c[ItemId] inventaire (${items.length})`, "color:#6cf;font-weight:bold");
    console.table(items);
    return items;
  }

  async function junkCandidates() {
    const items = await allItems();
    // heuristique soft pour proposer, pas auto-sell
    const hits = items.filter((it) =>
      /plume|viande|gibier|bois|peau|baie|algue|sel|bl[eé]|poisson|os|fourrure|minerai|charbon|cordage|resine|poudre|encre|fil|corne|champignon|venin|thon|cristal|ecorce|huile|verre|sang|dent/i.test(
        it.id + " " + it.name
      )
    );
    console.log("%c[ItemId] candidats junk", "color:#fc6;font-weight:bold");
    console.table(hits);
    console.log(
      "Copie SELL_JUNK:\n[\n" +
        hits.map((h) => `  "${h.id}", // ${h.name}`).join("\n") +
        "\n]"
    );
    return hits;
  }

  window.ItemId = { find, list, junkCandidates, allItems };
  console.log(
    "%c✅ ItemId\n" +
      '  ItemId.find("plume")\n' +
      "  ItemId.list()\n" +
      "  ItemId.junkCandidates()",
    "color:#7f7;font-weight:bold"
  );
})();
