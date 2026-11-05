# Farm berries + XP — live 01/11/2026

## État après déblocage

| | |
|--|--|
| Berries | **~121k** (vente market caisse 138k net) |
| Hull | **100** (kits ×3 @ 3300 = +25 hull/kit) |
| Level | 5 · XP 1105 |
| Map | ohara |

## Gains validés

| Source | Berries | XP | Temps approx | Notes |
|--------|---------|-----|--------------|-------|
| Market rare (caisse) | **138000** | 0 | passif | listing `economy/market/list` |
| Contrat LIVRAISON | **2000** brut | 36 | ~2–3 min | net ~+1700 après coûts mer |
| Hunt journalière | **1200** | 60 | ? | `huntAvailable` true, foeId à capturer |
| Kit réparation | **-3300** | 0 | instant | +25 hull |

## Boucle farm optimale (actuelle)

```
1. Accept contrat LIVRAISON (minLevel OK)
2. Ponton → depart → cap → position → dock
3. Reward paid au dock
4. Accept retour inverse si offre
5. Stock repair-kit (3+) avant mer longue
6. Éviter Patrouille Marine (hull burn)
```

Ratio contrat : **~600–800฿/min** + XP.

## Réparation

```
POST /characters/{id}/buy { itemId: "repair-kit", quantity: 1 }  // 3300฿
POST /world/repair { characterId }  // consomme 1 kit, +25 hull, même à quai
```

## Market (très rentable items rares)

```
GET  /economy/market/price/{itemId}
POST /economy/market/list { characterId, itemId, quantity, price }
POST /economy/market/cancel { characterId, listingId }
GET  /economy/market/me/{id}
```

Caisse renforcée : unit ~180k (ventes), listée 150k → vendue.

## Prochaines optis bot

1. Auto-loop contrats aller-retour ilusia↔ohara
2. Capturer foeId hunt (UI Chasser visible)
3. Combat quête dès lvl 8–10 (receleurs)
4. Éviter Marine / patch auto si hull < 40
