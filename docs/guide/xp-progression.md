# XP & progression — cartographie (pré auto-XP)

État au 02/11/2026. **Plan auto-XP v0** : `tools/level_core.py` + `src/launcher/level_loop.py` (2026-11-02). Données encore partielles ; gaps listés en fin.

---

## 1. Où l’XP est stockée

| Piste | Champs | Notes |
|-------|--------|-------|
| **Niveau perso** | `level`, `xp` | Bukima live : **niv.5 · xp 1215** |
| **Haki** | `haki.observation.xp` / `armament.xp` | Gagné au combat (475 chacun observés) ; unlock séparé |
| **Maîtrise sorts** | `mastery["tir-1"]` etc. | % maîtrise technique (64.4 sur Tir précis) |
| **Campagne** | `campaign.stage`, `accomplies`, `dernier`, `parcours` | Progression narrative West Blue |
| **Side quests** | `sideQuests.active/completed/...` | Structure présente, peu d’actives |
| **Faction quest** | `factionQuest.chapter`, `fouilles` | |

Courbe exacte `xp → level+1` : **non extraite** du client.

Point live : passage **niv.5→6** observé entre XP **1239 et ~1254** (Bukima).

---

## 2. Sources d’XP prouvées (live)

### A. Quête principale (campagne)

| Étape | ID | Δ XP | Méthode |
|-------|-----|------|---------|
| Lin | `pw1-lin` | **+15** | `campaign/talk` |
| Ganza | `pw1-ganza` | **+15** | talk |
| Affiches | fouille | ~+25 (355→380 zone) | `quest-search` |
| Miliciens | combat quête | **+85** (380→465) | `battles/start` objectif |
| Aliss | `pw1-aliss` | **+20** | |
| Cap voyage | `pw2-cap` | **+60** | accostage Ohara |
| Severin | `pw2-severin` | **+35** | |

Campagne actuelle Bukima : **stage 132**, `parcours: "west"`, **13 accomplies**, dernier `pw2-severin`.  
Objectifs Ohara live : **`campagne:pw2-receleurs`** — 3× receleurs **niv.10** @ (72,36). Bukima **niv.6** = underlevel.

### B. Daily tâches
Chaque tâche : **+76 XP + 160฿** (ex. 5 bêtes, 3 pêches, 2 crafts).  
Bonus all-tasks : XP supplémentaire (~128 hist.).

### C. Combat FAUNE

Mesure live 02/11 (`docs/sessions/2026-11-02/xp_combat_rat.md`) :

| Pack | XP perso | Haki obs/arm | ฿ |
|------|----------|--------------|---|
| **Rat ×1 niv.2** | **+15** | **+20 / +20** | +50 |
| **Chien ×1 niv.1** | **+9** | **+20 / +20** | +34 |
| **2× Loup niv.1+2** | **+12** | **+25 / +25** | +81 |

- Solo niv.1 ≈ 9 XP ; solo niv.2 ≈ 15 XP (Bukima niv.5).
- Haki obs+arm : **+20 chacun par win** (constant sur ces 2 packs).
- Talk campagne basique (+15) ≈ 1 rat ; combat quête (+85) ≫ farm solo.
- Multi/vautour : en cours de mesure.
- Détail : `docs/sessions/2026-11-02/xp_combat_table.md`

### D. Side quests
```
POST /api/characters/{id}/side-quests
action ∈ accept | complete | abandon | answer | progress
```
Catalogue et XP par quête : **à scraper / accepter en live**.

---

## 3. Déblocage d’îles / contenu

Observé :
- Campagne West Blue pousse **Ilusia → Ohara** (voyage mer + étapes `pw2-*`).
- XP de voyage/accostage significative (**+60** cap).
- Mobs plus durs sur nouvelles îles → meilleur XP combat *si* on peut les tuer vite (sinon perte de temps / mort).

Hypothèse (à valider) : la **campagne** est le goulot pour ouvrir les zones ; le farm FAUNE local optimise l’XP **dans** une zone déjà ouverte.

---

## 4. Stratégie auto-XP envisagée (pas encore codée)

```
priorité 1 — Campagne
  GET quest-objectives (map courante + maps connues)
  si objectif talk/fouille/combat → walkTo + action API
  si objectif autre île → travel mer (sea depart/cap/dock)

priorité 2 — Daily XP
  tâches combat/pêche/craft si coût temps faible
  claim +76 XP chacune

priorité 3 — Farm FAUNE zone
  packs dispo hors morts/engagees
  GLCombat jusqu’à inventaire plein / CD freeFight
  economy/sell (฿, pas XP)

priorité 4 — Side quests rentables
  seulement si rewards.xp / temps > farm local
```

**Rentable** pour une side = XP (et éventuellement route débloquée) > même durée de farm FAUNE.

---

## 5. Données manquantes (bloquantes ou semi-bloquantes)

| Gap | Impact auto-XP | Action |
|-----|----------------|--------|
| Table XP niv → niv+1 | Savoir combien de kills/étapes | Mesurer xp avant/après level-up |
| XP / kill par espèce & Δ niveau | Prioriser packs | **rat+15 fait** ; reste chien/vautour/multi |
| Suite campagne stage 132+ | Continuer le goulot îles | Travel Ohara + objectives |
| Liste side-quests + XP | Filtrer rentables | accept + lecture rewards |
| Multiplicateurs race/dojo | Optimiser île de farm | Comparer 10 kills 2 îles |
| Mort / penalités XP | Risque | Mourir exprès une fois (compte test) |

---

## 6. Protocole de mesures (prochaine session)

1. **Ohara** : dock, `GET quest-objectives`, enchaîner 1–3 étapes campagne, logger Δxp.  
2. **Combat** : 1 pack rat / chien / vautour, noter `xp` avant/après (API characters uniquement).  
3. **Level-up** : si proche seuil, farm jusqu’au passage de niveau → déduire seuil.  
4. **Side quest** : `POST side-quests {action:"accept", ...}` selon body exact (à découvrir près PNJ).  

---

## 7. Décision

**On ne code pas l’auto-XP tant que :**
- la suite campagne (objectifs post-132) n’est pas listée, **et**
- on n’a qu’**un** point (rat+15) — il en faut plusieurs espèces / multi.

En parallèle, l’éco berries (`economy/sell` + daily) reste découplée : le script XP peut vendre le loot mais l’objectif premier est `level`/`xp`/`campaign.stage`.


## Travel Ohara (02/11)

Arrival `{col:2,row:0,x:2.74,y:62.87}` → dock. Coût **380฿**. Détail: `docs/sessions/2026-11-02/xp_session_suite.md`.
