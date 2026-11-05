# Contrats + Craft + Rest — live 01/11/2026

## Rest
POST /world/rest { characterId, kind: "BELLE_ETOILE" } → +HP
2e → 409 besoin lit auberge/maison

## Combat action
POST /battles/{id}/action { characterId, kind:"ATTAQUE", targetId, targetCell } → 200
3 receleurs lvl10 trop durs en lvl5

## Craft
- planche / potion-soin : 409 pas ton métier
- autres : 404 inconnue
- POST .../craft { recipeId, catalyseur }
- POST .../craft/collect
- TIREUR n'a pas de recettes craft trouvées live

## Contrats
GET /economy/contracts/{id}
POST /economy/contracts/accept { characterId, contractId }
Accept live: ohara-498208-0 LIVRAISON → ilusia · 740฿ · 144xp
