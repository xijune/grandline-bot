# Règles combat mer — confirmées client + live 01/11/2026

## 1. Hunt Roi des Mers (journalière) — CONFIRMÉ

```
GET /sea/journal/{id}
  huntAvailable: true  → prime dispo
  huntAvailable: false → "Prime de cette mer remportée aujourd’hui"

UI: "Chasser · prime du jour" / "Approche un monstre puis choisis Chasser"
POST /sea/hunt { characterId, foeId }
  foeId = id d’une entité kind === "ROI_DES_MERS" à portée (rayonCorps+7)
Reward: 1200฿ + 60 XP
```

**Une fois par jour / par mer** (flag serveur `huntAvailable`).

Live compte test : `huntAvailable: true` (pas encore fait aujourd’hui).

---

## 2. Attaque navires (joueurs + mobs NAVIRE) — CONFIRMÉ

| Action | API |
|--------|-----|
| Tir canons | `POST /sea/broadside { characterId, targetId, ammo, heading, angle, pull }` |
| Abordage (mobs/navires) | `POST /sea/board { characterId, foeId, seconds, auGrappin, col, row }` |
| Abordage joueur | `POST /sea/player-board { characterId, targetId }` |

Live : barque **canons: []**, slots **[]** → pas de tir tant que sabords non armés à quai.

```
GET  /world/ship/canons/{id}
POST /world/ship/canons { characterId, slot, itemId }  // à quai seulement
  tiers: canon-leger 6000฿ · canon-moyen 45000฿ · …
```

---

## 3. Abordage — 2 voies — CONFIRMÉ (seuil corrigé)

Client `By = 0.6` (60 %, **pas 50 %**) :

```js
function canBoard({ foe, partDeCoque, auGrappin, aUnGrappin }) {
  if (!foe) return "Il n’y a personne à aborder.";
  if (foe.kind !== "NAVIRE") return "On n’aborde pas une bête : elle n’a pas de pont.";
  if (auGrappin) return aUnGrappin ? null : "Il te faut un grappin pour monter sur une coque intacte.";
  if (partDeCoque > 0.6)
    return `Sa coque tient encore (${%}). Descends-la sous 60 %, ou monte au grappin.`;
  return null; // OK sans grappin
}
```

| Situation | Besoin |
|-----------|--------|
| Coque adverse **> 60 %** | **grappin** en inventaire (`itemId: "grappin"`) |
| Coque adverse **≤ 60 %** | aborder sans grappin (« monte à la lame ») |
| kind ≠ NAVIRE (ROI_DES_MERS, etc.) | **impossible** d’aborder |

UI labels :
- grappin + coque intacte → `Aborder au grappin · N en cale · sa coque est intacte`
- coque ≤60 % → `Aborder · XX % de coque · monte à la lame`

---

## État compte test

| | |
|--|--|
| canons | [] (barque slots vides) |
| grappin | 0 en inv |
| huntAvailable | true |
| ship | L’Alizé / barque / hull 93 |

Pour valider bout-en-bout live : grappin + canon à quai, puis engagement NAVIRE.
