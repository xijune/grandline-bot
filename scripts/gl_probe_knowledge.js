/**
 * GrandLine Online - Sonde Ciblée : Connaissances, Objets & Soin
 * 
 * À coller dans la console F12 en jeu.
 * Ce script interroge directement les méthodes internes révélées par la première analyse :
 * 1. scene.chargerLesConnaissances() (catalogue global du jeu)
 * 2. Événements socket (scene.network.socket)
 * 3. Données de l'inventaire UI (tooltips, description des objets quand on clique dessus)
 * 4. Mécanisme de soin / régénération des PV et consommation des rations en mer
 */
(async function () {
  "use strict";

  const scene = window.__grandlineScene;
  console.log("%c🔍 [GL-Sonde Ciblée] Analyse de 'chargerLesConnaissances' et des sockets...", "color:#38bdf8;font-weight:bold;");

  const results = {
    connaissances: null,
    socketListeners: [],
    registryValues: {},
    cacheData: {},
    itemDomDetails: [],
    restMethods: []
  };

  // 1. Tester chargerLesConnaissances
  if (typeof scene?.chargerLesConnaissances === "function") {
    try {
      const res = await scene.chargerLesConnaissances();
      results.connaissances = res ? {
        type: typeof res,
        keys: Object.keys(res),
        sample: Array.isArray(res) ? res.slice(0, 10) : (typeof res === "object" ? Object.fromEntries(Object.entries(res).slice(0, 10)) : res)
      } : "executed_returned_null_or_void";
    } catch (e) {
      results.connaissances = { error: e.message };
    }
  }

  // 2. Inspecter le cache Phaser (textures, json, etc.)
  try {
    if (scene?.cache?.json) {
      const jsonEntries = scene.cache.json.entries?.entries || scene.cache.json.entries || {};
      results.cacheData = Object.keys(jsonEntries);
    }
  } catch (_) {}

  // 3. Inspecter les listeners socket actifs
  try {
    const s = scene?.network?.socket;
    if (s) {
      if (s._callbacks) {
        results.socketListeners = Object.keys(s._callbacks).map(k => k.replace(/^\$/, ""));
      } else if (s.listeners) {
        results.socketListeners = s.eventNames ? s.eventNames() : Object.keys(s);
      }
    }
  } catch (_) {}

  // 4. Inspecter les éléments de l'inventaire dans le DOM pour extraire descriptions et tooltips
  try {
    const itemEls = Array.from(document.querySelectorAll("[data-item-id], .slot-item, .item-card, .inventaire-item, .sac-item"));
    for (const el of itemEls.slice(0, 15)) {
      results.itemDomDetails.push({
        tag: el.tagName,
        classes: el.className,
        dataset: { ...el.dataset },
        text: el.innerText.trim(),
        title: el.getAttribute("title") || el.getAttribute("data-tooltip") || ""
      });
    }
  } catch (_) {}

  // 5. Inspecter le Registry et Data du jeu
  try {
    if (scene?.registry?.values) {
      results.registryValues = Object.keys(scene.registry.values);
    }
  } catch (_) {}

  // 6. Inspecter les fonctions liées au repos, au voyage et au soin
  for (const k of Object.keys(scene || {})) {
    if (/repos|soin|voyage|mer|bateau|navire|faim|ration|nourriture|pv|vie|reg|heal/i.test(k)) {
      results.restMethods.push(k);
    }
  }

  console.log("%c✅ [GL-Sonde Ciblée] Résultat :", "color:#10b981;font-weight:bold;", results);

  // Téléchargement
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(results, null, 2));
  const dlAnchor = document.createElement("a");
  dlAnchor.setAttribute("href", dataStr);
  dlAnchor.setAttribute("download", `gl_connaissances_${Date.now()}.json`);
  document.body.appendChild(dlAnchor);
  dlAnchor.click();
  dlAnchor.remove();

  return results;
})();
