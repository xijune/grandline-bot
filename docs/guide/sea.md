# Mer & voyage

> Extrait consolidé depuis systems_advanced (01/11/2026). Preuves : `docs/sessions/`.

## 3. Travel / Navire bout en bout

### Travel simple (téléport / voyage rapide ?)
```
POST /api/world/travel
{ characterId, islandId }
```
Réponse peut contenir `alreadyThere`, `seaKing`, `ambush`, `events`.

### Navire — construction / achat
| Route | Body |
|-------|------|
| POST `/api/characters/${id}/construire-navire` | `{ classId }` |
| POST `/api/world/ship/buy` | `{ characterId, classId }` |
| POST `/api/world/ship/name` | `{ characterId, name }` |
| POST `/api/world/ship/look` | look |
| POST `/api/world/ship/pieces` | équipement pièce |
| POST `/api/world/ship/canons` | canons |
| GET  `/api/world/ship/pieces/${id}` / `canons/${id}` | état |
| GET  `/api/world/dock/${characterId}` | état dock |
| POST `/api/characters/${id}/reparer-au-port` | réparation |

### Mer (sea)
| Route | Rôle |
|-------|------|
| GET `/api/sea/${charId}` | état mer |
| POST `/api/sea/depart` | `{ characterId, islandId?, mode: "navire", sortie? }` |
| POST `/api/sea/cap` | `{ characterId, islandId }` |
| GET `/api/sea/caps/${id}` | caps disponibles |
| POST `/api/sea/position` | position |
| POST `/api/sea/dock` | `{ characterId, islandId }` |
| POST `/api/sea/abandon` | abandon |
| POST `/api/sea/canal/exit` | sortie canal |
| … | hunt, salvage, journal, deck, invitation… |

### Navigation (équipage / droits)
| Route | Body |
|-------|------|
| GET `/api/navigation/etat/${id}` | état |
| POST `/api/navigation/debloquer` | `{ characterId }` |
| POST `/api/navigation/quitter-navire` | `{ characterId }` |

### Flux typique
1. Avoir / construire un navire (`ship.owned`).
2. Au dock → `seaDepart` ou `travel`.
3. En mer → `seaCap` / position / events (tempête, seaKing…).
4. Arrivée → `seaDock` sur île cible.
5. Optionnel : embarquer/débarquer membres d’équipage (rights `EMBARQUER`).

`character.ship` contient `owned`, class, coque, etc.  
Repos « rough » / `ship` dans rest state indique disponibilité repos à bord.

---


