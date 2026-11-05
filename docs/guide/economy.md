# Économie (négoce, shop, affaires)

> Extrait consolidé depuis systems_advanced (01/11/2026). Preuves : `docs/sessions/`.

## 1. Vente au comptoir (négoce)

Le **comptoir de change** (négoce) est le système de commerce de denrées entre ports.

### Routes exactes

| Méthode | Route | Body / Args |
|---------|-------|-------------|
| GET | `/api/negoce/comptoir/${characterId}` | — |
| GET | `/api/negoce/tableau/${denreeId}` | — (cours d’une denrée) |
| POST | `/api/negoce/acheter` | `{ characterId, marchandise, quantite }` |
| POST | `/api/negoce/vendre` | `{ characterId, marchandise, quantite }` |

### Flux client
- UI ouverte via dock « Négociant du port » (`ouvrirLeNegoce`).
- `negoceComptoir` renvoie `ordreMax`, `cargaison`, `denrees[]`, `refus?`.
- La marchandise voyage dans la **cale** du navire (`cargaison`).
- Devis calculé côté client (`w1(qo, denree, qty, …)`).
- Socket : `negoce:perte` (tempête, pertes en mer).

### Compteur
`character.compteurs["ventes-au-comptoir"]` existe et est incrémenté.

### Notes bot
- Nécessite d’être **au port** (dock) pour ouvrir le négoce.
- Vendre nécessite `enCale: true` sur la denrée.
- Pas de vente d’items d’inventaire classique ici → c’est le système denrées/cargaison.

---


## 6. Shop (vrais items près d’un PNJ vendeur)

### Routes

| Méthode | Route | Body / Args |
|---------|-------|-------------|
| GET | `/api/characters/${id}/shop/${rayon}` | rayon = `"port"`, `"CHANTIER"`, `"taverne"`, `"boutique"`, … |
| POST | `/api/characters/${id}/buy` | `{ itemId, shopId }` |

### Comportement
- `shopRayon(rayon)` → `{ items: [...] }`.
- **Souvent `items: []`** si le joueur n’est pas dans le bon contexte (près du PNJ / bâtiment correspondant).
- Default client : `shopRayon("port")`, buy avec `shopId: "port"`.
- Autres contextes testés dans le code : `"CHANTIER"` (achat de coques / navire), taverne, boutique.

### Notes bot
Pour obtenir de vrais items :
1. Se placer près du PNJ / bâtiment vendeur (port, chantier, taverne…).
2. Appeler le rayon correspondant.
3. Puis `buy(itemId, shopId)`.

L’UI shop se rafraîchit dynamiquement selon la position / interaction.

---


## Synthèse pour le bot

| Système | Prêt pour automatisation | Prérequis |
|---------|--------------------------|-----------|
| Négoce vendre/acheter | Oui | Au dock + cargaison |
| Craft | Partiel | Connaître recipeIds + aspiration |
| Travel simple | Oui | islandId connu |
| Sea / navire complet | Oui (routes claires) | Navire owned + dock |
| Quêtes | Oui | Objectifs sur map courante |
| PvP challenge | Oui | targetId d’un joueur proche |
| Shop items | Conditionnel | Proximité PNJ + bon rayon |

---

*Source principale : extraction live du bundle client du 31/10/2026 + catalogue API existant.*

---

---

Voir aussi **[economy-farming.md](./economy-farming.md)** — comparatif rendement berries (mesures live).
