## [farm] scripts/gl_farm.js — source console GL — 2026-11-02

- IA kite obligatoire si d < safe (plus de condition allMelee)
- Interdit tir sous safe tant que PM disponibles
- walkTo resync path start + case adjacente walkable
- Popup stop sur CONTINUER · farm continu GL.start()
- Préfère packs petits · blacklist walk/attack fail

## [toroa] Packs fauna + console level bot — 2026-11-02

- Catalogue packs Toroa (écureuil/chien/poule/colombe niv 7–10)
- `scripts/console_level_bot.js` pour test parallèle autre compte
- Filtre fauna élargi (poule/colombe)
- Gap: fixture walkable Toroa manquante

## [travel] Ohara→Toroa autonome + loop XP — 2026-11-02

- Sea travel bout-en-bout validé : depart → cap → positions → dock **toroa**
- Campaign `pw3-cap` stage 135 · XP +70
- Gestion sac plein (`economy/sell`) + ration obligatoire
- `tools/sea_travel.py`, `docs/data/docks.json`, level_loop branch travel réelle
- level_core : travel uniquement îles **unvisited**
- Session : `docs/sessions/2026-11-02/sea_travel_toroa_autonomous.md`

## [level] Planificateur XP adaptatif — 2026-11-02

- `tools/level_core.py` — rest / daily / quest / farm / travel (underlevel → farm)
- `src/launcher/level_loop.py` — runner (--plan-only, --no-travel)
- `docs/data/xp_knowledge.json` + tests 10 passed
- Live plan-only : travel **toroa** (stage 134, objectifs vides)
- Session : `docs/sessions/2026-11-02/level_adaptive_plan.md`

## [quête] Bot adaptatif validé méthodo A→D — 2026-11-02

- `tools/quest_core.py` + `src/launcher/quest_loop.py` + `docs/data/npcs.json`
- `tests/test_quest_core.py` (8 tests) + fixture golden receleurs
- Live : pw2-receleurs 0-dmg + pw2-lucien + plan → travel_hint toroa
- Sessions : `docs/sessions/2026-11-02/quest_adaptive_validation.md`

## [méthodo] Auto-capture fixtures combat — 2026-11-02

- `headless_world --farm` → `tests/fixtures/battles/*_tNN.json` (défaut ON, `--no-capture` pour off)
- 3 wins live + **21 fixtures** turns capturés
- aligné méthodo A→B→C

## [D] Farm headless 5×0 dmg — 2026-11-02

- `headless_world --farm 5` : **5 ALLIE, hpDelta 0**
- `fight_pack` → `decide_core` (même IA que tests offline)
- Filtre packs faibles ; walkable ohara ; polling socket fallback

## [map] Walkable ohara + path offline — 2026-11-02

- Fixture `tests/fixtures/map/ohara_walkable.json` (633 blocked, 160×160)
- `tools/map_path.py` BFS offline + `tests/test_map_path.py`
- `headless_world.walk_to` utilise la fixture si présente
- Procédure capture : `tools/map_walkable_dump.md`

## [méthodo] Stack R&D projet entier — 2026-11-02

- `docs/guide/methodology.md` — capture → offline → golden → live pour **tous** les systèmes
- `tools/decide_core.py`, `replay_decide.py`, `capture_battle_turns.py`, `capture_browser_socket.js`
- `tools/capture_rest_session.py` — capture REST multi-systèmes
- `tests/test_decide_smoke.py` + `tests/fixtures/`
- Liens depuis START / ARCHITECTURE / testing / README

# Changelog

## [2.3.0] Headless world move (Socket.IO) — 2026-11-02

### Live
- Socket `api.grandline-online.fr/socket.io` auth JWT
- `world:join` + `player:move` **sans navigateur**
- `headless_world.py --farm 3` → **3 wins, hpDelta 0**

### Outils
- `src/launcher/headless_world.py`
- Docs : `docs/guide/testing.md` section déplacement

## [2.2.0] Combat 0-dmg + rest gate + API pure tests — 2026-11-02

### Live (compte Bukima / junymine4)
- Personnage à **1/436 PV** → serveur refuse tout combat (`repose-toi`)
- Rest `BELLE_ETOILE` → +337 HP validé
- **API pure** : `POST /battles/start` **sans navigateur** si position serveur proche
- Login API : `User-Agent` navigateur obligatoire (sinon 403)
- Farm API : **5 wins, hpDelta 0** chacun (~39 s) — `artifacts/pure_api_farm_2026-11-02.json`
- Selenium headless Phaser : tab crash (sandbox) → non retenu pour combat

### GLCombat 2.2.0
- **Kite AVANT attaque** si threatened (PM ennemi + range + marge)
- sweet = min(myRange, max(4, enemyPM + enemyRange + margin))
- Ignore ATTAQUE base si ranged (`NEVER_MELEE_IF_RANGED`)
- GARDE une seule fois (`statuses`), seuil 18 %, dist ≤ 1
- PA ATTAQUE forcé ≥ 2 ; LOS sur techniques distance
- `ensureHealthy()` : rest auto si HP < 35 % avant fight
- Config : `KITE_BEFORE_ATTACK`, `MIN_HP_TO_FIGHT`

### Outils / docs
- `src/launcher/pure_api_farm.py` — canal test optimal
- `docs/guide/testing.md` — guide reprise IA
- `docs/sessions/2026-11-02/` — preuves

## [structure] — 2026-11-01

### Projet
- Restructuration docs option A : `guide/`, `api/`, `data/`, `sessions/`, `history/`
- `docs/START.md` + `docs/ARCHITECTURE.md` + `docs/ROADMAP.md` unique
- README réécrit, `requirements.txt`, config.example enrichi
- Preuves live déplacées sous `docs/sessions/YYYY-MM-DD/`

# Changelog

## [2.21.0] Mer free-roam + foeId live — 2026-11-01

### Breakthrough
- foeId format: `sea-west-{col}-{row}-{kind}-{idx}`
- BANC salvage live → poisson-commun
- BARIL/EPAVE/ROI existent (proximité requise)
- Cap libre = depart sans /sea/cap
- discoveries 21, combatReclameS, tirs in position

## [2.20.0] Mer mastery — travel + combat — 2026-11-01

### Travel
- Ohara↔Ilusia : 113 cases, 3 tiles, **~35 s** optimisé
- credit position + rate-limit documentés
- ship pieces (voile/gouvernail/coque) → bonus.vitesse

### Combat
- Flux hunt / broadside / board / player-board
- Aggro 10, désengage ×1.35
- CD hunt 60s client ; CD 10 min même navire (joueur)

## [2.19.0] Tests combat mer complets — 2026-11-01

### Validé live
- Sloop + canon leger + grappin opérationnels
- Toutes APIs hunt/board/broadside/player-board (messages serveur)
- Seuil abordage 60%, ROI_DES_MERS, heading≤10
- Modes côtier vs haute mer documentés

## [2.18.0] Sloop + canon + grappin — 2026-11-01

### Navire
- Upgrade barque → sloop (2 sabords)
- Canon léger équipé slot 0
- Grappin acquis (market)

### Règles
- Barque ne peut pas canons
- ship/buy classId: barque|sloop|caravelle|galion|lupus

## [2.17.0] Règles combat mer confirmées — 2026-11-01

### Hunt
- 1×/jour/mer via huntAvailable (confirmé UI + journal)

### Abordage
- Seuil coque **60 %** (By=0.6), pas 50 %
- >60 % → grappin obligatoire
- ≤60 % → abordage libre
- kind NAVIRE seulement (pas ROI_DES_MERS)

### Canons
- GET/POST /world/ship/canons (à quai)
- broadside nécessite canons équipés

## [2.16.0] Hunt foe = ROI_DES_MERS — 2026-11-01

### Mer
- Chasser cible uniquement kind `ROI_DES_MERS` à portée
- foeId = id entité mer locale
- Portée (rayonCorps||2.4)+7
- GET /sea/caps : routes connues vs fermees

## [2.15.0] Farm opti + hull full — 2026-11-01

### Économie
- Market caisse → +138000฿
- repair-kit buy + world/repair = +25 hull/kit
- hull 100 restauré
- Contrat livraison +2000 live (loop farm)

### Opti
- Ratio contrat ~600-800฿/min
- Boucle documentée docs/archive/live_farm_optimize_2026-11-01.md

## [2.14.0] Repair lock + market list — 2026-11-01

### Mer / coque
- hull 1 bloque `sea/cap`
- repair-kit shop port 3300฿
- world/repair exige chantier naval

### Market
- list/cancel/price/me validés
- caisse-renforcee listée 150k

## [2.13.0] Combat mer structure — 2026-11-01

### Mer
- journal huntAvailable + prime 1200฿/60XP
- APIs hunt/broadside/board/wreck/salvage documentées
- wreck live → retour île hull 1
- Patrouille Marine = menace réelle
- foeId monstre = engagement client (Chasser UI)

## [2.12.0] PvP rules + duel amical — 2026-11-01

### PvP
- challenge : 8 cases, même île, pas combat/barre
- Protection débutants < lvl 30
- Duel amical : POST /crews/duel-amical/defier → 201 ouvert
- sea/hunt testé (pas de monstre près Ilusia)

## [2.11.0] Contrat livraison complet — 2026-11-01

### Contrats
- LIVRAISON ohara→ilusia bout-en-bout : +740฿ payés au dock
- Ponton Ohara = cityMap.port.docks cells (45,141-146)

### PvP
- Route : `POST /battles/pvp/challenge { characterId, targetId }`
- 409 si cible pas sur même île

## [2.10.0] Rest / Craft / Contrats — 2026-11-01

- Rest BELLE_ETOILE OK
- Craft: recettes metier (planche) pas TIREUR
- Contrat LIVRAISON accept live ohara→ilusia 740B
- Combat ATTAQUE kind validé

## [2.9.0] Quête Ohara Acte II + fix combat action — 2026-11-01

### Campagne
- pw2-severin validé · stage 132 · level 5
- Objectif combat pw2-receleurs (×3 lvl 10)

### Combat
- Action body : `kind` obligatoire (ATTAQUE|TECHNIQUE|GARDE|FUITE|OBJET)
- skillId sans kind → 400

## [2.8.0] Quête Ohara + travel inter-îles — 2026-11-01

### Campagne
- pw1-vivres, pw1-barque, pw2-cap validés live
- discover ohara via quête · stage 127 Acte II

### Travel
- Cap + position + dock Ohara bout-en-bout
- Coût accostage (tax/wage/rations/hull)

## [2.7.0] Travel mer aller-retour — 2026-11-01

### Navire / mer
- Depart live OK depuis ponton 104,139 (`sea/depart` mode navire)
- Dock retour ilusia OK
- Position mer rate-limitée
- Inter-îles bloqué sans routes PNJ

## [2.6.0] Ventes optimisées economy/sell — 2026-11-01

### Économie
- `POST /economy/sell` ~6× plus rentable que comptoir (plumes 126 vs 19)
- Bulk live +5153 berries → 6036
- Market list/price advice documentés
- Barque achetée : `POST /world/ship/buy { classId:"barque" }` (−3500)

## [2.5.0] Shop achat réel — 2026-11-01

### Shop
- Achat live OK : ration via shopId `port` au dock (−1050 berries)
- GET `/characters/{id}/shop/{rayon}` · POST `/characters/{id}/buy` `{ itemId, shopId }`

## [2.4.0] Négoce vente réelle — 2026-11-01

### Comptoir
- Vente live OK dock ilusia (104,137) : `plumes` ×1 → +19 berries
- POST `/negoce/vendre` `{ characterId, marchandise, quantite }`
- Inventaire : `character.inventory.items`

## [2.3.0] GLCombat v2.1 + quête combat — 2026-11-01

### GLCombat 2.1.0
- Fix critique : `yourTurn` lu au **top-level** (plus `tactics.yourTurn`)
- `isMyTurn()` : yourTurn | activeFighterId | tactics.yourTurn
- Positions défensives si `tactics.positions` manquant
- `fightQuest(objectifId)` : rest → start → engage → fight

## [2.2.0] Pathfinder walkable — 2026-10-31

### GLBot 1.1.0
- BFS 4-directions sur `scene.movementBlocked` + `blocked`
- `escapeBlockedCell()` — sortie case eau / invalide
- `walkTo(target)`, `findPath`, `nearestWalkable`, `debugPath`
- `moveToward` branché sur le pathfinder
- GLCombat.walkToPack délègue à GLBot.walkTo si présent

## [2.1.0] RE avancé — 2026-10-31

### Documentation
- Nouveau `docs/systems_advanced.md` : 6 systèmes manquants
  - Négoce comptoir (routes + body exacts)
  - Craft (recipeId + catalyseur + queue)
  - Travel / ship / sea bout en bout
  - Quêtes (objectifId → search → complete)
  - PvP challenge/accept
  - Shop (rayons + buy conditionné proximité)
- Roadmap + reverse_engineering + systems.md mis à jour
- Bundle client archivé (`docs/archive/client_bundle.js`)

### Validation live (compte junymine4 / Bukima)
- Login API `POST /api/auth/login` avec email=pseudo
- Shop **items réels** sur ilusia : port (3), ARMURERIE (42), CHANTIER (navires+mats)
- Négoce : refus « approche-toi du ponton » (`auPonton: false`)
- Travel : refus sans navire ; dock offers barque 3500 / sloop 29000
- Craft : structure OK, `queueSlots: 0` (TIREUR) ; recipe inconnue → INTROUVABLE
- Quêtes : objectifs vides ; side-quests action enum ; faction complete lvl 8+
- Atlas public 148 îles ; samples `docs/archive/live_*.json`
### Session navigateur live (ilusia)
- Hub → JOUER → scène active ; PNJ + dock coords capturés
- Quête prologue Lin : campaign/talk exige proximité
- battles/start sans fauna → RENCONTRE (Sergent Beauregard) — défaite documentée
- Action combat payload confirmé (`kind`+`id`+`targetCell`)
- moveLocal depuis case eau → Invalid path (pathfinding requis)
- ilusia_map_live.json archivé


## [2.0.0] GLCombat — 2026-10-31

### Module combat optimisé max
- Score estimates/PA, seuil efficacité min
- Focus fire anti-combo multi-mobs
- LOS Bresenham (needsSight + obstacles)
- Évite hazards au move
- GARDE conditionnelle (status 1 tour)
- Tracking dmg dealt/taken/crits + berries API
- Validation live : WIN 2 vautours, 0 dmg, +64฿

### Compréhension
- Log GUARD/CAST/DAMAGE/DOWN/END
- Combos Frappe conjointe
- 65 états listés côté client (bundle)
- Shapes: single, circle1/2, cross1, line3/5, cone3, self

## [1.3.0] — 2026-10-31
- Navigation longue distance, multi-win vautours +185฿

## [1.0.0] GLBot — 2026-10-31
- Farm map + IA combat de base

