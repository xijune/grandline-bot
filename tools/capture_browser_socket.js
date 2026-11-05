/**
 * Coller en console F12 une fois en jeu (monde chargé).
 * Log tous les emit / emitWithAck world:* et player:* → window.__GL_SOCKET_LOG
 *
 * Export :
 *   copy(JSON.stringify(window.__GL_SOCKET_LOG))
 * ou téléchargement auto si supporté.
 */
(() => {
  const scene = window.__grandlineScene;
  if (!scene?.network?.socket) {
    console.error("Pas de socket — entre en monde d’abord");
    return;
  }
  const sock = scene.network.socket;
  window.__GL_SOCKET_LOG = window.__GL_SOCKET_LOG || [];
  const log = (dir, ev, payload, result) => {
    const row = {
      t: Date.now(),
      dir,
      ev,
      payload,
      result: result === undefined ? undefined : result,
    };
    window.__GL_SOCKET_LOG.push(row);
    if (/^(player:|world:)/.test(ev)) {
      console.log("%c[sock]", "color:#fc6", dir, ev, payload, result ?? "");
    }
  };

  if (!sock.__glPatched) {
    const origAck = sock.emitWithAck.bind(sock);
    const origEmit = sock.emit.bind(sock);
    sock.emitWithAck = async function (ev, payload) {
      try {
        const r = await origAck(ev, payload);
        log("out-ack", ev, payload, r);
        return r;
      } catch (e) {
        log("out-ack-err", ev, payload, String(e));
        throw e;
      }
    };
    sock.emit = function (ev, payload, ...rest) {
      log("out", ev, payload);
      return origEmit(ev, payload, ...rest);
    };
    sock.onAny((ev, ...args) => {
      if (/^(player:|world:|fauna:|battle:)/.test(ev)) {
        log("in", ev, args[0]);
      }
    });
    sock.__glPatched = true;
  }

  console.log(
    "%c✅ Socket capture actif → window.__GL_SOCKET_LOG\n" +
      "  Déplace-toi / engage un pack, puis : copy(JSON.stringify(window.__GL_SOCKET_LOG))",
    "color:#7f7;font-weight:bold"
  );
})();
