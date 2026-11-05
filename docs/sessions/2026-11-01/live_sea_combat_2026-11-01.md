# Combat mer — live 01/11/2026

## État mer

```
GET /sea/{id}
GET /sea/journal/{id} → huntAvailable, huntReward {berries:1200, xp:60}
GET /sea/deck/{id}
```

Journal : titre « Éclaireur des mers », discoveries 12/25.

## APIs combat mer

| Endpoint | Body | Live |
|----------|------|------|
| `POST /sea/hunt` | `{characterId, foeId}` | 409 sans monstre proche |
| `POST /sea/broadside` | `{characterId, targetId, ammo, heading, angle, pull}` | testé |
| `POST /sea/board` | `{characterId, foeId, seconds, auGrappin, col, row}` | 409 adversaire absent |
| `POST /sea/player-board` | `{characterId, targetId}` | besoin en mer |
| `POST /sea/salvage` | `{characterId, foeId, col, row}` | |
| `POST /sea/spoils` | `{characterId, foeId, seconds, hullLost, col, row}` | |
| `POST /sea/wreck` | `{characterId}` | **200** retour île hull=1 |
| `POST /sea/patch` | `{characterId}` | rafistolage |

## UI mer (live)

- Tir auto / Tir manuel (fronde → boulet)
- Aborder (grappin requis)
- Chasser · prime du jour (hidden jusqu’à monstre proche)
- Rafistoler
- Port / Cap / Auto / Pont / Cale

## Contraintes live

- Patrouille Marine agresse → hull ↓ (88→17→wreck)
- `sea/wreck` = naufrage forcé, retour map île d’origine
- fauneEntities île ≠ monstres mer
- foeId monstre = id engagement client (à capturer quand Chasser visible)
- huntAvailable true = prime journalière encore dispo

## Prochaine étape technique

1. Rester en mer sans wreck
2. Approcher monstre (baleine / faune mer)
3. Lire foeId au moment où `.sea-chasser` n’est plus hidden
4. `POST /sea/hunt { foeId }` → combat / spoils
