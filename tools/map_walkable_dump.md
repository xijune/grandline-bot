# Dump walkable map

`world:join` ne renvoie **pas** la grille si `map.deja: true` (carte déjà connue du compte).

Source fiable : client Phaser `scene.mapData` / `scene.movementBlocked`.

## Procédure capture (1× par map)

1. Entrer en jeu sur la map
2. Console :

```js
(() => {
  const s = window.__grandlineScene;
  const md = s.mapData;
  const blocked = [];
  s.movementBlocked.forEach((v, k) => blocked.push(String(k)));
  const dump = {
    meta: { system: "map", source: "browser", mapId: md.id },
    width: md.width,
    height: md.height,
    maxSteps: md.maxSteps,
    blockedFormat: "x:y",
    blocked,
  };
  copy(JSON.stringify(dump));
  console.log("copied", md.id, blocked.length);
})();
```

3. Sauver dans :
   - `tests/fixtures/map/<mapId>_walkable.json`
   - `docs/data/maps/<mapId>_walkable.json` (référence)

## Usage offline

```python
from map_path import load_walkable, bfs_path
w = load_walkable("ohara")
path = bfs_path(w, 100, 89, 110, 95)
```

## Présent

| Map | Cells bloquées | Fichier |
|-----|----------------|---------|
| ohara | 633 | `tests/fixtures/map/ohara_walkable.json` |
