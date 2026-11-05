# Exploration mer West — tests live complets 01/11/2026

## Cap sans destination

```
POST /sea/depart { mode:"navire", sortie }
→ atSea.capIslandId = null   // = sans cap / libre
```
Pas d’endpoint spécial : **partir sans appeler /sea/cap**.

Discoveries augmentent en explorant (12 → 21).

---

## Grille West Blue

```
grid: { cols: 6, rows: 4 }
tile id: sea-west-{col}-{row}
```

Exploré free-roam col/row 0–5 / 0–3.

---

## foeId format (CONFIRMÉ LIVE)

```
sea-{seaId}-{col}-{row}-{kind}-{index}

Exemples live :
  sea-west-3-3-banc-0     → BANC
  sea-west-3-3-baril-0    → BARIL (existe)
  sea-west-3-3-baril-1    → BARIL (existe)
  sea-west-3-3-epave-0    → EPAVE (existe)
  sea-west-3-3-roi-0      → ROI_DES_MERS (existe)
  sea-west-3-3-bouteille-0 → absent sur cette case
```

---

## Interactions live validées

### BANC — SUCCESS
```
POST /sea/salvage { foeId:"sea-west-3-3-banc-0", col:3, row:3 }
→ 200
kind: "BANC"
name: "Banc de poissons"
loot: [{ id:"poisson-commun", name:"Poisson de port", quantity:2 }]
UI bouton: "Jeter le filet"
```
Inventaire après : poisson-commun ×5

### BARIL — existe (proximité)
```
→ 409 "Approche-toi davantage."
UI: "Repêcher le baril"
```

### EPAVE — existe (proximité)
```
→ 409 "Approche-toi davantage."
```

### ROI_DES_MERS — existe (proximité)
```
salvage → 409 "Ça ne se fouille pas : ça se canonne"
hunt    → 409 "Approche-toi du monstre."
foeId: sea-west-3-3-roi-0
UI: "Chasser · prime du jour" (hidden tant que trop loin)
Visible UI: "Serpent des mers" / "En vue : un Roi des Mers"
```

### NAVIRE (abordage)
```
UI: "Aborder 2 % de coque · monte à la lame"
→ coque ≤60% = sans grappin
button.sea-aborder (hidden hors portée)
```

---

## Combat / navigation UI haute mer

| Élément | Observé |
|---------|---------|
| Mode | manuel / Auto |
| Voilure | 75% |
| Vitesse | jusqu’à 5.0 c/s |
| Tir | Tir auto / Tir manuel |
| Rafistoler | consomme repair-kit |
| combatReclameS | 8.64 (timer combat) |
| position body | `{ hull, tirs:{} }` |
| Chasseurs de primes | alerte "4 cases" |

Aggro / circle blanc = zone d’interaction.

---

## Messages serveur clés

| Action | Message |
|--------|---------|
| Trop loin fouille | Approche-toi davantage. |
| Trop loin hunt | Approche-toi du monstre. |
| ROI en salvage | Ça ne se fouille pas : ça se canonne |
| Foe absent | Il n’y a rien de tel dans ces eaux |
| Hunt absente | Aucun monstre à chasser ici. |
| Broadside UUID fake | Ce capitaine n’existe pas |

---

## État compte après session

| | |
|--|--|
| discoveries | **21** / next 25 |
| huntAvailable | true |
| hull | 37 |
| poisson-commun | 5 |
| bois-brut | 3 |
| grappin | 1 |
| berries | ~60k |
| cap | null (libre) |

---

## Boucle bot mer (concrète)

```
1. depart sans cap (capIslandId null)
2. position scan cells
3. foeId = sea-west-{col}-{row}-{kind}-{i}
4. salvage banc/baril/epave/bouteille si proche
5. hunt roi-0 si huntAvailable && proche
6. board navire si coque≤60% ou grappin
7. patch si hull bas
```
