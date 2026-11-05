# Systèmes jeu — référence bot

Synthèse des systèmes testés live (31/10/2026). Combat détaillé dans `combat.md`.

## Combat FAUNE
Voir `combat.md` + `api_combat.md`. Module : `GLCombat` v2.

## Repos
| Route | Rôle |
|-------|------|
| GET `/api/world/rest/:charId` | vitality, HP, options freeSleep/inn/ship/rough |
| POST `/api/world/rest` | `{ characterId, kind: "BELLE_ETOILE" }` |

## Farm faune
- Skip `network.fauna.engagees`
- Skip si `fauna.morts[packId] > now`
- Cooldown freeFight ~90s (`freeFightAt`)

## Harvest
| Route | Rôle |
|-------|------|
| POST `/api/characters/:id/harvest` | loot île + nextHarvestAt (~2 min CD, 429) |

## Pêche
| Route | Rôle |
|-------|------|
| POST `/api/characters/:id/fish` | au bord de l’eau → `{ caught, nextAt }` |

## Daily
| Route | Rôle |
|-------|------|
| GET `/api/characters/:id/daily` | calendar, roulette, taches |
| POST `.../daily/claim` | reward du jour |
| POST `.../daily/spin` | roulette |
| POST `.../daily/taches/:id/reclamer` | claim tâche finie |

## Loot sol
| Route | Rôle |
|-------|------|
| POST `.../inventory/pickup` | `{ dropId }` |

## Coffres
| Route | Rôle |
|-------|------|
| GET `.../chests` | liste + respawn |
| POST `.../chests/open` | `{ chestId }` |

## Haki
Gagné **uniquement** en combat (train API refuse).

## Sockets utiles
`players:moved`, `world:maj`, `world:population`, `player:left`, `world:entre`

## Affaires du jour
| Route | Rôle |
|-------|------|
| GET `/api/affaires/:charId` | offres du créneau |
| POST `/api/affaires/:charId/acheter` | `{ index }` — testé index 0 gratuit +500฿ |

## Collection coffres
| Route | Rôle |
|-------|------|
| GET `/api/coffres/:charId` | emplacements, boutique, paliers |
| POST `/api/coffres/:id/ouvrir` | ouvrir un coffre inventaire |
| POST `/api/coffres/:id/acheter` | acheter type bois/argent/or… |

## Bourse
GET `/api/bourse/iles`, `/api/bourse/portefeuille/:id`

## Sockets faune/combat map
- `fauna:updated` `{packId, statut, respawnAt?, prochain?}`
- `battle:opened` / `battle:closed`

---

## Systèmes avancés (doc dédiée)

Voir **`docs/guide/economy.md`** pour le détail complet extrait du bundle client :

1. **Négoce / vente comptoir** — `/api/negoce/vendre|acheter|comptoir|tableau`
2. **Craft** — `/api/characters/:id/craft` + `craft/collect` (recipeId + catalyseur)
3. **Travel / Navire / Mer** — `/api/world/travel`, `/api/sea/*`, `/api/navigation/*`, ship buy/construire
4. **Quêtes** — `quest-objectives` → `quest-search` `{objectifId}` → complete / side-quests
5. **PvP** — `/api/battles/pvp/challenge` `{characterId, targetId}` + join
6. **Shop** — `shop/:rayon` + `buy` `{itemId, shopId}` (rayons : port, CHANTIER, taverne…)
