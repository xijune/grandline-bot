# Réparation coque + lock combat mer — live 01/11/2026

## État

- hull **1/100** (naufrage Marine)
- berries **0** (achats rations + listing market)
- Ilusia **pas de chantier naval** (`shipyard: false`)

## Règles réparation

```
POST /world/repair { characterId }
→ 409 « Aucun chantier naval… Kit de réparation, ou charpentier à bord »

POST /sea/patch { characterId }  # en mer uniquement, consomme repair-kit
```

Shop port :
- `GET /characters/{id}/shop/port`
- `POST /characters/{id}/buy { itemId, quantity }`
- **repair-kit** = **3300฿**
- ration = 1050฿

Repair full dock = **7079฿** (si chantier)

## Cap bloqué

```
POST /sea/cap → 409 « La coque est trop abîmée : fais-la réparer avant de repartir »
```
Départ local OK, **cap long = interdit** hull trop bas.

## Market

```
GET  /economy/market
GET  /economy/market/price/{itemId}
POST /economy/market/list { characterId, itemId, quantity, price }
POST /economy/market/cancel { characterId, listingId }
GET  /economy/market/me/{id}
```

Listing live : **caisse-renforcee @ 150000** (net ~138000 si vente)

## Déblocage combat mer

1. Vente market caisse → berries
2. `buy repair-kit` ×1 (3300)
3. `sea/depart` + `sea/patch` (ou chantier)
4. Approche monstre → `hunt`
