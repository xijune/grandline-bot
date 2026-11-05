# Factions, primes & chasse — cartographie + plan de tests multi-comptes

Document de travail (01/11/2026).  
Objectif : comprendre les flux **berries** liés aux rôles (Pirate / Marine / Révolutionnaire / Chasseur) et aux primes — **pas** contourner des protections hors jeu.

---

## 1. Factions (API)

```
POST /api/characters/{id}/faction
body: { "faction": "<FACTion>" }
```

Valeurs vues côté client : `PIRATE`, `MARINE`, `REVOLUTIONNAIRE` (et mentions `CHASSEUR` dans les textes chasse).

Bukima actuel : **PIRATE** (déjà validé live).

---

## 2. Prime / headPrice

Formule client `hq()` :
```js
// MARINE → headPrice = crossGuild (pas la bounty pirate classique)
// sinon → headPrice = bounty
function hq({ faction, bounty, crossGuild }) {
  return faction === "MARINE"
    ? Math.max(0, Number(crossGuild) || 0)
    : Math.max(0, Number(bounty) || 0);
}
```

Champs character utiles :
- `bounty` / `appelDeLaPrime`
- `headPrice`
- `hunted` (état de proie)
- `crossGuild`

UI : affiche `฿ {headPrice}` et badge Cross Guild si `huntable`.

---

## 3. Chasse (bounty hunt)

| Route | Rôle |
|-------|------|
| `GET /api/world/hunt/{characterId}` | Bureau / état chasse du perso |
| `POST /api/world/hunt/declare` | Déclarer une chasse |
| `POST /api/world/hunt/abandon` | Abandonner |
| `GET /api/sea/hunt` | Chasse en mer (lié) |

**Declare** (extrait client) :
- Body UUID : `{ characterId, targetId }` (si arg = uuid)
- Texte UI : *« Il a **cinq minutes** d’avance. »*

Constantes timing vues près de la formule (ms) :  
`5*60*1000` (5 min), autres 45s / 60s / 24h — à mesurer live (fenêtre d’avance, durée chasse, CD).

### Flux attendu (hypothèse à prouver)
1. Cible a une **prime** (`bounty` / `headPrice` > 0)  
2. Chasseur **declareHunt** sur `targetId`  
3. Cible a **5 min d’avance**  
4. Engagement PvP / assault → si victoire chasseur, **transfert de berries** lié à la prime ?  
5. Possible achat/don d’affiches wanted

---

## 4. Wanted (affiches)

| Route | Body / notes |
|-------|----------------|
| `GET /api/world/wanted/wall/{id}` | Mur d’affiches |
| `GET /api/world/wanted/folder/{id}` | Dossier |
| `POST /api/world/wanted/buy` | `{ characterId, targetId }` |
| `POST /api/world/wanted/give` | `{ characterId, targetId, posterId }` |

Coût d’achat d’affiche et lien exact avec le payout chasse : **à mesurer**.

---

## 5. Marine (économie de faction)

| Route | Rôle |
|-------|------|
| `GET /api/world/marine/desk/{id}` | Bureau marine |
| `GET /api/world/marine/registry` | Registre |
| `GET /api/world/marine/seuils` | Seuils grades |
| `POST /api/world/marine/appoint` | Nomination |
| `POST /api/world/marine/ban` | Ban jeu |
| `POST /api/economy/marine/tax` | Taxe |
| `GET/POST .../marine/funding` | Dotation |
| `POST /api/economy/marine/spend` | Dépense trésorerie |
| `GET /api/economy/marine/treasury` | Trésorerie |

Question éco : une Marine peut-elle **farm la trésorerie** / taxes plus vite que le farm FAUNE + `economy/sell` ?

---

## 6. Révolutionnaire

Moins de routes dédiées extraites ; probablement :
- même `changeFaction` → `REVOLUTIONNAIRE`
- quêtes faction : `POST .../faction-quest/complete`
- PvP / territoires selon `pvpParFaction`

À ouvrir avec le compte Révolutionnaire.

---

## 7. Plan de tests multi-comptes (tes 3 rôles)

### Comptes cibles
| # | Rôle | But du test |
|---|------|-------------|
| A | **Pirate** (Bukima existant) | Cible prime / farm classique contrôle |
| B | **Chasseur** (ou Pirate chasseur) | declareHunt → kill → mesurer Δ berries |
| C | **Marine** | desk, tax, funding, prime crossGuild |
| D | **Révolutionnaire** | quêtes faction, interactions PvP |

### Protocole chasse (mesures obligatoires)
1. Noter `bounty`, `headPrice`, `berries` des deux côtés **avant**  
2. `GET /api/world/hunt/{hunterId}`  
3. `POST /api/world/hunt/declare` `{ characterId: hunter, targetId: prey }`  
4. Logger réponse + timestamp (vérifier 5 min)  
5. Engagement combat (challenge PvP ou assault — noter la route exacte utilisée)  
6. Après fight : `berries`, `bounty`, `hunted` des deux  
7. **Δ berries chasseur vs prime affichée** = payout réel  
8. Cas limites :  
   - declare sans prime  
   - declare Marine → Marine  
   - abandon avant combat  
   - proie offline  
   - double declare

### Protocole Marine
1. Faction MARINE  
2. `marine/desk` + `treasury`  
3. Une action tax/funding si dispo  
4. Comparer gain net vs 15 min farm FAUNE + economy/sell  

### Ce qu’on cherche (design / imbalance, pas “cheat serveur”)
- Payout chasse **>** coût (affiche + temps + risque) → rentable  
- Boucle multi-comptes **ferme** (A se fait chasser par B, partage) : le jeu la permet-il ? sanctions ?  
- Marine treasury vs farm solo  
- Cooldown / anti-farm (même cible, même IP, etc. si visible)

---

## 8. Éthique / limites projet

- Comptes **à toi**, tests en jeu.  
- On documente les **mécaniques et chiffres**.  
- On n’automatise pas du harcèlement multi-comptes sur des joueurs tiers.  
- Bot chasse PvP = hors scope farm PvE tant que le payout n’est pas prouvé supérieur et stable.

---

## 9. Statut

| Élément | État |
|---------|------|
| Routes hunt / wanted / marine | extraites bundle |
| Formule headPrice client | OK |
| Payout berries réel chasse | **non mesuré** |
| Multi-faction live | **en attente de tes comptes** |

Dès que les 3 comptes existent : on enchaîne declareHunt instrumenté + tableau Δ฿.

---

## 10. Validation multi-comptes (02/11)

Voir `docs/sessions/2026-11-02/accounts_factions_scan.md`.

| Règle prouvée | Détail |
|---------------|--------|
| `canHunt` | **true** seulement si faction `CHASSEUR` |
| Niveau proie | **≥ 30** sinon 409 protection débutant |
| Guilde apprenti | plafond prime **100k**, 3 chasses → Pisteur |
| Marine treasury | ~98M ฿ serveur (pas créditée au recrue) |

Comptes test :
- Julifa `junymine6` MARINE
- Hankir `junymine7` REVOLUTIONNAIRE  
- Porgas `junymine8` CHASSEUR (`928cae40-c243-4470-849e-bf7db7c83791`)

---

## 10. Validation multi-comptes (02/11)

Voir `docs/sessions/2026-11-02/accounts_factions_scan.md`.

| Règle prouvée | Détail |
|---------------|--------|
| `canHunt` | **true** seulement si faction `CHASSEUR` |
| Niveau proie | **≥ 30** sinon 409 protection débutant |
| Guilde apprenti | plafond prime **100k**, 3 chasses → Pisteur |
| Marine treasury | ~98M ฿ serveur (pas créditée au recrue) |

Comptes : Julifa MARINE · Hankir REVOLUTIONNAIRE · Porgas CHASSEUR
