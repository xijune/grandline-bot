/**
 * Version minimale pour tests rapides en console.
 * Copie-colle uniquement ce fichier si tu veux quelque chose de très léger.
 */

(function () {
  const s = window.__grandlineScene;
  if (!s) return console.error("Pas de scène");

  s.confirmationDattaqueDemandee = () => false;

  window.GLBot = {
    player: () => s.character && ({ x: s.character.x, y: s.character.y, name: s.character.name }),
    monsters: () => {
      const out = [];
      (s.network?.fauna?.packs || []).forEach(p => {
        (p.mobs || []).forEach(m => {
          out.push({
            packId: p.id,
            espece: m.espece,
            niveau: m.niveau,
            x: m.orbit?.cx ?? p.ancre?.x,
            y: m.orbit?.cy ?? p.ancre?.y
          });
        });
      });
      return out;
    },
    closest: function () {
      const p = this.player();
      const ms = this.monsters();
      if (!p || !ms.length) return null;
      return ms.reduce((a, b) => {
        const da = Math.hypot(a.x - p.x, a.y - p.y);
        const db = Math.hypot(b.x - p.x, b.y - p.y);
        return da < db ? a : b;
      });
    },
    attack: async function (packId) {
      const id = packId || this.closest()?.packId;
      if (!id) return console.log("Aucun monstre");
      await s.attackFaunaPack(id);
      setTimeout(() => document.querySelector("button.confirmer-combat")?.click(), 300);
    },
    start: function () {
      if (this._t) return;
      const loop = async () => {
        const c = this.closest();
        if (!c) { this._t = setTimeout(loop, 2000); return; }
        const p = this.player();
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        console.log(c.espece, "dist", d.toFixed(1));
        if (d > 8) {
          const step = 5;
          const r = Math.min(step / d, 1);
          await s.moveLocal([
            { x: p.x, y: p.y },
            { x: Math.round(p.x + (c.x - p.x) * r), y: Math.round(p.y + (c.y - p.y) * r) }
          ]);
          this._t = setTimeout(loop, 900);
        } else {
          await this.attack(c.packId);
          this._t = setTimeout(loop, 2800);
        }
      };
      loop();
      console.log("Farm start");
    },
    stop: function () {
      clearTimeout(this._t);
      this._t = null;
      console.log("Farm stop");
    }
  };

  console.log("Quick GLBot prêt → GLBot.start() / GLBot.stop() / GLBot.closest()");
})();
