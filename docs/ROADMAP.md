# Roadmap

Dernière synchro : 02/11/2026.

## Versions code

| Module | Fichier | Version |
|--------|---------|---------|
| GLCombat | `src/inject/combat-module.js` | **2.2.0** (kite-first, ensureHealthy) |
| GLBot | `src/inject/glbot.js` | **1.1.0** |
| pure_api_farm | `src/launcher/pure_api_farm.py` | **1.0** |
| headless_world | `src/launcher/headless_world.py` | **1.0** (move + farm sans navigateur) |

## Objectif compréhension

≥ 90 % opérationnel (route + 1 flux live bout-en-bout) par système — voir historique ci-dessous.

---

## Roadmap opérationnelle (fusion)

### Fait
- [x] Combat FAUNE API + IA v2.2 (kite-**before**-attack, estimates/PA, focus, LOS, GARDE once)
- [x] Multi-mobs anti-combo, wins **0 dmg** prouvés API pure (2026-11-02)
- [x] Canal test optimal documenté (`docs/guide/testing.md`, `pure_api_farm.py`)
- [x] **Déplacement map Socket.IO headless** (`headless_world.py`, 2026-11-02)
- [x] Pathfinder BFS walkable (GLBot 1.1)
- [x] Faune morts / engagees / freeFightAt 90s
- [x] Rest / daily / harvest / fish / coffres
- [x] Négoce vente + shop buy près PNJ
- [x] Travel mer (depart → cap → position → dock)
- [x] Quête prologue partielle (talk → fouille → combat miliciens)
- [x] PvP challenge / join documenté
- [x] Craft / contrats routes
- [x] Catalogue API 387 méthodes + sockets

### Méthodes (avant features)
- [x] methodology.md projet entier
- [x] tools capture/replay combat + REST générique
- [ ] fixtures hors combat (quête, map walkable)
- [ ] CLI unique glbot

### En cours / prioritaire
- [ ] Boucle quête campagne complète (prologue West Blue)
- [ ] Farm loop unifiée : pathfinder + skip morts/engagees + GLCombat
- [ ] Claim tâches daily auto
- [ ] Auto-pickup ground drops

### Plus tard
- [ ] AOE quand sorts AOE en deck
- [ ] Formule dégâts serveur (optionnel — estimates suffisent)
- [ ] Combat mer automatisé bout-en-bout
- [ ] PvP bot (hors scope farm)

---

## Annexe — détail objectif 90 % par système

# Roadmap compréhension 90 % minimum — par système

Objectif : ≥ 90 % opérationnel (routes + 1 flux live réussi bout-en-bout) pour chaque système.

## Ordre d’exécution

| # | Système | Cible 90 % | Critère “done” | Priorité |
|---|---------|------------|----------------|----------|
| 1 | Quête campagne | talk→search→combat→suite | Fin prologue West Blue acte 1 ou 3 étapes après miliciens | EN COURS |
| 2 | Combat | farm + quête stables | 5 wins d’affilée fightQuest / arm | ~90 % |
| 3 | Shop | achat réel | 1 achat près PNJ vendeur | |
| 4 | Négoce | vente comptoir | 1 vente réussie | |
| 5 | Travel / navire | bout en bout | dock → travel → débarquement | |
| 6 | Craft | recette non nulle | 1 craft réussi | |
| 7 | PvP | challenge/accept | 1 duel lancé + accepté | |

## Progression live (01/11/2026)

### Quête
- Lin talk ✓ · Ganza talk ✓ · Affiches fouille ✓ · Miliciens combat ✓ (ALLIE)
- stage 123, accomplies 4, dernier pw1-miliciens
- Next : talk Ganza proximité (objectifs vides côté API)

### Combat
- GLCombat v2.1 : yourTurn top-level, fightQuest, move→cast
- Rest BELLE_ETOILE ✓

### Pathfinder
- BFS chunks 20, nearestWalkable ✓

## Méthode
Toujours : test live → doc archive → code → changelog. Pas d’hypothèse livrée.

