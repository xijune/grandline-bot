# Architecture

## Vue d’ensemble

```
                    ┌─ pure_api_farm.py  (TEST OPTIMAL — sans navigateur)
JWT + characterId ──┤
                    └─ Navigateur Phaser
                         │  sessionStorage token
                         ├─► API REST  https://api.grandline-online.fr
                         └─► Socket.IO  (fauna:updated, battle:*, …)

Scripts injectés (console F12)
    ├─ GLCombat  (combat-module.js v2.2)  — IA kite-first + loop combat
    └─ GLBot     (glbot.js)               — farm map, pathfinder
```

**Important (2026-11-02)** : `POST /battles/start` fonctionne **sans client ouvert** si le character a une position serveur assez proche du pack. Le canal de test combat recommandé est donc Python API pure — voir `docs/guide/testing.md`.

## Responsabilités

| Module | Responsable de | Ne fait pas |
|--------|----------------|-------------|
| **headless_world.py** | Socket world:join + player:move + farm | Rendu Phaser |
| **pure_api_farm.py** | Régression combat API seule | Déplacement map |
| **GLCombat** | start/engage/action/move/end-turn, IA (kite-first, focus, LOS), fightQuest, ensureHealthy | Navigation longue distance map |
| **GLBot** | Pathfinder BFS, walkTo, farm loop, rest | IA combat optimale (délègue à GLCombat si présent) |
| **live_farm_test.py** | Selenium inject farm (fragile headless Phaser) | Production |
| **selenium_login.py** | Login + injection fichier | Logique métier |

## Flux combat FAUNE

```
proximité pack → POST /battles/start { characterId, fauna }
              → POST /battles/:id/engage
              → loop : GET state → decide → action|move|end-turn
              → winner ALLIE → loot inventaire + berries (API characters)
```

Points critiques validés live :
- `yourTurn` est **top-level** sur le state (pas seulement `tactics.yourTurn`)
- `characterId` + `kind` obligatoires sur `/action`
- ATTAQUE range serveur = 1 ; techniques = `geometry.range`
- Estimates serveur = source de vérité dégâts
- **Kite avant attaque** si threatened → 0 dmg (TIREUR, 2026-11-02)
- Login API : header `User-Agent` navigateur requis (sinon 403)
- HP très bas → start refusé ; `BELLE_ETOILE` puis éventuellement lit

## Flux navigation map

```
cible (x,y) → BFS walkable (movementBlocked) → chunks ≤ maxSteps
           → scene.moveLocal(path, null, {courir, redresser})
           → attendre !entity.moving
```

## Données runtime utiles

| Source | Usage |
|--------|--------|
| `window.__grandlineScene` | scène Phaser, entities, mapData |
| `scene.network.fauna` | packs, morts, engagees |
| `scene.character` / GET `/api/characters` | HP, berries, freeFightAt, inventory |
| `sessionStorage grandline-token` | Bearer |

## Méthodologie

→ [guide/methodology.md](./guide/methodology.md) : capture → offline → golden → live (projet entier).  
→ `tools/` = capture + fonctions pures ; `tests/` = régression ; `src/launcher/` = validation live.

## Docs vs code

- **Vérité gameplay actuelle** → `docs/guide/*`
- **Preuves / journaux de session** → `docs/sessions/`
- **Schémas JSON stables** → `docs/data/`
- **Historique RE** → `docs/history/`
