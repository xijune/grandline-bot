/**
 * Capture walkable (méthodo A) — coller en console F12 une fois en jeu sur la map.
 *
 * Résultat : JSON copié dans le presse-papier + log console.
 * Sauver dans :
 *   tests/fixtures/map/<mapId>_walkable.json
 *   docs/data/maps/<mapId>_walkable.json
 *
 * Puis offline :
 *   python -c "from tools.map_path import load_walkable, bfs_path; ..."
 */
(() => {
  const s = window.__grandlineScene;
  if (!s) {
    console.error("[dump_walkable] Pas de scène — entre en jeu d'abord");
    return;
  }
  const md = s.mapData || {};
  const blocked = [];
  const mb = s.movementBlocked;
  if (mb && typeof mb.forEach === "function") {
    mb.forEach((v, k) => blocked.push(String(k).replace(",", ":")));
  } else if (md.blocked) {
    for (const c of md.blocked) blocked.push(String(c).replace(",", ":"));
  } else {
    console.error("[dump_walkable] movementBlocked introuvable");
    return;
  }
  // normalize x:y
  const norm = blocked.map((k) => {
    if (k.includes(":")) return k;
    if (k.includes(",")) return k.replace(",", ":");
    return k;
  });
  const dump = {
    meta: {
      system: "map",
      source: "browser_movementBlocked",
      mapId: md.id || s.network?.mapId || "unknown",
      capturedAt: new Date().toISOString(),
    },
    width: md.width || 160,
    height: md.height || 160,
    maxSteps: md.maxSteps || 50,
    blockedFormat: "x:y",
    blocked: norm,
  };
  const json = JSON.stringify(dump);
  if (typeof copy === "function") {
    copy(json);
    console.log(
      "[dump_walkable] COPIED",
      dump.meta.mapId,
      "blocked=",
      norm.length,
      "size=",
      dump.width + "x" + dump.height
    );
  } else {
    console.log(json);
    console.log(
      "[dump_walkable]",
      dump.meta.mapId,
      "blocked=",
      norm.length,
      "(copy manuelle)"
    );
  }
  window.__glWalkableDump = dump;
  return dump;
})();
