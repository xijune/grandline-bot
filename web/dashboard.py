#!/usr/bin/env python3
"""
GrandLine Multi-Bot Dashboard
=============================
Interface web locale pour lancer / suivre plusieurs bots en parallèle.

Usage:
  cd grandline-bot
  python web/dashboard.py
  # puis ouvrir http://127.0.0.1:8765

Comptes stockés localement dans config/accounts.json (jamais commité).
"""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
ACCOUNTS_PATH = ROOT / "config" / "accounts.json"
LOG_DIR = ROOT / "artifacts" / "bot_logs"
HOST = os.getenv("GL_DASH_HOST", "127.0.0.1")
PORT = int(os.getenv("GL_DASH_PORT", "8765"))

# ---------------------------------------------------------------------------
# Process registry
# ---------------------------------------------------------------------------

class BotProcess:
    def __init__(
        self,
        pid: str,
        name: str,
        account_id: str,
        account_label: str,
        command: list[str],
        env: dict[str, str],
        cwd: str,
    ):
        self.id = pid
        self.name = name
        self.account_id = account_id
        self.account_label = account_label
        self.command = command
        self.env = env
        self.cwd = cwd
        self.proc: subprocess.Popen | None = None
        self.log_path = LOG_DIR / f"{pid}.log"
        self.started_at = time.time()
        self.ended_at: float | None = None
        self.exit_code: int | None = None
        self._lock = threading.Lock()
        self._log_fh = None

    def start(self) -> None:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        self._log_fh = open(self.log_path, "w", encoding="utf-8", buffering=1)
        full_env = os.environ.copy()
        full_env.update(self.env)
        self.proc = subprocess.Popen(
            self.command,
            cwd=self.cwd,
            env=full_env,
            stdout=self._log_fh,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,  # own process group for clean kill
        )

    def is_running(self) -> bool:
        if self.proc is None:
            return False
        code = self.proc.poll()
        if code is not None:
            self.exit_code = code
            if self.ended_at is None:
                self.ended_at = time.time()
            return False
        return True

    def stop(self) -> None:
        if self.proc is None or not self.is_running():
            return
        try:
            os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            self.proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
        self.ended_at = time.time()
        self.exit_code = self.proc.poll()
        if self._log_fh:
            try:
                self._log_fh.close()
            except Exception:
                pass

    def tail(self, n: int = 80) -> str:
        if not self.log_path.exists():
            return ""
        try:
            lines = self.log_path.read_text(encoding="utf-8", errors="replace").splitlines()
            return "\n".join(lines[-n:])
        except Exception as e:
            return f"(log read error: {e})"

    def to_dict(self) -> dict[str, Any]:
        running = self.is_running()
        return {
            "id": self.id,
            "name": self.name,
            "account_id": self.account_id,
            "account_label": self.account_label,
            "command": " ".join(self.command),
            "running": running,
            "pid": self.proc.pid if self.proc else None,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "exit_code": self.exit_code,
            "uptime_s": int((self.ended_at or time.time()) - self.started_at),
        }


PROCESSES: dict[str, BotProcess] = {}
PROC_LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------

def load_accounts() -> list[dict]:
    if not ACCOUNTS_PATH.exists():
        return []
    try:
        data = json.loads(ACCOUNTS_PATH.read_text(encoding="utf-8"))
        return list(data.get("accounts") or [])
    except Exception:
        return []


def save_accounts(accounts: list[dict]) -> None:
    ACCOUNTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    ACCOUNTS_PATH.write_text(
        json.dumps({"accounts": accounts}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def get_account(aid: str) -> dict | None:
    for a in load_accounts():
        if a.get("id") == aid:
            return a
    return None


# ---------------------------------------------------------------------------
# Launch presets
# ---------------------------------------------------------------------------

PRESETS = [
    {
        "id": "pure_farm",
        "label": "Pure API Farm",
        "desc": "Combat FAUNE API + découverte live packs (socket). Préférer Headless si trop loin.",
        "script": "src/launcher/pure_api_farm.py",
        "params": [
            {"name": "fights", "label": "Nb combats", "type": "number", "default": 8, "min": 1, "max": 50},
            {"name": "packs", "label": "Packs (vide = live socket)", "type": "text", "default": ""},
            {"name": "max_dist", "label": "Dist max", "type": "number", "default": 14, "min": 0, "max": 80},
            {"name": "fallback", "label": "Fallback IDs morts", "type": "checkbox", "default": False},
        ],
    },
    {
        "id": "headless_farm",
        "label": "Headless World + Farm",
        "desc": "Socket world:join + player:move + farm (capture fixtures ON)",
        "script": "src/launcher/headless_world.py",
        "params": [
            {"name": "farm", "label": "Nb combats", "type": "number", "default": 5, "min": 0, "max": 30},
            {"name": "to", "label": "Walk to x,y (optionnel)", "type": "text", "default": ""},
            {"name": "no_capture", "label": "Sans capture fixtures", "type": "checkbox", "default": False},
        ],
    },
    {
        "id": "quest_loop",
        "label": "Quest Loop",
        "desc": "Boucle quête adaptative (talk / combat / objectifs)",
        "script": "src/launcher/quest_loop.py",
        "params": [
            {"name": "steps", "label": "Étapes max", "type": "number", "default": 10, "min": 1, "max": 40},
            {"name": "no_travel", "label": "Sans travel", "type": "checkbox", "default": False},
        ],
    },
    {
        "id": "level_loop",
        "label": "Level Loop",
        "desc": "Planificateur XP adaptatif (farm / quête / daily / travel)",
        "script": "src/launcher/level_loop.py",
        "params": [
            {"name": "steps", "label": "Étapes max", "type": "number", "default": 5, "min": 1, "max": 30},
            {"name": "no_travel", "label": "Sans travel", "type": "checkbox", "default": False},
            {"name": "plan_only", "label": "Plan only (pas d'exec)", "type": "checkbox", "default": False},
        ],
    },
    {
        "id": "gl_farm_test",
        "label": "Test GL Farm (Selenium)",
        "desc": "Injecte scripts/gl_farm.js et lance GL.farm(N) — test live automatisé",
        "script": "src/launcher/test_gl_farm.py",
        "params": [
            {"name": "fights", "label": "Nb combats", "type": "number", "default": 3, "min": 1, "max": 15},
            {"name": "headed", "label": "Fenêtre visible", "type": "checkbox", "default": False},
        ],
    },
    {
        "id": "live_farm",
        "label": "Live Farm (Selenium)",
        "desc": "Selenium + injection (plus fragile, utile pour UI)",
        "script": "src/launcher/live_farm_test.py",
        "params": [
            {"name": "fights", "label": "Nb combats", "type": "number", "default": 5, "min": 1, "max": 20},
            {"name": "headed", "label": "Fenêtre visible", "type": "checkbox", "default": False},
        ],
    },
]


def build_command(preset_id: str, params: dict) -> list[str]:
    preset = next((p for p in PRESETS if p["id"] == preset_id), None)
    if not preset:
        raise ValueError(f"Unknown preset: {preset_id}")

    script = ROOT / preset["script"]
    if not script.exists():
        raise FileNotFoundError(str(script))

    cmd = [sys.executable, str(script)]

    if preset_id == "pure_farm":
        fights = int(params.get("fights") or 8)
        cmd += ["--fights", str(fights)]
        packs = (params.get("packs") or "").strip()
        if packs:
            cmd += ["--packs", packs]
        max_dist = params.get("max_dist")
        if max_dist is not None and str(max_dist) != "":
            cmd += ["--max-dist", str(int(max_dist))]
        if params.get("fallback"):
            cmd += ["--fallback"]

    elif preset_id == "headless_farm":
        farm = int(params.get("farm") or 0)
        if farm:
            cmd += ["--farm", str(farm)]
        to = (params.get("to") or "").strip()
        if to:
            cmd += ["--to", to]
        if params.get("no_capture"):
            cmd += ["--no-capture"]

    elif preset_id == "quest_loop":
        steps = int(params.get("steps") or 10)
        cmd += ["--steps", str(steps)]
        if params.get("no_travel"):
            cmd += ["--no-travel"]

    elif preset_id == "level_loop":
        steps = int(params.get("steps") or 5)
        cmd += ["--steps", str(steps)]
        if params.get("no_travel"):
            cmd += ["--no-travel"]
        if params.get("plan_only"):
            cmd += ["--plan-only"]

    elif preset_id == "gl_farm_test":
        fights = int(params.get("fights") or 3)
        cmd += ["--fights", str(fights)]
        if params.get("headed"):
            cmd += ["--headed"]

    elif preset_id == "live_farm":
        fights = int(params.get("fights") or 5)
        cmd += ["--fights", str(fights)]
        if params.get("headed"):
            cmd += ["--headed"]

    return cmd


# ---------------------------------------------------------------------------
# HTTP handlers
# ---------------------------------------------------------------------------

HTML_PAGE = r"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GrandLine Multi-Bot</title>
<style>
  :root {
    --bg: #0f1419;
    --panel: #1a2332;
    --panel2: #243044;
    --border: #2d3a4f;
    --text: #e7ecf3;
    --muted: #8b9bb4;
    --accent: #3b82f6;
    --accent2: #22c55e;
    --danger: #ef4444;
    --warn: #f59e0b;
    --radius: 12px;
    --font: "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    line-height: 1.45;
  }
  header {
    background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  header h1 {
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  header h1 span { color: var(--accent); }
  .badge {
    background: var(--panel2);
    color: var(--muted);
    font-size: 0.75rem;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
  }
  main {
    max-width: 1280px;
    margin: 0 auto;
    padding: 20px;
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 20px;
  }
  @media (max-width: 900px) {
    main { grid-template-columns: 1fr; }
  }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
  }
  .panel h2 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-bottom: 12px;
  }
  .accounts-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
  .account-card {
    background: var(--panel2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .account-card .name { font-weight: 600; font-size: 0.95rem; }
  .account-card .meta { font-size: 0.75rem; color: var(--muted); }
  .btn {
    border: none;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
    color: #fff;
  }
  .btn:hover { opacity: 0.9; }
  .btn:active { transform: scale(0.98); }
  .btn-primary { background: var(--accent); }
  .btn-success { background: var(--accent2); }
  .btn-danger { background: var(--danger); }
  .btn-ghost {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .btn-sm { padding: 4px 10px; font-size: 0.75rem; }
  .btn-block { width: 100%; }
  form.add-account { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  input, select, textarea {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 8px 12px;
    font-size: 0.9rem;
    width: 100%;
  }
  input:focus, select:focus, textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  label {
    font-size: 0.75rem;
    color: var(--muted);
    display: block;
    margin-bottom: 2px;
  }
  .field { margin-bottom: 10px; }
  .launch-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }
  .preset-card {
    background: var(--panel2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .preset-card h3 { font-size: 1rem; }
  .preset-card p { font-size: 0.8rem; color: var(--muted); flex: 1; }
  .preset-params { display: flex; flex-direction: column; gap: 6px; }
  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .checkbox-row input { width: auto; }
  .procs-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  .proc-list { display: flex; flex-direction: column; gap: 12px; }
  .proc-card {
    background: var(--panel2);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }
  .proc-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 14px;
    gap: 12px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--border);
  }
  .proc-title { font-weight: 600; }
  .proc-meta { font-size: 0.75rem; color: var(--muted); }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 999px;
  }
  .status.running { background: rgba(34,197,94,0.15); color: #4ade80; }
  .status.stopped { background: rgba(148,163,184,0.15); color: #94a3b8; }
  .status.failed { background: rgba(239,68,68,0.15); color: #f87171; }
  .status::before {
    content: "";
    width: 7px; height: 7px;
    border-radius: 50%;
    background: currentColor;
  }
  .status.running::before { box-shadow: 0 0 6px currentColor; }
  .proc-actions { display: flex; gap: 6px; }
  .log-box {
    background: #0a0e14;
    font-family: ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace;
    font-size: 0.72rem;
    line-height: 1.4;
    padding: 12px;
    max-height: 220px;
    overflow: auto;
    white-space: pre-wrap;
    color: #a5b4c8;
  }
  .empty {
    text-align: center;
    color: var(--muted);
    padding: 32px 16px;
    font-size: 0.9rem;
  }
  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: var(--panel2);
    border: 1px solid var(--border);
    padding: 12px 18px;
    border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.4);
    z-index: 100;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.25s;
    max-width: 320px;
    font-size: 0.9rem;
  }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.error { border-color: var(--danger); }
  .toast.ok { border-color: var(--accent2); }
</style>
</head>
<body>
<header>
  <h1>GrandLine <span>Multi-Bot</span></h1>
  <div class="badge" id="server-info">localhost</div>
</header>

<main>
  <!-- LEFT: accounts -->
  <aside>
    <div class="panel">
      <h2>Comptes</h2>
      <div class="accounts-list" id="accounts-list"></div>
      <form class="add-account" id="add-account-form" onsubmit="return addAccount(event)">
        <div class="field">
          <label>Label</label>
          <input name="label" placeholder="Bukima / junymine4" required>
        </div>
        <div class="field">
          <label>Email / Pseudo</label>
          <input name="email" type="text" required autocomplete="username">
        </div>
        <div class="field">
          <label>Mot de passe</label>
          <input name="password" type="password" required autocomplete="current-password">
        </div>
        <div class="field">
          <label>Character ID (optionnel)</label>
          <input name="char_id" placeholder="laisse vide = 1er perso">
        </div>
        <button type="submit" class="btn btn-primary btn-block">Ajouter le compte</button>
      </form>
    </div>
  </aside>

  <!-- RIGHT: launch + processes -->
  <section>
    <div class="panel" style="margin-bottom:16px">
      <h2>Lancer un bot</h2>
      <div class="field">
        <label>Compte</label>
        <select id="launch-account"></select>
      </div>
      <div class="launch-grid" id="presets"></div>
    </div>

    <div class="panel">
      <div class="procs-header">
        <h2 style="margin:0">Processus actifs</h2>
        <button class="btn btn-ghost btn-sm" onclick="refreshProcs()">Rafraîchir</button>
      </div>
      <div class="proc-list" id="proc-list">
        <div class="empty">Aucun bot lancé</div>
      </div>
    </div>
  </section>
</main>

<div class="toast" id="toast"></div>

<script>
const PRESETS = __PRESETS_JSON__;

function toast(msg, type = "ok") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show " + type;
  setTimeout(() => el.classList.remove("show"), 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------- Accounts ----------
async function loadAccounts() {
  const data = await api("/api/accounts");
  const list = document.getElementById("accounts-list");
  const select = document.getElementById("launch-account");
  list.innerHTML = "";
  select.innerHTML = "";

  if (!data.accounts.length) {
    list.innerHTML = '<div class="empty" style="padding:12px">Aucun compte</div>';
    select.innerHTML = '<option value="">— ajoute un compte —</option>';
    return data.accounts;
  }

  data.accounts.forEach(a => {
    const card = document.createElement("div");
    card.className = "account-card";
    card.innerHTML = `
      <div>
        <div class="name">${esc(a.label)}</div>
        <div class="meta">${esc(a.email)}${a.char_id ? " · " + esc(a.char_id.slice(0,8)) + "…" : ""}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="deleteAccount('${a.id}')">✕</button>
    `;
    list.appendChild(card);

    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.label + " (" + a.email + ")";
    select.appendChild(opt);
  });
  return data.accounts;
}

async function addAccount(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/api/accounts", {
      method: "POST",
      body: JSON.stringify({
        label: fd.get("label"),
        email: fd.get("email"),
        password: fd.get("password"),
        char_id: fd.get("char_id") || "",
      }),
    });
    e.target.reset();
    toast("Compte ajouté");
    await loadAccounts();
  } catch (err) {
    toast(err.message, "error");
  }
  return false;
}

async function deleteAccount(id) {
  if (!confirm("Supprimer ce compte ?")) return;
  try {
    await api("/api/accounts/" + id, { method: "DELETE" });
    toast("Compte supprimé");
    await loadAccounts();
  } catch (err) {
    toast(err.message, "error");
  }
}

// ---------- Presets ----------
function renderPresets() {
  const box = document.getElementById("presets");
  box.innerHTML = "";
  PRESETS.forEach(p => {
    const card = document.createElement("div");
    card.className = "preset-card";
    let paramsHtml = "";
    (p.params || []).forEach(param => {
      if (param.type === "checkbox") {
        paramsHtml += `
          <label class="checkbox-row">
            <input type="checkbox" data-param="${param.name}" ${param.default ? "checked" : ""}>
            ${esc(param.label)}
          </label>`;
      } else {
        paramsHtml += `
          <div>
            <label>${esc(param.label)}</label>
            <input type="${param.type}" data-param="${param.name}"
              value="${esc(String(param.default ?? ""))}"
              ${param.min != null ? `min="${param.min}"` : ""}
              ${param.max != null ? `max="${param.max}"` : ""}>
          </div>`;
      }
    });
    card.innerHTML = `
      <h3>${esc(p.label)}</h3>
      <p>${esc(p.desc)}</p>
      <div class="preset-params">${paramsHtml}</div>
      <button class="btn btn-success btn-block" data-preset="${p.id}">Lancer</button>
    `;
    card.querySelector("button").addEventListener("click", () => launchPreset(p.id, card));
    box.appendChild(card);
  });
}

async function launchPreset(presetId, card) {
  const accountId = document.getElementById("launch-account").value;
  if (!accountId) {
    toast("Choisis un compte", "error");
    return;
  }
  const params = {};
  card.querySelectorAll("[data-param]").forEach(el => {
    if (el.type === "checkbox") params[el.dataset.param] = el.checked;
    else params[el.dataset.param] = el.value;
  });
  try {
    const data = await api("/api/launch", {
      method: "POST",
      body: JSON.stringify({ preset: presetId, account_id: accountId, params }),
    });
    toast("Bot lancé · " + data.process.name);
    await refreshProcs();
  } catch (err) {
    toast(err.message, "error");
  }
}

// ---------- Processes ----------
async function refreshProcs() {
  const data = await api("/api/processes");
  const box = document.getElementById("proc-list");
  if (!data.processes.length) {
    box.innerHTML = '<div class="empty">Aucun bot lancé</div>';
    return;
  }
  box.innerHTML = "";
  data.processes.forEach(p => {
    const statusCls = p.running ? "running" : (p.exit_code && p.exit_code !== 0 ? "failed" : "stopped");
    const statusTxt = p.running ? "EN COURS" : (p.exit_code === 0 ? "TERMINÉ" : "ARRÊTÉ / ERREUR");
    const card = document.createElement("div");
    card.className = "proc-card";
    card.innerHTML = `
      <div class="proc-head">
        <div>
          <div class="proc-title">${esc(p.name)} · ${esc(p.account_label)}</div>
          <div class="proc-meta">${esc(p.command)} · ${p.uptime_s}s · pid ${p.pid || "—"}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="status ${statusCls}">${statusTxt}</span>
          <div class="proc-actions">
            ${p.running ? `<button class="btn btn-danger btn-sm" onclick="stopProc('${p.id}')">Stop</button>` : ""}
            <button class="btn btn-ghost btn-sm" onclick="loadLog('${p.id}')">Log</button>
            <button class="btn btn-ghost btn-sm" onclick="removeProc('${p.id}')">Retirer</button>
          </div>
        </div>
      </div>
      <div class="log-box" id="log-${p.id}">chargement…</div>
    `;
    box.appendChild(card);
    loadLog(p.id);
  });
}

async function loadLog(id) {
  try {
    const data = await api("/api/processes/" + id + "/log?n=100");
    const el = document.getElementById("log-" + id);
    if (el) {
      el.textContent = data.log || "(vide)";
      el.scrollTop = el.scrollHeight;
    }
  } catch (err) {
    const el = document.getElementById("log-" + id);
    if (el) el.textContent = err.message;
  }
}

async function stopProc(id) {
  try {
    await api("/api/processes/" + id + "/stop", { method: "POST" });
    toast("Stop demandé");
    await refreshProcs();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function removeProc(id) {
  try {
    await api("/api/processes/" + id, { method: "DELETE" });
    await refreshProcs();
  } catch (err) {
    toast(err.message, "error");
  }
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// boot
document.getElementById("server-info").textContent = location.host;
renderPresets();
loadAccounts().then(refreshProcs);
setInterval(refreshProcs, 4000);
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    server_version = "GLMultiBot/1.0"

    def log_message(self, fmt: str, *args) -> None:
        # quieter
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ("/", "/index.html"):
            html = HTML_PAGE.replace("__PRESETS_JSON__", json.dumps(PRESETS, ensure_ascii=False))
            body = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/accounts":
            accounts = load_accounts()
            # never send passwords to the browser
            safe = [
                {
                    "id": a["id"],
                    "label": a.get("label") or a.get("email"),
                    "email": a.get("email"),
                    "char_id": a.get("char_id") or "",
                }
                for a in accounts
            ]
            self._json(200, {"accounts": safe})
            return

        if path == "/api/processes":
            with PROC_LOCK:
                items = [p.to_dict() for p in PROCESSES.values()]
            items.sort(key=lambda x: x["started_at"], reverse=True)
            self._json(200, {"processes": items})
            return

        m = re.match(r"^/api/processes/([a-f0-9\-]+)/log$", path)
        if m:
            pid = m.group(1)
            qs = parse_qs(parsed.query)
            n = int((qs.get("n") or ["80"])[0])
            with PROC_LOCK:
                proc = PROCESSES.get(pid)
            if not proc:
                self._json(404, {"error": "process not found"})
                return
            self._json(200, {"log": proc.tail(n)})
            return

        if path == "/api/presets":
            self._json(200, {"presets": PRESETS})
            return

        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        data = self._read_json()

        if path == "/api/accounts":
            label = (data.get("label") or "").strip()
            email = (data.get("email") or "").strip()
            password = data.get("password") or ""
            char_id = (data.get("char_id") or "").strip()
            if not email or not password:
                self._json(400, {"error": "email et password requis"})
                return
            accounts = load_accounts()
            acc = {
                "id": str(uuid.uuid4()),
                "label": label or email,
                "email": email,
                "password": password,
                "char_id": char_id,
            }
            accounts.append(acc)
            save_accounts(accounts)
            self._json(201, {"id": acc["id"], "label": acc["label"]})
            return

        if path == "/api/launch":
            preset = data.get("preset")
            account_id = data.get("account_id")
            params = data.get("params") or {}
            acc = get_account(account_id)
            if not acc:
                self._json(400, {"error": "compte introuvable"})
                return
            try:
                cmd = build_command(preset, params)
            except Exception as e:
                self._json(400, {"error": str(e)})
                return

            env = {
                "GL_EMAIL": acc["email"],
                "GL_PASSWORD": acc["password"],
            }
            if acc.get("char_id"):
                env["GL_CHAR_ID"] = acc["char_id"]

            preset_meta = next((p for p in PRESETS if p["id"] == preset), {})
            name = preset_meta.get("label") or preset
            pid = str(uuid.uuid4())
            bp = BotProcess(
                pid=pid,
                name=name,
                account_id=acc["id"],
                account_label=acc.get("label") or acc["email"],
                command=cmd,
                env=env,
                cwd=str(ROOT),
            )
            try:
                bp.start()
            except Exception as e:
                self._json(500, {"error": f"start failed: {e}"})
                return
            with PROC_LOCK:
                PROCESSES[pid] = bp
            self._json(201, {"process": bp.to_dict()})
            return

        m = re.match(r"^/api/processes/([a-f0-9\-]+)/stop$", path)
        if m:
            pid = m.group(1)
            with PROC_LOCK:
                proc = PROCESSES.get(pid)
            if not proc:
                self._json(404, {"error": "process not found"})
                return
            proc.stop()
            self._json(200, {"process": proc.to_dict()})
            return

        self._json(404, {"error": "not found"})

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        m = re.match(r"^/api/accounts/([a-f0-9\-]+)$", path)
        if m:
            aid = m.group(1)
            accounts = load_accounts()
            accounts = [a for a in accounts if a.get("id") != aid]
            save_accounts(accounts)
            self._json(200, {"ok": True})
            return

        m = re.match(r"^/api/processes/([a-f0-9\-]+)$", path)
        if m:
            pid = m.group(1)
            with PROC_LOCK:
                proc = PROCESSES.pop(pid, None)
            if proc and proc.is_running():
                proc.stop()
            self._json(200, {"ok": True})
            return

        self._json(404, {"error": "not found"})


def main() -> int:
    # ensure accounts file exists (empty)
    if not ACCOUNTS_PATH.exists():
        save_accounts([])

    # add accounts.json to gitignore if possible
    gi = ROOT / ".gitignore"
    if gi.exists():
        text = gi.read_text(encoding="utf-8")
        if "config/accounts.json" not in text:
            gi.write_text(text.rstrip() + "\nconfig/accounts.json\nartifacts/bot_logs/\n", encoding="utf-8")

    print(f"GrandLine Multi-Bot Dashboard")
    print(f"  → http://{HOST}:{PORT}")
    print(f"  comptes : {ACCOUNTS_PATH}")
    print(f"  logs    : {LOG_DIR}")
    print("  Ctrl+C pour arrêter\n")

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt…")
        with PROC_LOCK:
            for p in list(PROCESSES.values()):
                if p.is_running():
                    p.stop()
        server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
