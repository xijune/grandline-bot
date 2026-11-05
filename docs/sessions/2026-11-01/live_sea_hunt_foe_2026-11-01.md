# Sea hunt foeId — reverse live 01/11/2026

## Règle client (bundle)

```js
// Chasser visible seulement si :
rt = huntAvailable
  && entities.find(e =>
       e.kind === "ROI_DES_MERS"
       && dist(e, ship) < (e.rayonCorps ?? 2.4) + 7
     )

// Click Chasser :
POST /sea/hunt { characterId, foeId: rt.id }
```

## Conséquences bot

| Champ | Valeur |
|-------|--------|
| kind cible | **`ROI_DES_MERS`** uniquement |
| Portée | ~9.4 unités mer (corps + 7) |
| foeId | `id` de l’entité locale mer (pas land fauna) |
| Prime | 1200฿ + 60 XP si `huntAvailable` |

## Autres kinds mer (fouiller / aborder)

- `EPAVE` → Aborder l’épave  
- `BARIL` → Repêcher le baril  
- `BOUTEILLE` → Lire la bouteille  

## Reste à valider live

1. Lister `en` (population mer) en UI sea active  
2. Naviguer jusqu’à un `ROI_DES_MERS`  
3. `POST /sea/hunt` avec son `id` → spoils  

Les entités mer sont dans la **closure UI mer** (pas `faunaEntities` Phaser terre).

## Routes connues (GET /sea/caps/{id})

Depuis **ohara** live :
- caps : **ilusia** uniquement
- fermees : wheat, whisky, water7, sabaody, alabasta, … (nombreuses)

```
POST /sea/cap { islandId: "flower_country" }
→ 409 « Aucune route connue ne mène ici »
```

Déblocage routes = progression jeu (quêtes / découvertes mer).
