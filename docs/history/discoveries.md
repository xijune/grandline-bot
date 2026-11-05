# Découvertes techniques – GrandLine Online

Date des tests : 30 octobre 2026  
Compte de test : Bukima (junymine4)

---

## 1. Architecture du client

| Élément              | Valeur / Observation                          |
|----------------------|-----------------------------------------------|
| Framework            | **Phaser 3**                                  |
| Rendu                | Canvas (plusieurs)                            |
| Sprites              | LPC (Liberated Pixel Cup)                     |
| Réseau               | Socket.IO                                     |
| API REST             | `https://api.grandline-online.fr`             |
| Scène principale     | `window.__grandlineScene`                     |

Fichiers JS importants chargés :
- `phaser-*.js`
- `net-*.js` (module réseau)
- `world-data-*.js`
- `quetes-*.js`

---

## 2. Accès à l'état du jeu

### Joueur
```js
const c = window.__grandlineScene.character;
// c.id, c.name, c.x, c.y, c.level, c.berries, c.bounty, c.dead, c.faction, c.race...
```

### Monstres (fauna)
```js
const packs = window.__grandlineScene.network.fauna.packs;
// packs[].id
// packs[].ancre = {x, y}
// packs[].mobs[] = { id, espece, niveau, orbit: {cx, cy, ...} }
```

Exemples d'espèces observées :
- `chien`
- `rat`
- `mercenaire`
- `loup-de-justice`

### Autres objets intéressants
```js
scene.network.socket          // Socket.IO
scene.network.fauna.morts
scene.network.fauna.engagees
scene.network.groundDrops
scene.network.population
scene.entities                // Map des entités
scene.combat                  // État de combat (si actif)
```

---

## 3. Fonctions internes utiles

| Fonction                        | Signature / Comportement                              |
|--------------------------------|-------------------------------------------------------|
| `scene.attackFaunaPack(packId)`| Lance l'attaque sur un pack de monstres               |
| `scene.moveLocal(path, opts)`  | Déplace le joueur. `path = [{x,y}, {x,y}, ...]`       |
| `scene.network.move(path, opts)`| Envoie le mouvement au serveur via socket            |
| `scene.handleClick(pointer)`   | Gestionnaire de clic souris                           |
| `scene.toGrid(screenX, screenY)`| Conversion écran → grille                            |
| `scene.toScreen(gridX, gridY)` | Conversion grille → écran                             |
| `scene.showPath(path)`         | Affiche le chemin en preview                          |
| `scene.confirmationDattaqueDemandee()` | Retourne true si confirmation demandée      |
| `scene.proposerLeCombat(...)`  | Affiche la popup de confirmation                      |
| `scene.enterCombat` / `leaveCombat` | Gestion de l'état combat                         |

### Mouvement (détail)
```js
// path doit avoir au moins 2 points
await scene.moveLocal([
  { x: 61, y: 85 },
  { x: 63, y: 84 }
]);
```

Le serveur est appelé via :
```js
socket.emitWithAck("player:move", { path, courir, sauter })
```

### Attaque (détail)
```js
// Peut afficher une popup de confirmation
await scene.attackFaunaPack("ilusia-groupe-5-g298");
```

Pour bypasser la confirmation :
```js
scene.confirmationDattaqueDemandee = () => false;
```

Il existe un cooldown (« Reprends ton souffle ») après un combat.

---

## 4. Événements Socket.IO observés

```
$world:snapshot
$player:moved
$player:stopped
$player:emote
$player:left
$world:population
$world:relocated
$brume:etat
$world:entre
$world:maj
$ground-drop:created
$ground-drop:removed
$fauna:updated
$donjon:*
$resource:updated
$halloween:*
$chat:message
$chat:whisper
$duel:*
$character:dead
```

---

## 5. Endpoints API REST (extraits)

```
POST /api/auth/login
GET  /api/characters
GET  /api/characters/{id}/daily
GET  /api/characters/{id}/chests
GET  /api/world/config
GET  /api/world/recherches
GET  /api/world/planches
GET  /api/crews/social/fil?characterId=...
GET  /api/crews/duel-amical/etat?characterId=...
GET  /api/party/mine?characterId=...
GET  /api/coffres/{id}
GET  /api/affaires/{id}
GET  /api/halloween/public
```

Character ID de test : `37762d71-bf5c-48ec-8092-de390221be4e`

---

## 6. UI / Sélecteurs DOM utiles

| Élément                     | Sélecteur / Texte                     |
|----------------------------|---------------------------------------|
| Bouton login               | `button.embark-button`                |
| Champ email/pseudo         | `input[name="email"]`                 |
| Champ password             | `input[name="password"]`              |
| Bouton JOUER (hub)         | `button.hub-jouer`                    |
| Fermer popup               | `button.modal-close`                  |
| Passer le guide            | bouton contenant « Passer le guide »  |
| Confirmer combat           | `button.confirmer-combat`             |
| Barre de sorts             | classes `barre-case`, `barre-onglet`  |

---

## 7. Système de Forme & Repos (PV)

| Élément | Valeur |
|---------|--------|
| Forme (0-100) | `character.vitality` |
| HP actuel | `character.currentHp` |
| Labels forme | ≥85 En pleine forme · ≥60 Un peu marqué · ≥35 Fatigué · >0 Épuisé |

### Types de repos (testés en live 30/10/2026)

UI : `button.open-rest` → panneau « Se reposer »  
Boutons : `button[data-rest="KIND"]`

| Kind | Description | Coût | Notes |
|------|-------------|------|-------|
| `NAVIRE` | Couchette du navire | Gratuit | Besoin d’un navire (`ship.owned`) |
| `BELLE_ETOILE` | À la belle étoile | Gratuit | Cap forme ~50/100 ; peut restaurer des PV |
| `AUBERGE` | Chambre d’auberge | Payant / taverne | **Ignoré par le bot** |

> La forme décide des PV avec lesquels on entre en combat.

API sous-jacente : `POST /api/world/rest` `{ characterId, kind }`  
Token : `sessionStorage.getItem("grandline-token")`

Le bot utilise l’UI (plus fiable) : ouvre le panneau → clique le premier `data-rest` gratuit disponible.

---

## 8. Combat tour par tour (style Dofus)

### Types de combat
| kind | Origine | Cooldown entre combats |
|------|---------|------------------------|
| `FAUNE` | Mobs sur la map (`attackFaunaPack`) | **Non** |
| (random menu) | Bouton Combattre du menu | Oui (~50 s) |

Le bot **ne lance que du FAUNE** via `scene.attackFaunaPack(packId)`.

### État live
```js
scene.combatState.kind          // "FAUNE"
scene.combatState.yourTurn
scene.combatState.fighters[]    // team ALLIE / ENNEMI, hp, faune
scene.combatState.actions[]     // ATTAQUE, TECHNIQUE, GARDE, FUITE + estimates
scene.combatState.tactics.positions[id] = {x,y}
scene.combatState.tactics.ap / mp
```

### API battles
```
POST /api/battles/start
POST /api/battles/:id/action   { characterId, ... }
POST /api/battles/:id/move     { characterId, cell }
POST /api/battles/:id/end-turn
GET  /api/battles/:id
```

### Phases
1. Placement (cases bleues) → bouton **Prêt**
2. Tours : PA/PM, sorts, déplacement grille
3. **Fin du tour** / **Fuir**

Message si trop loin : « Le groupe est trop loin : approche-toi d'abord »

---


## 8b. Loot & récompenses de combat FAUNE

À la **victoire** d’un combat map (`kind: "FAUNE"`) :
- **Loot** → directement dans l’inventaire si de la place (pas de ramassage au sol obligatoire)
- **Berries** (monnaie) → crédités automatiquement
- Si inventaire plein → loot probablement perdu / non reçu (à confirmer)

Conséquence bot : pas besoin d’auto-loot `groundDrops` pour les rewards de combat.
`groundDrops` reste utile pour objets laissés au sol hors combat.

Suivi simple après combat :
```js
const before = { berries: scene.character.berries, inv: scene.character.inventory };
// ... runCombat ...
const after = { berries: scene.character.berries, inv: scene.character.inventory };
```

---
## 9. Limitations actuelles

- Pathfinding map : chemin 4-dir OK ; obstacles gérés partiellement via `redresserLeChemin`.
- Exécution des sorts en combat encore basée UI (pas 100 % API action).
- Positions fauna = ancres de patrouille approximatives.
- `BELLE_ETOILE` désactivé si forme > ~50 ; `NAVIRE` sans navire.

---

## 10. Pistes pour le niveau 1 (WebSocket)

Le socket est accessible :
```js
const socket = window.__grandlineScene.network.socket;
socket.emitWithAck("player:move", { path: [...], courir: false });
```

Prochaine étape intéressante : écouter `$fauna:updated` et `$player:moved` pour avoir un état synchronisé en temps réel.

---

## 11. Inventaire & groundDrops (confirmé live 30/10/2026 – compte Bukima)

### Inventaire (structure réelle)
```js
character.inventory = {
  bagCapacity: 24,      // slots de base
  bonusCapacity: 0,    // bonus éventuels
  fruitCapacity: 0,
  items: [              // objets dans le sac
    { id: "slingshot", name: "Lance-pierre renforcé", quantity: 1 },
    // ...
  ]
}
```
- **max** = `bagCapacity + bonusCapacity`
- **used** = `items.length`
- Plein quand `used >= max`

Équipement séparé : `character.equipment` (slots nommés : arme, armure, …).

### Ground drops
`scene.network.groundDrops` — array (vide au moment du test).  
Clés réseau confirmées : `fauna`, `groundDrops`, `population`, `recoltes`, `mapBattles`, `socket`, …

### Autres champs utiles
- `character.vitality` / `hpVitality` (forme 0-100) — observé 22
- `character.currentHp` (observé 1 — champ à surveiller, UI cœur peut différer)
- `character.ship.owned` (false sur ce compte → pas de repos NAVIRE)
- `button.open-rest` présent en jeu
- Fauna packs : `id`, `ancre.{x,y}`, `mobs[].{espece, niveau, orbit.{cx,cy,...}}`

---

## 12. Validations live complémentaires (30/10/2026)

### HP affiché
- DOM fiable : `document.querySelector("b.coeur-pv").textContent` (ex. `"184"`)
- `character.currentHp` souvent **stale à 1** → ne pas s'y fier pour engager
- Parent : `.bandeau-coeur`

### Forme / repos
- Panneau : `button.open-rest` → `button[data-rest="BELLE_ETOILE"|"NAVIRE"|"AUBERGE"]`
- BELLE_ETOILE : gratuit, plafond **50/100**, restaure aussi les PV combat
- Après repos, `character.vitality` peut rester stale ; le bot force 50 après BELLE_ETOILE
- NAVIRE : `character.ship.owned === false` → bouton disabled
- AUBERGE : disabled hors île avec taverne

### Mouvement
- `moveLocal(path, pendingArrival, {courir, sauter, redresser})` — path cases orthogonales
- Chemins **courts** (1–4 cases) fiables ; longs chemins (>12) souvent ignorés
- Position live : `entities.get(character.id).x/y` (character.x/y en retard)
- `network.move` → socket `player:move` ; chemin invalide si mal formé

### Pickup
- `scene.pickupGroundDrop(id)` **existe** (typeof function)
- `network.groundDrops` = array

### Fauna Ilusia (échantillon)
| Pack | Espèce | Niveau | Ancre approx |
|------|--------|--------|--------------|
| ilusia-groupe-1 | chien | 1 | 46,34 |
| ilusia-groupe-2 | vautour | 2 | 119,44 |
| ilusia-groupe-3 | rat | 1 | 42,52 |
| ilusia-groupe-4 | loup-de-justice | 1-2 | 120,72 |
| ilusia-groupe-5 | mercenaire | 3 | 40,76 |

→ garder mercenaire dans avoidSpecies

### Loot FAUNE confirmé (utilisateur + client)
À la **victoire** d’un combat map `kind: "FAUNE"` :
- Loot → **directement dans** `character.inventory.items` si place (`bagCapacity + bonusCapacity`)
- **Berries** crédités sur `character.berries`
- Pas de ramassage sol obligatoire pour les rewards de combat
- Si inventaire plein → loot probablement perdu / non reçu

Le bot (v0.8.2) snapshot inventaire+berries avant combat, diff après, log les gains et incrémente `SESSION.itemsLooted` / `berriesGained`.

### Attaque FAUNE – condition réelle (v0.8.3)
`attackFaunaPack(packId)` ne fait rien si le pack n’est **pas** dans `scene.faunaEntities` (Map).

```js
// Source client (extrait live)
async attackFaunaPack(t) {
  if (this.faunaEngagees?.has(t)) { /* toast déjà en combat */ return; }
  const n = this.faunaEntities?.get(t);
  if (n) {
    if (!this.confirmationDattaqueDemandee()) {
      this.onFaunaAttack(t);
      return;
    }
    this.proposerLeCombat(t, n);
  }
}
```

- `network.fauna.packs` = tous les packs de la zone (info)
- `faunaEntities` = packs **chargés / proches** (attaquables)
- Le bot filtre donc sur `attackable === true` (présence dans faunaEntities)

---

## 13. Analyse combat complète (31/10/2026)

Voir **`docs/guide/combat.md`** et **`docs/data/techniques.json`** (330 techniques).

Résumé :
- Combat tour par tour, PA/PM, placement, estimates serveur `{min,max}`
- Catalogue aspirations (SABREUR, TIREUR, COMBATTANT, …) + races
- Types : TRANCHANT, TIR, CONTONDANT, ELEMENTAIRE, SONIQUE, SOIN, SOUTIEN
- Effets : poser-etat, poussee, retrait-pm/pa, bouclier, glyphe, …
- Défaite FAUNE : perte berries (~6–7) ; victoire : loot inv + berries
- API : `/api/battles/:id/{action,move,placement,end-turn,...}`

### Runtime combat (live 31/10)
- PA=6 PM=3, maxHp=237, résist. générale 8 %
- Deck TIREUR + race Lunaria + skill arme
- Estimates + **critMin/critMax** + mastery branche PORTEE
- Voir `docs/combat_live_sample.json` et section 13 de `docs/guide/combat.md`

### Mob Rat des chantiers
- HP 87, PA6 PM3, initiative 25, résist 0
- Technique unique : Poing de fer (CONTONDANT pwr 1.3, range 1)
- Capture via `POST /api/battles/start` (hook fetch)

### Controller combat UI
- `scene.combat.screen.cellClick` / `fighterClick` = chemin officiel
- `tactics.reachable[]` = `{x,y,cost,taclePm,taclePa}`
- Bot v0.8.7 branché dessus

### Script user combattourpartour V18
- IA pure API tour-par-tour validée en prod
- Intégrée dans glbot 0.9.0 (sweet spot, kite, finishers, targetCell)
- Ref : `docs/reference/combattourpartour.js`

---

## Session 31/10 — wins + navigation

### Berries
- DOM et scene.character.berries souvent stale
- Source de verite : GET /api/characters → berries

### Navigation map
- moveLocal path 1 case : souvent bloque (arbres)
- Path 8–12 cases : avance fiable
- Longue distance : cibler mob.orbit.cx/cy (pas iso container)

### Packs multi-mobs (Ilusia)
- groupe-2 : 2x vautour
- groupe-4 : 2x loup-de-justice (niv 1+3)
- Start battle fauna:packId engage tout le pack

### Combat
- ATTAQUE base range 1 serveur
- Focus fire multi valide
- 2 vautours : 6x Tir precis, 0 dmg, +185 berries

### Dump combatState complet (31/10)
- Fichier : `docs/sessions/2026-10-31/combat_knowledge_dump.json`
- Ennemis exposent techniques + caracs (PA/PM/initiative/résistances)
- Estimates: min/max/critMin/critMax
- Tir précis = meilleur avg/PA (20.5) ; Flamme dorsale très faible (5.8)
- secondesParTour: 30 ; obstacles + hazards dans tactics

### Log CAST/DAMAGE/DOWN/END (31/10)
- Types complets documentés dans combat.md §23
- Crits observés 67–70 vs normal 40–44 (Tir précis)
- Loot API: viande-de-gibier, plumes, peau-tannee, minerai-fer, ble

### Defense log + combos (31/10)
- DAMAGE entrant meme schema (amount, critical, damageType)
- Combo multi-mobs: "Frappe conjointe" avec combo:true (absent de techniques[] initial)
- Tank volontaire multi-vautours → 6/237 HP

### GUARD / GARDE (31/10)
- Log type GUARD
- Status {id:GARDE, turns:1, stack:1, force:1}
- Pas de bouclier HP ; dure 1 tour
- hazards ~99, obstacles ~111 sur map combat plage

---

## Session exploration monde (31/10 après-midi)

### Faune — respawn
- `network.fauna.packs[]` : `{ id, slot, generation, ancre, echelle, mobs }`
- `network.fauna.morts[packId]` = **timestamp respawn** (si `morts[id] > now` → pack pas encore dispo)
- `network.fauna.engagees[]` = packIds en combat
- Statuts pack (socket/update) : `ENGAGEE`, `ABATTUE`, `REPEUPLEE`
- Client `FH()` sépare packs en `poser` / `attendre` (respawn) / ignore engagees

### Cooldown combat libre
- `character.freeFightAt` / `combatLibreA`
- Délai client **90 s** (`delaiSecondes: 90`)
- Texte UI : prêt → « XP et butin, sans berrys » / sinon timer

### Récoltes
- `network.recoltes[]` : `{ id, repousseAt }` (ex. `herbes-109-95`, `arbre-120-83`, `nasse-131-97`)
- Scene : `onHarvest`, `recoltesDuMonde`, `eclatsDeRecolte`
- API : `POST /api/characters/:id/harvest` (via client)

### Inventaire / sol
- `POST /api/characters/:id/inventory/pickup` body `{ dropId }`
- `POST /api/characters/:id/inventory/discard`
- `network.groundDrops[]` (souvent vide si rien au sol)
- Scene : `onPickup`, `groundDropSprites`, `groundDropsPicking`

### Compteurs
```json
"compteurs": { "ventes-au-comptoir": 7, "combats-gagnes": 8, "betes-abattues": 13 }
"compteursDuJour": { "jour": "2026-10-31", "valeurs": { "combats-gagnes": 8, "betes-abattues": 13 } }
"farm": { "islandId": "ilusia", "count": 1, "at": <ts> }
```

### Banque
- `character.bank` : balance, prêt (`loan.principal/amount/dueAt`), journal EMPRUNT

### Population
- `network.population.total` + `byIsland` (toutes les îles listées)

### Autres systèmes scene (non creusés en profondeur)
- Halloween (`cranes`, chests, boss)
- Navire / dock / embark
- Quêtes objectifs (`loadQuestObjectives`, `objectiveRoute`)
- PvP challenge / bribe / hunt
- Météo, zoan forme, haki train
- Craft, fish, treasure dig

### API utile bot (confirmé ou extrait bundle)
| Route | Usage |
|-------|--------|
| POST /api/battles/start | Engager faune |
| GET /api/battles/active/:charId | Combat en cours |
| POST /api/world/rest | Repos |
| GET /api/world/rest/:charId | État repos? |
| POST /api/characters/:id/inventory/pickup | Ramasser drop |
| POST /api/characters/:id/harvest | Récolte |
| GET /api/characters | berries, inventory, compteurs |
| POST /api/battles/pvp/challenge | PvP |
| POST /api/battles/halloween | Event |

Catalogue complet : `docs/api/catalog.md`

---

## Rest state API + daily + harvest live (31/10)

### GET `/api/world/rest/:characterId`
```json
{
  "vitality": 42, "vitalityMax": 100, "label": "Fatigué",
  "hp": {"current": 203, "max": 262},
  "freeSleep": {"readyAt": null, "waitMs": 0},
  "inn": {"available": false, "price": 900, "recovery": 58, "hpRecovery": 59},
  "ship": {"available": false, "cap": 75},
  "rough": {"available": true, "gain": 8, "cap": 50}
}
```
- BELLE_ETOILE = rough sleep (vitality vers cap 50)
- Inn payant quand available

### Harvest île
- `POST /api/characters/:id/harvest` → loot + `nextHarvestAt`
- CD ~2 min (HTTP 429 message clair)
- Loot testé : peau-tannée, baies-sauvages

### Daily
- `GET /api/characters/:id/daily` : calendar, roulette, **taches**
- `POST .../daily/claim` → reward jour (testé : Ration ×5)
- Tâches live : combats (3/3 faite), pêche, quêtes — récompenses xp+berrys
- Bonus si toutes tâches faites

### Sockets observés
`players:moved`, `world:maj`, `world:entre`, `world:population`, `player:left`

### Farm filters confirmés
- Skip `fauna.engagees`
- Skip `fauna.morts[id] > now`

---

## Taches / pêche / coffres / haki (31/10)

### Daily tâche claim
```
POST /api/characters/:id/daily/taches/:taskId/reclamer
```
Testé `combats` → **+64 XP, +140฿**, `reclamee: true`.

### Pêche
```
POST /api/characters/:id/fish
```
- Nécessite d’être **au bord / dans l’eau** sinon 409
- Succès : `{ caught: { id, name, quantity, nextAt } }`
- Testé en (125,44) eau : **algue-marine** ×1
- Fait progresser la tâche daily `peche` (0→1)

### Haki
```
POST /api/characters/:id/haki/train  { "voie": "observation"|"armament" }
```
→ 409 : *« Le Haki ne s’enseigne pas : il se gagne au combat. »*

### Coffres île
```
GET /api/characters/:id/chests
→ { islandId, remaining, chests: [{id,x,y,opened,revientDans,allure}] }
POST .../chests/open { chestId }
```
Ilusia : 3 coffres, tous ouverts, respawn via `revientDans` (ms).

### Quêtes objectifs
- `GET .../quest-objectives` → `{ mapId, objectifs[] }` (vide sur Ilusia hors marqueur)
- `POST .../quest-search` exige `objectifId`

---

## Reverse engineering batch (31/10 soir)

- 387 méthodes API client documentées (`api_methods.md`)
- 99 events socket (`archive/socket_events.json`)
- 65 états (`archive/etats_list.json`)
- Affaires : achat gratuit +500฿ live
- Collection coffres (2 bois en attente, boutique prix)
- `fauna:updated` + `battle:opened/closed` capturés live
- Shop rayons répondent mais items[] vides (contexte PNJ?)
- mapData / cityMap structure extraite
- Doc maître : `docs/history/reverse_engineering.md`
