# Optimisation ventes berries — live 01/11/2026

## 4 canaux de vente

| Canal | Route | Vitesse | Prix plumes ×1 | Notes |
|-------|-------|---------|----------------|-------|
| **Comptoir négoce** | `POST /negoce/vendre` | Instant | **19–20** | Dock requis · prix local bas |
| **Marchand (economy)** | `POST /economy/sell` | Instant | **126** | **~6× comptoir** · validé live |
| **Market joueurs** | `POST /economy/market/list` | Attente acheteur | suggest **269** (low 202–high 363) | Prix libre · taxe île |
| **Contrats livraison** | `/economy/contracts` | Voyage | reward **2000** | Besoin navire + dest |

## Verdict optimisation instantanée

**`POST /api/economy/sell { characterId, itemId, quantity }`**  
≫ comptoir pour les ressources farm (plumes, peaux, viande…).

### Vente live bulk (economy/sell)

| Item | qty | paid | unit |
|------|-----|------|------|
| plumes | 20 | 2520 | 126 |
| viande-de-gibier | 9 | 963 | 107 |
| peau-tannee | 4 | 424 | 106 |
| minerai-fer | 1 | 440 | 440 |
| algue-marine | 3 | 258 | 86 |
| ble | 3 | 189 | 63 |
| bois-brut | 1 | 126 | 126 |
| poisson-commun | 1 | 90 | 90 |
| baies-sauvages | 1 | 90 | 90 |
| sel-marin | 1 | 53 | 53 |
| **TOTAL** | | **5153** | |

berries 883 → **6036**

### Market price advice

`GET /economy/market/price/{itemId}?quantity=1`  
→ unit / suggested / low / high / basis (sales, listings, catalogue)

### Comptoir (ressources ilusia)

peau 36 · minerai 42 · viande 27 · ble 24 · plumes 20 · … (toujours < economy/sell)

### Market list

```
POST /economy/market/list { characterId, itemId, quantity, price }
POST /economy/market/cancel { characterId, listingId }
GET  /economy/market/me/{characterId}
```

## Suite travel — barque achetée live

```
POST /api/world/ship/buy { characterId, classId: "barque" }
→ 200 shipClass barque, price 3500
Navire: "L’Alizé" · storage 20 · hull 100
berries 6036 → 2536
```
