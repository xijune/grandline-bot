# Shop PNJ — achat réel live 01/11/2026

## Routes

| Action | Méthode | Détail |
|--------|---------|--------|
| Catalogue | GET `/api/characters/{id}/shop/{rayon}` | rayon sensible à la casse |
| Achat | POST `/api/characters/{id}/buy` | `{ itemId, shopId }` |

## Rayons live (ilusia, pos dock 104,137)

| rayon | items | Note |
|-------|-------|------|
| `port` | 3 (ration 1050, log-pose 9000, repair-kit 3300) | **OK dock** |
| `ARMURERIE` | 42 | catalogue global ? |
| `CHANTIER` | 23 (rowboat 10500…) | |
| `PORT` / `taverne` / `boutique` / `armurerie` | 0 | casse / hors zone |

## Achat validé

```
POST /characters/{id}/buy
{ itemId: "ration", shopId: "port" }
→ 200
berries 1807 → 757 (−1050)
ration quantity 5 → 6
```

shopId doit matcher le rayon exact (`port` ≠ `PORT`).
