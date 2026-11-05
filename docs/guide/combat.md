# Analyse combat — GrandLine Online

Date : 31 octobre 2026 — **MAJ IA 0-dmg 02 novembre 2026**  
Sources : bundle client, combats live FAUNE (Bukima), API `/api/battles/*`, farm API pure

> **Tester le combat** : `docs/guide/testing.md` + `python src/launcher/pure_api_farm.py`  
> IA code : `src/inject/combat-module.js` **v2.2** (kite-first)

### Ordre de décision 0-dmg (TIREUR) — validé live 2026-11-02

1. Fuite si HP &lt; `FLEE_HP_PCT`
2. Garde si collé (d≤1), HP bas, **pas déjà** status GARDE
3. **Kite** si threatened (`d ≤ enemyPM + enemyRange`) et PM &gt; 0
4. Techniques in-range + LOS (jamais ATTAQUE base si ranged)
5. Approach vers sweet = `min(myRange, max(4, enemyPM+enemyRange+margin))`
6. Endturn (AP=0 ou rien d’utile)

Preuve : 5/5 wins, hpDelta **0** — `docs/sessions/2026-11-02/`

---

## 1. Vue d’ensemble

Combat **tour par tour style Dofus** sur grille isométrique.

| Phase | Description |
|--------|-------------|
| **Placement** | Cases bleues (alliés) / rouges (ennemis). Bouton **Prêt**. API : `POST /api/battles/:id/placement` `{ characterId, cell }` puis engage |
| **Tours** | PA / PM, sorts, déplacement case à case, **Fin du tour** |
| **Fin** | VICTOIRE / DEFAITE / FUITE / ROMPU / NUL / INTERROMPU |

Kinds observés :
- `FAUNE` — mobs map via `attackFaunaPack` / `onFaunaAttack` (**pas** de CD entre combats)
- Random menu / PvP / Halloween — autres endpoints

---

## 2. Ressources de tour

Observé en combat live :
- **PA (Action Points)** — coût des sorts (`pa` dans le catalogue)
- **PM (Movement Points)** — déplacement grille Manhattan
- Timer de tour (`turnEndsAt`, ~30 s UI)
- Portée en **cases Manhattan** (pas euclidien)

Attaque de base / garde / fuite (toujours disponibles) :

```js
{ attack: { nom: "Attaque", kind: "ATTAQUE", glyphe: "⚔" },
  guard:  { nom: "Garde",   kind: "GARDE",   glyphe: "🛡" },
  flee:   { nom: "Fuir",    kind: "FUITE",   glyphe: "↗" } }
```

---

## 3. Catalogue de techniques (DB client)

**330 techniques** extraites du client → `docs/data/techniques.json`

### Par type de dégâts / rôle

| Type | Nb | Rôle |
|------|-----|------|
| SOUTIEN | 124 | Buffs, postures, utility (souvent power=0) |
| CONTONDANT | 80 | Mêlée brute |
| TRANCHANT | 37 | Lames / sabre |
| ELEMENTAIRE | 30 | Élémentaire |
| TIR | 27 | Distance (lance-pierre, armes à feu…) |
| SONIQUE | 17 | Musicien |
| SOIN | 15 | Heal |

### Par aspiration (30 sorts chacune, sauf FORGERON 60)

`SABREUR` · `TIREUR` · `COMBATTANT` · `MEDECIN` · `NAVIGATEUR` · `CUISINIER` · `CHARPENTIER` · `MUSICIEN` · `ARCHEOLOGUE` · `FORGERON`

+ **30 techniques de race** (`origin: "RACE"`)

### Champs d’une technique

```js
{
  id, name, level, cost,   // cost = coût de maîtrise/déblocage
  power,                   // multiplicateur de puissance (0 = pas de hit)
  type,                    // TRANCHANT | TIR | CONTONDANT | ...
  pa,                      // coût en PA
  origin,                  // ASPIRATION | RACE
  geometry: {
    range,                 // portée max (cases)
    minRange,              // portée min (souvent 0 ; TIR parfois 2+)
    shape,                 // single | line3 | line5 | circle1 | circle2 | cross1 | cone3 | self | aroundBody
    needsSight             // ligne de vue requise
  },
  description, specialite, role,
  effects: [ { type, etat?, duree?, valeur?, cibles? } ]
}
```

### Formes d’AoE (`shape`)

| Shape | Usage typique |
|-------|----------------|
| `single` | Une cible |
| `self` | Soi (postures) |
| `circle1` / `circle2` | Zone autour du point d’impact |
| `line3` / `line5` | Ligne |
| `cross1` | Croix |
| `cone3` | Cône |
| `aroundBody` | Autour du lanceur |

### Portées observées

- Mêlée pure : range **0–1**
- Moyenne : **2–5**
- Distance TIR : souvent **6–8**, jusqu’à **12** (ex. Hi no Tori Boshi)
- `minRange: 2` fréquent sur munitions TIR (ne tire pas au contact)

---

## 4. Effets (briques)

Types d’effets les plus fréquents (catalogue) :

| type | Nb | Signification |
|------|-----|----------------|
| `poser-etat` | 139 | Applique un statut |
| `poussee` | 40 | Push cases |
| `degats` | 40 | Dégâts bonus fixes (% ou plat) |
| `retrait-pm` / `ajout-pm` | 28 / 18 | −/+ PM |
| `retrait-pa` / `ajout-pa` | 17 / 9 | −/+ PA |
| `bouclier` | 20 | Shield |
| `glyphe` | 17 | Zone au sol |
| `resistance` | 12 | Modif résistances |
| `teleportation` | 9 | TP |
| `attirance` / `avancer` | 8 / 8 | Pull / avance |
| `bonus-dommages` | 8 | Buff dégâts |
| `invocation` | 7 | Summon |
| `soin-pourcent` | 4 | Heal % |
| `invisibilite` | 3 | Invis |
| `piege` / `rune` | 4 / 4 | Pièges |

### États (`etat`) observés

`SAIGNEMENT` · `BRULURE` · `POISON` · `ETOURDI` · `ESQUIVE` · `BOOST` · `MOUILLE` · `AVEUGLE` · `ENRACINE` · `PARALYSIE` · `ENDORMI` · `PROVOQUE` · `FAIBLESSE` · `MARQUE_DE_LAME` · `INEBRANLABLE` · `ENTRAVE` · `CHARGE_KI` · `RESONANCE` · `PARTITION` · `ANALYSE` · `REPU` · `PESANTEUR` · `GARDE` · …

Champs : `duree` (tours), `valeur`, `cibles` (`ennemis` | `allies` | `lanceur`).

---

## 5. Dégâts & estimates

Le client expose par action, **par cible** :

```js
action.estimates[enemyId] = { min, max }
```

Utilisé pour l’UI (« 10–18 ») et pour le bot (`pickBestAction`).

La formule exacte serveur n’est **pas** dans le bundle (calcul côté API). Influence probable :
- `power` de la technique
- Stats (`force`, `vitesse`, `resistance`, `intelligence`, `perception`, `volonte`, `endurance`)
- Niveau / maîtrise
- Résistances / types (TRANCHANT vs TIR…)
- États (FAIBLESSE, résistance −20, bonus-dommages…)
- Équipement (`arme`, etc.)

**Attaque de base** (`kind: "ATTAQUE"`) : pas de `power` catalogue ; estimates fournis par le serveur en combat.

---

## 6. API battles

```
POST /api/battles/:id/action      { characterId, kind, id, targetId?, targetCell? }
POST /api/battles/:id/move        { characterId, cell: {x,y} }
POST /api/battles/:id/placement   { characterId, cell }
POST /api/battles/:id/engage      { characterId }
POST /api/battles/:id/end-turn    { characterId }
POST /api/battles/:id/options     { characterId, ... }
POST /api/battles/:id/exclude     { characterId, targetId }
POST /api/battles/pvp/challenge   { characterId, targetId }
POST /api/battles/halloween       ...
```

Auth : `Authorization: Bearer <grandline-token>` (`sessionStorage`).

Entrée combat map FAUNE :
1. Pack dans `scene.faunaEntities` (chargé)
2. `confirmationDattaqueDemandee = () => false`
3. `scene.onFaunaAttack(packId)` ou `attackFaunaPack(packId)`

---

## 7. État live `combatState` (champs utiles)

```js
scene.combatState = {
  id,                    // battleId API
  kind: "FAUNE",
  yourTurn,
  finished,
  winner: "ALLIE" | "ENNEMI" | ...,
  fighters: [{ id, name, team: "ALLIE"|"ENNEMI", hp, maxHp, ... }],
  actions: [{
    kind: "ATTAQUE"|"TECHNIQUE"|"GARDE"|"FUITE",
    id, name, usable, locked,
    geometry: { range, shape, ... },
    estimates: { [fighterId]: { min, max } },
    pa, ...
  }],
  tactics: {
    placementDone,
    placementCells, placementCellsAdverses,
    positions: { [id]: {x,y} },
    ap, mp,
    yourTurn
  }
}
```

---

## 8. Récompenses / sanctions (live)

| Issue | Berries | Loot inventaire | Notes |
|-------|---------|-----------------|-------|
| **Victoire FAUNE** | +berries | items si place dans `bagCapacity` | Confirmé design jeu |
| **Défaite** | **−6 à −7 ฿** observé | aucun | UI « La bourse a fondu » |
| `character.berries` | souvent **stale** | — | Lire le **฿ UI** |

Tests live Bukima (31/10/2026) :
- Combat 1 défaite rat : 49 → **42 ฿** (−7), 0 loot
- Combat 2 défaite rat : 42 → **36 ฿** (−6), 0 loot

---

## 9. Stats personnage liées au combat

```js
character.stats = {
  force, vitesse, resistance,
  intelligence, perception, volonte, endurance
}
// Base type observée ~ force:10 vitesse:8 resistance:12–14 endurance:20
```

Haki (observation / armament / conqueror) : structure présente, unlocked=false au low level.

Équipement : slots `arme`, `armure`, `gants`, … — arme Bukima = `slingshot` → kit **TIR**.

---

## 10. Implications bot (optimisation)

1. **Avant combat** : s’approcher jusqu’à `faunaEntities.has(packId)` ; HP DOM `b.coeur-pv` ; forme ≥ seuil ; inventaire non plein.
2. **Placement** : case bleue la plus proche de l’ennemi (`placementCells` vs positions ennemies).
3. **Tour** :
   - Si dist > range du meilleur sort → `battleMove` / `combat.click` vers l’ennemi (PM).
   - Choisir action max `estimates[enemy].(min+max)/2` parmi `usable` et **à portée**.
   - Priorité techniques TIR à range pour slingshot ; éviter gaspi PA hors range.
   - Garde si aucun hit possible ; fuite si HP % < seuil.
4. **Fin de tour** : API `end-turn` ou bouton UI.
5. **Après combat** : snapshot berries UI + `inventory.items` ; compter wins/losses/loot.

### Kits prioritaires selon arme

| Arme / aspiration | Focus |
|-------------------|--------|
| Lance-pierre / TIR | `tir-*` range 5–8, minRange souvent 2 ; ne coller pas |
| Sabre | `sab-*` range 1–3, saignements |
| Combattant | `com-*` mêlée contondant |

---

## 11. Fichiers projet

| Fichier | Contenu |
|---------|---------|
| `docs/data/techniques.json` | 330 techniques (id, name, power, pa, range, shape, effects…) |
| `docs/guide/combat.md` | Ce document |
| `src/inject/glbot.js` | Bot utilisant estimates + FAUNE |

---

## 12. À approfondir

- [ ] Formule dégâts serveur exacte (stats × power × résistances)
- [ ] Valeurs PA/PM de base par niveau
- [ ] Liste complète des glyphes / pièges et triggers `declencher`
- [ ] Maîtrise (`character.mastery`) et déblocage par `cost`/`level`
- [ ] Victoire FAUNE live avec log loot + berries + (pour valider snapshot bot)
- [ ] Ciblage UI fiable (clic case ennemi après sélection sort) — échec live des hits

---

## 13. Données live runtime (31/10/2026 — combat FAUNE)

Fichier : `docs/sessions/2026-10-31/combat_live_sample.json`

### Ressources tour (Bukima niv.2 TIREUR)
| Ressource | Valeur |
|-----------|--------|
| PA | **6** (`caracs.pa` / `tactics.ap`) |
| PM | **3** (`caracs.pm` / `tactics.mp`) |
| Initiative | 28 |
| Secondes / tour | 30 |
| HP / maxHp | 184 / **237** |
| Résistance générale | **8 %** (`caracs.resistances.generale`) |
| Esquive / tacle | 0 / 0 |

### Deck équipé (3 techniques)
| id | name | origin | type | power | PA | range |
|----|------|--------|------|-------|-----|-------|
| tir-1 | Tir précis | ASPIRATION | TIR | 1.2 | 2 | 6 |
| race-lunaria-flame | Flamme dorsale | RACE | ELEMENTAIRE | 1.35 | 4 | ? |
| weapon-shot-quickdraw | Dégainé précis | **WEAPON** | TIR | 1.25 | 3 | 4 |

### Estimates vs Rat des chantiers (87 HP)
| Action | min–max | crit |
|--------|---------|------|
| Attaque de base | 33–41 | — |
| Tir précis | 40–49 | 64–78 |
| Flamme dorsale | 22–27 | 35–43 |
| **Dégainé précis** | **48–58** | **77–93** |

→ Un **Dégainé précis** critique ou **deux** tirs normaux tuent ce rat.  
Problème live : spawn à **dist Manhattan 10**, range max deck = 6 → il faut **2 tours de PM** (3+3) pour entrer en range.

### Mastery (par technique en combat)
```js
mastery: { rank: 1, uses: 0, next: 150, remaining: 150, ratio: 0, max: false, branche: "PORTEE" }
```
Branche observée : `PORTEE`. 150 uses pour rank suivant.

### Fighter keys utiles
`caracs`, `techniques[]`, `statuses`, `armeDeTir`, `weaponName`, `aspiration`, `race`, `faune`

### Pertes berries défaite (cumul live)
| Combat | Perte | Berries après |
|--------|-------|---------------|
| 1 | −7 | 42 |
| 2 | −6 | 36 |
| 3 | −5 | 31 |

Perte variable ~5–7 ฿ (pas un fixe unique).

### Blocage API depuis sandbox
`fetch` vers `api.grandline-online.fr` → `TypeError: Failed to fetch` (CORS / isolation navigateur outil).  
Le bot injecté **dans la page** peut appeler l’API ; les scripts out-of-page non.

---

## 14. Données mob FAUNE + API (live 31/10 suite)

### Rat des chantiers (ennemi type)
| Champ | Valeur |
|-------|--------|
| level | 1 |
| HP | 87 / 87 |
| PA / PM | **6 / 3** (même base que joueur niv.2) |
| Initiative | **25** (joueur TIREUR ~28–32 → joue en premier) |
| Résistances | toutes à 0 |
| Technique | `com-1` Poing de fer — CONTONDANT power 1.3, PA 2, range 1 |

Les mobs FAUNE ont la même structure `fighters[]` que les joueurs (`caracs`, `techniques`, `faune`).

### Endpoints confirmés live
| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /api/battles/start` | 200 | Body = combatState complet |
| `POST /api/battles/:id/engage` | 200 | Après placement |
| `POST /api/battles/:id/move` | — | OK côté client jeu ; **405** si proxy relative host ; outil isolé = Failed to fetch |

### Capture trafic
Hook `window.fetch` in-page : journalise toutes les réponses `/api/battles/*` (utilisé pour extraire caracs ennemi).

### Implications bot
1. Initiative joueur > rat → premier tour garanti (TIREUR perception haute)
2. Rat melee range 1 seulement → kiting distance avec TIR range 4–6
3. 2× Dégainé (~50) ou 2× Tir précis (~45) = kill théorique
4. **Priorité** : 2 tours de déplacement (PM 3+3) pour passer dist 10 → ≤6, puis full DPS

---

## 15. Controller UI combat (`combat.screen`) — 31/10

Découvert via `combat.click` source :

```js
// scene.combat.click(cell)
const fighter = this.screen.fighterAt?.(cell);
fighter
  ? this.screen.fighterClick(fighter, cell)
  : this.screen.cellClick(cell);
```

### `combat.screen` API (live)
| Méthode | Rôle |
|---------|------|
| `cellClick(cell)` | Placement / **move** si `cell ∈ tactics.reachable` / cible sort si action armée |
| `fighterClick(fighter, cell)` | Clic sur combattant (attaque) |
| `fighterAt(cell)` | Fighter sur la case |
| `arme()` | Action actuellement armée |
| `update` / `close` / `dismiss` | Lifecycle |

### `tactics.reachable` (live)
Liste des cases marchables ce tour :
```js
{ x, y, cost, taclePm, taclePa }
// cost = coût en PM (1..pm)
// 21 cases observées avec PM=3
```

### Flux client officiel
1. **Move** : `await screen.cellClick(reachableCell)` si `reachable.some(c => c.x===…)`
2. **Attack** : sélectionner sort (hotkey 1–9 / bouton) → `await screen.fighterClick(enemy, pos)`
3. Si sort armé (`q` interne) : `cellClick` applique le sort sur la case

### Bot v0.8.7
- `approachEnemyInCombat` utilise `reachable` + `screen.cellClick`
- `playAction` utilise `screen.fighterClick` en fallback UI

### Isolation réseau outil
`fetch`/`XHR` vers `api.grandline-online.fr` depuis le sandbox outil = échec.  
Les appels **du jeu** (via screen.*) passent et sont capturables par hook `window.fetch`.

---

## 16. Engagement FAUNE — distance serveur (31/10)

### Erreur API observée
```
POST /api/battles/start { characterId, fauna: packId }
→ 409 CONFLIT
{ "error": "Le groupe est trop loin : approche-toi d’abord", "code": "CONFLIT" }
```

### Causes
1. **`faunaEntities.has(packId)` ≠ assez proche** pour le serveur
2. Les mobs **patrouillent** (`orbit` shape `va-et-vient`, rx≈7, ry≈6) — l’ancre pack ≠ position réelle
3. Il faut coller à la **position live du mob** (container pixel → tile), pas seulement `ancre` / `orbit.cx`

### Structure pack / entity
```js
faunaEntities.get(packId) = {
  pack: { id, ancre: {x,y}, mobs, ... },
  mobs: [{ id, espece, niveau, orbit, container, sprite, ... }]
}
orbit = { shape:"va-et-vient", cx, cy, rx, ry, tilt, phase, period, sens }
// container = position pixel monde Phaser (pas tile)
```

### Payload engagement
```js
startBattle({ fauna: packId })  // via onFaunaAttack / attackFaunaPack
```

### Implications bot
- Calculer tile mob depuis `container` (iso) ou suivre l’entité jusqu’à dist ≤ seuil serveur
- Ne pas se fier uniquement à `ancre` / `orbit.cx`
- Gérer 409 : se rapprocher et réessayer

---

## 17. IA combat V0.9 (inspirée combattourpartour V18)

Référence : `docs/reference/combattourpartour.js` (script user validé).

### Apports intégrés dans glbot 0.9.0
| Feature | Détail |
|---------|--------|
| **Sweet spot** | `max(enemy.pm + myRange, enemy.pm + enemyRange + margin)` |
| **Kite** | Ranged vs mêlée : s'éloigne via `reachable` tant que dist < sweet |
| **Finishers** | `est.max >= hp` → +10000 score |
| **Focus low HP** | Priorise les cibles blessées |
| **Garde** | HP < 50% et menacé (dist ≤ enemy.pm+range) |
| **Fuite** | HP < 20% |
| **targetCell** | Envoyé avec chaque ATTAQUE/TECHNIQUE |
| **Approche** | `reachable` vers range utile, pas contact forcé |
| **Anti-boucle kite** | Max 3 kites consécutifs puis force approche |

### Payloads API (validés script user)
```js
// Action
POST /api/battles/:id/action
{ characterId, kind: "TECHNIQUE"|"ATTAQUE"|"GARDE"|"FUITE", id?, targetId?, targetCell? }

// Move
POST /api/battles/:id/move
{ characterId, cell: {x,y} }

// Fin tour
POST /api/battles/:id/end-turn
{ characterId }

// Poll état
GET /api/battles/:id

// Rest
POST /api/world/rest
{ characterId, kind: "BELLE_ETOILE" }

// Deck
GET /api/characters/:id/techniques
```

### Pattern d'usage recommandé (script user)
1. Joueur / bot engage le combat (map)
2. Hook `fetch` sur `/battles/start` → lance IA pure API
3. Poll GET battle + decide + execute jusqu'à winner
4. Auto-rest après combat

L'API pure fonctionne **uniquement injectée dans la page** (pas depuis sandbox outil isolé).

---

## 18. Module GLCombat v1.0 + API live

Fichier : `src/inject/combat-module.js`

### Utilisation
```js
// Console F12 en jeu
// coller combat-module.js
GLCombat.arm();   // auto-fight dès /battles/start
// ou
GLCombat.fight(battleId);
```

### Optimisations
| Axe | Stratégie |
|-----|-----------|
| **DPS** | Finishers prioritaires, focus low HP, multi-actions / tour tant que PA |
| **Rentabilité** | Kite ranged vs mêlée, sniper bonus distance (+3%/case >3), éviter défaites (−5–7฿) |
| **Risque** | Garde <45% HP si menacé, fuite <18% |
| **Temps** | Poll 280ms, pas d’UI, API pure, rest auto post-fight |
| **Position** | Sweet spot = enemy.pm + myRange ; prefer dist 6 pour Tir précis |

### Techniques débloquées (API techniques) Bukima
Deck actif 3/20 : Tir précis (PA2 R6), Flamme dorsale (PA4), Dégainé précis (PA3 R4)  
Arbre TIREUR vu : Étoile explosive circle1, Tir en chaîne line3, Balle de l’aube R8 pwr2.7, etc.  
Spé **Sniper** (niv.2, pas encore choisie) : +3% dmg/case au-delà de 3 (max +24%).

### Routes découvertes en plus
Voir `docs/api/combat-endpoints.md` — options, exclude, revenir, join, active, deck, maitrise.

---

## 19. Première WIN live validée (31/10/2026)

Fichier log : `../sessions/2026-10-31/win_log_001.json`

### Résultat
- **winner: ALLIE**
- Rat des chantiers 106 HP → 0 en **2× Tir précis**
- Joueur **184 HP** fin (0 dégâts subis)
- 4 tours total (approche + 2 tirs)

### Séquence
1. Move → dist 7  
2. End turn (PM épuisé)  
3. **Tir précis** dist 4, est ~44 → 62 HP restants  
4. **Tir précis** dist 4, est ~44 → **0 HP WIN**

### Règles serveur confirmées
| Règle | Détail |
|-------|--------|
| ATTAQUE base | **range 1** obligatoire (409 « Hors de portée » sinon) même TIREUR |
| TECHNIQUE tir-1 | range **6** OK |
| Payload action | **characterId obligatoire** |
| Estimates client | Affichés hors range réelle → ne pas s’y fier seuls |

### Implications module optimal
- Ne jamais scorer ATTAQUE à distance
- TIREUR : kiter à dist 4–6, spammer Tir précis / Dégainé
- 2 ticks de PA=2 = clear rat 106 HP sans prendre un coup

---

## 20. Session multi-win + berries API (31/10)

Logs : `../sessions/2026-10-31/win_log_002.json`

| Fight | Ennemi | Résultat | Skills | Tours |
|-------|--------|----------|--------|-------|
| 1 | Rat des chantiers | ALLIE | 2× Tir précis | 4 |
| 2 | Chien errant | ALLIE | 3× Tir précis + Dégainé précis | 7 |

- Joueur **184 HP** fin des 2 fights (0 dmg)
- **UI berries STALE** (137) vs **API berries 221** — toujours lire `GET /api/characters` → `berries`
- XP 113, level 2
- Inventaire items inchangé (slingshot only) — drop rate mobs bas niveau faible ou 0
- Vautour trop loin → 409 engagement (approche insuffisante sur packs distants)

### Règle module
```js
// Ne jamais se fier à DOM ฿ ni scene.character.berries
const berries = (await api GET /api/characters).berries
```

---

## 21. Navigation longue distance + WIN multi-mobs (31/10)

Log : `../sessions/2026-10-31/win_log_003_multi.json`

### Navigation map (point 1)
| Avant | Après |
|-------|-------|
| steps 1 case | **paths multi-cases** (8–12) via `moveLocal` |
| tile via container iso | **orbit.cx/cy / ancre** pour la longue distance |
| stuck arbres | chunks axis-aligned (X puis Y) |

Validé : (62,38) → (117,43) en 6 chunks.

### Multi-mobs (point 2)
Pack `ilusia-groupe-2-g14` = **2 Vautour des cactus** (109 + 131 HP)

| Résultat | ALLIE |
|----------|-------|
| Tours | 9 |
| Hits | 6× Tir précis |
| HP joueur | 184 (0 dmg) |
| **Berries API** | 221 → **406** (**+185**) |
| XP | 150 |

**Focus fire** validé : kill cible la plus blessée / priorisée avant de switch.

### Améliorations proposées
1. Intégrer `walkToPack` dans farm loop glbot
2. AOE (`Étoile explosive` circle1) quand 2+ ennemis adjacents et sort débloqué
3. Pickup ground drops (crâne visible post-fight)
4. Éviter loups niv.3 si sous-level

---

## 22. Compréhension approfondie (dump live 31/10)

Source : `docs/sessions/2026-10-31/combat_knowledge_dump.json` + battle multi-vautours.

### Schéma battleState (top-level)
`winner`, `fighters`, `log`, `id`, `round`, `finished`, `kind` (FAUNE), `islandId`,  
`placementEndsAt`, `turnEndsAt`, `margeDeRelecture` (1600 ms), `secondesParTour` (**30**),  
`order`, `turn`, `you`, `activeFighterId`, `yourTurn`, `absent`, `toursManques`,  
`actions`, `tactics`, `optionsDePlacement`, `renfortsExcluables`

### tactics
| Champ | Rôle |
|-------|------|
| grid | `{width,height,x0,y0}` — sous-carte combat |
| obstacles | cases bloquantes (105 sur sample plage) |
| hazards | cases dangereuses (eau…) |
| positions | `{fighterId: {x,y}}` |
| reachable | cases PM avec `cost` |
| ap / mp | PA/PM restants du tour |
| placementCells | cases dispo au placement |

### Fighter (allié & ennemi)
```
id, name, team, level, aspiration, armeDeTir, race,
hp, maxHp, statuses[], weaponName, faune, fruit,
caracs: {
  pa, pm, initiative, bouclier, bouclierTours,
  resistances: { generale, TRANCHANT, CONTONDANT, TIR,
                 ELEMENTAIRE, SONIQUE, critiques, alterations },
  esquive, tacle, effets[]
},
techniques[]: { id, name, type, origin, power, pa, range, shape, ... }
```

### Ennemi FAUNE exemple (Vautour)
- aspiration **COMBATTANT**, `armeDeTir: false`, range tech **1** (Poing de fer)
- PA 6 / PM 3 / initiative ~29–32 (souvent > joueur → jouent avant)
- Résistances 0 sur sample

### Estimates (serveur)
```json
{ "min", "max", "critMin", "critMax" }
```
Crit ≈ **×1.6** sur ce sample.

### Efficacité réelle (avg/PA) vs vautour
| Sort | avg | PA | avg/PA | Verdict |
|------|-----|-----|--------|---------|
| **Tir précis** | 41 | 2 | **20.5** | meilleur |
| Attaque | 34.5 | 2 | 17.2 | mêlée only |
| Dégainé précis | 49.5 | 3 | 16.5 | burst, moins efficient |
| Flamme dorsale | 23 | 4 | **5.8** | à éviter ici |

### Log combat
Événements vus : `INITIATIVE`, `ENGAGE`, `MOVE`  
MOVE contient `from`, `to`, `path[]`, `mp`, `taclePm`, `taclePa`.

### Implications IA
1. Scorer par **estimates.avg / PA**, pas par power client seul  
2. Ignorer Flamme dorsale vs FAUNE faible résist ELEMENTAIRE nulle mais power mal convertie  
3. Lire `enemy.techniques[].range` + `caracs.pm` pour sweet spot réel  
4. `statuses` / `caracs.effets` prêts pour buffs/debuffs (vides sur sample)  
5. Initiative ordre dans `order` / log INITIATIVE — ennemis souvent avant  
6. Timer 30 s/tour — bot doit jouer vite (< poll 300 ms OK)

---

## 23. Log combat complet + loot (31/10)

Source : `docs/sessions/2026-10-31/combat_log_schema.json` — WIN 2 vautours avec log intégral.

### Types d’événements `log[]`
| Type | Rôle | Champs clés |
|------|------|-------------|
| INITIATIVE | ordre de tour | `order`, `orderIds` |
| ENGAGE | début | `seq` |
| MOVE | déplacement | `actor`, `from`, `to`, `path`, `mp`, `taclePm/Pa` |
| **CAST** | lancement sort | `technique`, `techniqueId`, `damageType`, `cell`, `cells[]`, `atRange`, `hits`, `supportive`, `origin` |
| **DAMAGE** | dégâts appliqués | `amount`, `critical`, `remaining`, `maxHp`, `target`, `damageType`, `technique` |
| **DOWN** | mort / KO | `target`, `targetId` |
| **END** | fin combat | `winner` |

### Exemples DAMAGE réels (Tir précis)
| amount | critical | remaining | maxHp |
|--------|----------|-----------|-------|
| 70 | true | 39 | 109 |
| 40 | false | 0 | 109 |
| 67 | true | 64 | 131 |
| 44 | false | 20 | 131 |
| 67 | true | 0 | 131 |

→ Les **crits** collent aux `critMin/critMax` des estimates ; les hits normaux aux `min/max`.

### CAST
```json
{
  "type": "CAST",
  "technique": "Tir précis",
  "techniqueId": "aspiration:TIREUR:tir-1",
  "damageType": "TIR",
  "cell": {"x":115,"y":40},
  "cells": [{"x":115,"y":40}],
  "atRange": true,
  "hits": 1,
  "supportive": false
}
```

### Loot FAUNE confirmé (inventaire API)
Après wins : `viande-de-gibier`, `peau-tannee`, `minerai-fer`, `ble`, `plumes`  
→ Les drops existent ; lecture via `GET /api/characters` → `inventory.items`.

### Implications IA
1. Parser le log post-action pour confirmer dégâts réels (`amount`, `critical`)
2. Ajuster le modèle estimates ↔ dégâts observés
3. `DOWN` = cible morte (plus fiable que hp<=0 seul)
4. Tracker loot via inventory API diff avant/après
5. `techniqueId` namespaced (`aspiration:TIREUR:tir-1`) dans le log ≠ id court `tir-1` dans actions

---

## 24. Dégâts subis + combos ennemis (31/10)

Source : `docs/sessions/2026-10-31/combat_defense_log.json`  
Combat volontairement tanké (mêlée + end-turn) puis clear.

### DAMAGE entrant (même schéma que sortant)
```json
{
  "type": "DAMAGE",
  "actor": "Vautour des cactus 1",
  "target": "Bukima",
  "amount": 7,
  "damageType": "CONTONDANT",
  "critical": false,
  "technique": "Poing de fer",
  "techniqueId": "aspiration:COMBATTANT:com-1",
  "atRange": false,
  "remaining": 97,
  "maxHp": 237
}
```

### Techniques ennemies observées
| Technique | Type | Notes |
|-----------|------|-------|
| Poing de fer | CONTONDANT | Tech listée sur le fighter (`com-1`, range 1) |
| **Frappe conjointe** | CONTONDANT | **`combo: true`** — pas dans `fighter.techniques[]` au start |

### Combo multi-mobs
Quand 2+ vautours au contact, le log montre des hits **Frappe conjointe** avec `"combo": true` (dégâts faibles ~3, parfois crit).  
→ Pack multi = plus dangereux que somme des techs individuelles.

### Dégâts reçus (échantillon)
| amount | crit | technique |
|--------|------|-----------|
| 3 | non | Frappe conjointe |
| 7–11 | non | Poing de fer |
| 16 | **oui** | Poing de fer |
| 3 | oui | Frappe conjointe |

Résistance générale joueur 8 % — les hits restent faibles vs vautour niv.1, mais **tank 3 tours → HP 6/237**.

### Implications IA
1. **Ne jamais tanker** en multi-mobs : kite obligatoire (déjà le cas TIREUR)
2. Prioriser kill d’un mob pour casser les **combos**
3. Lire les DAMAGE où `targetId === you` pour risk assessment
4. Les techs ennemies listées au start sont **incomplètes** (combos cachés)
5. `atRange: false` sur mêlée confirmé

---

## 25. GARDE + hazards (31/10)

Source : `docs/sessions/2026-10-31/combat_guard_hazards.json`

### GARDE
| Élément | Valeur observée |
|---------|-----------------|
| Action | `kind: "GARDE"` → HTTP 200 |
| Log | type **`GUARD`** (`actor`, `actorId`, `seq`) |
| Status | `{ id: "GARDE", turns: 1, stack: 1, force: 1, posee: false }` |
| Bouclier | **inchangé** (reste 0) |
| Durée | **1 tour** — status absent au tour suivant |
| Dégâts sous garde | toujours reçus (ex. 18 crit, 10, 9 CONTONDANT) |

→ GARDE = status temporaire, **pas** un bouclier HP.  
Réduction exacte non prouvée sur 1 sample (hits encore significatifs).  
Usage IA : optionnel si HP bas et on doit encaisser 1 tour (fuite préférable si possible).

### Schema status
```json
{ "id": "GARDE", "turns": 1, "stack": 1, "force": 1, "posee": false }
```
Prêt pour d’autres statuses (SAIGNEMENT, etc.) avec le même format.

### Hazards / obstacles (
- Sample plage Ilusia : **~99 hazards**, **~111 obstacles** dans `tactics`
- Hazards = cases eau / danger (pas testé de marcher dessus ce run)
- Obstacles = cases bloquantes pour move/LOS probable

### Implications IA
1. Lire `fighter.statuses[]` chaque tour
2. GARDE si vraiment forcé d’encaisser — sinon kite / kill
3. Pathfinding combat : éviter `hazards` si possible, respecter `obstacles`

---

## 26. GLCombat v2.0 — optimisation max (31/10)

Module : `src/inject/combat-module.js` **v2.0.0**  
Validation : `../sessions/2026-10-31/win_log_004_v2.json` — multi-vautours, **0 dmg pris**, +64฿.

### IA v2
1. Score **avgEst/PA** (ignore sorts eff < 8 sauf kill)
2. **Focus fire + anti-combo** multi (priorité kill count)
3. **LOS Bresenham** si `needsSight` vs `tactics.obstacles`
4. **Évite hazards** dans reachable
5. Kite sweet spot = enemyPM + enemyRange + margin
6. GARDE seulement si HP bas + adjacent + pas déjà status
7. Tracking log DAMAGE dealt/taken/crits + berries API
8. Rest auto post-fight

### Compréhension combat

| Domaine | % |
|---------|---|
| Flow API / payloads | ~99 |
| Ranges / ATTAQUE vs TECHNIQUE | ~99 |
| Estimates & scoring | ~98 |
| Multi / combos / focus | ~97 |
| Log CAST/DAMAGE/DOWN/GUARD | ~98 |
| Status GARDE | ~95 |
| LOS client approx | ~90 |
| Hazards (évités, dmg tick non mesuré) | ~85 |
| Formule serveur exacte (stats→dmg) | ~40 (estimates suffisent) |
| Tous les 65 états numériques | ~30 |

**Global opérationnel FAUNE / TIREUR : ~96–98 %**  
Le reste est polish (formule serveur, ticks hazard, états rares) — le bot n’en a pas besoin pour farmer optimal.
