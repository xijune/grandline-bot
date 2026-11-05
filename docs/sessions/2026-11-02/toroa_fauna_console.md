# Toroa fauna + script console — 2026-11-02

## Packs Toroa (join fauna live)

| Pack | Espèces | Niveaux | Ancre |
|------|---------|---------|-------|
| toroa-groupe-1 | écureuil×3 | 8–9 | 40,35 |
| toroa-groupe-2 | chien×3 | 9–10 | 120,43 |
| toroa-groupe-3 | poule×3 | 7–9 | 40,56 |
| toroa-groupe-4 | colombe×3 | 7–8 | 120,66 |

Spawn port ~ **(53,129)**.

## Blocage walk

Pas de fixture `toroa_walkable.json` → greedy pathfinding se bloque (ex. y=120 mur).  
À capturer (console ou dump join `movementBlocked`) pour BFS offline.

## Combat

`POST /battles/start { fauna }` exige proximité → 409 « trop loin » si pas assez proche.

## Script console

`scripts/console_level_bot.js` — coller F12, puis `await GLBot.loop(5)`.
