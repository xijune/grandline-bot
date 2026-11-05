# Farm & navigation map

> Pathfinder + faune. Détails combat : [combat.md](./combat.md). Preuves pathfinder : `docs/sessions/2026-11-01/live_pathfinder_2026-11-01.md`.

## Modules

| Global | Rôle |
|--------|------|
| `GLBot` (`src/inject/glbot.js` v1.1) | Farm map, pathfinder BFS, walkTo |
| `GLCombat` (`src/inject/combat-module.js` v2.1) | Combat API pure |

## Pathfinder (v1.1)

- Source walkable : `scene.movementBlocked` + `mapData.blocked`
- BFS 4 directions, chunks de **20** cases (`mapData.maxSteps`)
- Cible bloquée (PNJ) → `nearestWalkable` rayon 1–2
- `moveLocal(path, null, { courir: true, redresser: true })`
- Poll `!entity.moving` ~200 ms

```js
GLBot.debugPath(79, 92);      // inspecte BFS
GLBot.escapeBlockedCell();    // sort eau / case invalide
GLBot.walkTo({ x: 104, y: 140 });
```

## Faune — filtres farm

| Champ | Usage |
|-------|--------|
| `network.fauna.packs[]` | cibles |
| `network.fauna.morts[packId]` | skip si `> Date.now()` (respawn) |
| `network.fauna.engagees[]` | skip (déjà en combat) |
| `character.freeFightAt` | cooldown ~90 s entre combats libres |

Socket : `fauna:updated` `{ packId, statut, respawnAt?, prochain? }`

## Boucle farm recommandée

```
1. Rest si HP / vitality bas (GET /api/world/rest/:id)
2. Lister packs disponibles (pas morts / pas engagees)
3. walkToPack (orbit.cx/cy) ou GLBot.walkTo(ancre)
4. POST /battles/start { characterId, fauna: packId }
5. GLCombat.fight(battleId) ou arm()
6. Loot / berries via GET /api/characters
7. Répéter
```

## API liées

- `POST /api/battles/start` — engagé proche du pack sinon 409
- `POST /api/world/rest` — `{ characterId, kind: "BELLE_ETOILE" }`
- Berries : toujours lire l’API (UI souvent stale)
