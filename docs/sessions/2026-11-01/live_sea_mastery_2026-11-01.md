# Mer — maîtrise complète (live + client) 01/11/2026

## 1. Structure mer West Blue

```
GET /sea/{id}
grid: { cols: 6, rows: 4 }   # secteurs
tiles: sea-west-{col}-{row}
```

Îles connues depuis ohara/ilusia : **uniquement l’autre** (routes fermées pour le reste).

## 2. Voyage île → île (optimal)

### Flux
```
POST /sea/depart { characterId, mode:"navire", sortie }
POST /sea/cap    { characterId, islandId }
POST /sea/position { characterId, col, row, x, y }  # par tile du plan
POST /sea/dock   { characterId, islandId }
```

### Mesure live Ohara → Ilusia
| | |
|--|--|
| distanceCases | **113.67** |
| tiles | **3** (2-0 → 1-0 → 1-1) |
| temps optimisé | **~35 s** |
| credit départ | 6 |

### Rate-limit position
- Erreur : `La mer ne se traverse pas si vite`
- Champ `credit` sur atSea (régénère)
- Attente optimale : ~2–2.5 s entre tiles après le premier

### Accélérer
```
GET /world/ship/pieces/{id}
bonus.vitesse  (0 sans pièces)
postes:
  voile → voile-renforcee (~500k market)
  gouvernail → gouvernail-fin (~440k)
  coque → coque-doublee / quille-d-adam
  cale, canon, ancre
POST /world/ship/pieces { characterId, poste, itemId }
```

Sloop storageCapacity 50 vs barque 20.

## 3. Lancement des combats mer

### A. Hunt Roi des Mers (journalier)
```
1. huntAvailable === true (GET /sea/journal/{id})
2. Approcher entity kind === "ROI_DES_MERS" (portée rayonCorps+7)
3. Bouton Chasser visible
4. POST /sea/hunt { characterId, foeId }
→ 1200฿ + 60 XP
Cooldown client post-hunt sur foeId : 60 s (6e4 ms)
```

### B. Combat navire (mob NAVIRE ou joueur)
```
1. Entity kind === "NAVIRE" à portée
2a. Tir : POST /sea/broadside { targetId:UUID, ammo, heading≤10, angle, pull }
    - exige canons équipés
    - tirAuto possible (client)
2b. Abordage :
    - coque adverse > 60% → grappin + POST /sea/board { auGrappin:true }
    - coque ≤ 60% → POST /sea/board { auGrappin:false }
3. Joueur : POST /sea/player-board { targetId:UUID }
```

### C. Engagement auto
- Aggro défaut : **10** unités mer
- Sortie d’aggro : distance > aggro × 1.35 → désengagement + cooldown client `nr`
- « Romps le contact d’abord : on ne fait pas route sous le feu » (pas de cap/dock en combat)

### D. Cooldown même navire
- **Rapport joueur : 10 min** avant de réattaquer le même navire
- Client : Map `nr` empêche re-engagement immédiat (valeur `sg` + hunt 60s)
- À valider live sur 2e engagement du même targetId

## 4. Fouille hors combat
```
kinds: EPAVE | BANC | BARIL | BOUTEILLE
portée: (rayonCorps||2) + 4
POST /sea/salvage { foeId, col, row }
```

## 5. Boucle farm mer optimale (théorique bot)

```
1. Depart île A
2. Cap île B (route connue)
3. Pendant transit : si ROI → hunt (1×/jour)
4. Si NAVIRE hostile → broadside jusqu’à ≤60% → board
   (respecter CD 10 min / même cible)
5. Dock B → contrat / sell → retour
Temps A↔B (ohara/ilusia) : ~35 s pure navigation
```

## 6. État compte test

| | |
|--|--|
| Sloop + canon leger + grappin | OK |
| pieces bonus.vitesse | 0 |
| Routes | ilusia ↔ ohara uniquement |
| huntAvailable | selon jour |

## 7. Reste pour 100%

- Capturer foeId live (ROI / NAVIRE) dans UI haute mer
- Confirmer CD 10 min serveur sur 2e attaque même ship
- Effet quantifié voile-renforcee sur c/s et temps de traverse
- Munitions (boulet-fonte) stock + effet dégâts
