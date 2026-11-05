# Pathfinder walkable — validation live 01/11/2026

Compte : junymine4 / Bukima (ilusia)

## Preuve de déplacement

| Étape | Départ | Arrivée | Méthode |
|-------|--------|---------|---------|
| 1 | 124,44 | 112,44 | moveLocal ligne ouest 12 cases |
| 2 | 112,44 | 102,44 | moveLocal X-then-Y |
| 3 | 102,44 | 90,44 | moveLocal X-then-Y |
| 4 | 90,44 | stuck | X-then-Y **échoue** (obstacle) |
| 5 | 90,44 | 83,49 | **BFS movementBlocked** chunk 12 |
| 6 | 83,49 | 83,61 | BFS |
| 7 | 83,61 | 82,72 | BFS |
| 8 | 82,72 | 82,84 | BFS |
| 9 | 82,84 | 80,94 | BFS |
| 10 | 80,94 | **79,92** | BFS — **Lin atteinte** |

## Conclusions concrètes

1. `scene.movementBlocked` (Set `"x:y"`, size ~902 sur ilusia) est la source fiable.
2. BFS 4-dir sur movementBlocked trouve un chemin 90,44 → 79,92 (64 cases).
3. `scene.moveLocal(path, null, {courir:true, redresser:true})` accepte des chemins de cases adjacentes.
4. Chunks de **12 cases** fonctionnent de façon stable.
5. Ligne droite X-puis-Y **échoue** face aux obstacles (stuck à 90,44).
6. Position live = `scene.entities.get(character.id).{x,y}` (plus fiable que character.x).
7. Attendre `!entity.moving` avant le chunk suivant (≈ 200–250 ms poll).

## API validée

```js
// BFS + moveLocal chunk
const path = findPath(from, {x:79,y:92}, 120);
await scene.moveLocal(path.slice(0,13), null, {courir:true, redresser:true});
// attendre !moving
```
