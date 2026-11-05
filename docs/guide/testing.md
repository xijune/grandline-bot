> Vue projet entier (tous systèmes) : **[methodology.md](./methodology.md)**

# Tests live — guide pour les prochaines IA

**Dernière validation : 2026-11-02** (compte test `junymine4` / perso **Bukima** TIREUR niv.8, Ohara)

## Règle d’or

> **Le combat se teste en API pure (Python/curl), pas via navigateur.**

Le navigateur (Phaser) est fragile ici (crash WebGL headless, popups, AFK).  
Une fois le personnage **positionné sur la carte** (même session ancienne), le serveur accepte :

```http
POST /api/battles/start  { "characterId", "fauna": "<packId>" }
```

sans client ouvert. Toute la boucle combat est REST.

## Canal optimal (ordre de préférence)

| Rang | Méthode | Quand l’utiliser |
|------|---------|------------------|
| **1** | `src/launcher/pure_api_farm.py` | Validation IA combat, régression, 0-dmg |
| **2** | Console jeu + inject `combat-module.js` | Pathfinding map, UI, popup, onFaunaAttack |
| **3** | `live_farm_test.py` (Selenium) | Uniquement si besoin d’entrer en monde automatiquement |
| **4** | `browser_tab` Grok | Débug ponctuel UI — lent, fragile |

### Ce qui a été prouvé 2026-11-02

- Login API + start fauna **sans navigateur** → 200 + battleId
- 5 wins / 5 fights aboutis, **hpDelta = 0** à chaque fois
- ~39 s pour 10 tentatives (5 packs hors portée → 409 « trop loin »)
- Kite live : `KITE 3→6`, `APPROACH`, `Tir précis` à d=5–6, `AP0 endturn`

Preuve : `artifacts/pure_api_farm_2026-11-02.json` + `docs/sessions/2026-11-02/`

## Prérequis API pure

1. **JWT** via `POST /api/auth/login` `{ "email": "<pseudo|email>", "password" }`  
   Header `User-Agent` navigateur obligatoire (sinon 403).
2. **characterId** (GET `/api/characters`).
3. **Position serveur** du perso assez proche du pack (sinon 409 *trop loin*).  
   La position est celle **persistée** (`mapId`, `x`, `y` sur le character) — pas besoin d’être « online » UI.
4. Pack **non engagé / non mort** : id type `ohara-groupe-30-g55`.

### HP bas

Si `hp` très bas, le serveur refuse le combat :

> *Tu tiens à peine debout … repose-toi*

→ `POST /api/world/rest` `{ characterId, kind: "BELLE_ETOILE" }`  
Note : après un rest, un second peut renvoyer *« Il te faut un vrai lit »* (cooldown / plafond).

## Boucle combat (contrat API)

```
POST /battles/start     { characterId, fauna }
POST /battles/:id/engage { characterId }
loop:
  GET  /battles/:id
  si yourTurn (TOP-LEVEL) :
    decide → POST move | action | end-turn
jusqu’à winner / finished
```

### Pièges validés live

| Piège | Fix |
|-------|-----|
| `yourTurn` lu seulement dans `tactics` | Lire **top-level** `s.yourTurn` |
| ATTAQUE `pa` undefined → spam 409 | Forcer PA ≥ 2 |
| GARDE en boucle | `statuses` contient GARDE → ne plus la rejouer ; ban 409 |
| LOS coupée | Bresenham + obstacles ; ban action ; side-step ou endturn |
| Attaquer avant de kiter | **Kite si threatened AVANT** tout cast (0 dmg) |
| Ancre orbit ≠ mob live (UI) | API start utilise la position **serveur** du perso vs pack |

### Décision 0-dmg (TIREUR)

1. Fuite si HP &lt; seuil  
2. Garde si collé + HP bas + pas déjà en garde  
3. **Kite** si `dist ≤ enemyPM + enemyRange` et PM dispo  
4. Cast techniques in-range + LOS (jamais ATTAQUE base si ranged)  
5. Approach vers sweet = `min(myRange, max(4, enemyPM+enemyRange+1))`  
6. Endturn  

## Lancer le farm API

```bash
export GL_EMAIL=... GL_PASSWORD=...
# optionnel : GL_CHAR_ID=...
python src/launcher/pure_api_farm.py --fights 8 --map ohara
```

Variables d’env uniquement — **ne jamais committer de mot de passe**.

## Compte de test (contexte)

- Pseudo connu en session 2026-11-02 : `junymine4` (perso Bukima, Ohara, TIREUR)  
- Mot de passe : **uniquement via env / secret opérateur**, jamais dans le git  
- Si le compte change, mettre à jour ce paragraphe + session du jour

## Selenium / navigateur

- `selenium_login.py` : login + inject fichier  
- `live_farm_test.py` : farm injecté — **Chrome headless plante** souvent sur Phaser dans les sandboxes légers  
- Préférer API pure pour le combat ; Selenium seulement pour *entrer en monde* ou tester `moveLocal`

## Checklist reprise projet (IA)

1. Lire `docs/START.md` → `ARCHITECTURE.md` → **ce fichier**  
2. Lire `docs/guide/combat.md` (IA décision)  
3. Vérifier `CHANGELOG.md` entrée la plus récente  
4. Lancer `pure_api_farm.py` si credentials dispo  
5. Toute découverte live → `docs/sessions/YYYY-MM-DD/` + ligne CHANGELOG  
6. Code combat → `src/inject/combat-module.js` (miroir logique du runner Python)


## Déplacement map sans navigateur (2026-11-02)

**Oui — via Socket.IO**, validé live.

| Élément | Valeur |
|---------|--------|
| URL | `https://api.grandline-online.fr` |
| path | `/socket.io` |
| auth | `{ "token": "<JWT>" }` |
| join | `world:join` `{ characterId, pasCompacts: true, carteEnTexte: true, carte? }` |
| move | `player:move` `{ path: [{x,y},…], courir, sauter }` |

Contraintes path :
- `path.length >= 2`
- `path[0]` = position serveur actuelle (sinon *Path start mismatch*)
- cases orthogonales walkables (sinon *Invalid path*)

Runner : `src/launcher/headless_world.py`

```bash
export GL_EMAIL=... GL_PASSWORD=...
python src/launcher/headless_world.py --step 1,0
python src/launcher/headless_world.py --to 110,91
python src/launcher/headless_world.py --farm 5
```

Preuve : 3 wins headless, hpDelta 0 — `artifacts/headless_farm_latest.json`


## Capture auto fixtures combat

`headless_world.py --farm N` écrit chaque turn joueur dans `tests/fixtures/battles/<battle8>_tNN.json`  
(désactiver : `--no-capture`).

Replay :
```bash
python tools/replay_decide.py tests/fixtures/battles/<file>.json
```
