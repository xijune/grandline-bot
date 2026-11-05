# Quête Ohara suite — live 01/11/2026

## Progression

| Step | ID | XP | Notes |
|------|-----|-----|-------|
| severin | pw2-severin | +35 | stage 132 · level 5 |
| receleurs | campagne:pw2-receleurs | combat ×3 lvl 10 | en cours |

## Combat — format action corrigé

```
POST /api/battles/{id}/action
{
  characterId,
  kind: "ATTAQUE" | "TECHNIQUE" | "GARDE" | "FUITE" | "OBJET" | "SE_LIBERER",
  id: "<skillId>",          // pour TECHNIQUE
  targetId,
  targetCell
}
```

- `skillId` seul → 400 (kind obligatoire)
- Placement → engage → yourTurn top-level
- Ennemis lvl 10 vs perso lvl 5 : risque élevé (1 défaite live)

## État

- map: ohara
- campaign stage 132 · accomplies 13 · dernier pw2-severin
- objectif combat actif 72,36
- berries ~2306 · level 5 · xp 925

## Next

1. Rest BELLE_ETOILE + re-fight receleurs avec kind correct
2. Craft
3. Contrats
