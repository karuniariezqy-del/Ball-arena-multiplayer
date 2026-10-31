/* =====================================================================
   BALL ARENA LEGENDS — arena client (canvas renderer + input + HUD)
   ===================================================================== */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (dt, k) => 1 - Math.exp(-dt * k);

  const MODE_LABEL = { multi: 'MULTIPLAYER ARENA', solo: 'SOLO RUN', boss: 'BOSS BATTLE', duel: '1V1 DUEL' };
  const PLAYER_SPEED = 268;

  class ArenaScene {
    constructor(socket, options) {
      this.socket = socket;
      this.opts = options || {};
      this.skins = this.opts.skins || {};
      this.canvas = $('gameCanvas');
      this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
      this.running = false;
      this.roomId = null;
      this.mode = 'multi';
      this.bossDef = null;
      this.world = { w: 2800, h: 2000 };

      this.players = new Map();
      this.enemies = new Map();
      this.orbs = new Map();
      this.shots = new Map();
      this.bossRender = null;
      this.particles = [];
      this.floaters = [];
      this.rings = [];
      this.sparks = [];

      this.me = { key: null, x: 200, y: 200, px: 200, py: 200, vx: 0, vy: 0, t: 0 };
      this.stats = { hp: 100, maxHp: 100, alive: true, respawnIn: 0, kills: 0, deaths: 0, coinsRun: 0, expRun: 0, flagsRun: 0, dashCd: 0 };
      this.duel = null;
      this.cam = { x: 0, y: 0, zoom: 1 };
      this.aim = 0;
      this.lastT = 0;
      this.dpr = 1;
      this.viewW = 800;
      this.viewH = 600;
      this.input = { x: 0, y: 0 };
      this.keys = new Set();
      this.joystick = { active: false, pointerId: null, cx: 0, cy: 0, radius: 60 };

      this.pendingDash = false;
      this.inputTimer = null;
      this.raf = null;
      this.resizeHandler = () => this.resize();
      this.lastStateAt = 0;

      this.bound = {
        state: (payload) => this.onState(payload),
        joined: (payload) => this.onJoined(payload),
        error: (payload) => this.onError(payload),
        end: (payload) => this.onRunEnd(payload),
        chat: (msg) => this.onChatMessage(msg),
        wallet: (payload) => { if (this.opts.onWallet) this.opts.onWallet(payload.user); },
        banned: (payload) => this.onBanned(payload),
        duelQueue: (payload) => { if (this.opts.onDuelQueue) this.opts.onDuelQueue(payload); },
      };
    }

    /* ---------------- lifecycle ---------------- */
    start(mode, bossId) {
      if (!this.canvas || !this.ctx) return;
      this.mode = mode;
      this.running = true;
      this.attachSocket();
      this.bindInput();
      this.bindButtons();
      this.resize();
      window.addEventListener('resize', this.resizeHandler);
      window.addEventListener('orientationchange', this.resizeHandler);
      this.applyModeChrome();
      this.socket.emit('arena:join', { mode, bossId: bossId || null }, (res) => {
        if (res && res.error) this.onError(res);
      });
      this.inputTimer = setInterval(() => this.pushInput(), 50);
      this.lastT = performance.now();
      if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
      document.body.classList.add('in-arena');
    }

    stop(silent) {
      this.running = false;
      if (this.inputTimer) { clearInterval(this.inputTimer); this.inputTimer = null; }
      window.removeEventListener('resize', this.resizeHandler);
      window.removeEventListener('orientationchange', this.resizeHandler);
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
      this.detachSocket();
      this.resetJoystick();
      this.keys.clear();
      this.input.x = 0; this.input.y = 0;
      document.body.classList.remove('in-arena');
      if (this.opts.onExit) this.opts.onExit(silent === true);
    }

    attachSocket() {
      const s = this.socket;
      s.on('state', this.bound.state);
      s.on('arena:joined', this.bound.joined);
      s.on('arena:error', this.bound.error);
      s.on('run:end', this.bound.end);
      s.on('chat:message', this.bound.chat);
      s.on('wallet:update', this.bound.wallet);
      s.on('banned', this.bound.banned);
      s.on('duel:queue', this.bound.duelQueue);
    }

    detachSocket() {
      const s = this.socket;
      s.off('state', this.bound.state);
      s.off('arena:joined', this.bound.joined);
      s.off('arena:error', this.bound.error);
      s.off('run:end', this.bound.end);
      s.off('chat:message', this.bound.chat);
      s.off('wallet:update', this.bound.wallet);
      s.off('banned', this.bound.banned);
      s.off('duel:queue', this.bound.duelQueue);
    }

    applyModeChrome() {
      const label = $('arenaModeLabel');
      if (label) label.textContent = MODE_LABEL[this.mode] || 'ARENA';
      const duel = $('duelHud');
      if (duel) duel.classList.toggle('hidden', this.mode !== 'duel');
      const boss = $('bossHud');
      if (boss) boss.classList.add('hidden');
      const veil = $('respawnVeil');
      if (veil) veil.classList.add('hidden');
      const modal = $('resultModal');
      if (modal) modal.classList.add('hidden');
      this.fillScoreboard([]);
      if (this.opts.onFeed) this.opts.onFeed({ type: 'system', text: `${MODE_LABEL[this.mode] || 'ARENA'} — good luck!` });
      this.clearFeed();
    }

    /* ---------------- server messages ---------------- */
    onJoined(payload) {
      if (!payload) return;
      this.roomId = payload.roomId;
      this.mode = payload.mode || this.mode;
      this.world = payload.world || this.world;
      this.bossDef = payload.bossDef || null;
      if (payload.you) {
        this.me.key = payload.you.key;
        this.me.x = payload.you.x; this.me.y = payload.you.y;
        this.me.px = payload.you.x; this.me.py = payload.you.y;
        this.cam.x = payload.you.x; this.cam.y = payload.you.y;
        this.mySkin = payload.you.skin || this.mySkin;
        this.stats.maxHp = payload.you.maxHp || this.stats.maxHp;
        this.stats.hp = payload.you.hp || payload.you.maxHp;
      }
      if (this.bossDef && this.opts.onBossIntro) this.opts.onBossIntro(this.bossDef);
      this.applyModeChrome();
      const rcLabel = $('roomChat');
      if (rcLabel) rcLabel.querySelector('.rc-title-text');
    }

    onError(payload) {
      const msg = (payload && (payload.error || payload.message)) || 'Could not join the arena.';
      if (this.opts.onToast) this.opts.onToast(msg, 'error');
      this.stop(true);
    }

    onBanned(payload) {
      if (this.opts.onToast) this.opts.onToast(`Banned: ${(payload && payload.reason) || 'policy violation'}`, 'error');
      this.stop(true);
      if (this.opts.onBanned) this.opts.onBanned(payload);
    }

    onState(state) {
      if (!this.running || !state) return;
      const now = performance.now();
      const dt = this.lastStateAt ? Math.min(0.5, (now - this.lastStateAt) / 1000) : 0.066;
      this.lastStateAt = now;
      this.world = state.world || this.world;
      this.duel = state.duel || null;
      if (state.mode) this.mode = state.mode;

      // players
      const seen = new Set();
      (state.players || []).forEach((p) => {
        seen.add(p.id);
        let e = this.players.get(p.id);
        if (!e) {
          e = { x: p.x, y: p.y, tx: p.x, ty: p.y, data: p, bob: Math.random() * TAU };
          this.players.set(p.id, e);
        }
        e.tx = p.x; e.ty = p.y;
        e.data = p;
      });
      for (const key of [...this.players.keys()]) if (!seen.has(key)) this.players.delete(key);

      // enemies
      const seenE = new Set();
      (state.enemies || []).forEach((en) => {
        seenE.add(en.id);
        let e = this.enemies.get(en.id);
        if (!e) { e = { x: en.x, y: en.y, tx: en.x, ty: en.y, r: en.r, data: en, hitAt: 0 }; this.enemies.set(en.id, e); }
        e.tx = en.x; e.ty = en.y; e.r = en.r; e.data = en;
      });
      for (const id of [...this.enemies.keys()]) if (!seenE.has(id)) this.enemies.delete(id);

      // orbs
      const seenO = new Set();
      (state.orbs || []).forEach((o) => {
        seenO.add(o.id);
        let e = this.orbs.get(o.id);
        if (!e) { e = { x: o.x, y: o.y, tx: o.x, ty: o.y, data: o, born: now }; this.orbs.set(o.id, e); }
        e.tx = o.x; e.ty = o.y; e.data = o;
      });
      for (const id of [...this.orbs.keys()]) if (!seenO.has(id)) this.orbs.delete(id);

      // shots
      const seenS = new Set();
      (state.shots || []).forEach((s) => {
        seenS.add(s.id);
        let e = this.shots.get(s.id);
        if (!e) { e = { x: s.x, y: s.y, tx: s.x, ty: s.y, data: s }; this.shots.set(s.id, e); }
        e.tx = s.x; e.ty = s.y; e.data = s;
      });
      for (const id of [...this.shots.keys()]) if (!seenS.has(id)) this.shots.delete(id);

      // boss
      if (state.boss) {
        if (!this.bossRender) this.bossRender = { x: state.boss.x, y: state.boss.y, tx: state.boss.x, ty: state.boss.y, data: state.boss };
        this.bossRender.tx = state.boss.x; this.bossRender.ty = state.boss.y;
        this.bossRender.data = state.boss;
      } else {
        this.bossRender = null;
      }

      // you
      const you = state.you || {};
      if (you.key) this.me.key = you.key;
      const serverMe = (state.players || []).find((p) => p.id === this.me.key);
      if (serverMe) {
        const d = Math.hypot(serverMe.x - this.me.x, serverMe.y - this.me.y);
        if (d > 140 || !this.me.alive) { this.me.x = serverMe.x; this.me.y = serverMe.y; }
        else { this.me.x = lerp(this.me.x, serverMe.x, 0.34); this.me.y = lerp(this.me.y, serverMe.y, 0.34); }
        this.mySkin = serverMe.skin || this.mySkin;
        this.me.alive = serverMe.alive;
      }
      if (you.alive != null) this.me.alive = you.alive;
      this.stats.hp = you.hp != null ? you.hp : this.stats.hp;
      this.stats.maxHp = you.maxHp || this.stats.maxHp;
      this.stats.alive = you.alive !== false;
      this.stats.respawnIn = you.respawnIn || 0;
      this.stats.kills = you.kills || 0;
      this.stats.deaths = you.deaths || 0;
      this.stats.coinsRun = you.coinsRun || 0;
      this.stats.expRun = you.expRun || 0;
      this.stats.flagsRun = you.flagsRun || 0;
      this.stats.dashCd = you.dashCd || 0;

      // events
      (state.events || []).forEach((ev) => this.handleEvent(ev));

      this.updateHud(state);
      if (this.mode === 'duel') this.updateDuelHud(state);
    }

    handleEvent(ev) {
      if (!ev || !ev.type) return;
      switch (ev.type) {
        case 'enemy_down':
          this.burst(ev.x, ev.y, ev.color || '#fb7185', 18, 260);
          this.float(ev.x, ev.y - 10, '+coins', ev.color || '#fbbf24');
          break;
        case 'boss_down':
          this.burst(ev.x, ev.y, ev.color || '#fbbf24', 70, 520);
          this.ring(ev.x, ev.y, ev.color || '#fbbf24', 420);
          if (this.opts.onFeed) this.opts.onFeed({ type: 'boss', text: `${ev.name} defeated!` });
          break;
        case 'boss_spawn':
          this.ring(ev.x || this.world.w / 2, ev.y || this.world.h / 2, '#f43f5e', 500);
          if (this.opts.onFeed) this.opts.onFeed({ type: 'boss', text: `${ev.name} — ${ev.title || 'Boss'} awakens` });
          break;
        case 'boss_ring':
          this.ring(ev.x, ev.y, ev.color || '#22d3ee', 300);
          break;
        case 'boss_charge':
          this.shake = 0.5;
          break;
        case 'boss_telegraph':
          if (this.opts.onFeed) this.opts.onFeed({ type: 'boss', text: `${ev.name} is charging ${String(ev.attack || 'attack').toUpperCase()}` });
          break;
        case 'boss_timewarp':
          this.ring(this.me.x, this.me.y, '#a78bfa', 260);
          break;
        case 'flag':
          this.float(ev.x, ev.y, '+1 FLAG', '#fbbf24');
          this.burst(ev.x, ev.y, '#fbbf24', 10, 180);
          break;
        case 'shot':
          this.spark(ev.x, ev.y, ev.color || '#ffffff');
          break;
        case 'player_down':
          this.burst(this.me.x, this.me.y, '#f43f5e', 22, 240);
          if (this.opts.onFeed) this.opts.onFeed({ type: 'down', text: `${ev.username} was eliminated by ${ev.by || 'the arena'}` });
          break;
        case 'respawn':
          if (this.opts.onFeed) this.opts.onFeed({ type: 'info', text: `${ev.username} respawned` });
          break;
        case 'duel_start':
          if (this.opts.onFeed) this.opts.onFeed({ type: 'duel', text: `Duel: ${ev.a} vs ${ev.b}` });
          break;
        case 'duel_end':
          if (this.opts.onFeed) this.opts.onFeed({ type: 'duel', text: `Duel over — winner: ${ev.winner || 'draw'}` });
          break;
        default:
          break;
      }
    }

    onRunEnd(payload) {
      if (!this.running) return;
      const badge = $('resultBadge');
      const title = $('resultTitle');
      const body = $('resultBody');
      const modal = $('resultModal');
      const win = payload.winner && this.opts.username ? payload.winner === this.opts.username : payload.reason === 'boss_win';
      if (badge) {
        badge.textContent = payload.reason === 'boss_win' ? 'BOSS DEFEATED' : payload.reason === 'duel_end' ? (win ? 'VICTORY' : 'DEFEAT') : 'RUN COMPLETE';
        badge.className = `result-badge ${win ? 'win' : 'lose'}`;
      }
      if (title) {
        title.textContent = payload.reason === 'boss_win'
          ? `${payload.boss ? payload.boss.name : 'Boss'} destroyed`
          : payload.reason === 'duel_end'
            ? (payload.winner ? `Winner: ${payload.winner}` : 'Duel ended — draw')
            : 'Run settled';
      }
      if (body) {
        const r = payload.rewards || {};
        const rows = [];
        if (r.coins) rows.push(`+${r.coins} coins`);
        if (r.exp) rows.push(`+${r.exp} EXP`);
        if (r.flags) rows.push(`+${r.flags} flags`);
        if (r.skinId) rows.push('New skin unlocked');
        const stats = payload.stats || {};
        if (stats.kills != null) rows.push(`${stats.kills} kills · ${stats.deaths || 0} deaths`);
        body.innerHTML = rows.length ? rows.map((t) => `<span class="result-pill">${t}</span>`).join('') : '<span class="result-pill">No rewards this run</span>';
        if (payload.results) {
          body.innerHTML = payload.results.map((p) => `<div class="result-row"><strong>${escapeHtml(p.username)}</strong><span>${p.kills} kills · ${p.deaths} deaths</span><span>${p.win ? 'WIN' : ''}</span></div>`).join('');
        }
      }
      if (modal) modal.classList.remove('hidden');
      if (payload.user && this.opts.onWallet) this.opts.onWallet(payload.user);
      if (this.opts.onFinished) this.opts.onFinished(payload);
      this.resultPayload = payload;
    }

    /* ---------------- input ---------------- */
    bindButtons() {
      if (this._btnsBound) return;
      this._btnsBound = true;
      const back = $('btnArenaBack');
      if (back) back.addEventListener('click', () => {
        if (this.opts.onExitRequest) this.opts.onExitRequest();
        else this.leave();
      });
      const dash = $('btnDash');
      if (dash) {
        dash.addEventListener('pointerdown', (e) => { e.preventDefault(); this.pendingDash = true; dash.classList.add('active'); });
        const off = () => dash.classList.remove('active');
        dash.addEventListener('pointerup', off);
        dash.addEventListener('pointercancel', off);
        dash.addEventListener('pointerleave', off);
      }
      const again = $('resultAgain');
      if (again) again.addEventListener('click', () => {
        const modal = $('resultModal'); if (modal) modal.classList.add('hidden');
        const mode = this.mode; const bossId = this.bossDef ? this.bossDef.id : null;
        this.socket.emit('arena:join', { mode, bossId }, (res) => { if (res && res.error && this.opts.onToast) this.opts.onToast(res.error, 'error'); });
        this.clearFeed();
        this.applyModeChrome();
      });
      const lobby = $('resultLobby');
      if (lobby) lobby.addEventListener('click', () => {
        const modal = $('resultModal'); if (modal) modal.classList.add('hidden');
        this.leave();
      });
      const rcClose = $('rcClose');
      if (rcClose) rcClose.addEventListener('click', () => this.toggleRoomChat(false));
      const rcForm = $('rcForm');
      if (rcForm) rcForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('rcInput');
        const text = (input && input.value || '').trim();
        if (!text || !this.roomId) return;
        this.socket.emit('chat:send', { text, room: this.roomId }, (res) => {
          if (res && res.error && this.opts.onToast) this.opts.onToast(res.error, 'error');
        });
        if (input) input.value = '';
      });
    }

    bindInput() {
      if (this._inputBound) return;
      this._inputBound = true;
      this.keyDown = (e) => {
        const k = e.key.toLowerCase();
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
          this.keys.add(k); e.preventDefault();
        }
        if (k === ' ' || k === 'shift') { this.pendingDash = true; e.preventDefault(); }
      };
      this.keyUp = (e) => {
        const k = e.key.toLowerCase();
        this.keys.delete(k);
      };
      window.addEventListener('keydown', this.keyDown, { passive: false });
      window.addEventListener('keyup', this.keyUp);

      const stick = $('joystick');
      if (stick) {
        stick.addEventListener('pointerdown', (e) => this.startJoystick(e, stick));
        stick.addEventListener('pointermove', (e) => this.moveJoystick(e, stick));
        stick.addEventListener('pointerup', (e) => this.endJoystick(e));
        stick.addEventListener('pointercancel', (e) => this.endJoystick(e));
        stick.addEventListener('pointerleave', (e) => this.endJoystick(e));
      }
      const canvas = this.canvas;
      if (canvas) {
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
      }
    }

    startJoystick(e, stick) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const rect = stick.getBoundingClientRect();
      this.joystick.active = true;
      this.joystick.pointerId = e.pointerId;
      this.joystick.cx = rect.left + rect.width / 2;
      this.joystick.cy = rect.top + rect.height / 2;
      this.joystick.radius = rect.width * 0.34;
      if (stick.setPointerCapture) { try { stick.setPointerCapture(e.pointerId); } catch (_) { /* noop */ } }
      this.moveJoystick(e, stick);
    }

    moveJoystick(e, stick) {
      if (!this.joystick.active || e.pointerId !== this.joystick.pointerId) return;
      e.preventDefault();
      const dx = e.clientX - this.joystick.cx;
      const dy = e.clientY - this.joystick.cy;
      const mag = Math.hypot(dx, dy) || 1;
      const cap = this.joystick.radius;
      const k = Math.min(1, mag / cap);
      this.joystick.nx = (dx / mag) * k;
      this.joystick.ny = (dy / mag) * k;
      const knob = $('joystickKnob');
      if (knob) knob.style.transform = `translate(${(dx / mag) * cap * k}px, ${(dy / mag) * cap * k}px)`;
    }

    endJoystick(e) {
      if (this.joystick.pointerId != null && e.pointerId !== this.joystick.pointerId) return;
      this.resetJoystick();
    }

    resetJoystick() {
      this.joystick.active = false;
      this.joystick.pointerId = null;
      this.joystick.nx = 0;
      this.joystick.ny = 0;
      const knob = $('joystickKnob');
      if (knob) knob.style.transform = 'translate(0px, 0px)';
    }

    readInput() {
      let x = 0; let y = 0;
      if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
      if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
      if (this.joystick.active && (this.joystick.nx || this.joystick.ny)) {
        x = this.joystick.nx || 0;
        y = this.joystick.ny || 0;
      }
      const mag = Math.hypot(x, y);
      if (mag > 1) { x /= mag; y /= mag; }
      this.input.x = x; this.input.y = y;
      return { x, y };
    }

    pushInput() {
      if (!this.running) return;
      const { x, y } = this.readInput();
      const dash = this.pendingDash;
      this.pendingDash = false;
      this.socket.emit('input', { x, y, dash });
      if (x || y) this.aim = Math.atan2(y, x);
    }

    /* ---------------- helpers ---------------- */
    burst(x, y, color, count, speed) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      for (let i = 0; i < count; i += 1) {
        const a = Math.random() * TAU;
        const s = (0.3 + Math.random() * 0.7) * (speed || 220);
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.45 + Math.random() * 0.55, max: 1, color, r: 1.5 + Math.random() * 3 });
      }
      if (this.particles.length > 520) this.particles.splice(0, this.particles.length - 520);
    }
    ring(x, y, color, size) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      this.rings.push({ x, y, color, size: size || 260, life: 0.7, max: 0.7 });
    }
    spark(x, y, color) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      this.sparks.push({ x, y, color, life: 0.22, max: 0.22 });
      if (this.sparks.length > 200) this.sparks.shift();
    }
    float(x, y, text, color) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      this.floaters.push({ x, y, text, color: color || '#fff', life: 1.1, max: 1.1 });
      if (this.floaters.length > 60) this.floaters.shift();
    }

    clearFeed() {
      const feed = $('feed');
      if (feed) feed.innerHTML = '';
    }

    /* ---------------- HUD ---------------- */
    updateHud(state) {
      const s = this.stats;
      const hpPct = clamp(s.hp / Math.max(1, s.maxHp), 0, 1) * 100;
      const hpFill = $('hpFill');
      if (hpFill) {
        hpFill.style.width = `${hpPct}%`;
        hpFill.classList.toggle('low', hpPct < 30);
      }
      const hpText = $('hpText');
      if (hpText) hpText.textContent = `${Math.round(s.hp)} / ${Math.round(s.maxHp)}`;
      const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      set('runCoins', s.coinsRun);
      set('runExp', s.expRun);
      set('runFlags', s.flagsRun);
      set('runKills', s.kills);

      const dashBtn = $('btnDash');
      if (dashBtn) {
        const ready = !s.dashCd;
        dashBtn.classList.toggle('cooldown', !ready);
        dashBtn.textContent = ready ? 'DASH' : `${s.dashCd.toFixed(1)}s`;
      }

      const veil = $('respawnVeil');
      if (veil) {
        const show = !s.alive;
        veil.classList.toggle('hidden', !show);
        const ri = $('respawnIn');
        if (ri && show) ri.textContent = String(Math.max(0, s.respawnIn || 0));
      }

      const boss = state.boss;
      const bossHud = $('bossHud');
      if (bossHud) {
        if (boss) {
          bossHud.classList.remove('hidden');
          set('bossName', boss.name);
          set('bossTitle', boss.title || 'BOSS');
          set('bossHpText', `${Math.max(0, boss.hp)} / ${boss.maxHp}`);
          const fill = $('bossHpFill');
          if (fill) fill.style.width = `${clamp(boss.hp / boss.maxHp, 0, 1) * 100}%`;
          bossHud.classList.toggle('enraged', !!boss.enraged);
        } else {
          bossHud.classList.add('hidden');
        }
      }

      this.fillScoreboard(state.players || []);
    }

    fillScoreboard(players) {
      const el = $('scoreboard');
      if (!el) return;
      const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).slice(0, 6);
      el.innerHTML = sorted.map((p) => `<div class="sb-row${p.alive ? '' : ' dead'}">
        <span class="sb-name">${escapeHtml(p.username || 'Player')}</span>
        <span class="sb-lv">L${p.level || 1}</span>
        <span class="sb-k">${p.kills || 0}</span>
      </div>`).join('');
    }

    updateDuelHud(state) {
      if (!this.duel) return;
      const players = state.players || [];
      const mine = players.find((p) => p.id === this.me.key);
      const foe = players.find((p) => p.id !== this.me.key);
      const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      set('duelYou', `${mine ? mine.kills : 0}`);
      set('duelFoe', `${foe ? foe.kills : 0}`);
      const left = Math.max(0, Math.ceil((this.duel.startedAt + this.duel.duration - state.t) / 1000));
      const mm = String(Math.floor(left / 60)).padStart(2, '0');
      const ss = String(left % 60).padStart(2, '0');
      set('duelTimer', `${mm}:${ss}`);
      const foeName = $('duelHud');
      if (foeName && foe) foeName.dataset.foe = foe.username;
    }

    /* ---------------- room chat ---------------- */
    toggleRoomChat(force) {
      const panel = $('roomChat');
      if (!panel) return;
      const show = force != null ? force : panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !show);
    }

    onChatMessage(msg) {
      if (!msg || !this.roomId || msg.room !== this.roomId) return;
      const list = $('rcMessages');
      if (!list) return;
      const row = document.createElement('div');
      row.className = `rc-msg${msg.isOwner ? ' owner' : ''}`;
      row.innerHTML = `<span class="rc-user">${escapeHtml(msg.username)}</span><span class="rc-text">${escapeHtml(msg.text)}</span>`;
      list.appendChild(row);
      while (list.children.length > 60) list.removeChild(list.firstElementChild);
      list.scrollTop = list.scrollHeight;
    }

    leave() {
      this.socket.emit('arena:leave');
      this.stop();
    }

    /* ---------------- render ---------------- */
    resize() {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      this.viewW = Math.max(320, rect.width || window.innerWidth);
      this.viewH = Math.max(240, rect.height || window.innerHeight);
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(this.viewW * this.dpr);
      this.canvas.height = Math.round(this.viewH * this.dpr);
      this.cam.zoom = clamp(Math.min(this.viewW / 1080, this.viewH / 720), 0.42, 1.05);
    }

    frame(t) {
      this.raf = requestAnimationFrame((nt) => this.frame(nt));
      if (!this.running) return;
      const dt = Math.min(0.05, (t - this.lastT) / 1000 || 0.016);
      this.lastT = t;
      this.update(dt);
      this.render(t / 1000, dt);
    }

    update(dt) {
      // local prediction
      const { x, y } = this.readInput();
      const speed = PLAYER_SPEED;
      if (this.stats.alive) {
        this.me.vx = lerp(this.me.vx, x * speed, ease(dt, 18));
        this.me.vy = lerp(this.me.vy, y * speed, ease(dt, 18));
        this.me.x += this.me.vx * dt;
        this.me.y += this.me.vy * dt;
        const pad = 26;
        this.me.x = clamp(this.me.x, pad, this.world.w - pad);
        this.me.y = clamp(this.me.y, pad, this.world.h - pad);
      }

      // camera
      const z = this.cam.zoom;
      const targetX = clamp(this.me.x, (this.viewW / 2) / z, this.world.w - (this.viewW / 2) / z);
      const targetY = clamp(this.me.y, (this.viewH / 2) / z, this.world.h - (this.viewH / 2) / z);
      this.cam.x = lerp(this.cam.x, targetX, ease(dt, 7));
      this.cam.y = lerp(this.cam.y, targetY, ease(dt, 7));

      // entity smoothing
      const k = ease(dt, 13);
      for (const e of this.players.values()) { e.x = lerp(e.x, e.tx, k); e.y = lerp(e.y, e.ty, k); e.bob += dt; }
      for (const e of this.enemies.values()) { e.x = lerp(e.x, e.tx, k); e.y = lerp(e.y, e.ty, k); }
      for (const e of this.orbs.values()) { e.x = lerp(e.x, e.tx, k); e.y = lerp(e.y, e.ty, k); }
      for (const e of this.shots.values()) { e.x = lerp(e.x, e.tx, k); e.y = lerp(e.y, e.ty, k); }
      if (this.bossRender) { this.bossRender.x = lerp(this.bossRender.x, this.bossRender.tx, k); this.bossRender.y = lerp(this.bossRender.y, this.bossRender.ty, k); }

      // particles
      for (let i = this.particles.length - 1; i >= 0; i -= 1) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) { this.particles.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.94; p.vy *= 0.94;
      }
      for (let i = this.rings.length - 1; i >= 0; i -= 1) { this.rings[i].life -= dt; if (this.rings[i].life <= 0) this.rings.splice(i, 1); }
      for (let i = this.floaters.length - 1; i >= 0; i -= 1) { const f = this.floaters[i]; f.life -= dt; f.y -= 32 * dt; if (f.life <= 0) this.floaters.splice(i, 1); }
      for (let i = this.sparks.length - 1; i >= 0; i -= 1) { this.sparks[i].life -= dt; if (this.sparks[i].life <= 0) this.sparks.splice(i, 1); }
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2);
    }

    render(t, dt) {
      const ctx = this.ctx;
      const W = this.viewW; const H = this.viewH;
      const z = this.cam.zoom;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const shakeX = this.shake ? (Math.random() - 0.5) * 14 * this.shake : 0;
      const shakeY = this.shake ? (Math.random() - 0.5) * 14 * this.shake : 0;

      ctx.save();
      ctx.translate(W / 2 + shakeX, H / 2 + shakeY);
      ctx.scale(z, z);
      ctx.translate(-this.cam.x, -this.cam.y);

      const camLeft = this.cam.x - W / (2 * z);
      const camTop = this.cam.y - H / (2 * z);
      const camRight = this.cam.x + W / (2 * z);
      const camBottom = this.cam.y + H / (2 * z);
      const visible = (x, y, pad) => x > camLeft - pad && x < camRight + pad && y > camTop - pad && y < camBottom + pad;

      this.drawWorld(ctx, t, camLeft, camTop, camRight, camBottom);
      this.drawOrbs(ctx, t, visible);
      this.drawShots(ctx, visible);
      this.drawEnemies(ctx, t, visible);
      this.drawBoss(ctx, t, visible);
      this.drawPlayers(ctx, t, visible);
      this.drawParticles(ctx);
      this.drawFloaters(ctx);

      ctx.restore();

      // vignette
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(3,4,12,0.55)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }

    drawWorld(ctx, t, l, top, r, b) {
      const w = this.world.w; const h = this.world.h;
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#0a1024');
      bg.addColorStop(0.5, '#0c1329');
      bg.addColorStop(1, '#0a0f22');
      ctx.fillStyle = 'rgba(2,4,10,1)';
      ctx.fillRect(l - 400, top - 400, (r - l) + 800, (b - top) + 800);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // grid
      const step = 80;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(99,140,255,0.10)';
      ctx.beginPath();
      const gx0 = Math.max(0, Math.floor(l / step) * step);
      for (let x = gx0; x <= Math.min(w, r); x += step) { ctx.moveTo(x, Math.max(0, top)); ctx.lineTo(x, Math.min(h, b)); }
      const gy0 = Math.max(0, Math.floor(top / step) * step);
      for (let y = gy0; y <= Math.min(h, b); y += step) { ctx.moveTo(Math.max(0, l), y); ctx.lineTo(Math.min(w, r), y); }
      ctx.stroke();

      // diagonal accents
      ctx.strokeStyle = 'rgba(56,189,248,0.06)';
      ctx.lineWidth = 2;
      for (let x = -h; x < w; x += 240) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.stroke();
      }

      // orbs of light in the floor
      for (let i = 0; i < 5; i += 1) {
        const cx = (w / 5) * (i + 0.5);
        const cy = h / 2 + Math.sin(t * 0.4 + i) * h * 0.22;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 260);
        g.addColorStop(0, 'rgba(124,58,237,0.16)');
        g.addColorStop(1, 'rgba(124,58,237,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - 260, cy - 260, 520, 520);
      }

      // boundary
      ctx.save();
      ctx.strokeStyle = 'rgba(56,189,248,0.55)';
      ctx.lineWidth = 6;
      ctx.shadowColor = 'rgba(56,189,248,0.8)';
      ctx.shadowBlur = 26;
      roundRect(ctx, 3, 3, w - 6, h - 6, 42);
      ctx.stroke();
      ctx.restore();

      // center mark
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 150, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 90, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    drawOrbs(ctx, t, visible) {
      for (const o of this.orbs.values()) {
        if (!visible(o.x, o.y, 60)) continue;
        const kind = o.data.kind;
        const pulse = 0.85 + Math.sin(t * 4 + o.x) * 0.15;
        ctx.save();
        ctx.translate(o.x, o.y);
        if (kind === 'coin') {
          ctx.rotate(t * 1.6);
          ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 16;
          const g = ctx.createLinearGradient(-10, -10, 10, 10);
          g.addColorStop(0, '#fde68a'); g.addColorStop(1, '#f59e0b');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(0, 0, 9 * pulse, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(120,53,15,0.55)';
          ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, TAU); ctx.fill();
        } else if (kind === 'flag') {
          ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 20;
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(-2.5, -16, 4, 32);
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath(); ctx.moveTo(2, -16); ctx.lineTo(20, -10); ctx.lineTo(2, -3); ctx.closePath(); ctx.fill();
        } else if (kind === 'heal') {
          ctx.shadowColor = '#34d399'; ctx.shadowBlur = 18;
          ctx.fillStyle = '#34d399';
          ctx.fillRect(-10, -3.6, 20, 7.2);
          ctx.fillRect(-3.6, -10, 7.2, 20);
        } else {
          ctx.shadowColor = '#a78bfa'; ctx.shadowBlur = 14;
          ctx.fillStyle = '#a78bfa';
          ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
        }
        ctx.restore();
      }
    }

    drawShots(ctx, visible) {
      for (const s of this.shots.values()) {
        if (!visible(s.x, s.y, 40)) continue;
        const c = s.data.color || '#fff';
        ctx.save();
        ctx.shadowColor = c; ctx.shadowBlur = 18;
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.data.r || 7, 0, TAU); ctx.fill();
        ctx.restore();
      }
      for (const sp of this.sparks) {
        const a = sp.life / sp.max;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = sp.color;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 16 * (1 + (1 - a) * 2), 0, TAU); ctx.fill();
        ctx.restore();
      }
    }

    drawEnemies(ctx, t, visible) {
      for (const e of this.enemies.values()) {
        if (!visible(e.x, e.y, 90)) continue;
        const en = e.data;
        const r = e.r || 20;
        const col = en.color || '#fb7185';
        const hpRatio = en.maxHp ? clamp(en.hp / en.maxHp, 0, 1) : 1;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.shadowColor = col; ctx.shadowBlur = 18;
        const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
        g.addColorStop(0, window.BAL.shade(col, 0.4));
        g.addColorStop(1, window.BAL.shade(col, -0.45));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;

        // type accents
        if (en.type === 'rusher') {
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2.5;
          for (let i = 0; i < 3; i += 1) {
            const a = t * 6 + (i * TAU) / 3;
            ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4);
            ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95); ctx.stroke();
          }
        } else if (en.type === 'tank') {
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, TAU); ctx.stroke();
        } else if (en.type === 'shooter') {
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(6,182,212,0.9)';
          ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, TAU); ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.beginPath(); ctx.arc(-r * 0.22, -r * 0.1, r * 0.13, 0, TAU); ctx.arc(r * 0.22, -r * 0.1, r * 0.13, 0, TAU); ctx.fill();
        }
        ctx.restore();

        if (hpRatio < 1) {
          const w = r * 2.2;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(e.x - w / 2, e.y - r - 12, w, 5);
          ctx.fillStyle = col;
          ctx.fillRect(e.x - w / 2, e.y - r - 12, w * hpRatio, 5);
        }
      }
    }

    drawBoss(ctx, t, visible) {
      const b = this.bossRender;
      if (!b) return;
      const d = b.data;
      if (!visible(b.x, b.y, 300)) return;
      const r = d.r || 90;

      // telegraph
      if (d.state === 'telegraph') {
        const tx = d.telegraphX || b.x; const ty = d.telegraphY || b.y;
        const pulse = 0.5 + 0.5 * Math.sin(t * 12);
        ctx.save();
        ctx.strokeStyle = `rgba(248,113,113,${0.35 + pulse * 0.5})`;
        ctx.lineWidth = 6;
        ctx.setLineDash([18, 12]);
        ctx.beginPath(); ctx.arc(tx, ty, 120 + pulse * 20, 0, TAU); ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(b.x, b.y);
      if (d.enraged) { ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 40; }
      else { ctx.shadowColor = d.color || '#f43f5e'; ctx.shadowBlur = 26; }

      // aura
      const aura = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.8);
      aura.addColorStop(0, window.BAL.rgba(d.color || '#f43f5e', 0.35));
      aura.addColorStop(1, window.BAL.rgba(d.color || '#f43f5e', 0));
      ctx.fillStyle = aura;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, TAU); ctx.fill();

      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.15, 0, 0, r);
      g.addColorStop(0, window.BAL.shade(d.color || '#f43f5e', 0.35));
      g.addColorStop(0.55, d.color || '#f43f5e');
      g.addColorStop(1, window.BAL.shade(d.secondary || '#3b0764', -0.4));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;

      // rotating shards
      ctx.save();
      ctx.rotate(t * 0.4);
      ctx.strokeStyle = window.BAL.rgba(d.accent || '#ffffff', 0.65);
      ctx.lineWidth = r * 0.05;
      for (let i = 0; i < 6; i += 1) {
        ctx.beginPath(); ctx.arc(0, 0, r * 0.78, (i * TAU) / 6, (i * TAU) / 6 + 0.55); ctx.stroke();
      }
      ctx.restore();

      // eyes
      const dir = Math.atan2(this.me.y - b.y, this.me.x - b.x);
      const ex = Math.cos(dir) * r * 0.22;
      const ey = Math.sin(dir) * r * 0.22;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(-r * 0.26 + ex * 0.4, -r * 0.1 + ey * 0.4, r * 0.17, 0, TAU);
      ctx.arc(r * 0.26 + ex * 0.4, -r * 0.1 + ey * 0.4, r * 0.17, 0, TAU); ctx.fill();
      ctx.fillStyle = d.enraged ? '#ef4444' : '#0b1020';
      ctx.beginPath(); ctx.arc(-r * 0.22 + ex, -r * 0.08 + ey, r * 0.085, 0, TAU);
      ctx.arc(r * 0.3 + ex, -r * 0.08 + ey, r * 0.085, 0, TAU); ctx.fill();
      ctx.restore();

      // name
      ctx.save();
      ctx.font = '600 18px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(d.name || 'Boss', b.x, b.y - r - 22);
      ctx.restore();
    }

    drawPlayers(ctx, t, visible) {
      for (const p of this.players.values()) {
        const d = p.data;
        if (!visible(p.x, p.y, 140)) continue;
        const r = 24;
        const isMe = d.id === this.me.key;
        const skin = d.skin || this.mySkin || { primary: '#7c3aed', secondary: '#111827', accent: '#ffffff', pattern: 'solid', rarity: 'COMMON' };
        const bob = Math.sin(t * 2.2 + p.bob) * 1.2;

        if (!d.alive) {
          ctx.save();
          ctx.globalAlpha = 0.35;
          window.BAL.drawBall(ctx, skin, p.x, p.y, r * 0.55, t, { glow: false });
          ctx.restore();
          ctx.save();
          ctx.font = '600 12px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(226,232,240,0.7)';
          ctx.fillText(d.respawnIn ? `respawn ${d.respawnIn}s` : 'down', p.x, p.y - 22);
          ctx.restore();
          continue;
        }

        if (d.slow) {
          ctx.save();
          ctx.strokeStyle = 'rgba(167,139,250,0.7)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 12, 0, TAU); ctx.stroke();
          ctx.restore();
        }

        window.BAL.drawBall(ctx, skin, p.x, p.y + bob, r, t, {
          glow: true,
          glowScale: isMe ? 0.95 : 0.6,
          ring: isMe ? 'rgba(125,211,252,0.9)' : null,
        });

        // dash trail hint
        if (isMe) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = 'rgba(125,211,252,0.8)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y + bob, r + 9, this.aim - 0.5, this.aim + 0.5);
          ctx.stroke();
          ctx.restore();
        }

        // name + hp
        const label = d.username || 'Player';
        ctx.save();
        ctx.font = '600 13px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = isMe ? '#7dd3fc' : 'rgba(226,232,240,0.92)';
        ctx.fillText(label, p.x, p.y - r - 16);
        if (d.level) {
          ctx.fillStyle = 'rgba(148,163,184,0.9)';
          ctx.font = '600 10px Inter, system-ui, sans-serif';
          ctx.fillText(`LV ${d.level}`, p.x, p.y - r - 32);
        }
        const w = r * 2.1;
        const ratio = clamp(d.hp / Math.max(1, d.maxHp), 0, 1);
        ctx.fillStyle = 'rgba(3,7,18,0.7)';
        ctx.fillRect(p.x - w / 2, p.y - r - 9, w, 5);
        ctx.fillStyle = ratio > 0.55 ? '#34d399' : ratio > 0.25 ? '#fbbf24' : '#f43f5e';
        ctx.fillRect(p.x - w / 2, p.y - r - 9, w * ratio, 5);
        ctx.restore();
      }
    }

    drawParticles(ctx) {
      for (const p of this.particles) {
        const a = clamp(p.life / p.max, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + a * 0.9), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const r of this.rings) {
        const k = 1 - r.life / r.max;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 6 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.size * k, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    drawFloaters(ctx) {
      ctx.textAlign = 'center';
      for (const f of this.floaters) {
        const a = clamp(f.life / f.max, 0, 1);
        ctx.globalAlpha = a;
        ctx.font = '700 14px Inter, system-ui, sans-serif';
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.ArenaScene = ArenaScene;
})();
