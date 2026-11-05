# Travel / navire bout-en-bout — live 01/11/2026

## Prérequis validés

1. Navire owned : `POST /api/world/ship/buy { characterId, classId: "barque" }` → "L’Alizé"
2. Sur **cellule ponton exacte** : ilusia **104,139** (pas seulement 104,137)
3. Mode : `navire`

## Flux live réussi (aller-retour)

```
1. WalkTo 104,139
2. POST /api/sea/depart
   { characterId, mode: "navire", sortie: "sud"|"nord"|"est"|"ouest" }
   → 200 atSea { seaId:"west", col, row, x, y, fromIslandId:"ilusia" }

3. GET /api/sea/{characterId}
   → atSea, equipage, hull, dockable, grid {cols:6,rows:4}, cap, fermees[]

4. POST /api/sea/position { characterId, col, row, x, y }
   → rate-limit : 409 "La mer ne se traverse pas si vite" si trop tôt

5. POST /api/sea/dock { characterId, islandId: "ilusia" }
   → 200 alreadyThere / mapId ilusia · atSea null
```

## Blocage inter-îles (concret)

- `discoveredLocations`: **["ilusia"]** seulement
- `POST /world/travel { islandId }` → 409 « Tu n’as pas la route de cette île »
- `POST /sea/cap { islandId }` → 409 « Aucune route connue » / « pas dans cette mer »
- `GET /sea/caps/{id}` → `caps: []` tant qu’aucune route
- Client : *« Parle aux gens du port : ce sont eux qui les donnent. »*
- Log Pose routes Paradise : `GET /api/world/pose/routes` (routes grand line, pas West Blue local)

## Routes API

| Action | Route | Body |
|--------|-------|------|
| Achat navire | POST `/world/ship/buy` | `{ characterId, classId }` |
| Dock info | GET `/world/dock/{id}` | — |
| Départ | POST `/sea/depart` | `{ characterId, mode:"navire", sortie? }` |
| État mer | GET `/sea/{id}` | — |
| Caps | GET `/sea/caps/{id}` | — |
| Cap | POST `/sea/cap` | `{ characterId, islandId }` |
| Position | POST `/sea/position` | `{ characterId, col, row, x, y }` |
| Accoster | POST `/sea/dock` | `{ characterId, islandId }` |
| Travel (si route) | POST `/world/travel` | `{ characterId, islandId }` |

## Sortie

`sortie` ∈ `nord|est|sud|ouest` (sinon 400)

## Prochaine étape pour 90 % travel

Obtenir **routes West Blue** via PNJ port (Lin / quête) puis cap + dock autre île.
