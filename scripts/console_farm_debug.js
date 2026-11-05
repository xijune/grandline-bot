/**
 * Diagnostic faune — coller si Farm dit "aucun pack valide"
 * Affiche la structure brute scene.network.fauna
 */
(function () {
  const scene =
    window.__grandlineScene ||
    (window.game || window.phaserGame)?.scene?.scenes?.find(
      (s) => s?.network || s?.character
    );
  if (!scene) return console.error("Pas de scène");
  window.__grandlineScene = scene;

  const fauna = scene.network?.fauna;
  console.log("%c[DBG] network.fauna", "color:#6cf", fauna);
  console.log("keys", fauna ? Object.keys(fauna) : null);
  const packs = fauna?.packs || [];
  console.log("n packs", packs.length);
  packs.slice(0, 8).forEach((p, i) => {
    console.log(`pack[${i}]`, {
      id: p.id,
      ancre: p.ancre,
      engaged: p.engaged,
      mobs: (p.mobs || []).map((m) => ({
        espece: m.espece,
        niveau: m.niveau ?? m.level,
        orbit: m.orbit && { cx: m.orbit.cx, cy: m.orbit.cy },
      })),
    });
  });
  console.log("morts", fauna?.morts);
  console.log("engagees", fauna?.engagees);
  console.log("faunaEntities size", scene.faunaEntities?.size ?? scene.faunaEntities);
  console.log("character", scene.character && {
    mapId: scene.character.mapId,
    x: scene.character.x,
    y: scene.character.y,
    level: scene.character.level,
  });
  // autres endroits possibles
  const alt = [
    ["scene.fauna", scene.fauna],
    ["scene.faunaPacks", scene.faunaPacks],
    ["network.world", scene.network?.world],
  ];
  alt.forEach(([n, v]) => {
    if (v) console.log("[DBG] alt", n, v);
  });
  window.FarmDbg = { scene, fauna, packs };
  console.log("%c[DBG] prêt — FarmDbg.packs", "color:#6f6");
})();
