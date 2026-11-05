# Équipement mer acquis — live 01/11/2026

## Achats validés

| Item | Source | Prix | Statut |
|------|--------|------|--------|
| Grappin d’abordage | market buy | 21999 | **en inventaire** |
| Canon léger | market buy | 18000 | équipé après upgrade |
| Sloop (upgrade) | `POST /world/ship/buy { classId:"sloop" }` | ~27k (trade-in barque) | **actif** |

## Règles navire confirmées live

```
Barque  → slots: []  → 409 « Cette coque n’a pas de sabord : elle se rame, elle ne se canonne pas »
Sloop   → slots: [null, null] → 2 sabords
POST /world/ship/canons { characterId, slot: 0, itemId: "canon-leger" } → slots: ["leger", null]
```

Classes valides : `barque | sloop | caravelle | galion | lupus`  
Caravelle exige chantier naval.

## État compte test

| | |
|--|--|
| Navire | **Sloop** L’Alizé |
| Hull | 100 |
| Canons | `["leger", null]` |
| Grappin | 1 |
| Berries | ~53k |
| huntAvailable | true |

## APIs confirmées

```
POST /world/ship/buy { characterId, classId }
GET  /world/ship/canons/{id}
POST /world/ship/canons { characterId, slot, itemId }  // à quai
POST /economy/market/buy { characterId, listingId }
```

## Test engagement live

Équipement prêt. Approche ROI_DES_MERS / NAVIRE en UI mer encore à stabiliser
(navigation côtière vs haute mer). Prochaine session : engagement avec intercept foeId.
