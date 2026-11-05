# Négoce / comptoir — vente live 01/11/2026

## Routes

| Action | Méthode | Body / path |
|--------|---------|-------------|
| État | GET `/api/negoce/comptoir/{characterId}` | refus si hors ponton |
| Vendre | POST `/api/negoce/vendre` | `{ characterId, marchandise, quantite }` |
| Acheter | POST `/api/negoce/acheter` | `{ characterId, marchandise, quantite }` |

## Proximité

- Dock ilusia : cellules `104,139–144` (origin 104,138)
- Stand validé : **104,137**
- GET comptoir peut encore afficher `refus` ; **POST vendre OK** dès sur/près ponton
- Hors zone → 409 « approche-toi du ponton »

## Vente réelle

```
POST /negoce/vendre
{ characterId, marchandise: "plumes", quantite: 1 }

→ 200
quantite: 1, unitaire: 19, total: 19, ile: "ilusia"
berries: 1788 → 1807
plumes: 22 → 21
```

## Inventaire

`GET /characters/{id}` → `inventory.items[]` `{ id, name, quantity }`

Marchandises testées vendables (proche ponton) : plumes, viande-de-gibier, peau-tannee, ble, bois-brut, poisson-commun, algue-marine, sel-marin  
`ration` → 404 « ne connaît pas cette marchandise »
