# Session XP suite — 02/11/2026 (nuit)

## Combat XP (API)

| Pack | Niv mobs | Δ XP | Haki obs/arm | ฿ | Level joueur |
|------|----------|------|--------------|---|--------------|
| Rat ×1 | 2 | **+15** | +20/+20 | +50 | 5 |
| Chien ×1 | 1 | **+9** | +20/+20 | +34 | 5 |
| **2× Loup-de-justice** | 2+1 | **+12** | **+25/+25** | **+81** | 6 |

### Lectures
- Solo niv.1 ≈ 9 XP ; solo niv.2 ≈ 15 XP (joueur niv.5)
- Multi 2 loups (niv 1+2) joueur **niv.6** → **+12 XP** seulement (≠ somme solos)
- Haki : 20 (solo) → **25** (multi)
- Berries multi > solo

### Level-up
- 5→6 entre XP **1239 et ~1254**

## Campagne / Ohara

### Travel validé
```
BFS → ponton (104,139)
POST /sea/depart { characterId, mode:"navire", sortie:"sud" }
POST /sea/cap { characterId, islandId:"ohara" }
POST /sea/position … (rate-limit ~2.5–3.5s)
  arrival: col=2, row=0, x≈2.74, y≈62.87
POST /sea/dock { characterId, islandId:"ohara" }
→ 380฿ (tax 80 + wage 300), hullWear 4
```

### Objectif suivant
- id: `campagne:pw2-receleurs`
- kind: combat · 3× **Receleur niv.10** @ (72,36)
- titre: La nuit du séchoir
- start sans proximité → 409 *Approche-toi de ton adversaire de quête*
- Bukima niv.6 vs 3×10 → underlevel, farm Ohara d’abord

### Rest
BELLE_ETOILE → +188 HP, cost 0
