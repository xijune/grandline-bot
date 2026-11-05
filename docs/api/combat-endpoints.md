# API Combat GrandLine — carte complète

Base: `https://api.grandline-online.fr`  
Auth: `Authorization: Bearer <jwt>` (sessionStorage token)

## Battles
| Méthode | Route | Body / notes |
|---------|-------|----------------|
| POST | `/api/battles/start` | `{ characterId, fauna: packId }` ou boss/pvp variants |
| GET | `/api/battles/:id` | État complet (fighters, actions, tactics, winner) |
| GET | `/api/battles/active/:characterId` | Combat en cours éventuel |
| POST | `/api/battles/:id/engage` | `{ characterId }` |
| POST | `/api/battles/:id/placement` | `{ characterId, cell: {x,y} }` |
| POST | `/api/battles/:id/move` | `{ characterId, cell: {x,y} }` — cases de `tactics.reachable` |
| POST | `/api/battles/:id/action` | voir ci-dessous |
| POST | `/api/battles/:id/end-turn` | `{ characterId }` |
| POST | `/api/battles/:id/options` | `{ characterId, ... }` |
| POST | `/api/battles/:id/exclude` | `{ characterId, targetId }` |
| POST | `/api/battles/:id/revenir` | `{ characterId }` |
| POST | `/api/battles/:id/join` | `{ characterId, side }` |
| POST | `/api/battles/boss` | boss île |
| POST | `/api/battles/pvp/challenge` | `{ characterId, targetId }` |
| POST | `/api/battles/halloween` | event |
| POST | `/api/battles/halloween/treasure-ambush` | event |

### Action payload
```json
{
  "characterId": "...",
  "kind": "TECHNIQUE|ATTAQUE|GARDE|FUITE",
  "id": "tir-1",
  "targetId": "quest-enemy",
  "targetCell": { "x": 39, "y": 46 }
}
```

## Character / deck
| Méthode | Route |
|---------|-------|
| GET | `/api/characters` |
| GET | `/api/characters/:id/techniques` |
| GET | `/api/characters/:id/deck` |
| POST | `/api/characters/:id/techniques/:techId/maitrise` | `{ branche }` |

## World
| Méthode | Route | Body |
|---------|-------|------|
| POST | `/api/world/rest` | `{ characterId, kind: "BELLE_ETOILE" }` |
| POST | `/api/world/fauna/tame` | `{ characterId, packId }` |
| POST | `/api/world/fauna/release` | |

## Engagement FAUNE
- 409 `CONFLIT` / « trop loin » si pas assez proche du **mob réel** (orbit va-et-vient)
- 200 + body = combatState complet (comme GET battle)

## Live validé (31/10/2026)
- GET techniques → 200, 19 actions (deck + locked tree)
- GET deck → 200, sorts: tir-1, race-lunaria-flame, weapon-shot-quickdraw
- POST start fauna → 200 (après approche tile mob)
- POST engage → 200
- Isolation outil: fetch parfois OK parfois non; **console page = fiable**
