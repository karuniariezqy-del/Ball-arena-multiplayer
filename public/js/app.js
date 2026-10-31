/* BALL ARENA LEGENDS — client controller
 * Screens, REST calls, socket lifecycle, shop, chat and owner dashboard.
 * Depends on window.BAL (ball renderer) and window.ArenaScene (arena canvas engine).
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const BAL = window.BAL;

  const MODE_LABEL = { multi: 'MULTIPLAYER', solo: 'SOLO', duel: '1 VS 1', boss: 'BOSS RAID' };
  const TITLES = {
    intro: 'BALL ARENA', auth: 'ACCOUNT', lobby: 'LOBBY', modes: 'MODES',
    bosses: 'BOSSES', skins: 'SKINS', profile: 'PROFILE', chat: 'GLOBAL CHAT',
    owner: 'OWNER DASHBOARD', arena: 'ARENA',
  };
  const PAGES = ['lobby', 'modes', 'bosses', 'skins', 'profile', 'chat', 'owner'];

  const App = {
    user: null,
    meta: null,
    rarities: {},
    skins: [],
    skinMap: {},
    socket: null,
    scene: null,
    screen: 'intro',
    stack: [],
    skinFilter: 'ALL',
    chatBound: false,
    ownerLoaded: false,
    bossId: null,
    duelStatus: 'idle',
  };

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(n) {
    const num = Number(n) || 0;
    return num.toLocaleString('en-US');
  }

  function when(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (err) { return '—'; }
  }

  async function api(path, options) {
    const opts = Object.assign({ credentials: 'same-origin', headers: {} }, options || {});
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(`/api${path}`, opts);
    let data = {};
    try { data = await res.json(); } catch (err) { data = {}; }
    if (!res.ok) {
      const error = new Error(data.error || `Request failed (${res.status})`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function toast(message, kind) {
    const host = $('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = `toast ${kind || 'info'}`;
    el.textContent = String(message == null ? '' : message);
    host.appendChild(el);
    setTimeout(() => { el.classList.add('out'); }, 2600);
    setTimeout(() => { el.remove(); }, 3200);
  }

  function openModal(title, html) {
    const modal = $('genericModal');
    if (!modal) return;
    $('modalTitle').textContent = title || 'Details';
    $('modalBody').innerHTML = html || '';
    modal.classList.remove('hidden');
  }

  function closeModal() {
    const modal = $('genericModal');
    if (modal) modal.classList.add('hidden');
  }

  /* ------------------------------------------------------------------ */
  /* skin / ball rendering                                               */
  /* ------------------------------------------------------------------ */

  function skinOf(id) {
    return App.skinMap[id] || App.skinMap.skin_001 || {
      id: 'skin_001', name: 'Pebble', rarity: 'COMMON', pattern: 'solid',
      primary: '#7c3aed', secondary: '#22d3ee', accent: '#ffffff',
    };
  }

  function mountPreview(canvas, getSkin) {
    if (!canvas || !BAL || !BAL.mount) return;
    BAL.mount(canvas, getSkin);
  }

  function rarityMeta(rarity) {
    return App.rarities[rarity] || { label: rarity || 'COMMON', color: '#94a3b8', order: 99 };
  }

  function renderLogo() {
    const canvas = $('logoBall');
    if (!canvas || !BAL) return;
    const godly = skinOf(App.user && App.user.isOwner ? 'skin_096' : 'skin_001');
    mountPreview(canvas, () => godly);
  }

  /* ------------------------------------------------------------------ */
  /* router                                                              */
  /* ------------------------------------------------------------------ */

  function showScreen(name, opts) {
    const target = $(`screen-${name}`);
    if (!target) return;
    const previous = App.screen;
    if (opts && opts.push !== false && previous !== name) App.stack.push(previous);
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    target.classList.add('active');
    App.screen = name;

    const shell = $('appShell');
    if (shell) shell.classList.toggle('active', PAGES.includes(name) && !!App.user);
    const navTitle = $('navTitle');
    if (navTitle) navTitle.textContent = TITLES[name] || '';
    const back = $('navBack');
    if (back) back.style.visibility = name === 'lobby' ? 'hidden' : 'visible';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (name === 'lobby') renderLobby();
    if (name === 'bosses') loadBosses();
    if (name === 'skins') loadSkins();
    if (name === 'profile') renderProfile();
    if (name === 'chat') enterChat();
    if (name === 'owner') enterOwner();
    if (name === 'arena') document.body.classList.add('in-arena');
    else document.body.classList.remove('in-arena');
  }

  function goBack() {
    if (App.screen === 'arena') { requestArenaExit(); return; }
    if (App.stack.length) {
      const prev = App.stack.pop();
      showScreen(prev, { push: false });
    } else {
      showScreen(App.user ? 'lobby' : 'intro', { push: false });
    }
  }

  function toLobby() {
    App.stack = [];
    showScreen('lobby', { push: false });
  }

  /* ------------------------------------------------------------------ */
  /* user state                                                          */
  /* ------------------------------------------------------------------ */

  function applyUser(user) {
    if (!user) return;
    App.user = user;
    const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    set('chipCoins', fmt(user.coins));
    set('chipFlags', fmt(user.flags));
    set('chipName', user.username);
    set('chipLevel', user.level);
    const avatar = $('chipAvatar');
    if (avatar) {
      if (user.avatar && user.avatar.startsWith('/uploads/')) {
        avatar.innerHTML = `<img src="${escapeHtml(user.avatar)}" alt="" />`;
      } else {
        avatar.textContent = user.avatar || '🔵';
      }
    }
    const ownerImage = $('ownerImageBtn');
    if (ownerImage) ownerImage.hidden = !user.isOwner;
  }

  function applyWallet(user) {
    if (!user) return;
    applyUser(user);
    if (App.screen === 'lobby') renderLobby();
    if (App.screen === 'profile') renderProfile();
    if (App.screen === 'skins') loadSkins();
  }

  /* ------------------------------------------------------------------ */
  /* intro / auth                                                        */
  /* ------------------------------------------------------------------ */

  function bindAuth() {
    const start = $('btnStart');
    if (start) start.addEventListener('click', () => {
      showScreen(App.user ? 'lobby' : 'auth');
    });
    const howto = $('btnHowTo');
    if (howto) howto.addEventListener('click', () => {
      openModal('HOW TO PLAY', `
        <ul class="rules">
          <li><b>Move</b> — WASD / arrow keys. On mobile, drag the virtual joystick.</li>
          <li><b>Dash</b> — SPACE or the DASH button. 2.8s cooldown, 190ms burst.</li>
          <li><b>Coins &amp; EXP</b> — dropped by enemy balls and boss kills.</li>
          <li><b>Flags</b> — found in the arena; required to open boss raids.</li>
          <li><b>Modes</b> — Multiplayer, Solo, 1v1 duel (first to 3 knockouts), Boss raids.</li>
          <li><b>Rewards</b> are validated and stored server-side, so progress is permanent.</li>
        </ul>`);
    });
    const home = $('authHome');
    if (home) home.addEventListener('click', (e) => { e.preventDefault(); showScreen('intro'); });

    const tabLogin = $('tabLogin');
    const tabRegister = $('tabRegister');
    const loginForm = $('loginForm');
    const registerForm = $('registerForm');
    const selectTab = (which) => {
      const isLogin = which === 'login';
      if (tabLogin) tabLogin.classList.toggle('active', isLogin);
      if (tabRegister) tabRegister.classList.toggle('active', !isLogin);
      if (loginForm) loginForm.classList.toggle('active', isLogin);
      if (registerForm) registerForm.classList.toggle('active', !isLogin);
    };
    if (tabLogin) tabLogin.addEventListener('click', () => selectTab('login'));
    if (tabRegister) tabRegister.addEventListener('click', () => selectTab('register'));
    document.querySelectorAll('[data-goto-register]').forEach((b) => b.addEventListener('click', () => selectTab('register')));
    document.querySelectorAll('[data-goto-login]').forEach((b) => b.addEventListener('click', () => selectTab('login')));

    document.querySelectorAll('.eye').forEach((btn) => btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    }));

    if (loginForm) loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('loginError');
      const submit = $('loginSubmit');
      if (errEl) errEl.textContent = '';
      if (submit) { submit.disabled = true; submit.textContent = 'LOGGING IN…'; }
      try {
        const data = await api('/login', {
          method: 'POST',
          body: { username: $('loginUser').value.trim(), password: $('loginPass').value },
        });
        applyUser(data.user);
        toast(data.message || 'Welcome back.', 'ok');
        connectSocket();
        toLobby();
        loadLobbyData();
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      } finally {
        if (submit) { submit.disabled = false; submit.textContent = 'LOG IN'; }
      }
    });

    if (registerForm) registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('regError');
      const submit = $('regSubmit');
      if (errEl) errEl.textContent = '';
      const password = $('regPass').value;
      if (password !== $('regConfirm').value) {
        if (errEl) errEl.textContent = 'Passwords do not match.';
        return;
      }
      if (submit) { submit.disabled = true; submit.textContent = 'CREATING…'; }
      try {
        const data = await api('/register', {
          method: 'POST',
          body: {
            username: $('regUser').value.trim(),
            password,
            confirmPassword: $('regConfirm').value,
          },
        });
        applyUser(data.user);
        toast(data.message || 'Account created.', 'ok');
        connectSocket();
        toLobby();
        loadLobbyData();
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      } finally {
        if (submit) { submit.disabled = false; submit.textContent = 'CREATE LEGEND'; }
      }
    });

    const logout = $('btnLogout');
    if (logout) logout.addEventListener('click', async () => {
      try { await api('/logout', { method: 'POST' }); } catch (err) { /* ignore */ }
      disconnectSocket();
      App.user = null;
      App.stack = [];
      const shell = $('appShell');
      if (shell) shell.classList.remove('active');
      showScreen('intro', { push: false });
      toast('Logged out.', 'info');
    });

    const back = $('navBack');
    if (back) back.addEventListener('click', goBack);

    const chip = $('playerChip');
    if (chip) chip.addEventListener('click', () => showScreen('profile'));
  }

  /* ------------------------------------------------------------------ */
  /* socket                                                              */
  /* ------------------------------------------------------------------ */

  function connectSocket() {
    if (App.socket || typeof window.io !== 'function') return App.socket;
    const socket = window.io({ withCredentials: true });
    App.socket = socket;

    socket.on('connect', () => { socket.emit('presence:ping'); });
    socket.on('ready', (payload) => {
      if (payload && payload.user) applyUser(payload.user);
    });
    socket.on('online:update', (payload) => {
      renderOnlineList(payload && payload.players, payload && payload.count);
    });
    socket.on('wallet:update', (payload) => { if (payload && payload.user) applyWallet(payload.user); });
    socket.on('profile:update', () => { api('/me').then((d) => { if (d.user) applyUser(d.user); }).catch(() => {}); });
    socket.on('connect_error', (err) => {
      if (err && /banned/i.test(err.message || '')) {
        toast('This account is banned.', 'error');
        disconnectSocket();
      }
    });
    socket.on('banned', (payload) => {
      toast(`Banned: ${(payload && payload.reason) || 'policy violation'}`, 'error');
    });
    return socket;
  }

  function disconnectSocket() {
    if (App.socket) { App.socket.disconnect(); App.socket = null; }
  }

  /* ------------------------------------------------------------------ */
  /* lobby                                                               */
  /* ------------------------------------------------------------------ */

  function renderLobby() {
    const user = App.user;
    if (!user) return;
    const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    const skin = skinOf(user.equippedSkin);
    set('lobbyName', user.username);
    set('lobbySkinName', skin.name);
    set('lobbyRarity', rarityMeta(skin.rarity).label || skin.rarity);
    set('lobbyRole', user.isOwner ? 'OWNER' : (user.role || 'PLAYER'));
    set('lobbyLevel', user.level);
    set('lobbyCoins', fmt(user.coins));
    set('lobbyFlags', fmt(user.flags));
    set('lobbyWins', fmt(user.wins));
    const pct = Math.max(0, Math.min(100, Math.round((user.expIntoLevel / Math.max(1, user.expForNext)) * 100)));
    const bar = $('expBar');
    if (bar) bar.style.width = `${pct}%`;
    set('expText', `${fmt(user.expIntoLevel)} / ${fmt(user.expForNext)} EXP`);
    mountPreview($('playerBall'), () => skinOf(App.user && App.user.equippedSkin));
    const ownerNav = document.querySelector('[data-nav="owner"]');
    if (ownerNav) ownerNav.hidden = !user.isOwner;
    const ownerBtn = document.querySelectorAll('[data-owner-only]');
    ownerBtn.forEach((el) => { el.hidden = !user.isOwner; });
  }

  async function loadLobbyData() {
    try {
      const [lb, meta] = await Promise.all([api('/leaderboard'), api('/meta')]);
      const list = $('lbList');
      if (list) {
        list.innerHTML = (lb.players || []).length
          ? lb.players.map((p, i) => `
            <div class="lb-row">
              <span class="lb-rank">${i + 1}</span>
              <span class="lb-name">${escapeHtml(p.username)}</span>
              <span class="lb-tag">LV ${p.level}</span>
              <span class="lb-val">${fmt(p.coins)} 🪙</span>
              <span class="lb-val">${fmt(p.wins)} 🏆</span>
            </div>`).join('')
          : '<p class="muted">No legends ranked yet.</p>';
      }
      if (meta) {
        App.meta = meta;
        const intro = $('introOnline');
        if (intro) intro.textContent = meta.online || 0;
        renderOnlineList(meta.onlinePlayers, meta.online);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderOnlineList(players, count) {
    const host = $('onlineList');
    const badge = $('multiOnline');
    const online = Array.isArray(players) ? players : [];
    const total = typeof count === 'number' ? count : online.length;
    if (badge) badge.textContent = `${total} online`;
    const chatOnline = $('chatOnline');
    if (chatOnline) chatOnline.textContent = `${total} online`;
    const intro = $('introOnline');
    if (intro) intro.textContent = total;
    if (!host) return;
    host.innerHTML = online.length
      ? online.map((p) => `<div class="online-row"><span class="live-dot"></span>${escapeHtml(p.username)}<b>LV ${p.level || 1}</b></div>`).join('')
      : '<p class="muted">Nobody online yet.</p>';
  }

  function bindModes() {
    document.querySelectorAll('[data-mode]').forEach((el) => {
      el.addEventListener('click', () => {
        const mode = el.dataset.mode;
        if (mode === 'duel') { queueDuel(); return; }
        if (mode === 'boss') { showScreen('bosses'); return; }
        startArena(mode);
      });
    });
    const cancel = $('btnDuelCancel');
    if (cancel) cancel.addEventListener('click', () => {
      if (App.socket) App.socket.emit('duel:cancel');
      App.duelStatus = 'idle';
      setDuelStatus('Not in queue.');
      toast('Left the duel queue.', 'info');
    });
  }

  function setDuelStatus(text) {
    const el = $('duelStatusText');
    if (el) el.textContent = text;
  }

  function queueDuel() {
    if (!App.socket) { toast('Not connected yet.', 'error'); return; }
    App.socket.emit('duel:queue');
    setDuelStatus('Searching for an opponent…');
    showScreen('modes');
    toast('Searching for an opponent…', 'info');
  }

  /* ------------------------------------------------------------------ */
  /* bosses                                                              */
  /* ------------------------------------------------------------------ */

  async function loadBosses() {
    const host = $('bossList');
    if (!host) return;
    const flagsLabel = $('bossFlagsLabel');
    if (flagsLabel) flagsLabel.textContent = `Flags: ${fmt(App.user ? App.user.flags : 0)}`;
    try {
      const data = await api('/bosses');
      const bosses = data.bosses || [];
      host.innerHTML = bosses.map((b) => {
        const locked = !b.unlocked;
        return `
          <div class="boss-card ${locked ? 'locked' : ''}" data-boss="${escapeHtml(b.id)}">
            <div class="boss-orb" style="--boss:${escapeHtml(b.color || '#a78bfa')}"></div>
            <h4>${escapeHtml(b.name)}</h4>
            <p class="muted">${escapeHtml(b.title || '')}</p>
            <div class="boss-reqs">
              <span class="${b.levelOk ? 'ok' : 'no'}">LV ${b.reqLevel}</span>
              <span class="${b.flagsOk ? 'ok' : 'no'}">🚩 ${b.reqFlags}</span>
            </div>
            <p class="hint">Clears: ${b.clears} · Reward skin: ${escapeHtml(b.rewardSkin || '—')}</p>
            <button class="btn ${locked ? 'btn-ghost' : 'btn-primary'}" ${locked ? 'disabled' : ''}>
              ${locked ? 'LOCKED' : 'RAID BOSS'}
            </button>
          </div>`;
      }).join('') || '<p class="muted">No bosses available.</p>';
      host.querySelectorAll('[data-boss]').forEach((card) => {
        const btn = card.querySelector('button');
        if (!btn || btn.disabled) return;
        btn.addEventListener('click', () => startArena('boss', card.dataset.boss));
      });
    } catch (err) {
      host.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
    }
  }

  /* ------------------------------------------------------------------ */
  /* skins                                                               */
  /* ------------------------------------------------------------------ */

  function renderSkinFilters() {
    const host = $('skinFilters');
    if (!host) return;
    const order = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGEND', 'MYTHIC', 'SECRET', 'GODLY', 'ULTIMAX', 'GODMAX'];
    const counts = {};
    App.skins.forEach((s) => { counts[s.rarity] = (counts[s.rarity] || 0) + 1; });
    host.innerHTML = ['ALL'].concat(order).map((r) => {
      const n = r === 'ALL' ? App.skins.length : (counts[r] || 0);
      const active = App.skinFilter === r ? 'active' : '';
      return `<button class="chip-btn ${active}" data-filter="${r}">${r} <b>${n}</b></button>`;
    }).join('');
    host.querySelectorAll('[data-filter]').forEach((btn) => btn.addEventListener('click', () => {
      App.skinFilter = btn.dataset.filter;
      renderSkinFilters();
      renderSkinGrid();
    }));
  }

  function renderSkinGrid() {
    const host = $('skinGrid');
    if (!host) return;
    const list = App.skinFilter === 'ALL' ? App.skins : App.skins.filter((s) => s.rarity === App.skinFilter);
    const owned = App.user ? (App.user.ownedSkins || []) : [];
    host.innerHTML = list.map((s) => {
      const meta = rarityMeta(s.rarity);
      const isOwned = owned.includes(s.id);
      const equipped = App.user && App.user.equippedSkin === s.id;
      const locked = s.grantOnly;
      let action = '<span class="skin-tag">OWNED</span>';
      if (equipped) action = '<span class="skin-tag on">EQUIPPED</span>';
      else if (isOwned) action = `<button class="btn btn-ghost small" data-equip="${escapeHtml(s.id)}">EQUIP</button>`;
      else if (locked) action = '<span class="skin-tag locked">OWNER GRANT ONLY</span>';
      else action = `<button class="btn btn-primary small" data-buy="${escapeHtml(s.id)}">${fmt(s.price)} 🪙</button>`;
      return `
        <div class="skin-card ${equipped ? 'equipped' : ''}" style="--rarity:${escapeHtml(meta.color || '#94a3b8')}">
          <div class="skin-preview"><canvas data-skin-canvas="${escapeHtml(s.id)}" width="120" height="120"></canvas></div>
          <h5>${escapeHtml(s.name)}</h5>
          <span class="rarity" style="color:${escapeHtml(meta.color || '#94a3b8')}">${escapeHtml(meta.label || s.rarity)}</span>
          <div class="skin-action">${action}</div>
        </div>`;
    }).join('') || '<p class="muted">No skins in this tier.</p>';

    list.forEach((s) => {
      const canvas = host.querySelector(`[data-skin-canvas="${CSS.escape ? CSS.escape(s.id) : s.id}"]`);
      if (canvas) mountPreview(canvas, () => s);
    });

    host.querySelectorAll('[data-buy]').forEach((btn) => btn.addEventListener('click', () => buySkin(btn.dataset.buy)));
    host.querySelectorAll('[data-equip]').forEach((btn) => btn.addEventListener('click', () => equipSkin(btn.dataset.equip)));
  }

  async function loadSkins() {
    if (!App.skins.length) {
      try {
        const data = await api('/skins');
        App.skins = data.skins || [];
        App.rarities = data.rarities || {};
        App.skinMap = {};
        App.skins.forEach((s) => { App.skinMap[s.id] = s; });
      } catch (err) {
        toast(err.message, 'error');
        return;
      }
    }
    const ownedCount = App.user ? (App.user.ownedSkins || []).length : 0;
    const countEl = $('skinCount');
    if (countEl) countEl.textContent = `${ownedCount} / ${App.skins.length} owned`;
    renderSkinFilters();
    renderSkinGrid();
  }

  async function buySkin(skinId) {
    try {
      const data = await api('/shop/buy', { method: 'POST', body: { skinId } });
      applyUser(data.user);
      toast(data.message || 'Skin unlocked!', 'ok');
      await loadSkins();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function equipSkin(skinId) {
    try {
      const data = await api('/profile/skin', { method: 'POST', body: { skinId } });
      applyUser(data.user);
      toast(`${skinOf(skinId).name} equipped.`, 'ok');
      await loadSkins();
      renderLobby();
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ------------------------------------------------------------------ */
  /* profile                                                             */
  /* ------------------------------------------------------------------ */

  function renderProfile() {
    const user = App.user;
    if (!user) return;
    const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    const skin = skinOf(user.equippedSkin);
    const avatar = $('profileAvatar');
    if (avatar) {
      if (user.avatar && user.avatar.startsWith('/uploads/')) {
        avatar.innerHTML = `<img src="${escapeHtml(user.avatar)}" alt="" />`;
      } else {
        avatar.textContent = user.avatar || '🔵';
      }
    }
    set('profileName', user.username);
    set('profileMeta', `Member since ${when(user.createdAt)}`);
    set('profileRole', user.isOwner ? 'OWNER' : (user.role || 'PLAYER'));
    set('profileSkin', `${skin.name} · ${rarityMeta(skin.rarity).label || skin.rarity}`);
    const bio = $('bioInput');
    if (bio && document.activeElement !== bio) bio.value = user.bio || '';
    mountPreview($('profileBall'), () => skinOf(App.user && App.user.equippedSkin));

    const stats = $('profileStats');
    if (stats) {
      const rows = [
        ['Level', user.level], ['EXP', fmt(user.exp)], ['Coins', fmt(user.coins)],
        ['Flags', fmt(user.flags)], ['Wins', fmt(user.wins)], ['Losses', fmt(user.losses)],
        ['Skins owned', (user.ownedSkins || []).length], ['Role', user.role || 'PLAYER'],
      ];
      stats.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${escapeHtml(v)}</b></div>`).join('');
    }
    const strip = $('profileSkins');
    if (strip) {
      const owned = (user.ownedSkins || []).map(skinOf);
      const countEl = $('profileSkinCount');
      if (countEl) countEl.textContent = `${owned.length} skins`;
      strip.innerHTML = owned.slice(0, 40).map((s) => {
        const meta = rarityMeta(s.rarity);
        return `<button class="skin-mini ${user.equippedSkin === s.id ? 'on' : ''}" data-equip-mini="${escapeHtml(s.id)}" title="${escapeHtml(s.name)}">
          <canvas data-mini-canvas="${escapeHtml(s.id)}" width="72" height="72"></canvas>
          <span style="color:${escapeHtml(meta.color || '#94a3b8')}">${escapeHtml(s.rarity)}</span>
        </button>`;
      }).join('') || '<p class="muted">No skins owned yet.</p>';
      owned.slice(0, 40).forEach((s) => {
        const canvas = strip.querySelector(`[data-mini-canvas="${s.id}"]`);
        if (canvas) mountPreview(canvas, () => s);
      });
      strip.querySelectorAll('[data-equip-mini]').forEach((btn) => btn.addEventListener('click', () => equipSkin(btn.dataset.equipMini)));
    }
  }

  function bindProfile() {
    const save = $('bioSave');
    if (save) save.addEventListener('click', async () => {
      try {
        const data = await api('/profile', { method: 'PATCH', body: { bio: $('bioInput').value } });
        applyUser(data.user);
        toast('Profile saved.', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    });
    const file = $('avatarFile');
    if (file) file.addEventListener('change', () => {
      const picked = file.files && file.files[0];
      if (!picked) return;
      if (picked.size > 400 * 1024) { toast('Image must be under 400KB.', 'error'); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const data = await api('/profile/avatar', { method: 'POST', body: { dataUrl: reader.result } });
          applyUser(data.user);
          renderProfile();
          toast('Profile photo updated.', 'ok');
        } catch (err) { toast(err.message, 'error'); }
      };
      reader.readAsDataURL(picked);
    });
  }

  /* ------------------------------------------------------------------ */
  /* chat                                                                */
  /* ------------------------------------------------------------------ */

  function chatBubble(m) {
    const isOwner = m.isOwner;
    const avatar = m.avatar && String(m.avatar).startsWith('/uploads/')
      ? `<img src="${escapeHtml(m.avatar)}" alt="" />`
      : escapeHtml(m.avatar || '🔵');
    const image = m.imageUrl
      ? `<div class="msg-image"><img src="${escapeHtml(m.imageUrl)}" alt="owner image" loading="lazy" /></div>`
      : '';
    const canReport = !isOwner && !m.deleted && App.user;
    return `<div class="msg ${isOwner ? 'owner' : ''} ${m.deleted ? 'deleted' : ''}" data-msg="${m.id}">
      <span class="msg-avatar">${avatar}</span>
      <div class="msg-main">
        <div class="msg-head"><b>${escapeHtml(m.username)}</b>${isOwner ? '<span class="owner-tag">OWNER</span>' : ''}<i>${new Date(m.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</i></div>
        ${m.text ? `<p>${escapeHtml(m.text)}</p>` : ''}
        ${image}
      </div>
      ${canReport ? `<button class="msg-report" data-report="${m.id}" title="Report message">⚠</button>` : ''}
    </div>`;
  }

  function appendChat(host, message, limit) {
    if (!host) return;
    const empty = host.querySelector('.muted');
    if (empty) empty.remove();
    host.insertAdjacentHTML('beforeend', chatBubble(message));
    const max = limit || 120;
    while (host.children.length > max) host.removeChild(host.firstElementChild);
    host.scrollTop = host.scrollHeight;
  }

  async function enterChat() {
    const host = $('chatMessages');
    const label = $('chatRoomLabel');
    if (label) label.textContent = 'GLOBAL CHAT';
    if (!App.chatBound) {
      App.chatBound = true;
      const form = $('chatForm');
      if (form) form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('chatInput');
        const text = input.value.trim();
        if (!text) return;
        if (!App.socket) { toast('Not connected.', 'error'); return; }
        App.socket.emit('chat:send', { text, room: 'global' }, (res) => {
          if (res && res.error) toast(res.error, 'error');
        });
        input.value = '';
      });
      document.querySelectorAll('#chatEmoji button').forEach((btn) => btn.addEventListener('click', () => {
        const input = $('chatInput');
        if (!input) return;
        input.value += btn.textContent;
        input.focus();
      }));
      host.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-report]');
        if (!btn) return;
        reportMessage(Number(btn.dataset.report));
      });
      const ownerImage = $('ownerImageBtn');
      if (ownerImage) ownerImage.addEventListener('click', () => pickOwnerImage());
    }
    if (host && !host.dataset.loaded) {
      host.innerHTML = '<p class="muted">Loading messages…</p>';
      try {
        const data = await api('/chat/history?room=global');
        host.innerHTML = '';
        host.dataset.loaded = '1';
        (data.messages || []).forEach((m) => appendChat(host, m));
        if (!(data.messages || []).length) host.innerHTML = '<p class="muted">No messages yet. Say hello!</p>';
      } catch (err) {
        host.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
      }
    }
    if (App.socket) {
      App.socket.off('chat:message', onGlobalChat);
      App.socket.on('chat:message', onGlobalChat);
      App.socket.off('chat:delete', onChatDelete);
      App.socket.on('chat:delete', onChatDelete);
    }
  }

  function onGlobalChat(message) {
    if (!message) return;
    if (message.room !== 'global') return;
    const host = $('chatMessages');
    if (App.screen === 'chat' && host) appendChat(host, message);
    else if (message.username !== (App.user && App.user.username)) toast(`${message.username}: ${message.text || '[image]'}`, 'info');
  }

  function onChatDelete(payload) {
    if (!payload) return;
    document.querySelectorAll(`[data-msg="${payload.id}"]`).forEach((el) => {
      el.classList.add('deleted');
      const body = el.querySelector('.msg-main');
      if (body) body.innerHTML = '<p class="muted">[removed by moderator]</p>';
    });
  }

  function reportMessage(messageId) {
    openModal('REPORT MESSAGE', `
      <label for="reportReason">Reason</label>
      <input id="reportReason" maxlength="200" placeholder="What is wrong with this message?" />
      <div class="modal-actions"><button class="btn btn-danger" id="reportSend">SEND REPORT</button></div>`);
    const send = $('reportSend');
    if (send) send.addEventListener('click', async () => {
      try {
        const data = await api('/chat/report', {
          method: 'POST',
          body: { messageId, reason: $('reportReason').value || 'Inappropriate content' },
        });
        closeModal();
        toast(data.message || 'Report sent.', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  function pickOwnerImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 1.5 * 1024 * 1024) { toast('Image must be under 1.5MB.', 'error'); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          await api('/owner/chat-image', { method: 'POST', body: { dataUrl: reader.result, text: '' } });
          toast('Owner image posted.', 'ok');
        } catch (err) { toast(err.message, 'error'); }
      };
      reader.readAsDataURL(file);
    });
    input.click();
  }

  /* ------------------------------------------------------------------ */
  /* owner dashboard                                                     */
  /* ------------------------------------------------------------------ */

  function enterOwner() {
    if (!App.user || !App.user.isOwner) {
      toast('Owner access only.', 'error');
      showScreen('lobby');
      return;
    }
    loadOwnerOverview();
  }

  async function loadOwnerOverview() {
    try {
      const data = await api('/owner/overview');
      App.ownerLoaded = true;
      const totals = data.totals || {};
      const stats = $('ownerStats');
      if (stats) {
        const rows = [
          ['Registered users', fmt(totals.users)], ['Coin holders', fmt(totals.holders)],
          ['Coins in economy', fmt(totals.coins)], ['Total EXP', fmt(totals.exp)],
          ['Flags collected', fmt(totals.flags)], ['Duels won', fmt(totals.wins)],
          ['Boss kills', fmt(totals.bossKills)], ['Online now', fmt((data.online || []).length)],
        ];
        stats.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${escapeHtml(v)}</b></div>`).join('');
      }
      const reports = $('ownerReports');
      if (reports) {
        reports.innerHTML = (data.reports || []).length
          ? data.reports.map((r) => `
            <div class="report-row">
              <div><b>${escapeHtml(r.username)}</b> <span class="muted">in ${escapeHtml(r.room)}</span>
                <p>${escapeHtml(r.text || '[image]')}</p>
                <i class="muted">reported by ${escapeHtml(r.reporter_name)} — ${escapeHtml(r.reason)}</i></div>
              <button class="btn btn-danger small" data-del-msg="${r.message_id}">DELETE</button>
            </div>`).join('')
          : '<p class="muted">No open reports.</p>';
        reports.querySelectorAll('[data-del-msg]').forEach((btn) => btn.addEventListener('click', async () => {
          try {
            await api(`/owner/messages/${btn.dataset.delMsg}/delete`, { method: 'POST' });
            toast('Message deleted.', 'ok');
            loadOwnerOverview();
            loadOwnerMessages();
          } catch (err) { toast(err.message, 'error'); }
        }));
      }
      const online = $('ownerOnline');
      if (online) {
        online.innerHTML = (data.online || []).length
          ? data.online.map((p) => `<div class="online-row"><span class="live-dot"></span>${escapeHtml(p.username)}<b>LV ${p.level}</b></div>`).join('')
          : '<p class="muted">Nobody online.</p>';
      }
      const rooms = $('ownerRooms');
      if (rooms) {
        rooms.innerHTML = (data.rooms || []).length
          ? data.rooms.map((r) => `<div class="room-row"><b>${escapeHtml(r.mode || r.id)}</b><span>${r.players || 0} players</span></div>`).join('')
          : '<p class="muted">No active rooms.</p>';
      }
      const select = $('grantSkin');
      if (select && (data.skins || []).length) {
        select.innerHTML = '<option value="">— none —</option>'
          + data.skins.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.rarity)})</option>`).join('');
      }
      loadOwnerMessages();
      loadOwnerPlayers('');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function loadOwnerMessages() {
    const host = $('ownerMessages');
    if (!host) return;
    try {
      const data = await api('/owner/messages?room=global');
      host.innerHTML = (data.messages || []).length
        ? data.messages.slice(-40).reverse().map((m) => `
          <div class="mod-row ${m.deleted ? 'deleted' : ''}">
            <div><b>${escapeHtml(m.username)}</b> <i class="muted">${new Date(m.createdAt).toLocaleString('en-US')}</i>
              <p>${escapeHtml(m.text || '')}${m.imageUrl ? ' <span class="muted">[image]</span>' : ''}</p></div>
            ${m.deleted ? '<span class="muted">removed</span>' : `<button class="btn btn-danger small" data-mod-del="${m.id}">DELETE</button>`}
          </div>`).join('')
        : '<p class="muted">No messages.</p>';
      host.querySelectorAll('[data-mod-del]').forEach((btn) => btn.addEventListener('click', async () => {
        try {
          await api(`/owner/messages/${btn.dataset.modDel}/delete`, { method: 'POST' });
          toast('Message removed.', 'ok');
          loadOwnerMessages();
        } catch (err) { toast(err.message, 'error'); }
      }));
    } catch (err) { host.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`; }
  }

  async function loadOwnerPlayers(query) {
    const tbody = $('ownerPlayers');
    if (!tbody) return;
    try {
      const data = await api(`/owner/players${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      tbody.innerHTML = (data.players || []).map((p) => `
        <tr>
          <td>${escapeHtml(p.username)}</td>
          <td>${escapeHtml(p.role || 'PLAYER')}</td>
          <td>${p.level}</td>
          <td>${fmt(p.exp)}</td>
          <td>${fmt(p.coins)}</td>
          <td>${fmt(p.flags)}</td>
          <td>${p.wins}/${p.losses}</td>
          <td>${p.isBanned ? `<span class="bad">banned</span>` : '<span class="ok">active</span>'}</td>
          <td><button class="btn btn-ghost small" data-fill="${escapeHtml(p.username)}">FILL</button></td>
        </tr>`).join('') || '<tr><td colspan="9" class="muted">No players found.</td></tr>';
      tbody.querySelectorAll('[data-fill]').forEach((btn) => btn.addEventListener('click', () => {
        const name = btn.dataset.fill;
        if ($('grantUser')) $('grantUser').value = name;
        if ($('banUser')) $('banUser').value = name;
        if ($('unbanUser')) $('unbanUser').value = name;
        toast(`${name} selected in the forms.`, 'info');
      }));
    } catch (err) { tbody.innerHTML = `<tr><td colspan="9" class="muted">${escapeHtml(err.message)}</td></tr>`; }
  }

  function bindOwner() {
    document.querySelectorAll('[data-owner-tab]').forEach((tab) => tab.addEventListener('click', () => {
      document.querySelectorAll('[data-owner-tab]').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('[data-owner-pane]').forEach((pane) => {
        pane.classList.toggle('active', pane.dataset.ownerPane === tab.dataset.ownerTab);
      });
    }));

    const grant = $('grantForm');
    if (grant) grant.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = await api('/owner/grant', {
          method: 'POST',
          body: {
            username: $('grantUser').value.trim(),
            coins: Number($('grantCoins').value) || 0,
            exp: Number($('grantExp').value) || 0,
            levels: Number($('grantLevels').value) || 0,
            skinId: $('grantSkin').value || null,
            godmax: $('grantGodmax').checked,
          },
        });
        toast(data.message || 'Grant applied.', 'ok');
        grant.reset();
        loadOwnerPlayers('');
      } catch (err) { toast(err.message, 'error'); }
    });

    const ban = $('banForm');
    if (ban) ban.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = await api('/owner/ban', {
          method: 'POST',
          body: {
            username: $('banUser').value.trim(),
            hours: Number($('banHours').value) || 24,
            reason: $('banReason').value || 'Violation of arena rules',
          },
        });
        toast(data.message || 'Player banned.', 'ok');
        loadOwnerPlayers('');
      } catch (err) { toast(err.message, 'error'); }
    });

    const unban = $('unbanForm');
    if (unban) unban.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = await api('/owner/unban', { method: 'POST', body: { username: $('unbanUser').value.trim() } });
        toast(data.message || 'Player unbanned.', 'ok');
        loadOwnerPlayers('');
      } catch (err) { toast(err.message, 'error'); }
    });

    const search = $('playerSearch');
    if (search) search.addEventListener('submit', (e) => {
      e.preventDefault();
      loadOwnerPlayers($('playerQuery').value.trim());
    });

    const pass = $('ownerPassForm');
    if (pass) pass.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = await api('/owner/password', {
          method: 'POST',
          body: { currentPassword: $('ownerCurrentPass').value, newPassword: $('ownerNewPass').value },
        });
        toast(data.message || 'Password updated.', 'ok');
        pass.reset();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ------------------------------------------------------------------ */
  /* arena                                                               */
  /* ------------------------------------------------------------------ */

  function ensureScene() {
    if (App.scene) return App.scene;
    if (typeof window.ArenaScene !== 'function') {
      toast('Arena engine failed to load.', 'error');
      return null;
    }
    if (!App.socket) { toast('Not connected to the server.', 'error'); return null; }
    App.scene = new window.ArenaScene(App.socket, {
      username: App.user ? App.user.username : '',
      skins: App.skinMap,
      onWallet: (user) => applyWallet(user),
      onFeed: () => {},
      onToast: (msg, kind) => toast(msg, kind === 'error' ? 'error' : 'info'),
      onDuelQueue: onDuelQueue,
      onFinished: (payload) => {
        if (payload && payload.user) applyWallet(payload.user);
        api('/me').then((d) => { if (d.user) applyUser(d.user); }).catch(() => {});
      },
      onBanned: () => { leaveArena(true); },
      onExit: (silent) => {
        if (!silent) toLobby();
      },
      onExitRequest: () => requestArenaExit(),
    });
    return App.scene;
  }

  function onDuelQueue(payload) {
    if (!payload) return;
    if (payload.status === 'waiting') {
      App.duelStatus = 'waiting';
      setDuelStatus(`Waiting for an opponent… (${payload.queueSize || 1} in queue)`);
    } else if (payload.status === 'matched') {
      App.duelStatus = 'matched';
      setDuelStatus('Match found! Entering the arena…');
      toast('Match found — duel starting.', 'ok');
      showScreen('arena', { push: false });
      startArena('duel');
    } else if (payload.status === 'idle') {
      App.duelStatus = 'idle';
      setDuelStatus('Not in queue.');
    }
  }

  function startArena(mode, bossId) {
    const scene = ensureScene();
    if (!scene) return;
    const canvas = $('gameCanvas');
    const modal = $('resultModal');
    if (modal) modal.classList.add('hidden');
    showScreen('arena', { push: false });
    if (canvas) canvas.focus();
    scene.start(mode, bossId || null);
    const label = $('arenaModeLabel');
    if (label) label.textContent = MODE_LABEL[mode] || String(mode).toUpperCase();
    toast(`${MODE_LABEL[mode] || mode} — good luck, legend.`, 'info');
  }

  function requestArenaExit() {
    openModal('LEAVE ARENA?', `
      <p class="muted">Coins and EXP collected this run are saved by the server before you leave.</p>
      <div class="modal-actions">
        <button class="btn btn-danger" id="confirmLeave">LEAVE</button>
        <button class="btn btn-ghost" id="stayArena">STAY</button>
      </div>`);
    const confirm = $('confirmLeave');
    if (confirm) confirm.addEventListener('click', () => { closeModal(); leaveArena(); });
    const stay = $('stayArena');
    if (stay) stay.addEventListener('click', closeModal);
  }

  function leaveArena(silent) {
    if (App.socket) App.socket.emit('arena:leave');
    if (App.scene) App.scene.stop(true);
    const modal = $('resultModal');
    if (modal) modal.classList.add('hidden');
    if (!silent) toLobby();
    loadLobbyData();
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */

  async function boot() {
    renderLogo();
    bindAuth();
    bindModes();
    bindProfile();
    bindOwner();

    const modalClose = $('modalClose');
    if (modalClose) modalClose.addEventListener('click', closeModal);
    const generic = $('genericModal');
    if (generic) generic.addEventListener('click', (e) => { if (e.target === generic) closeModal(); });

    document.querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', () => {
      showScreen(el.dataset.nav, { push: true });
    }));

    try {
      const data = await api('/me');
      if (data && data.user) {
        applyUser(data.user);
        connectSocket();
        toLobby();
        loadLobbyData();
        if (data.user.isOwner) {
          const ownerLink = $('ownerLink');
          if (ownerLink) ownerLink.hidden = false;
        }
      } else {
        showScreen('intro', { push: false });
      }
    } catch (err) {
      showScreen('intro', { push: false });
    }

    // Keep the appbar in sync when the tab regains focus.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && App.user) {
        api('/me').then((d) => { if (d && d.user) applyUser(d.user); }).catch(() => {});
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.BallArenaApp = App;
})();
