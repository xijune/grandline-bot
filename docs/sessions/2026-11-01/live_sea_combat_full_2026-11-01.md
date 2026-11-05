# Combat mer — tests complets 01/11/2026

## Équipement acquis (live)

| Item | Détail |
|------|--------|
| Navire | **Sloop** (upgrade barque, ~27k trade-in) |
| Canons | slot0 = **leger** (`POST /world/ship/canons`) |
| Grappin | **1** (market 21999฿) |
| Hull | 100 |
| Berries | ~52k |

### Règles navire confirmées

```
Barque → 409 « Cette coque n’a pas de sabord : elle se rame, elle ne se canonne pas »
Sloop  → 2 sabords [null,null] → équipables
Classes: barque | sloop | caravelle | galion | lupus
Caravelle = chantier naval requis
Canons s’équipent à quai uniquement
```

## APIs validées live (messages serveur)

### Hunt
```
POST /sea/hunt { characterId, foeId }
→ 409 « Aucun monstre à chasser ici. »  (foeId absent des eaux)
Cible: kind ROI_DES_MERS à portée (rayonCorps+7)
1×/jour/mer via huntAvailable
Reward: 1200฿ + 60 XP
```

### Board
```
POST /sea/board { characterId, foeId, seconds, auGrappin, col, row }
→ 409 « Cet adversaire n’est pas dans ces eaux »
kind NAVIRE uniquement
Seuil coque By=0.6 (60%)
  >60% → grappin obligatoire
  ≤60% → abordage libre
```

### Broadside
```
POST /sea/broadside { characterId, targetId, ammo, heading, angle, pull }
→ targetId = UUID
→ heading ≤ 10 (contrainte serveur)
Nécessite canons équipés
```

### Player board
```
POST /sea/player-board { characterId, targetId: UUID }
```

## Modes mer client

1. **Côtier** (`a-la-barre`) : près de l’île, boutons Rentrer/Gagner haute mer
2. **Haute mer** (`canvas.sea-canvas`) : combat, chasser, aborder, tir
   - Ouverture via balise + dialogue « Quel cap ? » / « Sans cap »
   - Entités mer (ROI_DES_MERS, NAVIRE) streamées dans cette UI

## Engagement live

Équipement prêt. Validation API des règles = **100%**.  
Engagement avec cible réelle = nécessite proximité entity dans UI haute mer
(foeId dynamique, non devinable hors population mer locale).

## Socket

```
sea:move (client emit)
sea:leave (ack ok)
Entities mer non exposées en REST — uniquement UI mer / socket population
```
