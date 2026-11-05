# GrandLine Online Bot

Bot d’automatisation pour [GrandLine Online](https://grandline-online.fr) (MMORPG navigateur Phaser 3).

Injection JS dans le client + appels API authentifiés (JWT Bearer).  
Combat FAUNE validé live (mono / multi-mobs, **0 dégâts** — kite-first v2.2).
Tests optimaux **sans navigateur** : `python src/launcher/pure_api_farm.py`.

**Première lecture :** [docs/START.md](docs/START.md) → [docs/guide/methodology.md](docs/guide/methodology.md) → [docs/guide/testing.md](docs/guide/testing.md)

---

## Structure

```
grandline-bot/
├── README.md
├── CHANGELOG.md
├── requirements.txt          ← Selenium (launcher)
├── config/config.example.js
├── docs/
│   ├── START.md              ← commencer ici
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   ├── guide/                ← vérité gameplay actuelle
│   │   ├── combat.md
│   │   ├── farm.md
│   │   ├── world.md
│   │   ├── economy.md
│   │   ├── quests.md
│   │   ├── sea.md
│   │   ├── pvp.md
│   │   └── craft.md
│   ├── api/                  ← référence routes / méthodes
│   ├── data/                 ← JSON stables (états, sockets, techniques)
│   ├── sessions/             ← preuves live datées
│   ├── history/              ← RE / discoveries chronologiques
│   └── reference/            ← ancien script combat user
├── tools/                   ← capture + replay offline (méthodo)
├── tests/                   ← régression fixtures/goldens
├── src/
│   ├── inject/
│   │   ├── combat-module.js  ← GLCombat v2.2 (kite-first)
│   │   └── glbot.js          ← GLBot v1.1 (farm + pathfinder)
│   └── launcher/
│       └── selenium_login.py
└── scripts/
    ├── probe_api.js
    └── quick_inject.js
```

---

## Démarrage rapide

### Combat (recommandé)

1. Se connecter sur le jeu et entrer en monde  
2. F12 → Console  
3. Coller le contenu de `src/inject/combat-module.js`  
4. Lancer :

```js
GLCombat.arm();
// ou
GLCombat.walkToPack("pack-id");
GLCombat.fightQuest("campagne:pw1-miliciens");
GLCombat.stats();
```

### Farm + navigation

Coller `src/inject/glbot.js` (idéalement après GLCombat) :

```js
GLBot.startFarm();
GLBot.walkTo({ x: 79, y: 92 });
GLBot.debugPath(79, 92);
GLBot.escapeBlockedCell();
GLBot.stopFarm();
```

### Launcher Selenium (optionnel)

```bash
export GL_EMAIL=...
export GL_PASSWORD=...
pip install -r requirements.txt
python src/launcher/selenium_login.py
```

---

## Règles combat (rappel)

| Règle | Détail |
|-------|--------|
| ATTAQUE base | range **1** côté serveur |
| Techniques | `geometry.range` (ex. Tir précis = 6) |
| Payload `/action` | `characterId` + `kind` obligatoires |
| Tour | `yourTurn` **top-level** sur le state |
| Berries | lire `GET /api/characters` (UI souvent stale) |

Détail : [docs/guide/combat.md](docs/guide/combat.md)

---

## Versions

| Module | Version |
|--------|---------|
| GLCombat | 2.1.0 |
| GLBot | 1.1.0 |

Voir [CHANGELOG.md](CHANGELOG.md) et [docs/ROADMAP.md](docs/ROADMAP.md).
