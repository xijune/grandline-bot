# Table XP combat FAUNE — mesures 02/11/2026

Compte Bukima · LUNARIA · TIREUR · niveau 5 (xp départ session 1230 après rat)

## Mesures live API (avant/après GET /characters)

| Pack | Composition | Niveaux mob | XP perso Δ | Haki obs/arm | ฿ Δ | Notes |
|------|-------------|-------------|------------|--------------|-----|-------|
| Rat solo | rat ×1 | 2 | **+15** | +20 / +20 | +50 | session tôt |
| Chien solo | chien ×1 | 1 | **+9** | +20 / +20 | +34 | BFS path 19 cases |
| **2× Loup-de-justice** | loup×2 | 2+1 | **+12** | +25/+25 | +81 |
| Vautours multi | 2× vautour | — | non finalisé | — | — |

## Synthèse partielle

| Observation | Valeur |
|-------------|--------|
| Solo mob niv.1 (chien) | **~9 XP** |
| Solo mob niv.2 (rat) | **~15 XP** |
| Haki par win (obs + arm) | **+20 chacun** indépendamment du pack |
| Berries kill | 34–50 solo, 64–185 multi (sessions antérieures) |

Hypothèse (à confirmer multi) : XP ≈ f(niveau_mob, nb_mobs) — pas linéaire simple (9 vs 15 pour niv 1 vs 2).

## Historique sessions (référence)

| Source | XP noté | Contexte |
|--------|---------|----------|
| win_log_002 | xp:113 | cumul personnage |
| win_log_003 multi vautours | xp:150 | cumul ; berries +185 |
| Combat quête miliciens | **+85** | 380→465 |
| Talk campagne | **+15** | Lin / Ganza |
| Cap voyage | **+60** | pw2-cap |

## Pathfinding

- `movementBlocked` est un **Set** (`x,y`)
- BFS 4-dir + walk case-par-case : fiable
- Direction bloquée (ouest mur) → contour obligatoire


## Level-up observé (session)

| Moment | Level | XP total |
|--------|-------|----------|
| Après rat | 5 | 1230 |
| Après chien | 5 | 1239 |
| Plus tard même session | **6** | **1254–1266** |

→ Passage **5 → 6** entre **1239 et ~1254** XP cumulés.  
Seuil niv.6 ≈ **dans la bande 1240–1254** (mesure fine encore utile : logger juste avant/après le tick de level-up).

## État fin session analyse

- BFS pathfinding validé production
- 2 points XP solo solides (chien+9, rat+15)
- Multi (vautour/loup) : packs instables / timeouts sandbox — à rejouer
- Campagne Ohara : toujours bloquée par trajet ponton (pas retesté ce bloc)
