# Reverse engineering GrandLine Online

État au 31/10/2026 — extraction bundle + tests API live.

## Architecture client
- Phaser 3, scène `window.__grandlineScene`
- Réseau : Socket.IO (`scene.network.socket`) + REST `https://api.grandline-online.fr`
- Auth : JWT Bearer dans `sessionStorage` (`grandline-token`)
- API client : **387 méthodes** nommées → `docs/api/methods.md`
- Routes uniques ~411 → `docs/api/catalog.md`

## Combat
Doc complète : `docs/guide/combat.md`  
Module : `src/inject/combat-module.js` v2.0

Points clés serveur :
- ATTAQUE range 1 ; techniques `geometry.range`
- Estimates `{min,max,critMin,critMax}`
- Log : INITIATIVE, ENGAGE, MOVE, CAST, DAMAGE, DOWN, GUARD, END
- Combos multi (`Frappe conjointe`, `combo:true`)
- Status `GARDE` 1 tour

## Faune (monde)
| Champ | Rôle |
|-------|------|
| packs[] | id, slot, generation, ancre, mobs |
| morts[packId] | timestamp respawn |
| engagees[] | en combat |

Socket **`fauna:updated`** : `{ packId, statut, respawnAt?, prochain? }`  
Statuts : ENGAGEE, ABATTUE, REPEUPLEE

Socket **`battle:opened` / `battle:closed`** : combats sur la map (joinable, pvp, participants)

## Repos / vitality
`GET /api/world/rest/:id` → vitality, label, freeSleep, inn, ship, rough  
`POST /api/world/rest` `{ characterId, kind: "BELLE_ETOILE" }`

## Harvest / pêche
| Action | Route | Contrainte |
|--------|-------|------------|
| Harvest île | POST `.../harvest` | CD ~2 min (429) |
| Pêche | POST `.../fish` | cases eau |

## Daily
- claim jour, spin roulette
- tâches : `.../daily/taches/:id/reclamer` | `/relancer`
- Testé : combats +64XP +140฿

## Économie
| Système | Route | Notes |
|---------|-------|-------|
| Shop rayon | GET `.../shop/:rayon` | items[] (souvent vide hors PNJ contexte?) |
| Buy | POST `.../buy` | berries insuffisants testé |
| Affaires du jour | GET/POST `/api/affaires/:id` | offres créneau, gratuit testé +500฿ |
| Bourse | `/api/bourse/*` | îles cotées, portefeuille |
| Banque | `character.bank` | prêts |
| Coffres (collection) | `/api/coffres/:id` | emplacements, ouvrir, boutique types |

## Coffres carte
GET `.../chests` — positions + `revientDans`  
POST `.../chests/open` `{ chestId }`

## Haki
Train API refusée — progression **par victoires** uniquement.

## Map client
`scene.mapData` : id, width, height, maxSteps, cityMap, blocked, aretes  
`cityMap` : spawn, buildings, port, npcs, anchors, terrain…

## Sockets prioritaires bot
```
fauna:updated, battle:opened, battle:closed, battle:state,
players:moved, player:left, world:maj, world:population,
world:snapshot, session:idle-warning, session:closed
```
Liste complète : `docs/sessions/2026-10-31/socket_events.json` (99)

## États combat (65)
`docs/sessions/2026-10-31/etats_list.json` — SAIGNEMENT, POISON, GARDE, VISEE, …

## Shapes AOE
single, circle1, circle2, cross1, line3, line5, cone3, self

## Systèmes avancés (31/10 soir)
Doc complète : **`docs/guide/economy.md`**

- Négoce : POST `/api/negoce/vendre` `{characterId, marchandise, quantite}`
- Craft : POST `.../craft` `{recipeId, catalyseur}` + collect
- Travel : POST `/api/world/travel` `{characterId, islandId}`
- Sea : `/api/sea/depart|cap|dock|position|…`
- Quêtes : `quest-objectives` → `quest-search` `{objectifId}`
- PvP : POST `/api/battles/pvp/challenge` `{characterId, targetId}`
- Shop : GET `.../shop/:rayon` + POST `.../buy` `{itemId, shopId}`

## Ce qui reste moins prouvé live
- Liste exhaustive des recipeId par aspiration (données client)
- Accept PvP exact (join vs socket UI)
- Shop items non-vides uniquement près PNJ (confirmé comportement)
- Formule dégâts serveur exacte (estimates = source de vérité)
- Consume item selon contexte map
