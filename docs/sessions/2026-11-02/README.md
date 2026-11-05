# Session 2026-11-02 — API pure + 0 dmg kite

## Compte

- Pseudo : `junymine4`
- Perso : **Bukima** (`37762d71-bf5c-48ec-8092-de390221be4e`), TIREUR Lunaria niv.8, map **ohara** (~100,89)
- Mot de passe : **uniquement env** `GL_PASSWORD` (ne pas versionner)

## Découvertes

### 1. Combat sans navigateur

`POST /api/battles/start { characterId, fauna }` fonctionne **sans client Phaser ouvert**, tant que la position serveur du character est assez proche du pack.

Login API exige un `User-Agent` navigateur (sinon **403**).

### 2. HP critique

Bukima était à **1/436 PV** → tout start refusé (*repose-toi*).  
`POST /api/world/rest { kind: "BELLE_ETOILE" }` → +337 HP.  
Un second rest immédiat peut échouer (*vrai lit requis*).

### 3. Farm API pure — résultats

Fichier : `artifacts/pure_api_farm_2026-11-02.json`

| Pack | Winner | hpDelta |
|------|--------|---------|
| ohara-groupe-30-g55 | ALLIE | **0** |
| ohara-groupe-8-g64 | ALLIE | **0** |
| ohara-groupe-42-g60 | ALLIE | **0** |
| ohara-groupe-43-g59 | ALLIE | **0** |
| ohara-groupe-45-g47 | ALLIE | **0** |

- 5 wins, 5 packs trop loin (409)  
- ~39 s total  
- Logs typiques : `KITE 3→6`, `APPROACH`, `Tir précis` d=5–6, `AP0 endturn`

### 4. IA

Priorité **kite avant attaque** si threatened → 0 dégât stable sur TIREUR.  
Ne jamais spammer ATTAQUE range 1 en ranged.  
Ban des actions en 409 (LOS / garde).

### 5. Infra test

- Selenium headless : **tab crash** Phaser dans sandbox léger  
- `browser_tab` Grok : utilisable mais lent (popups, AFK)  
- **Canal retenu** : `src/launcher/pure_api_farm.py`

## Fichiers touchés

- `src/inject/combat-module.js` → v2.2 kite-first + ensureHealthy  
- `src/launcher/pure_api_farm.py` → runner API  
- `src/launcher/live_farm_test.py` → Selenium (secondaire)  
- `docs/guide/testing.md`  
- `CHANGELOG.md` [2.2.0]

## Headless move (suite session)

- player:move OK avec path [{x,y} start, …]
- world:join retourne fauna packs + players positions
- Farm headless 3 wins 0 dmg : artifacts/headless_farm_latest.json


## Farm headless isolé (suite)

- `headless_world.py --farm 5` → **5 wins, hpDelta tous 0**
- decide_core branché dans fight_pack
- walkable ohara + filtre packs faibles
- transport polling si websocket-client absent
- preuve: `artifacts/headless_farm_latest.json`
