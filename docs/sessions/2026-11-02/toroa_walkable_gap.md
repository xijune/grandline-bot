# Toroa walkable — gap méthodo (2026-11-02)

## Symptôme live (D)
`headless_world --farm` sur Toroa (120,92) :
- packs live OK (ex. toroa-groupe-2 @ 120,43 d=49)
- walk ne rapproche pas → `POST /battles/start` **409** (trop loin / conflit)

## Analyse (B)
| Fait | Source |
|------|--------|
| Path fiable = BFS sur `scene.movementBlocked` | sessions pathfinder 2026-11-01, guide/farm.md |
| Fixture **ohara** existe → farm headless validé 0-dmg | pure_api_farm / headless 2026-11-02 |
| Fixture **toroa** absente | toroa_fauna_console.md, tests/fixtures/map/ |
| Greedy / learning sans grille = non validé | échec live utilisateur |

## Décision
Pas d’hypothèse livrée : **bloquer le farm headless Toroa sur capture A**.

## Capture A (1×)
1. En jeu sur **toroa**
2. Console : coller `scripts/dump_walkable.js`
3. Sauver JSON → `python tools/install_walkable_fixture.py dump.json`
4. `pytest tests/test_toroa_path.py` doit passer
5. Relancer `python src/launcher/headless_world.py --farm 3`

## Canal farm déjà validé sans fixture
`scripts/gl_farm.js` en console (utilise movementBlocked live).
