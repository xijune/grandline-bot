# Démarrage — lire dans cet ordre

Temps estimé : **5–10 minutes**.

## 0. Méthodologie (lire en premier si tu construis / debug)

→ **[guide/methodology.md](./guide/methodology.md)** — stack A→B→C→D pour **tout** le projet  
→ [guide/testing.md](./guide/testing.md) — canaux live combat/map

## 1. Contexte
Bot d’automatisation pour [GrandLine Online](https://grandline-online.fr) (MMORPG navigateur Phaser 3).  
Injection JS dans le client + appels REST authentifiés (JWT Bearer).

## 2. Architecture
→ [ARCHITECTURE.md](./ARCHITECTURE.md)

## 3. Tests (lire avant de debugger au hasard)
→ **[guide/testing.md](./guide/testing.md)** — canal optimal = **API pure** (`src/launcher/pure_api_farm.py`)

```bash
export GL_EMAIL=... GL_PASSWORD=...
python src/launcher/pure_api_farm.py --fights 8
```

Validé 2026-11-02 : 5 wins, **0 dmg** chaque fight, sans navigateur.

## 4. Quick start combat (navigateur)
1. Connexion jeu
2. F12 → Console
3. Coller `src/inject/combat-module.js` (v2.2 kite-first)
4. `GLCombat.arm()` puis engager un pack  
   ou `GLCombat.fightQuest('campagne:…')` / `GLCombat.walkToPack(packId)`

## 5. Quick start farm + navigation
1. Coller `src/inject/glbot.js` (et idéalement combat-module)
2. `GLBot.startFarm()` / `GLBot.walkTo({x,y})` / `GLBot.debugPath(x,y)`

## 6. Guides par système
| Guide | Contenu |
|-------|---------|
| [guide/testing.md](./guide/testing.md) | **Tests live / API pure / checklist IA** |
| [guide/combat.md](./guide/combat.md) | Combats FAUNE, log, IA 0-dmg |
| [guide/farm.md](./guide/farm.md) | Pathfinder, packs, boucle farm |
| [guide/world.md](./guide/world.md) | Rest, daily, harvest, fish |
| [guide/economy.md](./guide/economy.md) | Négoce, shop |
| [guide/quests.md](./guide/quests.md) | Objectifs campagne |
| [guide/sea.md](./guide/sea.md) | Voyage mer / navire |
| [guide/pvp.md](./guide/pvp.md) | Challenge / join |
| [guide/craft.md](./guide/craft.md) | Craft & contrats |
| [guide/factions-bounty.md](./guide/factions-bounty.md) | Primes, chasse, marine |
| [guide/xp-progression.md](./guide/xp-progression.md) | XP, campagne, auto-progress |

## 7. API
- [api/methods.md](./api/methods.md) — 387 méthodes client
- [api/catalog.md](./api/catalog.md) — routes
- [api/combat-endpoints.md](./api/combat-endpoints.md)

## 8. Preuves live
→ [sessions/README.md](./sessions/README.md)  
→ [sessions/2026-11-02/](./sessions/2026-11-02/) — API pure 0-dmg

## 9. Roadmap
→ [ROADMAP.md](./ROADMAP.md)
