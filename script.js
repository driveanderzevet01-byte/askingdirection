'use strict';
/* ==================================================================
   DIRECTION QUEST: THE LOST TRAVELER
   A browser-based educational RPG teaching English "Giving Directions".
   Vanilla JS / Canvas API only. No frameworks, no external assets —
   every visual and sound is drawn/synthesized at runtime.

   Scope (see README.md for full details):
     - 1 district ("Riverside"), 5 NPCs, 5 chained quests
     - All 6 mini-game types: Multiple Choice, Typing Challenge,
       Arrange Directions, Fill in the Blank, True/False, Interactive Map
     - Procedurally generated direction sentences (replayable)
     - Save/Load via localStorage, XP/Level/Coins/Achievements
     - Live Google Sheets logging via a deployed Apps Script Web App
       (see google-apps-script/Code.gs — paste your deployed URL below)
   ================================================================== */

/* ==================== CONFIG ====================
   Paste the /exec URL you get after deploying google-apps-script/Code.gs
   as a Web App (see README.md, "Deploying the Apps Script backend").
   Leave as-is to run fully offline — the game still works, and every
   event is queued in localStorage until a URL is set. */
const GAS_WEB_APP_URL = ''; // e.g. 'https://script.google.com/macros/s/AKfycb.../exec'

/* ==================== UTILITIES ==================== */
const Utils = {
  lerp: (a, b, t) => a + (b - a) * t,
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
  choice: (arr) => arr[Math.floor(Math.random() * arr.length)],
  sample: (arr, n) => {
    const copy = arr.slice();
    const out = [];
    while (out.length < n && copy.length) {
      out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    }
    return out;
  },
  aabb: (ax, ay, aw, ah, bx, by, bw, bh) =>
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by,
  normalizeText: (s) =>
    s
      .toLowerCase()
      .replace(/[.,!?;:'"()]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  /** Levenshtein edit distance between two strings. */
  levenshtein: (a, b) => {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[n];
  },
  similarity: (a, b) => {
    const na = Utils.normalizeText(a), nb = Utils.normalizeText(b);
    const maxLen = Math.max(na.length, nb.length) || 1;
    const d = Utils.levenshtein(na, nb);
    return Utils.clamp(1 - d / maxLen, 0, 1);
  },
  fmtClock: (t) => {
    // t in [0,1) -> label
    if (t < 0.22) return 'Dawn';
    if (t < 0.45) return 'Morning';
    if (t < 0.55) return 'Noon';
    if (t < 0.75) return 'Afternoon';
    if (t < 0.88) return 'Dusk';
    return 'Night';
  },
};

/* ==================== AUDIO MANAGER ====================
   All sound effects are synthesized with the Web Audio API —
   no external audio files required. */
class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = parseFloat(localStorage.getItem('dq_volume') ?? '0.7');
    this.muted = localStorage.getItem('dq_muted') === 'true';
    this._lastFootstep = 0;
  }
  _ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setVolume(v) {
    this.volume = v;
    localStorage.setItem('dq_volume', String(v));
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }
  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('dq_muted', String(this.muted));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }
  _tone(freq, dur, type = 'sine', gainPeak = 0.18, delay = 0, glideTo = null) {
    this._ensure();
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  click() { this._tone(520, 0.06, 'triangle', 0.12); }
  footstep() {
    const now = performance.now();
    if (now - this._lastFootstep < 220) return;
    this._lastFootstep = now;
    this._tone(110 + Math.random() * 20, 0.05, 'square', 0.04);
  }
  correct() {
    [660, 880, 1108].forEach((f, i) => this._tone(f, 0.14, 'triangle', 0.15, i * 0.08));
  }
  wrong() { this._tone(180, 0.28, 'sawtooth', 0.13, 0, 90); }
  questComplete() {
    [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.22, 'triangle', 0.16, i * 0.09));
  }
  levelUp() {
    [392, 523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.18, 'sine', 0.17, i * 0.07));
  }
  talk() { this._tone(300 + Math.random() * 120, 0.04, 'square', 0.05); }
}

/* ==================== SAVE MANAGER ==================== */
class SaveManager {
  static KEY = 'directionQuest_save_v1';
  static save(state) {
    try {
      localStorage.setItem(SaveManager.KEY, JSON.stringify(state));
      return true;
    } catch (e) { console.warn('Save failed', e); return false; }
  }
  static load() {
    try {
      const raw = localStorage.getItem(SaveManager.KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  static exists() { return !!localStorage.getItem(SaveManager.KEY); }
  static clear() { localStorage.removeItem(SaveManager.KEY); }
}

/* ==================== GOOGLE SHEET MANAGER ====================
   Logs session + quest events to a Google Sheet via a deployed Apps
   Script Web App (see google-apps-script/Code.gs). Uses text/plain
   content-type to avoid CORS preflight (the standard workaround for
   Apps Script Web Apps), retries failed sends with backoff, and keeps
   an offline queue in localStorage so nothing is lost if the network
   drops mid-session. */
class GoogleSheetManager {
  static QUEUE_KEY = 'directionQuest_pendingLogs_v1';

  constructor(webAppUrl = GAS_WEB_APP_URL) {
    this.webAppUrl = webAppUrl && webAppUrl.trim() ? webAppUrl.trim() : null;
    if (!this.webAppUrl) {
      console.warn('[GoogleSheetManager] No GAS_WEB_APP_URL set — events will queue locally only. See README.md.');
    }
    this._flushTimer = setInterval(() => this.flushQueue(), 20000);
    window.addEventListener('online', () => this.flushQueue());
  }

  _readQueue() {
    try { return JSON.parse(localStorage.getItem(GoogleSheetManager.QUEUE_KEY) || '[]'); }
    catch (e) { return []; }
  }
  _writeQueue(q) {
    try { localStorage.setItem(GoogleSheetManager.QUEUE_KEY, JSON.stringify(q)); }
    catch (e) { console.warn('Could not persist log queue', e); }
  }
  _enqueue(event) {
    const q = this._readQueue();
    q.push(event);
    this._writeQueue(q);
  }

  /** Fire-and-forget: try to send now, fall back to queue on any failure. */
  async _send(event, attempt = 1) {
    if (!this.webAppUrl) { this._enqueue(event); return; }
    try {
      const res = await fetch(this.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight on Apps Script
        body: JSON.stringify(event),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt < 3) {
        const delay = 500 * Math.pow(2, attempt); // 1s, 2s, 4s
        setTimeout(() => this._send(event, attempt + 1), delay);
      } else {
        console.warn('[GoogleSheetManager] Send failed after retries, queued for later:', err);
        this._enqueue(event);
      }
    }
  }

  async flushQueue() {
    if (!this.webAppUrl) return;
    const q = this._readQueue();
    if (!q.length) return;
    this._writeQueue([]); // optimistically clear; failures re-queue below
    for (const event of q) {
      await this._send(event);
    }
  }

  _envelope(type, extra) {
    return {
      type,
      timestamp: new Date().toISOString(),
      gameVersion: '1.0.0-slice',
      browser: navigator.userAgent,
      device: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
      ...extra,
    };
  }

  logSessionStart(profile) {
    this._send(this._envelope('session_start', {
      studentName: profile.name, studentId: profile.id,
    }));
  }

  logQuestCompletion(payload) {
    this._send(this._envelope('quest_complete', payload));
  }

  logGameComplete(payload) {
    this._send(this._envelope('game_complete', payload));
  }
}

/* ==================== CAMERA ==================== */
class Camera {
  constructor(worldW, worldH) {
    this.x = 0; this.y = 0;
    this.worldW = worldW; this.worldH = worldH;
    this.viewW = window.innerWidth; this.viewH = window.innerHeight;
    this.shakeMag = 0; this.shakeT = 0;
    this.zoom = 1; this.targetZoom = 1;
  }
  resize(w, h) { this.viewW = w; this.viewH = h; }
  follow(targetX, targetY, dt) {
    const desiredX = Utils.clamp(targetX - this.viewW / 2 / this.zoom, 0, Math.max(0, this.worldW - this.viewW / this.zoom));
    const desiredY = Utils.clamp(targetY - this.viewH / 2 / this.zoom, 0, Math.max(0, this.worldH - this.viewH / this.zoom));
    const ease = 1 - Math.pow(0.001, dt);
    this.x = Utils.lerp(this.x, desiredX, ease);
    this.y = Utils.lerp(this.y, desiredY, ease);
    this.zoom = Utils.lerp(this.zoom, this.targetZoom, ease);
    if (this.shakeT > 0) this.shakeT -= dt;
  }
  shake(mag = 8, duration = 0.25) { this.shakeMag = mag; this.shakeT = duration; }
  getShakeOffset() {
    if (this.shakeT <= 0) return { x: 0, y: 0 };
    const f = this.shakeT;
    return { x: (Math.random() - 0.5) * this.shakeMag * f, y: (Math.random() - 0.5) * this.shakeMag * f };
  }
  worldToScreen(x, y) {
    const s = this.getShakeOffset();
    return { x: (x - this.x) * this.zoom + s.x, y: (y - this.y) * this.zoom + s.y };
  }
  /** Inverse of worldToScreen (ignores the tiny shake offset — negligible for click targeting). */
  screenToWorld(sx, sy) {
    return { x: sx / this.zoom + this.x, y: sy / this.zoom + this.y };
  }
}

/* ==================== PARTICLE SYSTEM ==================== */
class ParticleSystem {
  constructor(worldW, worldH) {
    this.worldW = worldW; this.worldH = worldH;
    this.leaves = Array.from({ length: 18 }, () => this._newLeaf());
    this.birds = Array.from({ length: 4 }, () => this._newBird());
    this.bursts = []; // celebratory bursts on quest complete
  }
  _newLeaf() {
    return {
      x: Math.random() * this.worldW, y: Math.random() * this.worldH,
      vy: 8 + Math.random() * 10, sway: Math.random() * Math.PI * 2,
      size: 3 + Math.random() * 3, hue: Utils.choice(['#E8A33D', '#C1503E', '#2F6F4E']),
    };
  }
  _newBird() {
    return {
      x: Math.random() * this.worldW, y: 80 + Math.random() * 200,
      speed: 30 + Math.random() * 20, wing: Math.random() * Math.PI * 2, dir: Math.random() < 0.5 ? 1 : -1,
    };
  }
  burst(x, y, color = '#E8A33D') {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.bursts.push({
        x, y, vx: Math.cos(a) * (40 + Math.random() * 60), vy: Math.sin(a) * (40 + Math.random() * 60),
        life: 0.6, maxLife: 0.6, color,
      });
    }
  }
  update(dt) {
    for (const l of this.leaves) {
      l.y += l.vy * dt; l.sway += dt * 2; l.x += Math.sin(l.sway) * 12 * dt;
      if (l.y > this.worldH) { l.y = -10; l.x = Math.random() * this.worldW; }
    }
    for (const b of this.birds) {
      b.x += b.speed * b.dir * dt; b.wing += dt * 10;
      if (b.x > this.worldW + 40) b.x = -40; if (b.x < -40) b.x = this.worldW + 40;
    }
    this.bursts.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.life -= dt; });
    this.bursts = this.bursts.filter((p) => p.life > 0);
  }
  draw(ctx, cam) {
    ctx.save();
    for (const l of this.leaves) {
      const s = cam.worldToScreen(l.x, l.y);
      if (s.x < -20 || s.x > cam.viewW + 20 || s.y < -20 || s.y > cam.viewH + 20) continue;
      ctx.fillStyle = l.hue; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, l.size, l.size * 0.6, l.sway, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 0.55;
    for (const b of this.birds) {
      const s = cam.worldToScreen(b.x, b.y);
      const flap = Math.sin(b.wing) * 5;
      ctx.strokeStyle = '#24312B'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x - 6, s.y - flap); ctx.lineTo(s.x, s.y);
      ctx.lineTo(s.x + 6, s.y - flap); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const p of this.bursts) {
      const s = cam.worldToScreen(p.x, p.y);
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

/* ==================== WORLD DATA ====================
   A real street grid: 5 columns x 3 rows of 400x400 blocks, with a
   river + single bridge crossing south to the Riverside Overlook.
   Buildings sit centered inside their block, set back from the roads. */
const GRID = { cols: 5, rows: 3, block: 400, roadWidth: 50 };
const WORLD = { w: GRID.cols * GRID.block, h: 1650 }; // 2000 x 1650

// River band south of the city grid + the single bridge crossing it.
const RIVER = { y: 1200, h: 70 };
const BRIDGE = { x: 740, w: 120 }; // centered on the x=800 street boundary (between columns 1 and 2)

// Buildings double as collidable landmarks and quest destinations.
// (internal `id`s are unchanged from earlier builds so quest/save data stays
// compatible — only the display `name` changes to match real JIU locations.)
const BUILDINGS = [
  { id: 'library', name: 'Library', x: 130, y: 150, w: 140, h: 100, color: '#7C9CBF', roof: '#4A6A8A' },
  { id: 'museum', name: 'Bliss Cafe', x: 1320, y: 145, w: 160, h: 110, color: '#C9A66B', roof: '#8C6F3E' },
  { id: 'busstop', name: 'Cafeteria', x: 1750, y: 570, w: 100, h: 60, color: '#B7C4C2', roof: '#6E8482' },
  { id: 'coffeeshop', name: 'EL Lecturers Office', x: 135, y: 553, w: 130, h: 95, color: '#B98555', roof: '#7A4E28' },
  { id: 'overlook', name: 'Riverside Overlook', x: 730, y: 1420, w: 140, h: 80, color: '#8FB88A', roof: '#4F7A4C' },
  // Landmark-only buildings referenced inside generated directions text.
  { id: 'bank', name: 'Dormitory', x: 545, y: 155, w: 110, h: 90, color: '#A9B4C0', roof: '#5A6773', landmarkOnly: true },
  { id: 'pharmacy', name: 'Manna Hall', x: 545, y: 558, w: 110, h: 85, color: '#E3B7B0', roof: '#B0645A', landmarkOnly: true },
  { id: 'cinema', name: 'Auditorium', x: 1735, y: 153, w: 130, h: 95, color: '#7A6A9C', roof: '#4B3E68' },
  { id: 'park', name: 'Park', x: 900, y: 120, w: 200, h: 160, color: '#8FBF80', roof: null, landmarkOnly: true, isPark: true },
];

const buildingById = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

/* ==================== DIRECTION GENERATOR ====================
   Builds a fresh, randomized "giving directions" sentence for a
   destination, using nearby landmarks -- so no two playthroughs
   produce identical text. Also derives a multiple-choice question
   and a typing-challenge target from the same generated sentence. */
class DirectionGenerator {
  static TEMPLATES = [
    (d) => `Go straight for ${d.distance} blocks, then turn ${d.turn} at the ${d.landmark}. The ${d.destination} is on your ${d.turn}.`,
    (d) => `Walk past the ${d.landmark}, cross the bridge over the river, and continue until you reach the ${d.destination}.`,
    (d) => `Turn ${d.turn} at the ${d.landmark}, go straight for ${d.distance} blocks, and you will find the ${d.destination} next to the river.`,
    (d) => `The ${d.destination} is next to the ${d.landmark}. Head ${d.compass}, then turn ${d.turn} at the corner.`,
    (d) => `From here, go ${d.compass} for ${d.distance} blocks. The ${d.destination} is opposite the ${d.landmark}.`,
  ];

  static generate(destinationId, excludeIds = []) {
    const dest = buildingById[destinationId];
    const candidates = BUILDINGS.filter((b) => b.id !== destinationId && !excludeIds.includes(b.id));
    const landmark = Utils.choice(candidates);
    const data = {
      destination: dest.name,
      landmark: landmark.name,
      turn: Utils.choice(['left', 'right']),
      distance: 1 + Math.floor(Math.random() * 4),
      compass: Utils.choice(['north', 'south', 'east', 'west']),
    };
    const template = Utils.choice(DirectionGenerator.TEMPLATES);
    const sentence = template(data);
    return { sentence, data, landmarkId: landmark.id, destinationId };
  }

  /** Multiple-choice question derived from a generated direction.
   *  Builds a distractor pool per question form, then samples ONCE so the
   *  correct answer is always guaranteed to be present in the final options. */
  static buildMultipleChoice(generated) {
    const forms = [];
    forms.push({
      question: `According to the directions, which place do you turn at?`,
      correct: generated.data.landmark,
      distractors: BUILDINGS.filter((b) => b.id !== generated.landmarkId && b.id !== generated.destinationId).map((b) => b.name),
    });
    const turnLabel = generated.data.turn.charAt(0).toUpperCase() + generated.data.turn.slice(1);
    forms.push({
      question: `Which direction does the traveler need to turn?`,
      correct: turnLabel,
      distractors: ['Left', 'Right', 'Straight only', "Doesn't say"].filter((o) => o !== turnLabel),
    });
    const chosen = Utils.choice(forms);
    const distractorPool = Array.from(new Set(chosen.distractors.filter((d) => d !== chosen.correct)));
    const picks = Utils.sample(distractorPool, Math.min(3, distractorPool.length));
    const options = Utils.sample([...picks, chosen.correct], picks.length + 1); // single sample = shuffle, correct guaranteed
    return { question: chosen.question, correct: chosen.correct, options };
  }

  /** Blanks out the landmark (present in every template) for the Fill-in-the-Blank mini-game. */
  static buildFillBlank(generated) {
    const answer = generated.data.landmark;
    const withBlank = generated.sentence.replace(answer, '_____');
    return { sentenceWithBlank: withBlank, answer, hint: answer.charAt(0) };
  }

  /** A true/false statement about the turn direction — false half the time via a flipped turn. */
  static buildTrueFalse(generated) {
    const isTrue = Math.random() < 0.5;
    const turn = generated.data.turn;
    const opposite = turn === 'left' ? 'right' : 'left';
    const shownTurn = isTrue ? turn : opposite;
    const statement = `True or False: the directions say to turn ${shownTurn} at the ${generated.data.landmark}.`;
    return { statement, isTrue };
  }

  /** Splits the generated sentence into orderable clauses for the Arrange Directions drag-and-drop game. */
  static buildArrangeChunks(generated) {
    let chunks = generated.sentence
      .replace(/\.$/, '')
      .split(/,\s+|(?<=\w)\.\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (chunks.length < 2) chunks = [generated.sentence]; // safety net, shouldn't happen with current templates
    return chunks; // array order IS the correct order
  }
}

/* ==================== QUEST DEFINITIONS ==================== */
class Quest {
  constructor(cfg) {
    Object.assign(this, cfg);
    this.status = cfg.status || 'locked'; // locked | ready | active | complete
    this.generated = null; // filled when the giver NPC issues it
    this.challengeType = cfg.challengeType;
  }
}

function buildQuestChain() {
  return [
    new Quest({ id: 'q1', title: 'Find the Library', giverId: 'npc_dewi', destinationId: 'library', xp: 40, coins: 15, challengeType: 'mc', status: 'ready' }),
    new Quest({ id: 'q2', title: 'Find Bliss Cafe', giverId: 'npc_rian', destinationId: 'museum', xp: 55, coins: 20, challengeType: 'typing' }),
    new Quest({ id: 'q3', title: 'Find the Cafeteria', giverId: 'npc_tania', destinationId: 'busstop', xp: 65, coins: 22, challengeType: 'arrange' }),
    new Quest({ id: 'q4', title: 'Find the EL Lecturers Office', giverId: 'npc_budi', destinationId: 'coffeeshop', xp: 75, coins: 25, challengeType: 'fillblank' }),
    // Showcases the remaining two mini-game types back-to-back.
    new Quest({ id: 'q5', title: 'Find the Riverside Overlook', giverId: 'npc_sri', destinationId: 'overlook', xp: 100, coins: 40, challengeType: 'final' }),
    // Capstone: no NPC, no minigame — a pure navigation task that bridges to
    // the real-world scavenger hunt. Triggered automatically once q5 completes.
    new Quest({ id: 'q6', title: 'From the Auditorium to the Library', giverId: null, destinationId: 'library', waypointId: 'cinema', xp: 150, coins: 60, challengeType: null }),
  ];
}

/* ==================== NPC ==================== */
class NPC {
  constructor(cfg) {
    Object.assign(this, cfg);
    this.animT = Math.random() * 10;
    this.patrolIdx = 0;
    this.patrolWait = Math.random() * 2;
    this.pos = { x: cfg.x, y: cfg.y };
    this.facing = 'down';
  }
  update(dt) {
    this.animT += dt;
    if (!this.waypoints || this.waypoints.length === 0) return;
    const target = this.waypoints[this.patrolIdx];
    const d = Utils.dist(this.pos.x, this.pos.y, target.x, target.y);
    if (d < 4) {
      if (this.patrolWait > 0) { this.patrolWait -= dt; return; }
      this.patrolIdx = (this.patrolIdx + 1) % this.waypoints.length;
      this.patrolWait = 1.2 + Math.random() * 1.6;
      return;
    }
    const spd = 26;
    this.pos.x += ((target.x - this.pos.x) / d) * spd * dt;
    this.pos.y += ((target.y - this.pos.y) / d) * spd * dt;
    this.facing = Math.abs(target.x - this.pos.x) > Math.abs(target.y - this.pos.y)
      ? (target.x > this.pos.x ? 'right' : 'left')
      : (target.y > this.pos.y ? 'down' : 'up');
  }
  draw(ctx, cam, highlighted) {
    const s = cam.worldToScreen(this.pos.x, this.pos.y);
    const bob = Math.sin(this.animT * 4) * 1.5;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 16, 12, 5, 0, 0, Math.PI * 2); ctx.fill();

    // ring for interactable NPCs
    if (highlighted) {
      const pulse = 1 + Math.sin(performance.now() / 220) * 0.08;
      ctx.strokeStyle = '#E8A33D'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(s.x, s.y + 4, 22 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#E8A33D'; ctx.font = '700 18px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('!', s.x, s.y - 30 + Math.sin(performance.now() / 180) * 3);
    }

    // body
    ctx.save();
    ctx.translate(s.x, s.y + bob);
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.ellipse(0, 4, 11, 14, 0, 0, Math.PI * 2); ctx.fill();
    // head
    ctx.fillStyle = '#F0C29B';
    ctx.beginPath(); ctx.arc(0, -14, 9, 0, Math.PI * 2); ctx.fill();
    // hat/hair accent
    ctx.fillStyle = this.accent;
    ctx.beginPath(); ctx.arc(0, -17, 9, Math.PI, 0); ctx.fill();
    ctx.restore();

    // name tag
    ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(36,49,43,0.85)';
    ctx.fillText(this.name, s.x, s.y - 34);
  }
}

/* ==================== PLAYER ==================== */
class Player {
  constructor(x, y) {
    this.pos = { x, y };
    this.vel = { x: 0, y: 0 };
    this.speed = 130;
    this.runMult = 1.7;
    this.facing = 'down';
    this.moving = false;
    this.running = false;
    this.animT = 0;
    this.w = 20; this.h = 24;
  }
  get rect() { return { x: this.pos.x - this.w / 2, y: this.pos.y - this.h / 2, w: this.w, h: this.h }; }
  /** analog: optional { x, y, active, running } from a virtual joystick.
   *  moveTarget: optional { x, y } world point from a click/tap-to-move.
   *  Priority: joystick > keyboard > click-to-move, so any manual input
   *  immediately takes back control from a queued click destination. */
  update(dt, input, solids, worldBounds, analog = null, moveTarget = null) {
    let dx = 0, dy = 0, running = false;
    const kbActive = input.has('up') || input.has('down') || input.has('left') || input.has('right');
    if (analog && analog.active) {
      dx = analog.x; dy = analog.y; running = !!analog.running;
    } else if (kbActive) {
      if (input.has('up')) dy -= 1;
      if (input.has('down')) dy += 1;
      if (input.has('left')) dx -= 1;
      if (input.has('right')) dx += 1;
      running = input.has('run');
    } else if (moveTarget) {
      const ddx = moveTarget.x - this.pos.x, ddy = moveTarget.y - this.pos.y;
      const d = Math.hypot(ddx, ddy);
      if (d > 4) { dx = ddx / d; dy = ddy / d; }
      running = false;
    }
    this.moving = dx !== 0 || dy !== 0;
    this.running = this.moving && running;
    if (this.moving) {
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const spd = this.speed * (this.running ? this.runMult : 1);
      const nx = this.pos.x + dx * spd * dt;
      const ny = this.pos.y + dy * spd * dt;

      // axis-separated collision so sliding along walls feels natural
      if (!this._collides(nx, this.pos.y, solids)) this.pos.x = nx;
      if (!this._collides(this.pos.x, ny, solids)) this.pos.y = ny;

      if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? 'right' : 'left';
      else this.facing = dy > 0 ? 'down' : 'up';

      this.animT += dt * (this.running ? 10 : 6);
    }
    this.pos.x = Utils.clamp(this.pos.x, 12, worldBounds.w - 12);
    this.pos.y = Utils.clamp(this.pos.y, 12, worldBounds.h - 12);
  }
  _collides(x, y, solids) {
    const r = { x: x - this.w / 2, y: y - this.h / 2, w: this.w, h: this.h };
    for (const s of solids) {
      if (Utils.aabb(r.x, r.y, r.w, r.h, s.x, s.y, s.w, s.h)) return true;
    }
    return false;
  }
  draw(ctx, cam) {
    const s = cam.worldToScreen(this.pos.x, this.pos.y);
    const walkBob = this.moving ? Math.abs(Math.sin(this.animT)) * 3 : 0;

    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 16, 12, 5, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(s.x, s.y - walkBob);

    // legs (simple alternating steps)
    const stride = this.moving ? Math.sin(this.animT) * 6 : 0;
    ctx.strokeStyle = '#3B4A63'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-4, 10); ctx.lineTo(-4 + stride, 19); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 10); ctx.lineTo(4 - stride, 19); ctx.stroke();

    // backpack
    ctx.fillStyle = '#C1503E';
    ctx.beginPath(); ctx.roundRect(-9, -4, 8, 14, 3); ctx.fill();

    // body
    ctx.fillStyle = '#E8A33D';
    ctx.beginPath(); ctx.ellipse(0, 2, 11, 13, 0, 0, Math.PI * 2); ctx.fill();

    // head
    ctx.fillStyle = '#F0C29B';
    ctx.beginPath(); ctx.arc(0, -15, 9.5, 0, Math.PI * 2); ctx.fill();

    // hair
    ctx.fillStyle = '#3A2A1E';
    ctx.beginPath(); ctx.arc(0, -18.5, 9.5, Math.PI, 0); ctx.fill();

    // facing indicator (simple eyes offset by facing direction)
    const eyeOff = { up: [0, -3], down: [0, 1], left: [-3, -1], right: [3, -1] }[this.facing];
    ctx.fillStyle = '#24312B';
    ctx.beginPath(); ctx.arc(eyeOff[0] - 2, -15 + eyeOff[1], 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(eyeOff[0] + 2, -15 + eyeOff[1], 1.3, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }
}

/* ==================== TYPING ENGINE ==================== */
class TypingEngine {
  static evaluate(target, typed, elapsedSeconds) {
    const similarity = Utils.similarity(target, typed); // 0..1
    const words = Utils.normalizeText(typed).split(' ').filter(Boolean);
    const wpm = elapsedSeconds > 0 ? Math.round((words.length / elapsedSeconds) * 60) : 0;
    const targetNorm = Utils.normalizeText(target);
    const typedNorm = Utils.normalizeText(typed);
    const errors = Utils.levenshtein(targetNorm, typedNorm);
    const accuracy = Math.round(similarity * 100);
    return { similarity, accuracy, wpm, errors, pass: accuracy >= 78 };
  }
}

/* ==================== UI MANAGER ==================== */
class UIManager {
  constructor(game) {
    this.game = game;
    this.el = {
      hudLevel: document.getElementById('hudLevel'),
      xpBarFill: document.getElementById('xpBarFill'),
      hudXpLabel: document.getElementById('hudXpLabel'),
      questTrackerText: document.getElementById('questTrackerText'),
      hudCoins: document.getElementById('hudCoins'),
      hudClock: document.getElementById('hudClock'),
      interactPrompt: document.getElementById('interactPrompt'),
      notifyStack: document.getElementById('notifyStack'),
      dialogueBox: document.getElementById('dialogueBox'),
      dlgPortrait: document.getElementById('dlgPortrait'),
      dlgName: document.getElementById('dlgName'),
      dlgText: document.getElementById('dlgText'),
      dlgChoices: document.getElementById('dlgChoices'),
      challengeModal: document.getElementById('challengeModal'),
      challengeCard: document.getElementById('challengeCard'),
      journalModal: document.getElementById('journalModal'),
      journalList: document.getElementById('journalList'),
      pauseModal: document.getElementById('pauseModal'),
      minimapCanvas: document.getElementById('minimapCanvas'),
      btnMute: document.getElementById('btnMute'),
    };
  }
  updateHUD(p) {
    this.el.hudLevel.textContent = p.level;
    const need = p.xpToNext;
    this.el.xpBarFill.style.width = `${Utils.clamp((p.xp / need) * 100, 0, 100)}%`;
    this.el.hudXpLabel.textContent = `${p.xp} / ${need} XP`;
    this.el.hudCoins.textContent = p.coins;
  }
  updateClock(label) { this.el.hudClock.textContent = label; }
  updateQuestTracker(text) { this.el.questTrackerText.textContent = text; }
  showInteractPrompt(show) { this.el.interactPrompt.classList.toggle('hidden', !show); }

  notify(title, body = '', kind = 'info') {
    const div = document.createElement('div');
    div.className = `toast ${kind}`;
    div.innerHTML = `<b>${title}</b>${body ? `<span>${body}</span>` : ''}`;
    this.el.notifyStack.appendChild(div);
    setTimeout(() => {
      div.classList.add('leaving');
      setTimeout(() => div.remove(), 300);
    }, 3200);
  }

  renderJournal(quests) {
    this.el.journalList.innerHTML = '';
    quests.forEach((q) => {
      const div = document.createElement('div');
      div.className = `journal-item ${q.status === 'active' ? 'active' : ''} ${q.status === 'complete' ? 'done' : ''}`;
      const statusLabel = { locked: 'Locked', ready: 'Available', active: 'In Progress', complete: 'Complete' }[q.status];
      div.innerHTML = `<div class="jq-title">${q.title}</div>
        <div class="jq-desc">Reward: ${q.xp} XP · ${q.coins} coins</div>
        <span class="jq-status">${statusLabel}</span>`;
      this.el.journalList.appendChild(div);
    });
  }
}

/* ==================== DIALOGUE CONTROLLER ==================== */
class DialogueController {
  constructor(ui, audio) {
    this.ui = ui; this.audio = audio;
    this.typing = false; this.fullText = ''; this.charIdx = 0; this.typeTimer = null;
    document.getElementById('dlgSkip').addEventListener('click', () => this.skipTyping());
  }
  show(name, initials, color, text, choices = []) {
    this.ui.el.dialogueBox.classList.remove('hidden');
    this.ui.el.dlgName.textContent = name;
    this.ui.el.dlgPortrait.textContent = initials;
    this.ui.el.dlgPortrait.style.background = color;
    this.ui.el.dlgChoices.innerHTML = '';
    this._typeText(text, () => {
      choices.forEach((c) => {
        const btn = document.createElement('button');
        btn.textContent = c.label;
        btn.onclick = () => { this.audio.click(); c.onClick(); };
        this.ui.el.dlgChoices.appendChild(btn);
      });
    });
  }
  _typeText(text, onDone) {
    clearInterval(this.typeTimer);
    this.fullText = text; this.charIdx = 0; this.typing = true;
    this.ui.el.dlgText.innerHTML = '';
    this.typeTimer = setInterval(() => {
      this.charIdx += 2;
      const shown = this.fullText.slice(0, this.charIdx);
      this.ui.el.dlgText.innerHTML = `${shown}<span class="cursor">&nbsp;</span>`;
      if (this.charIdx % 6 === 0) this.audio.talk();
      if (this.charIdx >= this.fullText.length) {
        clearInterval(this.typeTimer);
        this.typing = false;
        this.ui.el.dlgText.textContent = this.fullText;
        onDone && onDone();
      }
    }, 18);
  }
  skipTyping() {
    if (this.typing) {
      clearInterval(this.typeTimer);
      this.typing = false;
      this.ui.el.dlgText.textContent = this.fullText;
    }
  }
  hide() { this.ui.el.dialogueBox.classList.add('hidden'); clearInterval(this.typeTimer); }
}

/* ==================== CHALLENGE MANAGER (mini-games) ==================== */
class ChallengeManager {
  constructor(ui, audio, particles, cam) {
    this.ui = ui; this.audio = audio; this.particles = particles; this.cam = cam;
  }
  open(quest, generated, onResolve) {
    this.ui.el.challengeModal.classList.remove('hidden');
    const renderers = {
      mc: this._renderMC, typing: this._renderTyping, arrange: this._renderArrange,
      fillblank: this._renderFillBlank, truefalse: this._renderTrueFalse, map: this._renderMapClick,
      final: this._renderFinal,
    };
    (renderers[quest.challengeType] || this._renderTyping).call(this, quest, generated, onResolve);
  }
  close() { this.ui.el.challengeModal.classList.add('hidden'); }

  /** Final quest showcases the two remaining mini-game types back-to-back. */
  _renderFinal(quest, generated, onResolve) {
    this._renderTrueFalse(quest, generated, (r1) => {
      if (!r1.pass) { onResolve({ pass: false, score: r1.score }); return; }
      this.ui.el.challengeModal.classList.remove('hidden');
      this._renderMapClick(quest, generated, (r2) => {
        onResolve({ pass: r2.pass, score: (r1.score || 0) + (r2.score || 0) });
      });
    });
  }

  _renderMC(quest, generated, onResolve) {
    const q = DirectionGenerator.buildMultipleChoice(generated);
    const card = this.ui.el.challengeCard;
    card.innerHTML = `
      <h2>Comprehension Check</h2>
      <div class="challenge-sub">Multiple Choice · 20 pts</div>
      <div class="challenge-prompt">${generated.sentence}</div>
      <p style="font-weight:600; margin: 0 0 10px;">${q.question}</p>
      <div class="mc-options" id="mcOptions"></div>
    `;
    const wrap = card.querySelector('#mcOptions');
    q.options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.className = 'mc-option';
      btn.textContent = opt;
      btn.onclick = () => {
        const isCorrect = opt === q.correct;
        [...wrap.children].forEach((b) => (b.disabled = true));
        btn.classList.add(isCorrect ? 'correct' : 'wrong');
        if (isCorrect) this.audio.correct(); else {
          this.audio.wrong();
          [...wrap.children].find((b) => b.textContent === q.correct)?.classList.add('correct');
        }
        setTimeout(() => { this.close(); onResolve({ pass: isCorrect, score: isCorrect ? 20 : 8 }); }, 900);
      };
      wrap.appendChild(btn);
    });
  }

  _renderTyping(quest, generated, onResolve) {
    const card = this.ui.el.challengeCard;
    card.innerHTML = `
      <h2>Typing Challenge</h2>
      <div class="challenge-sub">Retype the directions · 40 pts</div>
      <div class="challenge-prompt">${generated.sentence}</div>
      <textarea class="typing-textarea" id="typingInput" placeholder="Type the directions exactly as shown…"></textarea>
      <button class="hint-btn" id="hintBtn">Need a hint?</button>
      <div class="typing-stats" id="typingStats"></div>
      <div class="challenge-actions">
        <button class="btn btn-primary" id="submitTyping">Submit</button>
      </div>
    `;
    const startTime = performance.now();
    const input = card.querySelector('#typingInput');
    input.focus();
    card.querySelector('#hintBtn').onclick = () => {
      const words = generated.sentence.split(' ');
      const hint = words.slice(0, Math.ceil(words.length / 3)).join(' ') + ' …';
      card.querySelector('#typingStats').textContent = `Hint: starts with "${hint}"`;
    };
    card.querySelector('#submitTyping').onclick = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      const result = TypingEngine.evaluate(generated.sentence, input.value, elapsed);
      card.innerHTML = `
        <div class="result-banner ${result.pass ? 'pass' : 'fail'}">
          ${result.pass ? '✅ Great job!' : '📝 Almost — review and try again'}
        </div>
        <div class="typing-stats">
          <span>Accuracy: ${result.accuracy}%</span>
          <span>WPM: ${result.wpm}</span>
          <span>Errors: ${result.errors}</span>
        </div>
        <div class="challenge-actions">
          ${result.pass
            ? '<button class="btn btn-primary" id="continueBtn">Continue</button>'
            : '<button class="btn btn-secondary" id="retryBtn">Try Again</button>'}
        </div>`;
      if (result.pass) { this.audio.correct(); } else { this.audio.wrong(); }
      const cont = card.querySelector('#continueBtn');
      if (cont) cont.onclick = () => { this.close(); onResolve({ pass: true, score: Math.round(20 + result.accuracy / 5) }); };
      const retry = card.querySelector('#retryBtn');
      if (retry) retry.onclick = () => this._renderTyping(quest, generated, onResolve);
    };
  }

  /** Drag-and-drop reordering of the direction's clauses (with ▲/▼ buttons as a touch-friendly fallback). */
  _renderArrange(quest, generated, onResolve) {
    const chunks = DirectionGenerator.buildArrangeChunks(generated);
    const order = Utils.sample(chunks.map((_, i) => i), chunks.length); // shuffled display order (indices into chunks)
    const card = this.ui.el.challengeCard;
    card.innerHTML = `
      <h2>Arrange the Directions</h2>
      <div class="challenge-sub">Drag and Drop · 20 pts</div>
      <p style="font-size:.85rem;color:var(--ink-soft);margin:0 0 12px;">Put the steps in the correct order.</p>
      <div id="arrangeList" style="display:flex;flex-direction:column;gap:8px;"></div>
      <div class="challenge-actions"><button class="btn btn-primary" id="submitArrange">Check Order</button></div>
    `;
    const list = card.querySelector('#arrangeList');
    order.forEach((origIdx) => list.appendChild(this._makeDragItem(chunks[origIdx], origIdx)));

    let dragEl = null;
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const after = this._dragAfterElement(list, e.clientY);
      if (!dragEl) return;
      if (after == null) list.appendChild(dragEl); else list.insertBefore(dragEl, after);
    });
    list.querySelectorAll('.drag-item').forEach((item) => {
      item.addEventListener('dragstart', () => { dragEl = item; item.classList.add('dragging'); });
      item.addEventListener('dragend', () => { item.classList.remove('dragging'); dragEl = null; });
    });

    card.querySelector('#submitArrange').onclick = () => {
      const domOrder = [...list.querySelectorAll('.drag-item')].map((el) => Number(el.dataset.idx));
      const correctCount = domOrder.filter((idx, pos) => idx === pos).length;
      const pass = correctCount === chunks.length;
      list.querySelectorAll('.drag-item').forEach((el, pos) => {
        el.classList.add(Number(el.dataset.idx) === pos ? 'correct' : 'wrong');
      });
      if (pass) this.audio.correct(); else this.audio.wrong();
      setTimeout(() => {
        if (pass) { this.close(); onResolve({ pass: true, score: 20 }); }
        else this._renderArrange(quest, generated, onResolve); // fresh shuffle on retry
      }, 900);
    };
  }
  _makeDragItem(text, origIdx) {
    const div = document.createElement('div');
    div.className = 'drag-item mc-option';
    div.draggable = true;
    div.dataset.idx = String(origIdx);
    div.style.display = 'flex'; div.style.alignItems = 'center'; div.style.gap = '10px'; div.style.cursor = 'grab';
    div.innerHTML = `<span style="opacity:.5;">⋮⋮</span><span style="flex:1;">${text}</span>
      <span style="display:flex;flex-direction:column;gap:2px;">
        <button type="button" class="icon-btn" data-move="up" style="width:22px;height:22px;font-size:.65rem;">▲</button>
        <button type="button" class="icon-btn" data-move="down" style="width:22px;height:22px;font-size:.65rem;">▼</button>
      </span>`;
    div.querySelector('[data-move="up"]').onclick = () => { if (div.previousElementSibling) div.parentNode.insertBefore(div, div.previousElementSibling); };
    div.querySelector('[data-move="down"]').onclick = () => { if (div.nextElementSibling) div.parentNode.insertBefore(div.nextElementSibling, div); };
    return div;
  }
  _dragAfterElement(container, y) {
    const items = [...container.querySelectorAll('.drag-item:not(.dragging)')];
    return items.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
    }, { offset: -Infinity }).element;
  }

  /** Type the missing landmark back into the blanked-out sentence, with fuzzy matching for minor typos. */
  _renderFillBlank(quest, generated, onResolve) {
    const fb = DirectionGenerator.buildFillBlank(generated);
    const card = this.ui.el.challengeCard;
    card.innerHTML = `
      <h2>Fill in the Blank</h2>
      <div class="challenge-sub">10 pts</div>
      <div class="challenge-prompt">${fb.sentenceWithBlank}</div>
      <input type="text" class="typing-textarea" id="blankInput" placeholder="What goes in the blank?" style="min-height:auto;">
      <button class="hint-btn" id="blankHint">Need a hint?</button>
      <div class="challenge-actions"><button class="btn btn-primary" id="submitBlank">Submit</button></div>
    `;
    const input = card.querySelector('#blankInput');
    input.focus();
    card.querySelector('#blankHint').onclick = () => { input.placeholder = `Starts with "${fb.hint}"…`; };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') card.querySelector('#submitBlank').click(); });
    card.querySelector('#submitBlank').onclick = () => {
      const similarity = Utils.similarity(fb.answer, input.value);
      const pass = similarity >= 0.72;
      if (pass) this.audio.correct(); else this.audio.wrong();
      card.innerHTML = `
        <div class="result-banner ${pass ? 'pass' : 'fail'}">${pass ? '✅ Correct!' : `📝 Not quite — the answer was "${fb.answer}"`}</div>
        <div class="challenge-actions">
          ${pass ? '<button class="btn btn-primary" id="contBlank">Continue</button>' : '<button class="btn btn-secondary" id="retryBlank">Try Again</button>'}
        </div>`;
      const cont = card.querySelector('#contBlank');
      if (cont) cont.onclick = () => { this.close(); onResolve({ pass: true, score: 10 }); };
      const retry = card.querySelector('#retryBlank');
      if (retry) retry.onclick = () => this._renderFillBlank(quest, generated, onResolve);
    };
  }

  /** Simple true/false comprehension check on the turn direction. */
  _renderTrueFalse(quest, generated, onResolve) {
    const tf = DirectionGenerator.buildTrueFalse(generated);
    const card = this.ui.el.challengeCard;
    card.innerHTML = `
      <h2>True or False</h2>
      <div class="challenge-sub">10 pts</div>
      <div class="challenge-prompt">${generated.sentence}</div>
      <p style="font-weight:600;margin:0 0 14px;">${tf.statement}</p>
      <div class="mc-options">
        <button class="mc-option" id="tfTrue">True</button>
        <button class="mc-option" id="tfFalse">False</button>
      </div>
    `;
    const resolve = (choseTrue) => {
      const isCorrect = choseTrue === tf.isTrue;
      const btn = choseTrue ? card.querySelector('#tfTrue') : card.querySelector('#tfFalse');
      btn.classList.add(isCorrect ? 'correct' : 'wrong');
      card.querySelectorAll('.mc-option').forEach((b) => (b.disabled = true));
      if (isCorrect) this.audio.correct(); else this.audio.wrong();
      setTimeout(() => { this.close(); onResolve({ pass: isCorrect, score: isCorrect ? 10 : 4 }); }, 800);
    };
    card.querySelector('#tfTrue').onclick = () => resolve(true);
    card.querySelector('#tfFalse').onclick = () => resolve(false);
  }

  /** Click the correct destination among a few landmark markers on a simplified map. */
  _renderMapClick(quest, generated, onResolve) {
    const card = this.ui.el.challengeCard;
    const dest = buildingById[generated.destinationId];
    const distractors = Utils.sample(BUILDINGS.filter((b) => b.id !== dest.id), 3);
    const markers = Utils.sample([...distractors, dest], 4); // full shuffle, destination guaranteed present
    card.innerHTML = `
      <h2>Read the Map</h2>
      <div class="challenge-sub">Interactive Map · 20 pts</div>
      <p style="font-weight:600;margin:0 0 10px;">Click the <b>${dest.name}</b> on the map below.</p>
      <canvas id="mapChallengeCanvas" width="460" height="260" style="width:100%;border-radius:10px;border:1.5px solid var(--stone);cursor:pointer;display:block;"></canvas>
    `;
    const canvas = card.querySelector('#mapChallengeCanvas');
    const mctx = canvas.getContext('2d');
    const positions = markers.map((b, i) => ({ b, x: 90 + (i % 2) * 280, y: 70 + Math.floor(i / 2) * 130 }));
    const draw = () => {
      mctx.fillStyle = '#DCE7C8'; mctx.fillRect(0, 0, 460, 260);
      positions.forEach((p) => {
        mctx.fillStyle = '#8C6F3E';
        mctx.beginPath(); mctx.arc(p.x, p.y, 15, 0, Math.PI * 2); mctx.fill();
        mctx.fillStyle = '#24312B'; mctx.font = '600 12px Inter, sans-serif'; mctx.textAlign = 'center';
        mctx.fillText(p.b.name, p.x, p.y + 34);
      });
    };
    draw();
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX, cy = (e.clientY - rect.top) * scaleY;
      const hit = positions.find((p) => Utils.dist(cx, cy, p.x, p.y) < 22);
      if (!hit) return;
      const isCorrect = hit.b.id === dest.id;
      mctx.fillStyle = isCorrect ? 'rgba(91,140,90,0.4)' : 'rgba(193,80,62,0.4)';
      mctx.beginPath(); mctx.arc(hit.x, hit.y, 19, 0, Math.PI * 2); mctx.fill();
      if (isCorrect) this.audio.correct(); else this.audio.wrong();
      setTimeout(() => { this.close(); onResolve({ pass: isCorrect, score: isCorrect ? 20 : 8 }); }, 700);
    }, { once: true });
  }
}

/* ==================== MAIN GAME ==================== */
class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.minimapCanvas = document.getElementById('minimapCanvas');
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    this.audio = new AudioManager();
    this.sheets = new GoogleSheetManager();
    this.cam = new Camera(WORLD.w, WORLD.h);
    this.particles = new ParticleSystem(WORLD.w, WORLD.h);
    this.ui = new UIManager(this);
    this.dialogue = new DialogueController(this.ui, this.audio);
    this.challenges = new ChallengeManager(this.ui, this.audio, this.particles, this.cam);

    this.input = new Set();
    this.touchVector = { x: 0, y: 0, active: false, running: false };
    this.moveTarget = null; // world-space click/tap-to-move destination
    this.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.timeOfDay = 0.3; // 0..1 cycling
    this.state = 'menu'; // menu | howto | playing | paused
    this.lastT = 0;
    this._rotateHintDismissed = false;

    this.quests = buildQuestChain();
    this.player = new Player(1000, 700);
    this.profile = { name: '', id: '', level: 1, xp: 0, xpToNext: 100, coins: 0, achievements: [] };

    this._buildNPCs();
    this._bindUI();
    if (this.isTouch) this._setupMobileControls();
    this._resize();
    window.addEventListener('resize', () => { this._resize(); this._updateRotateHint(); });
    window.addEventListener('orientationchange', () => setTimeout(() => this._updateRotateHint(), 250));
  }

  _buildNPCs() {
    this.npcs = [
      // Near the spawn plaza — sends the player to the Library.
      new NPC({ id: 'npc_dewi', name: 'Officer Dewi', occupation: 'Police Officer', x: 1000, y: 650, color: '#4A6A8A', accent: '#24314A', initials: 'PD',
        idleLines: ["The streets are safe today. Let me know if you need directions."], waypoints: [{ x: 1000, y: 650 }, { x: 1050, y: 660 }, { x: 1000, y: 680 }] }),
      // Near the Library — sends the player to Bliss Cafe.
      new NPC({ id: 'npc_rian', name: 'Rian', occupation: 'Student', x: 220, y: 300, color: '#5B8C5A', accent: '#2F4E2C', initials: 'R',
        idleLines: ['Just heading to class. This city is easy to get lost in!'], waypoints: [{ x: 220, y: 300 }, { x: 260, y: 320 }] }),
      // Near Bliss Cafe — sends the player to the Cafeteria.
      new NPC({ id: 'npc_tania', name: 'Ms. Tania', occupation: 'Teacher', x: 1400, y: 290, color: '#C1503E', accent: '#7A2D22', initials: 'MT',
        idleLines: ["I teach nearby. Lovely afternoon, isn't it?"], waypoints: [{ x: 1400, y: 290 }, { x: 1440, y: 270 }] }),
      // Near the Cafeteria — sends the player to the EL Lecturers Office.
      new NPC({ id: 'npc_budi', name: 'Pak Budi', occupation: 'Street Vendor', x: 1800, y: 660, color: '#E8A33D', accent: '#8C5A16', initials: 'PB',
        idleLines: ["Fresh snacks here! Come back after your errands."], waypoints: [{ x: 1800, y: 660 }, { x: 1840, y: 660 }] }),
      // Near the EL Lecturers Office — sends the player to the Riverside Overlook.
      new NPC({ id: 'npc_sri', name: 'Grandma Sri', occupation: 'Retired Nurse', x: 200, y: 690, color: '#9C7AA6', accent: '#5C3D66', initials: 'GS',
        idleLines: ["I like to sit here and watch the river."], waypoints: [{ x: 200, y: 690 }] }),
    ];
    this.npcById = Object.fromEntries(this.npcs.map((n) => [n.id, n]));
  }

  _bindUI() {
    // Main menu
    document.getElementById('playerForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('inputName').value.trim();
      if (!name) return;
      this.profile.name = name;
      this._startNewGame();
    });
    document.getElementById('btnHowTo').addEventListener('click', () => this._switchScreen('howToScreen'));
    document.getElementById('btnHowToBack').addEventListener('click', () => this._switchScreen('mainMenu'));
    const btnContinue = document.getElementById('btnContinue');
    if (SaveManager.exists()) { btnContinue.disabled = false; }
    btnContinue.addEventListener('click', () => this._continueGame());

    // HUD
    document.getElementById('btnMute').addEventListener('click', (e) => {
      const muted = this.audio.toggleMute();
      e.target.textContent = muted ? '🔇' : '🔊';
    });
    document.getElementById('btnJournal').addEventListener('click', () => this._toggleJournal(true));
    document.getElementById('btnJournalClose').addEventListener('click', () => this._toggleJournal(false));
    document.getElementById('btnPause').addEventListener('click', () => this._togglePause(true));
    document.getElementById('btnResume').addEventListener('click', () => this._togglePause(false));
    document.getElementById('btnSaveNow').addEventListener('click', () => { this._save(); this.ui.notify('Saved', 'Your progress has been saved.', 'success'); });
    document.getElementById('btnQuitMenu').addEventListener('click', () => window.location.reload());
    document.getElementById('btnFinalInstructionClose').addEventListener('click', () => {
      document.getElementById('finalInstructionModal').classList.add('hidden');
      this.state = 'playing';
    });
    const volSlider = document.getElementById('volumeSlider');
    volSlider.value = this.audio.volume * 100;
    volSlider.addEventListener('input', (e) => this.audio.setVolume(e.target.value / 100));

    // Keyboard
    const keyMap = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', ShiftLeft: 'run', ShiftRight: 'run' };
    window.addEventListener('keydown', (e) => {
      if (keyMap[e.code]) this.input.add(keyMap[e.code]);
      if (e.code === 'KeyE') this._tryInteract();
      if (e.code === 'KeyJ') this._toggleJournal();
      if (e.code === 'Escape') this._togglePause();
    });
    window.addEventListener('keyup', (e) => { if (keyMap[e.code]) this.input.delete(keyMap[e.code]); });

    // Click/tap on canvas: an NPC tap talks to them; anywhere else walks the player there.
    this.canvas.addEventListener('click', (e) => {
      if (this.state !== 'playing') return;
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const tapRadius = this.isTouch ? 34 : 26;
      for (const npc of this.npcs) {
        const s = this.cam.worldToScreen(npc.pos.x, npc.pos.y);
        if (Utils.dist(sx, sy, s.x, s.y) < tapRadius) { this._tryInteract(npc); return; }
      }
      const world = this.cam.screenToWorld(sx, sy);
      this.moveTarget = { x: Utils.clamp(world.x, 12, WORLD.w - 12), y: Utils.clamp(world.y, 12, WORLD.h - 12) };
      this.audio.click();
    });
  }

  /** Sets up the on-screen virtual joystick + Talk button + fullscreen toggle
   *  for touch-capable devices. Uses Pointer Events so it works uniformly
   *  across touch, mouse, and pen. */
  _setupMobileControls() {
    document.body.classList.add('touch-device');
    document.getElementById('mobileControls').classList.remove('hidden');
    this._updateRotateHint();

    const base = document.getElementById('joystickBase');
    const knob = document.getElementById('joystickKnob');
    const radius = 40; // max knob travel in px
    let activePointerId = null;
    let center = { x: 0, y: 0 };

    const updateFromEvent = (e) => {
      let dx = e.clientX - center.x, dy = e.clientY - center.y;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, radius);
      const angle = Math.atan2(dy, dx);
      const kx = Math.cos(angle) * clamped, ky = Math.sin(angle) * clamped;
      knob.style.transform = `translate(-50%, -50%) translate(${kx}px, ${ky}px)`;
      const mag = clamped / radius;
      this.touchVector = { x: kx / radius, y: ky / radius, active: mag > 0.08, running: mag > 0.72 };
    };
    const start = (e) => {
      if (activePointerId !== null) return;
      activePointerId = e.pointerId;
      base.setPointerCapture(e.pointerId);
      const rect = base.getBoundingClientRect();
      center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      updateFromEvent(e);
    };
    const move = (e) => { if (e.pointerId === activePointerId) updateFromEvent(e); };
    const end = (e) => {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      knob.style.transform = 'translate(-50%, -50%)';
      this.touchVector = { x: 0, y: 0, active: false, running: false };
    };
    base.addEventListener('pointerdown', start);
    base.addEventListener('pointermove', move);
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);

    // Touch "Talk" button — mirrors the E key / click-to-talk interaction.
    document.getElementById('btnTouchInteract').addEventListener('click', () => this._tryInteract());

    // Fullscreen toggle (hides the browser chrome for more play area on phones).
    const fsBtn = document.getElementById('btnFullscreen');
    fsBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.();
    });

    // Dismissible "rotate to landscape" suggestion for narrow portrait phones.
    document.getElementById('rotateHintClose').addEventListener('click', () => {
      this._rotateHintDismissed = true;
      this._updateRotateHint();
    });
  }

  _updateRotateHint() {
    const hint = document.getElementById('rotateHint');
    if (!hint) return;
    const portraitPhone = window.innerWidth < window.innerHeight && window.innerWidth < 560;
    hint.classList.toggle('hidden', !(portraitPhone && !this._rotateHintDismissed && this.isTouch));
  }

  _switchScreen(id) {
    ['loadingScreen', 'mainMenu', 'howToScreen'].forEach((s) => document.getElementById(s).classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cam.resize(window.innerWidth, window.innerHeight);
  }

  /* ---------- boot sequence ---------- */
  boot() {
    let pct = 0;
    const bar = document.getElementById('loadingBarFill');
    const label = document.getElementById('loadingLabel');
    const labels = ['Unfolding the map…', 'Sketching the riverside…', 'Waking up the townsfolk…', 'Sharpening pencils…'];
    const timer = setInterval(() => {
      pct += 14 + Math.random() * 10;
      bar.style.width = Math.min(pct, 100) + '%';
      label.textContent = Utils.choice(labels);
      if (pct >= 100) {
        clearInterval(timer);
        setTimeout(() => { document.getElementById('loadingScreen').classList.add('hidden'); this._switchScreen('mainMenu'); }, 250);
      }
    }, 220);
    requestAnimationFrame((t) => this._loop(t));
  }

  _startNewGame() {
    SaveManager.clear();
    this.state = 'playing';
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('gameRoot').classList.remove('hidden');
    this.quests[0].status = 'ready';
    this.sessionStartTime = Date.now();
    this.sheets.logSessionStart(this.profile);
    this.ui.notify(`Welcome, ${this.profile.name}!`, 'Explore Riverside and talk to Officer Dewi to begin.', 'success');
    this._refreshQuestTracker();
    this._updateHUD();
    this._save();
    this._updateRotateHint();
  }

  _continueGame() {
    const data = SaveManager.load();
    if (!data) return;
    this.profile = data.profile;
    this.player.pos = { ...data.playerPos };
    this.quests.forEach((q) => {
      const saved = data.quests.find((s) => s.id === q.id);
      if (saved) {
        q.status = saved.status;
        q.challengePassed = saved.challengePassed;
        q.generated = saved.generated || null;
      }
    });
    this.state = 'playing';
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('gameRoot').classList.remove('hidden');
    this.sessionStartTime = Date.now();
    this.sheets.logSessionStart(this.profile);
    this.ui.notify(`Welcome back, ${this.profile.name}!`, 'Your journey continues.', 'success');
    this._refreshQuestTracker();
    this._updateHUD();
    this._updateRotateHint();
  }

  _save() {
    SaveManager.save({
      profile: this.profile,
      playerPos: this.player.pos,
      quests: this.quests.map((q) => ({ id: q.id, status: q.status, challengePassed: q.challengePassed || false, generated: q.generated || null })),
      savedAt: Date.now(),
    });
  }

  /* ---------- quest / interaction logic ---------- */
  _activeQuest() { return this.quests.find((q) => q.status === 'ready' || q.status === 'active'); }

  _npcNearby(radius = 46) {
    let closest = null, closestD = radius;
    for (const npc of this.npcs) {
      const d = Utils.dist(this.player.pos.x, this.player.pos.y, npc.pos.x, npc.pos.y);
      if (d < closestD) { closest = npc; closestD = d; }
    }
    return closest;
  }

  _tryInteract(forceNpc = null) {
    if (this.state !== 'playing') return;
    const npc = forceNpc || this._npcNearby();
    if (!npc) return;
    this.audio.click();
    const quest = this._activeQuest();

    if (quest && quest.giverId === npc.id && quest.status === 'ready') {
      // Issue new directions
      const excluded = [quest.destinationId];
      quest.generated = DirectionGenerator.generate(quest.destinationId, excluded);
      quest.status = 'active';
      this.state = 'dialogue';
      this.dialogue.show(npc.name, npc.initials, npc.color,
        `Ah, a traveler! You're looking for the ${buildingById[quest.destinationId].name}? ${quest.generated.sentence}`,
        [{ label: "Got it, let's go!", onClick: () => this._openChallenge(quest, npc) }]
      );
      return;
    }

    if (quest && quest.giverId === npc.id && quest.status === 'active' && !quest.challengePassed) {
      this.state = 'dialogue';
      this.dialogue.show(npc.name, npc.initials, npc.color,
        `Remember: ${quest.generated.sentence}`,
        [{ label: 'Ask again', onClick: () => this._openChallenge(quest, npc) }, { label: 'Okay', onClick: () => this._closeDialogue() }]
      );
      return;
    }

    if (quest && quest.giverId === npc.id && quest.challengePassed) {
      this.state = 'dialogue';
      this.dialogue.show(npc.name, npc.initials, npc.color,
        `${quest.generated.sentence} — Good luck finding it!`,
        [{ label: 'Okay', onClick: () => this._closeDialogue() }]
      );
      return;
    }

    // idle chatter for non-quest NPCs
    this.state = 'dialogue';
    this.dialogue.show(npc.name, npc.initials, npc.color, Utils.choice(npc.idleLines),
      [{ label: 'Okay', onClick: () => this._closeDialogue() }]);
  }

  _openChallenge(quest, npc) {
    this._closeDialogue(false);
    this.state = 'challenge';
    quest.attempts = (quest.attempts || 0) + 1;
    this.challenges.open(quest, quest.generated, (result) => {
      this.state = 'playing';
      if (result.pass) {
        quest.challengePassed = true;
        quest.challengeScore = result.score;
        this.profile.xp += Math.round(result.score);
        this._checkLevelUp();
        this.ui.notify('Directions understood!', `Head to the ${buildingById[quest.destinationId].name}.`, 'success');
        this._refreshQuestTracker();
        this._updateHUD();
        this._save();
      } else {
        this.ui.notify('Keep trying', 'Talk to them again to review the directions.', 'info');
      }
    });
  }

  _closeDialogue(resetState = true) {
    this.dialogue.hide();
    if (resetState) this.state = 'playing';
  }

  /** The building the player should currently be walking toward, if any —
   *  used by the arrival check, the floating marker, and the mini-map dot.
   *  Centralized here because q6 (no NPC, no challenge gate) works differently
   *  from q1-q5 (marker only appears after the comprehension challenge passes). */
  _activeDestinationId() {
    const q = this._activeQuest();
    if (!q) return null;
    if (q.id === 'q6') return q.waypointStage === 'toAuditorium' ? q.waypointId : q.destinationId;
    return q.challengePassed ? q.destinationId : null;
  }

  _checkArrival() {
    const quest = this._activeQuest();
    if (!quest || quest.status !== 'active') return;

    if (quest.id === 'q6') {
      const targetId = this._activeDestinationId();
      const b = buildingById[targetId];
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      if (Utils.dist(this.player.pos.x, this.player.pos.y, cx, cy) < 90) {
        if (quest.waypointStage === 'toAuditorium') {
          quest.waypointStage = 'toLibrary';
          this.audio.correct();
          this.ui.notify('Checkpoint reached! 📍', 'Now make your way to the Library.', 'success');
          this._refreshQuestTracker();
        } else {
          this._completeQuest(quest);
        }
      }
      return;
    }

    if (!quest.challengePassed) return;
    const b = buildingById[quest.destinationId];
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (Utils.dist(this.player.pos.x, this.player.pos.y, cx, cy) < 90) {
      this._completeQuest(quest);
    }
  }

  _completeQuest(quest) {
    quest.status = 'complete';
    this.profile.coins += quest.coins;
    this.profile.xp += quest.xp;
    this._checkLevelUp();
    this.audio.questComplete();
    this.cam.shake(6, 0.3);
    this.particles.burst(this.player.pos.x, this.player.pos.y - 10, '#E8A33D');

    if (quest.id === 'q6') {
      this._showFinalInstruction();
    } else {
      this.ui.notify('Quest Complete! 🏆', `${quest.title} (+${quest.xp} XP, +${quest.coins} coins)`, 'success');
    }

    this.sheets.logQuestCompletion({
      studentName: this.profile.name, studentId: this.profile.id,
      questId: quest.id, questTitle: quest.title,
      npcName: this.npcById[quest.giverId]?.name || '',
      challengeType: quest.challengeType,
      generatedDirections: quest.generated?.sentence || '',
      challengeScore: quest.challengeScore || 0,
      attempts: quest.attempts || 1,
      xpEarned: quest.xp, coinsEarned: quest.coins,
      totalXp: this.profile.xp, totalCoins: this.profile.coins, level: this.profile.level,
    });

    const idx = this.quests.findIndex((q) => q.id === quest.id);
    if (idx + 1 < this.quests.length) {
      const next = this.quests[idx + 1];
      if (next.id === 'q6') this._beginFinalQuest(next);
      else next.status = 'ready';
    } else {
      this._onGameComplete();
    }
    this._refreshQuestTracker();
    this._updateHUD();
    this._save();
  }

  /** Auto-starts the capstone quest (no NPC dialogue needed to trigger it). */
  _beginFinalQuest(quest) {
    quest.status = 'active';
    quest.waypointStage = 'toAuditorium';
    this.state = 'dialogue';
    this.dialogue.show('Final Task', '★', '#C1503E',
      'One last journey: make your way from the Auditorium to the Library.',
      [{ label: "Let's go!", onClick: () => this._closeDialogue() }]);
  }

  _showFinalInstruction() {
    this.state = 'finalInstruction';
    document.getElementById('finalInstructionModal').classList.remove('hidden');
  }

  _onGameComplete() {
    this.profile.achievements.push('Master Navigator');
    this.ui.notify('🎉 Journey Complete!', 'You mastered giving & following directions in English!', 'levelup');
    this.particles.burst(this.player.pos.x, this.player.pos.y - 20, '#C1503E');
    const durationSec = this.sessionStartTime ? Math.round((Date.now() - this.sessionStartTime) / 1000) : null;
    this.sheets.logGameComplete({
      studentName: this.profile.name, studentId: this.profile.id,
      finalLevel: this.profile.level, totalXp: this.profile.xp, totalCoins: this.profile.coins,
      questsCompleted: this.quests.filter((q) => q.status === 'complete').length,
      totalAttempts: this.quests.reduce((sum, q) => sum + (q.attempts || 0), 0),
      durationSeconds: durationSec,
    });
  }

  _checkLevelUp() {
    while (this.profile.xp >= this.profile.xpToNext) {
      this.profile.xp -= this.profile.xpToNext;
      this.profile.level += 1;
      this.profile.xpToNext = Math.round(this.profile.xpToNext * 1.25);
      this.audio.levelUp();
      this.cam.shake(4, 0.2);
      this.ui.notify('Level Up! ⭐', `You reached level ${this.profile.level}.`, 'levelup');
    }
  }

  _refreshQuestTracker() {
    const q = this._activeQuest();
    if (!q) { this.ui.updateQuestTracker('All quests complete! 🎉'); return; }
    if (q.id === 'q6') {
      this.ui.updateQuestTracker(q.waypointStage === 'toAuditorium' ? 'Make your way to the Auditorium' : 'Now head to the Library');
      return;
    }
    if (q.status === 'ready') this.ui.updateQuestTracker(`Talk to ${this.npcById[q.giverId].name} to start: ${q.title}`);
    else if (!q.challengePassed) this.ui.updateQuestTracker(`Prove you understood the directions to ${this.npcById[q.giverId].name}`);
    else this.ui.updateQuestTracker(`Head to the ${buildingById[q.destinationId].name}`);
  }

  _updateHUD() { this.ui.updateHUD(this.profile); }

  _toggleJournal(force) {
    const modal = document.getElementById('journalModal');
    const show = force !== undefined ? force : modal.classList.contains('hidden');
    modal.classList.toggle('hidden', !show);
    if (show) this.ui.renderJournal(this.quests);
  }

  _togglePause(force) {
    if (this.state === 'dialogue' || this.state === 'challenge' || this.state === 'finalInstruction') return;
    const modal = document.getElementById('pauseModal');
    const show = force !== undefined ? force : modal.classList.contains('hidden');
    modal.classList.toggle('hidden', !show);
    this.state = show ? 'paused' : 'playing';
  }

  /* ---------- render helpers ---------- */
  _solids() {
    return BUILDINGS.filter((b) => !b.isPark).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  }

  _drawGround(ctx) {
    ctx.fillStyle = '#DCE7C8';
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  _drawWorld(ctx) {
    const cam = this.cam;
    // grass base (screen-space fill already done in _drawGround)

    // real street grid: vertical streets at each column boundary, horizontal
    // streets at each row boundary — this is what makes "go straight 2
    // blocks, turn left" directions line up with what's actually on screen.
    ctx.fillStyle = '#C9BBA2';
    const half = GRID.roadWidth / 2;
    const bridgeStreetX = BRIDGE.x + BRIDGE.w / 2; // the one street that crosses the bridge south
    for (let c = 0; c <= GRID.cols; c++) {
      const x = c * GRID.block;
      const bottom = (x === bridgeStreetX) ? WORLD.h : GRID.rows * GRID.block;
      const a = cam.worldToScreen(x - half, 0);
      const b = cam.worldToScreen(x + half, bottom);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    for (let r = 0; r <= GRID.rows; r++) {
      const y = r * GRID.block;
      const a = cam.worldToScreen(0, y - half);
      const b = cam.worldToScreen(WORLD.w, y + half);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    // faint centerline markings so the grid reads as real streets, not solid slabs
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.setLineDash([14, 12]); ctx.lineWidth = 2;
    for (let c = 0; c <= GRID.cols; c++) {
      const x = c * GRID.block;
      const bottom = (x === bridgeStreetX) ? WORLD.h : GRID.rows * GRID.block;
      const a = cam.worldToScreen(x, 0), b = cam.worldToScreen(x, bottom);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let r = 0; r <= GRID.rows; r++) {
      const y = r * GRID.block;
      const a = cam.worldToScreen(0, y), b = cam.worldToScreen(WORLD.w, y);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.setLineDash([]);

    // river
    const rTop = cam.worldToScreen(0, RIVER.y);
    const rBot = cam.worldToScreen(0, RIVER.y + RIVER.h);
    ctx.fillStyle = '#4A90A4';
    ctx.fillRect(0, rTop.y, this.canvas.clientWidth, rBot.y - rTop.y);
    // water shimmer
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      const wx = (i * 220 + (performance.now() / 30) % 220);
      const s = cam.worldToScreen(wx, RIVER.y + 20 + (i % 3) * 15);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + 30, s.y); ctx.stroke();
    }
    // bridge
    const brA = cam.worldToScreen(BRIDGE.x, RIVER.y - 10);
    const brB = cam.worldToScreen(BRIDGE.x + BRIDGE.w, RIVER.y + RIVER.h + 10);
    ctx.fillStyle = '#8C6F3E';
    ctx.fillRect(brA.x, brA.y, brB.x - brA.x, brB.y - brA.y);
    ctx.strokeStyle = '#5A4527'; ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const yy = brA.y + ((brB.y - brA.y) / 6) * i;
      ctx.beginPath(); ctx.moveTo(brA.x, yy); ctx.lineTo(brB.x, yy); ctx.stroke();
    }

    // park (decorative circle with trees + benches)
    const park = buildingById.park;
    const pc = cam.worldToScreen(park.x + park.w / 2, park.y + park.h / 2);
    ctx.fillStyle = 'rgba(143,191,128,0.55)';
    ctx.beginPath(); ctx.ellipse(pc.x, pc.y, park.w / 2 * cam.zoom, park.h / 2 * cam.zoom, 0, 0, Math.PI * 2); ctx.fill();
    this._drawTree(ctx, park.x + 20, park.y + 30);
    this._drawTree(ctx, park.x + park.w - 30, park.y + 40);
    this._drawTree(ctx, park.x + park.w / 2, park.y + park.h - 20);

    // scattered decorative trees in the open blocks of the grid
    [[200, 1000], [600, 1000], [1000, 1000], [1400, 1000], [1800, 1000],
     [880, 680], [1420, 650], [800, 1520], [1200, 1500]].forEach(([x, y]) => this._drawTree(ctx, x, y));

    // buildings
    BUILDINGS.forEach((b) => { if (!b.isPark) this._drawBuilding(ctx, b); });
  }

  _drawTree(ctx, x, y) {
    const s = this.cam.worldToScreen(x, y);
    const sway = Math.sin(performance.now() / 900 + x) * 3;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 14, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#6B4A2A'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(s.x, s.y + 12); ctx.lineTo(s.x, s.y - 4); ctx.stroke();
    ctx.fillStyle = '#3F7A46';
    ctx.beginPath(); ctx.arc(s.x + sway, s.y - 16, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4E8F55';
    ctx.beginPath(); ctx.arc(s.x + sway - 6, s.y - 10, 10, 0, Math.PI * 2); ctx.fill();
  }

  _drawBuilding(ctx, b) {
    const topLeft = this.cam.worldToScreen(b.x, b.y);
    const w = b.w * this.cam.zoom, h = b.h * this.cam.zoom;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(topLeft.x + 4, topLeft.y + h - 4, w, 10);
    // body
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.roundRect(topLeft.x, topLeft.y, w, h, 6); ctx.fill();
    // roof
    if (b.roof) {
      ctx.fillStyle = b.roof;
      ctx.beginPath();
      ctx.moveTo(topLeft.x - 6, topLeft.y);
      ctx.lineTo(topLeft.x + w / 2, topLeft.y - 26);
      ctx.lineTo(topLeft.x + w + 6, topLeft.y);
      ctx.closePath(); ctx.fill();
    }
    // door
    ctx.fillStyle = 'rgba(36,49,43,0.65)';
    ctx.fillRect(topLeft.x + w / 2 - 9, topLeft.y + h - 26, 18, 26);
    // signboard
    ctx.font = '700 12px Fredoka, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    const signW = Math.max(60, b.name.length * 7);
    ctx.fillStyle = 'rgba(36,49,43,0.82)';
    ctx.beginPath(); ctx.roundRect(topLeft.x + w / 2 - signW / 2, topLeft.y - 44, signW, 20, 5); ctx.fill();
    ctx.fillStyle = '#FBF3E3';
    ctx.fillText(b.name, topLeft.x + w / 2, topLeft.y - 30);

    // quest marker above destination if relevant
    if (this._activeDestinationId() === b.id) {
      const bob = Math.sin(performance.now() / 250) * 4;
      ctx.fillStyle = '#E8A33D';
      ctx.beginPath();
      ctx.moveTo(topLeft.x + w / 2, topLeft.y - 70 + bob);
      ctx.lineTo(topLeft.x + w / 2 - 8, topLeft.y - 56 + bob);
      ctx.lineTo(topLeft.x + w / 2 + 8, topLeft.y - 56 + bob);
      ctx.closePath(); ctx.fill();
    }
  }

  _drawDayNightOverlay(ctx) {
    const t = this.timeOfDay;
    let color = 'rgba(0,0,0,0)';
    if (t < 0.22) color = `rgba(70,60,110,${0.18 * (1 - t / 0.22)})`;
    else if (t > 0.75 && t <= 0.88) color = `rgba(220,110,60,${0.12 * ((t - 0.75) / 0.13)})`;
    else if (t > 0.88) color = `rgba(20,20,60,${0.35})`;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  _drawMinimap() {
    const ctx = this.minimapCtx;
    const W = this.minimapCanvas.width, H = this.minimapCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#DCE7C8'; ctx.fillRect(0, 0, W, H);
    const sx = W / WORLD.w, sy = H / WORLD.h;
    ctx.fillStyle = '#4A90A4';
    ctx.fillRect(0, RIVER.y * sy, W, RIVER.h * sy);
    BUILDINGS.forEach((b) => {
      ctx.fillStyle = b.landmarkOnly ? 'rgba(140,120,90,0.5)' : '#8C6F3E';
      ctx.fillRect(b.x * sx, b.y * sy, Math.max(2, b.w * sx), Math.max(2, b.h * sy));
    });
    // destination marker
    const destId = this._activeDestinationId();
    if (destId) {
      const b = buildingById[destId];
      ctx.fillStyle = '#E8A33D';
      ctx.beginPath(); ctx.arc((b.x + b.w / 2) * sx, (b.y + b.h / 2) * sy, 4, 0, Math.PI * 2); ctx.fill();
    }
    // player
    ctx.fillStyle = '#C1503E';
    ctx.beginPath(); ctx.arc(this.player.pos.x * sx, this.player.pos.y * sy, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  /* ---------- main loop ---------- */
  _loop(tMs) {
    const t = tMs / 1000;
    const dt = Math.min(0.05, t - (this.lastT || t));
    this.lastT = t;

    if (this.state === 'playing') {
      this.timeOfDay = (this.timeOfDay + dt / 360) % 1;
      this.ui.updateClock(Utils.fmtClock(this.timeOfDay));

      // Manual input (keyboard or joystick) always cancels a pending click-to-move.
      const kbActive = this.input.has('up') || this.input.has('down') || this.input.has('left') || this.input.has('right');
      if ((kbActive || this.touchVector.active) && this.moveTarget) this.moveTarget = null;

      this.player.update(dt, this.input, this._solids(), WORLD, this.touchVector, this.moveTarget);
      if (this.moveTarget && Utils.dist(this.player.pos.x, this.player.pos.y, this.moveTarget.x, this.moveTarget.y) < 6) {
        this.moveTarget = null;
      }
      if (this.player.moving && Math.random() < 0.5) this.audio.footstep();
      this.npcs.forEach((n) => n.update(dt));
      this.particles.update(dt);
      this.cam.follow(this.player.pos.x, this.player.pos.y, dt);

      const near = this._npcNearby();
      this.ui.showInteractPrompt(!!near);

      this._checkArrival();
    } else if (this.state !== 'menu') {
      this.particles.update(dt);
    }

    this._render();
    requestAnimationFrame((tt) => this._loop(tt));
  }

  _render() {
    const ctx = this.ctx;
    this._drawGround(ctx);
    if (this.state === 'menu' || this.state === 'howto') { return; }
    this._drawWorld(ctx);
    if (this.moveTarget) this._drawMoveMarker(ctx);
    this.particles.draw(ctx, this.cam);
    // draw NPCs (with active-quest highlight)
    const quest = this._activeQuest();
    this.npcs.forEach((n) => {
      const highlighted = quest && quest.giverId === n.id && (quest.status === 'ready' || (quest.status === 'active' && !quest.challengePassed));
      n.draw(ctx, this.cam, highlighted);
    });
    this.player.draw(ctx, this.cam);
    this._drawDayNightOverlay(ctx);
    this._drawMinimap();
  }

  /** Small pulsing crosshair at the current click/tap-to-move destination. */
  _drawMoveMarker(ctx) {
    const s = this.cam.worldToScreen(this.moveTarget.x, this.moveTarget.y);
    const pulse = 1 + Math.sin(performance.now() / 150) * 0.18;
    ctx.strokeStyle = '#E8A33D'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, 11 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.x - 5, s.y); ctx.lineTo(s.x + 5, s.y);
    ctx.moveTo(s.x, s.y - 5); ctx.lineTo(s.x, s.y + 5);
    ctx.stroke();
  }
}

/* ==================== BOOT ==================== */
window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  window.__game = game; // debugging hook
  game.boot();
});
