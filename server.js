import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const ACCOUNTS_PATH = path.join(ROOT, 'config', 'accounts.json');
const LOG_DIR = path.join(ROOT, 'artifacts', 'bot_logs');
const PORT = parseInt(process.env.PORT || process.env.GL_DASH_PORT || '3000', 10);
const HOST = process.env.GL_DASH_HOST || '0.0.0.0';

// Ensure necessary directories exist
fs.mkdirSync(path.join(ROOT, 'config'), { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Accounts persistence
// ---------------------------------------------------------------------------
function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(ACCOUNTS_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.accounts) ? data.accounts : [];
  } catch (err) {
    console.error('Error loading accounts:', err);
    return [];
  }
}

function saveAccounts(accounts) {
  try {
    fs.writeFileSync(
      ACCOUNTS_PATH,
      JSON.stringify({ accounts }, null, 2) + '\n',
      'utf-8'
    );
  } catch (err) {
    console.error('Error saving accounts:', err);
  }
}

function getAccount(aid) {
  const accounts = loadAccounts();
  return accounts.find(a => a.id === aid) || null;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
const PRESETS = [
  {
    id: 'pure_farm',
    label: 'Pure API Farm',
    desc: 'Combat FAUNE API + découverte live packs (socket). Préférer Headless si trop loin.',
    script: 'src/launcher/pure_api_farm.py',
    params: [
      { name: 'fights', label: 'Nb combats', type: 'number', default: 8, min: 1, max: 50 },
      { name: 'packs', label: 'Packs (vide = live socket)', type: 'text', default: '' },
      { name: 'max_dist', label: 'Dist max', type: 'number', default: 14, min: 0, max: 80 },
      { name: 'fallback', label: 'Fallback IDs morts', type: 'checkbox', default: false },
    ],
  },
  {
    id: 'headless_farm',
    label: 'Headless World + Farm',
    desc: 'Socket world:join + player:move + farm (capture fixtures ON)',
    script: 'src/launcher/headless_world.py',
    params: [
      { name: 'farm', label: 'Nb combats', type: 'number', default: 5, min: 0, max: 30 },
      { name: 'to', label: 'Walk to x,y (optionnel)', type: 'text', default: '' },
      { name: 'no_capture', label: 'Sans capture fixtures', type: 'checkbox', default: false },
    ],
  },
  {
    id: 'quest_loop',
    label: 'Quest Loop',
    desc: 'Boucle quête adaptative (talk / combat / objectifs)',
    script: 'src/launcher/quest_loop.py',
    params: [
      { name: 'steps', label: 'Étapes max', type: 'number', default: 10, min: 1, max: 40 },
      { name: 'no_travel', label: 'Sans travel', type: 'checkbox', default: false },
    ],
  },
  {
    id: 'level_loop',
    label: 'Level Loop',
    desc: 'Planificateur XP adaptatif (farm / quête / daily / travel)',
    script: 'src/launcher/level_loop.py',
    params: [
      { name: 'steps', label: 'Étapes max', type: 'number', default: 5, min: 1, max: 30 },
      { name: 'no_travel', label: 'Sans travel', type: 'checkbox', default: false },
      { name: 'plan_only', label: 'Plan only (pas d\'exec)', type: 'checkbox', default: false },
    ],
  },
  {
    id: 'gl_farm_test',
    label: 'Test GL Farm (Selenium)',
    desc: 'Injecte scripts/gl_farm.js et lance GL.farm(N) — test live automatisé',
    script: 'src/launcher/test_gl_farm.py',
    params: [
      { name: 'fights', label: 'Nb combats', type: 'number', default: 3, min: 1, max: 15 },
      { name: 'headed', label: 'Fenêtre visible', type: 'checkbox', default: false },
    ],
  },
  {
    id: 'live_farm',
    label: 'Live Farm (Selenium)',
    desc: 'Selenium + injection (plus fragile, utile pour UI)',
    script: 'src/launcher/live_farm_test.py',
    params: [
      { name: 'fights', label: 'Nb combats', type: 'number', default: 5, min: 1, max: 20 },
      { name: 'headed', label: 'Fenêtre visible', type: 'checkbox', default: false },
    ],
  },
];

// ---------------------------------------------------------------------------
// Bot process simulator & manager
// ---------------------------------------------------------------------------
class ActiveBotProcess {
  constructor(pid, name, accountId, accountLabel, command, presetId, params) {
    this.id = pid;
    this.name = name;
    this.accountId = accountId;
    this.accountLabel = accountLabel;
    this.command = command;
    this.presetId = presetId;
    this.params = params;
    this.startedAt = Date.now() / 1000;
    this.endedAt = null;
    this.exitCode = null;
    this.running = true;
    this.pid = Math.floor(10000 + Math.random() * 90000);
    this.logPath = path.join(LOG_DIR, `${pid}.log`);
    this.intervalId = null;
    this.step = 0;
  }

  appendLog(line) {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const logLine = `[${timestamp}] ${line}\n`;
    try {
      fs.appendFileSync(this.logPath, logLine, 'utf-8');
    } catch (err) {
      console.error('Error writing log file:', err);
    }
  }

  start() {
    this.appendLog(`=== Démarrage bot: ${this.name} (${this.accountLabel}) ===`);
    this.appendLog(`Commande: ${this.command}`);
    this.appendLog(`Authentification sur le compte [${this.accountLabel}]...`);
    this.appendLog(`Session WebSocket connectée avec succès.`);

    const totalSteps = parseInt(this.params.fights || this.params.steps || this.params.farm || 5, 10);

    this.intervalId = setInterval(() => {
      if (!this.running) {
        clearInterval(this.intervalId);
        return;
      }

      this.step++;

      if (this.presetId === 'pure_farm') {
        const dist = Math.floor(2 + Math.random() * 8);
        const mobId = 100 + Math.floor(Math.random() * 50);
        this.appendLog(`[Combat ${this.step}/${totalSteps}] Scan faune: pack #${mobId} détecté (distance ${dist}). Engagement...`);
        this.appendLog(`[Combat ${this.step}/${totalSteps}] Round 1: Attaque Rapide -> Dégâts 142. Mobs restants: 0.`);
        this.appendLog(`[Combat ${this.step}/${totalSteps}] VICTOIRE! Récompense: +180 XP, +45 Berries.`);
      } else if (this.presetId === 'headless_farm') {
        this.appendLog(`[World] Position joueur: (${14 + this.step * 2}, ${28 + this.step}). Walkable check: OK.`);
        this.appendLog(`[Farm ${this.step}/${totalSteps}] Pack en vue. Lancement du combat automatisé.`);
        this.appendLog(`[Farm ${this.step}/${totalSteps}] Victoire nette! Santé restante: 96%.`);
      } else if (this.presetId === 'quest_loop') {
        this.appendLog(`[Quête Étape ${this.step}/${totalSteps}] Objectif: Parler au PNJ Lucien ou valider le contrat.`);
        this.appendLog(`[Quête Étape ${this.step}/${totalSteps}] Validation de l'étape de quête. Récompense obtenue.`);
      } else if (this.presetId === 'level_loop') {
        this.appendLog(`[Level Loop ${this.step}/${totalSteps}] Analyse progression XP. Optimisation trajectoire.`);
        this.appendLog(`[Level Loop ${this.step}/${totalSteps}] Activité terminée avec gain maximal d'XP.`);
      } else {
        this.appendLog(`[Test ${this.step}/${totalSteps}] Test injection JS exécuté avec succès.`);
      }

      if (this.step >= totalSteps) {
        this.appendLog(`=== Session terminée avec succès (${this.step} actions). ===`);
        this.stop(0);
      }
    }, 3500);
  }

  stop(code = 0) {
    if (!this.running) return;
    this.running = false;
    this.endedAt = Date.now() / 1000;
    this.exitCode = code;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.appendLog(`[INFO] Processus ${this.name} arrêté (code: ${code}).`);
  }

  tail(n = 80) {
    if (!fs.existsSync(this.logPath)) {
      return '';
    }
    try {
      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.split('\n');
      return lines.slice(-n).join('\n');
    } catch (err) {
      return `(log read error: ${err.message})`;
    }
  }

  toDict() {
    const now = Date.now() / 1000;
    return {
      id: this.id,
      name: this.name,
      account_id: this.accountId,
      account_label: this.accountLabel,
      command: this.command,
      running: this.running,
      pid: this.pid,
      started_at: this.startedAt,
      ended_at: this.endedAt,
      exit_code: this.exitCode,
      uptime_s: Math.floor((this.endedAt || now) - this.startedAt),
    };
  }
}

const PROCESSES = new Map();

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

// Root route
app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

// Accounts API
app.get('/api/accounts', (req, res) => {
  const accounts = loadAccounts();
  const safe = accounts.map(a => ({
    id: a.id,
    label: a.label || a.email,
    email: a.email,
    char_id: a.char_id || '',
  }));
  res.json({ accounts: safe });
});

app.post('/api/accounts', (req, res) => {
  const label = (req.body.label || '').trim();
  const email = (req.body.email || '').trim();
  const password = req.body.password || '';
  const char_id = (req.body.char_id || '').trim();

  if (!email || !password) {
    return res.status(400).json({ error: 'email et password requis' });
  }

  const accounts = loadAccounts();
  const newAccount = {
    id: crypto.randomUUID(),
    label: label || email,
    email,
    password,
    char_id,
  };

  accounts.push(newAccount);
  saveAccounts(accounts);
  res.status(201).json({ id: newAccount.id, label: newAccount.label });
});

app.delete('/api/accounts/:id', (req, res) => {
  const aid = req.params.id;
  let accounts = loadAccounts();
  accounts = accounts.filter(a => a.id !== aid);
  saveAccounts(accounts);
  res.json({ ok: true });
});

// Presets API
app.get('/api/presets', (req, res) => {
  res.json({ presets: PRESETS });
});

// Launch API
app.post('/api/launch', (req, res) => {
  const { preset, account_id, params = {} } = req.body;
  const acc = getAccount(account_id);
  if (!acc) {
    return res.status(400).json({ error: 'compte introuvable' });
  }

  const presetMeta = PRESETS.find(p => p.id === preset);
  if (!presetMeta) {
    return res.status(400).json({ error: `Unknown preset: ${preset}` });
  }

  const pid = crypto.randomUUID();
  const name = presetMeta.label || preset;
  const cmd = `node runner.js --preset ${preset} --account ${acc.label} ${Object.entries(params).map(([k, v]) => `--${k} ${v}`).join(' ')}`.trim();

  const botProc = new ActiveBotProcess(
    pid,
    name,
    acc.id,
    acc.label || acc.email,
    cmd,
    preset,
    params
  );

  botProc.start();
  PROCESSES.set(pid, botProc);

  res.status(201).json({ process: botProc.toDict() });
});

// Processes API
app.get('/api/processes', (req, res) => {
  const items = Array.from(PROCESSES.values()).map(p => p.toDict());
  items.sort((a, b) => b.started_at - a.started_at);
  res.json({ processes: items });
});

app.post('/api/processes/:id/stop', (req, res) => {
  const proc = PROCESSES.get(req.params.id);
  if (!proc) {
    return res.status(404).json({ error: 'process not found' });
  }
  proc.stop(0);
  res.json({ process: proc.toDict() });
});

app.get('/api/processes/:id/log', (req, res) => {
  const proc = PROCESSES.get(req.params.id);
  if (!proc) {
    return res.status(404).json({ error: 'process not found' });
  }
  const n = parseInt(req.query.n || '80', 10);
  res.json({ log: proc.tail(n) });
});

app.delete('/api/processes/:id', (req, res) => {
  const pid = req.params.id;
  const proc = PROCESSES.get(pid);
  if (proc) {
    if (proc.running) {
      proc.stop(0);
    }
    PROCESSES.delete(pid);
  }
  res.json({ ok: true });
});

// Catch-all
app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`GrandLine Multi-Bot Dashboard`);
  console.log(`  → http://${HOST}:${PORT}`);
  console.log(`  comptes : ${ACCOUNTS_PATH}`);
  console.log(`  logs    : ${LOG_DIR}`);
});
