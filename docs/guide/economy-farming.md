# Économie — meilleurs moyens de farmer des berries

Mesures live 31/10–01/11/2026 (Bukima, Ilusia).  
Objectif : maximiser **฿ / heure**.

---

## Verdict (preuves réelles)

### 1. Canal de vente : ne pas utiliser le comptoir pour le farm

| Canal | Route | Plumes ฿/u | Ratio |
|-------|-------|------------|-------|
| Comptoir négoce | `POST /api/negoce/vendre` | **19–20** | 1× |
| **Marchand economy** | **`POST /api/economy/sell`** | **126** | **~6,3×** |
| Market joueurs | `POST /api/economy/market/list` | suggest ~269 (202–363) | ~13× mais illiquide |

**Pour du cash immédiat : toujours `POST /api/economy/sell`**  
`{ characterId, itemId, quantity }` — validé bulk live.

### 2. Prix unitaires live (`economy/sell`)

| Item | ฿/u |
|------|-----|
| minerai-fer | **440** |
| plumes | **126** |
| bois-brut | **126** |
| viande-de-gibier | **107** |
| peau-tannee | **106** |
| algue-marine | **86** |
| poisson-commun | **90** |
| baies-sauvages | **90** |
| ble | **63** |
| sel-marin | **53** |

Bulk testé : inventaire farm → **+5153฿** en une vente (883→6036).

### 3. Passif quotidien (live 01/11 soir)

| Action | ฿ | Temps |
|--------|---|-------|
| Affaires gratuite | **+500** | API < 5 s |
| Daily claim (ex. jour 3) | **+1000** (+ items) | API < 5 s |
| Tâches ×3 (si faites) | **160 × 3 = 480** | selon tâche |
| Bonus all tasks | ~**280** | si 3/3 |

**Login optimal ≈ 1500–2200฿** avant tout farm.

### 4. Combat FAUNE (logs)

| Fight | ฿ combat | Loot | Temps combat |
|-------|----------|------|--------------|
| 2 vautours | **+185** | — | ~9 tours |
| 2 vautours (v2) | **+64** | plumes… | ~10 tours, 0 dmg |

Les ฿ de kill sont **en plus** du loot.  
Exemple : 10 plumes drop → 10×126 = **1260฿** à la vente economy (vs 190 au comptoir).

---

## Stratégie optimale prouvée

```
1. Login
   - POST daily/claim
   - POST affaires/{id}/acheter { index: 0 } si gratuit
   - POST daily/taches/{id}/reclamer pour tâches faites

2. Farm loop
   - Combats FAUNE (packs multi à plumes / peaux prioritaires)
   - Skip morts / engagees / mercenaire
   - Quand inventaire chargé → POST /api/economy/sell (pas négoce)

3. Compléments
   - Tâches daily (bêtes / pêche / artisan) pour les 160฿ × N
   - Harvest / fish seulement si tâche ou inventaire vide à remplir
```

### Pourquoi combat + economy/sell gagne

- Kill donne **฿ directs** (dizaines à ~200/pack)  
- Loot plumes/peaux/viande se monétise à **~100–126฿/u** via economy  
- Un pack qui drop ~5–15 plumes peut valoir **plus en loot vendu** qu’en ฿ de kill  
- Comptoir divise les gains loot par **~6** → à éviter pour le farm

### Market joueurs

- Prix affichés plus haut (plumes ~269) mais **pas instantané**  
- Utile pour stacks rares / minerai si patience  
- Sinon economy/sell pour le débit ฿/h

---

## Pièges

| Piège | Détail |
|-------|--------|
| Vendre au ponton négoce | 6× moins cher sur plumes |
| freeFight UI « sans berrys » | texte mode libre ; combats mesurés **avec** ฿ API |
| Inventaire plein | vend **avant** de refarmer |
| Trajets | vendre en **bulk**, pas 1 item à chaque kill |

---

## Mesures encore utiles

- [ ] ฿ combat moyen sur 10 kills par espèce (rat/chien/vautour/loup)  
- [ ] Drop rate plumes / peaux par espèce  
- [ ] ฿/h réel bot sur 15 min (pathfinder + sell)  
- [ ] Market : temps de vente moyen vs premium  

---

## Preuves

- `docs/sessions/2026-11-01/live_sell_optimize_2026-11-01.md` — economy/sell vs comptoir  
- `docs/sessions/2026-11-01/live_negoce_vente_2026-11-01.md` — plumes 19 comptoir  
- `docs/sessions/2026-11-01/live_economy_passif_2026-11-01.md` — daily + affaires  
- `docs/sessions/2026-10-31/win_log_003_multi.json` — +185฿ combat  
