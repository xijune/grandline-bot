# Quête campagne — validation live 01/11/2026

Compte : junymine4 / Bukima · map ilusia

## Route exacte validée

```
POST /api/characters/{characterId}/campaign/talk
Body: { "npc": "npc-lin-la-voyageuse" }
Header: Authorization: Bearer <token>
```

Champ obligatoire : **`npc`** (string).  
Autres noms (`npcId`, `id`) → 400 INVALIDE.

## Proximité

Sans être assez proche → **409** `"Approche-toi d’abord."`  
Ganza (99,65) : case PNJ **bloquée** dans `movementBlocked` → marcher sur case libre adjacente (99,66) suffit.

## Flux prologue West Blue (ilusia) — live

| Étape | NPC | id objectif | XP | Position | Résultat live |
|-------|-----|-------------|-----|----------|---------------|
| 1 | Lin la voyageuse | `pw1-lin` | 15 | 79,92 | **OK** talk |
| 2 | Ganza le garde | `pw1-ganza` | 15 | ~99,66 | **OK** talk |
| 3 | Aliss la guide | (affiches forêt) | ? | 120,92 | à faire |

### Réponse talk réussie (extrait)

```json
{
  "resolved": [{
    "id": "pw1-lin",
    "type": "TALK",
    "npc": "npc-lin-la-voyageuse",
    "title": "La voyageuse du port",
    "text": "Tu débarques à Ilusia… Va te présenter au sergent Ganza…",
    "rewards": { "xp": 15 },
    "act": "prologue-west-1-ilusia",
    "island": "ilusia"
  }],
  "progressed": null
}
```

### État character après Lin

```json
"campaign": {
  "stage": 120,
  "parcours": "west",
  "accomplies": 1,
  "dernier": "pw1-lin"
}
```

## quest-objectives

`GET /characters/{id}/quest-objectives` → `{ mapId, objectifs: [] }`  
**Ne liste pas** les objectifs campagne prologue (ils passent par `campaign/talk`).

## Pathfinder note

Cible = case PNJ souvent dans `movementBlocked` → BFS vers **nearestWalkable** autour du PNJ (rayon 1–2).

## Suite après Ganza (live)

- Position Aliss : 120,93 (case libre adjacente 120,92)
- `campaign/talk` Aliss → **200** mais `resolved: null` (pas d’étape TALK prête)
- État campaign :
  ```json
  { "stage": 121, "accomplies": 2, "dernier": "pw1-ganza", "parcours": "west" }
  ```
- Prochaine étape texte Ganza : affiches en forêt → probablement `quest-search` / objectif fouille, pas un simple talk

## XP

- Après Lin : xp 340 → (15) 
- Après Ganza : xp 355 (confirmé GET character)
