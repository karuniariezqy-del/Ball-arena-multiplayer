'use strict';

const crypto = require('crypto');
const { getSkin, DEFAULT_SKIN_ID, GODMAX_SKIN_ID } = require('./skins');
const { getBoss } = require('./bosses');
const { applyRewards, publicUser, stmts, db } = require('./db');
const { levelFromExp } = require('./progression');

const TICK_MS = 33;
const SNAPSHOT_MS = 66;
const MAX_PLAYERS_MULTI = 12;
const WORLD = {
  multi: { w: 2800, h: 2000 },
  solo: { w: 2000, h: 1500 },
  boss: { w: 1800, h: 1400 },
  duel: { w: 1600, h: 1200 },
};

const ENEMY_TYPES = {
  grunt: { hp: 62, speed: 105, r: 22, damage: 9, coins: 5, exp: 14, color: '#fb7185', glow: '#f43f5e' },
  rusher: { hp: 44, speed: 205, r: 17, damage: 13, coins: 6, exp: 16, color: '#fbbf24', glow: '#f59e0b' },
  tank: { hp: 210, speed: 68, r: 35, damage: 20, coins: 12, exp: 34, color: '#a78bfa', glow: '#8b5cf6' },
  shooter: { hp: 88, speed: 88, r: 24, damage: 11, coins: 9, exp: 26, color: '#22d3ee', glow: '#06b6d4' },
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rand = (min, max) => min + Math.random() * (max - min);
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

let entitySeq = 1;
const nextId = () => `e${entitySeq++}`;

function makeSkinState(skinId) {
  const skin = getSkin(skinId) || getSkin(DEFAULT_SKIN_ID);
  return { id: skin.id, primary: skin.primary, secondary: skin.secondary, accent: skin.accent, pattern: skin.pattern, rarity: skin.rarity };
}

class Room {
  constructor(mode, opts = {}) {
    this.id = opts.id || `${mode}:${crypto.randomBytes(4).toString('hex')}`;
    this.mode = mode;
    this.world = { ...(WORLD[mode] || WORLD.multi) };
    this.players = new Map();
    this.enemies = [];
    this.projectiles = [];
    this.orbs = [];
    this.boss = null;
    this.bossDef = opts.bossId ? getBoss(opts.bossId) : null;
    this.createdAt = Date.now();
    this.lastSnapshot = 0;
    this.spawnTimer = 0;
    this.flushTimer = 20;
    this.status = 'active';
    this.settled = false;
    this.duel = null;
    this.bossRewardApplied = false;
    this.events = [];
  }

  avgLevel() {
    const list = [...this.players.values()];
    if (!list.length) return 1;
    return list.reduce((sum, p) => sum + p.level, 0) / list.length;
  }

  pushEvent(type, data = {}) {
    this.events.push({ type, ...data, at: Date.now() });
    if (this.events.length > 120) this.events.splice(0, this.events.length - 120);
  }

  addPlayer(socket, user) {
    if (this.players.size >= (this.mode === 'multi' ? MAX_PLAYERS_MULTI : this.mode === 'duel' ? 2 : 4)) {
      return { error: 'Room is full' };
    }
    const skinId = user.equippedSkin || DEFAULT_SKIN_ID;
    const maxHp = 100 + (user.level - 1) * 14;
    const spawn = this.findSpawn();
    const player = {
      key: socket.id,
      socket,
      userId: user.id,
      username: user.username,
      role: user.role,
      avatar: user.avatar,
      skinId,
      skin: makeSkinState(skinId),
      level: user.level,
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      r: 27,
      speed: 268,
      hp: maxHp,
      maxHp,
      alive: true,
      respawnAt: 0,
      invulnUntil: Date.now() + 1800,
      input: { x: 0, y: 0 },
      fireCd: 0,
      dashCd: 0,
      dashUntil: 0,
      slowUntil: 0,
      kills: 0,
      deaths: 0,
      killsSinceFlag: 0,
      coinsRun: 0,
      expRun: 0,
      flagsRun: 0,
      damageDealt: 0,
      joinedAt: Date.now(),
      lastInputAt: Date.now(),
      lastRewardAt: Date.now(),
      touchCd: 0,
    };
    this.players.set(socket.id, player);
    if (this.mode === 'boss' && this.bossDef && !this.boss) this.spawnBoss(this.bossDef);
    if (this.mode === 'solo') this.spawnInitialEnemies();
    return { player };
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return null;
    this.commitRun(player, 'leave');
    this.players.delete(socketId);
    return player;
  }

  findSpawn() {
    for (let i = 0; i < 24; i += 1) {
      const p = { x: rand(140, this.world.w - 140), y: rand(140, this.world.h - 140) };
      let ok = true;
      for (const other of this.players.values()) {
        if (dist2(p, other) < 280 ** 2) { ok = false; break; }
      }
      if (ok) return p;
    }
    return { x: this.world.w / 2, y: this.world.h / 2 };
  }

  spawnInitialEnemies() {
    const count = this.mode === 'solo' ? 7 : 5 + this.players.size * 2;
    for (let i = 0; i < count; i += 1) this.spawnEnemy();
  }

  spawnEnemy(typeOverride) {
    if (this.enemies.length >= 16 + this.players.size * 3) return null;
    const levelScale = 1 + (this.avgLevel() - 1) * 0.11;
    const types = Object.keys(ENEMY_TYPES);
    let type = typeOverride;
    if (!type) {
      const roll = Math.random();
      type = roll < 0.5 ? 'grunt' : roll < 0.72 ? 'rusher' : roll < 0.88 ? 'shooter' : 'tank';
      if (this.avgLevel() < 3 && type === 'tank') type = 'grunt';
    }
    const base = ENEMY_TYPES[type] || ENEMY_TYPES.grunt;
    let x;
    let y;
    let guard = 0;
    do {
      x = rand(80, this.world.w - 80);
      y = rand(80, this.world.h - 80);
      guard += 1;
    } while (guard < 20 && [...this.players.values()].some((p) => p.alive && dist2({ x, y }, p) < 460 ** 2));
    const enemy = {
      id: nextId(),
      type,
      x,
      y,
      vx: 0,
      vy: 0,
      r: base.r,
      hp: Math.round(base.hp * levelScale),
      maxHp: Math.round(base.hp * levelScale),
      speed: base.speed * (1 + (this.avgLevel() - 1) * 0.015),
      damage: Math.round(base.damage * (1 + (this.avgLevel() - 1) * 0.07)),
      coins: base.coins,
      exp: base.exp,
      color: base.color,
      glow: base.glow,
      shootCd: rand(1.2, 2.4),
      touchCd: 0,
      lastHitBy: null,
      wanderAngle: rand(0, Math.PI * 2),
    };
    this.enemies.push(enemy);
    return enemy;
  }

  spawnBoss(def) {
    const avg = this.avgLevel();
    const scaleHp = 1 + Math.max(0, avg - def.reqLevel) * 0.075;
    const scaleDmg = 1 + Math.max(0, avg - def.reqLevel) * 0.05;
    this.boss = {
      id: nextId(),
      bossId: def.id,
      name: def.name,
      title: def.title,
      x: this.world.w / 2,
      y: this.world.h * 0.32,
      vx: 0,
      vy: 0,
      r: 66,
      hp: Math.round(def.hp * scaleHp),
      maxHp: Math.round(def.hp * scaleHp),
      touchDamage: Math.round(def.touchDamage * scaleDmg),
      color: def.color,
      secondary: def.secondary,
      accent: def.accent,
      attacks: def.attacks,
      attackCd: 2.2,
      state: 'idle',
      stateUntil: 0,
      currentAttack: null,
      chargeVx: 0,
      chargeVy: 0,
      touchCd: 0,
      spawnedAt: Date.now(),
      enraged: false,
    };
    this.pushEvent('boss_spawn', { name: def.name, title: def.title, hp: this.boss.maxHp });
  }

  applyPlayerDamage(player, amount, source) {
    if (!player.alive) return;
    if (player.invulnUntil > Date.now()) return;
    player.hp -= amount;
    player.lastHitAt = Date.now();
    if (player.hp <= 0) {
      player.hp = 0;
      player.alive = false;
      player.deaths += 1;
      player.respawnAt = Date.now() + (this.mode === 'duel' ? 3000 : 4000);
      player.vx = 0;
      player.vy = 0;
      this.pushEvent('player_down', { username: player.username, by: source || 'enemy' });
      if (this.mode === 'duel' && source && source.userId && source.userId !== player.userId) {
        source.kills += 1;
        this.checkDuelEnd();
      }
    }
  }

  damageEnemy(enemy, amount, player) {
    enemy.hp -= amount;
    enemy.lastHitBy = player.userId;
    if (player) player.damageDealt += amount;
    if (enemy.hp <= 0) this.killEnemy(enemy, player);
  }

  killEnemy(enemy, player) {
    const idx = this.enemies.indexOf(enemy);
    if (idx < 0) return;
    this.enemies.splice(idx, 1);
    this.pushEvent('enemy_down', { x: enemy.x, y: enemy.y, color: enemy.color, type: enemy.type });
    if (player) {
      player.expRun += enemy.exp;
      player.kills += 1;
      player.killsSinceFlag += 1;
      const orbs = enemy.type === 'tank' ? 3 : 2;
      for (let i = 0; i < orbs; i += 1) {
        this.orbs.push({
          id: nextId(),
          x: enemy.x + rand(-18, 18),
          y: enemy.y + rand(-18, 18),
          kind: 'coin',
          value: Math.max(1, Math.round(enemy.coins / orbs)),
          vx: rand(-60, 60),
          vy: rand(-60, 60),
          r: 9,
        });
      }
      if (player.killsSinceFlag >= 10) {
        player.killsSinceFlag = 0;
        this.orbs.push({ id: nextId(), x: enemy.x, y: enemy.y, kind: 'flag', value: 1, vx: 0, vy: 0, r: 13 });
      } else if (Math.random() < 0.07) {
        this.orbs.push({ id: nextId(), x: enemy.x, y: enemy.y, kind: 'heal', value: 22, vx: 0, vy: 0, r: 11 });
      }
    }
  }

  damageBoss(boss, amount, player) {
    if (!boss || boss.hp <= 0) return;
    boss.hp -= amount;
    player.damageDealt += amount;
    if (boss.hp <= 0) {
      boss.hp = 0;
      this.onBossDefeated(boss, player);
    }
  }

  onBossDefeated(boss, player) {
    if (this.bossRewardApplied) return;
    this.bossRewardApplied = true;
    const def = getBoss(boss.bossId);
    if (!def) return;
    const levelBonus = 1 + Math.max(0, player.level - def.reqLevel) * 0.03;
    const coins = Math.round(def.rewardCoins * levelBonus);
    const exp = Math.round(def.rewardExp * levelBonus);
    let updated = null;
    try {
      updated = applyRewards(player.userId, {
        coins: coins + player.coinsRun,
        exp: exp + player.expRun,
        flags: def.rewardFlags + player.flagsRun,
        kind: 'boss_kill',
        meta: { bossId: def.id, roomId: this.id },
      });
      db.prepare('INSERT INTO boss_kills (user_id, boss_id, level_at_kill, created_at) VALUES (?, ?, ?, ?)')
        .run(player.userId, def.id, player.level, Date.now());
      if (def.rewardSkin) stmts.grantSkin.run(player.userId, def.rewardSkin, 'boss', Date.now());
    } catch (err) {
      console.error('Boss reward failed', err.message);
    }
    player.coinsRun = 0;
    player.expRun = 0;
    player.flagsRun = 0;
    player.lastRewardAt = Date.now();
    this.pushEvent('boss_down', { name: def.name, x: boss.x, y: boss.y, color: boss.color });
    this.status = 'finished';
    this.settled = true;
    this.finishPayload = {
      reason: 'boss_win',
      boss: { id: def.id, name: def.name },
      rewards: { coins, exp, flags: def.rewardFlags, skinId: def.rewardSkin || null },
      user: updated ? publicUser(updated) : null,
      stats: { kills: player.kills, damage: Math.round(player.damageDealt), deaths: player.deaths },
    };
  }

  commitRun(player, reason) {
    const coins = Math.floor(player.coinsRun);
    const exp = Math.floor(player.expRun);
    const flags = Math.floor(player.flagsRun);
    if (coins || exp || flags) {
      try {
        const updated = applyRewards(player.userId, { coins, exp, flags, kind: `run_${reason}` });
        player.coinsRun = 0;
        player.expRun = 0;
        player.flagsRun = 0;
        player.lastRewardAt = Date.now();
        return publicUser(updated);
      } catch (err) {
        console.error('commitRun failed', err.message);
      }
    }
    return null;
  }

  checkDuelEnd() {
    if (this.mode !== 'duel' || !this.duel || this.settled) return;
    const players = [...this.players.values()];
    if (players.length < 2) return;
    const target = 3;
    const winner = players.find((p) => p.kills >= target);
    if (winner) this.finishDuel(winner);
  }

  finishDuel(winner) {
    if (this.settled) return;
    this.settled = true;
    this.status = 'finished';
    const results = [];
    for (const p of this.players.values()) {
      const win = winner && p.userId === winner.userId;
      const baseCoins = win ? 140 : 45;
      const baseExp = win ? 220 : 65;
      let updated = null;
      try {
        updated = applyRewards(p.userId, {
          coins: baseCoins + p.coinsRun,
          exp: baseExp + p.expRun,
          flags: p.flagsRun,
          wins: win ? 1 : 0,
          losses: win ? 0 : 1,
          kind: 'duel_result',
          meta: { roomId: this.id, win },
        });
      } catch (err) {
        console.error('duel reward failed', err.message);
      }
      results.push({
        userId: p.userId,
        username: p.username,
        kills: p.kills,
        deaths: p.deaths,
        win,
        rewards: { coins: baseCoins, exp: baseExp },
        user: updated ? publicUser(updated) : null,
      });
    }
    this.finishPayload = { reason: 'duel_end', results, winner: winner ? winner.username : null };
    this.pushEvent('duel_end', { winner: winner ? winner.username : null });
    this.duelEndsAt = Date.now() + 9000;
  }

  canSpawnBoss() {
    return this.mode === 'boss' && this.bossDef && !this.boss;
  }

  update(dt) {
    const now = Date.now();
    if (this.status === 'finished' && this.mode === 'duel') {
      if (this.duelEndsAt && now > this.duelEndsAt) this.status = 'closing';
      return;
    }

    // ----- Players -----
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (now >= p.respawnAt) {
          const spawn = this.findSpawn();
          p.x = spawn.x;
          p.y = spawn.y;
          p.hp = p.maxHp;
          p.alive = true;
          p.invulnUntil = now + 2000;
          p.fireCd = 0;
          p.vx = 0;
          p.vy = 0;
          this.pushEvent('respawn', { username: p.username });
        }
        continue;
      }
      const slow = p.slowUntil > now ? 0.45 : 1;
      let ix = clamp(p.input.x || 0, -1, 1);
      let iy = clamp(p.input.y || 0, -1, 1);
      const mag = Math.hypot(ix, iy);
      if (mag > 1) { ix /= mag; iy /= mag; }
      if (now < p.dashUntil) {
        p.vx = p.dashVx || p.vx;
        p.vy = p.dashVy || p.vy;
      } else {
        const targetVx = ix * p.speed * slow;
        const targetVy = iy * p.speed * slow;
        const blend = Math.min(1, dt * 14);
        p.vx += (targetVx - p.vx) * blend;
        p.vy += (targetVy - p.vy) * blend;
      }
      p.x = clamp(p.x + p.vx * dt, p.r, this.world.w - p.r);
      p.y = clamp(p.y + p.vy * dt, p.r, this.world.h - p.r);

      // Auto attack
      if (p.fireCd > 0) p.fireCd -= dt;
      const target = this.findTargetFor(p);
      if (target && p.fireCd <= 0) {
        p.fireCd = 0.4;
        const angle = Math.atan2(target.y - p.y, target.x - p.x);
        const spread = (Math.random() - 0.5) * 0.05;
        const dmg = 10 + p.level * 1.7;
        this.projectiles.push({
          id: nextId(),
          ownerKey: p.key,
          ownerId: p.userId,
          team: 'player',
          x: p.x + Math.cos(angle) * (p.r + 6),
          y: p.y + Math.sin(angle) * (p.r + 6),
          vx: Math.cos(angle + spread) * 660,
          vy: Math.sin(angle + spread) * 660,
          r: 7,
          damage: dmg,
          color: p.skin.accent,
          life: 1.5,
        });
        this.pushEvent('shot', { x: p.x, y: p.y, color: p.skin.accent });
      }
    }

    // Player separation (all modes) + duel dash damage
    const list = [...this.players.values()];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (!a.alive || !b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = a.r + b.r;
        if (d < min) {
          const push = (min - d) / 2;
          const nx = dx / d;
          const ny = dy / d;
          a.x = clamp(a.x - nx * push, a.r, this.world.w - a.r);
          a.y = clamp(a.y - ny * push, a.r, this.world.h - a.r);
          b.x = clamp(b.x + nx * push, b.r, this.world.w - b.r);
          b.y = clamp(b.y + ny * push, b.r, this.world.h - b.r);
          if (this.mode === 'duel') {
            if (now < a.dashUntil && now > (a.lastDashHit || 0)) {
              a.lastDashHit = now + 600;
              this.applyPlayerDamage(b, 16, a);
            }
            if (now < b.dashUntil && now > (b.lastDashHit || 0)) {
              b.lastDashHit = now + 600;
              this.applyPlayerDamage(a, 16, b);
            }
          }
        }
      }
    }

    // ----- Enemies -----
    const alivePlayers = list.filter((p) => p.alive);
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const e = this.enemies[i];
      if (e.touchCd > 0) e.touchCd -= dt;
      let nearest = null;
      let nearestD = Infinity;
      for (const p of alivePlayers) {
        const d = dist2(e, p);
        if (d < nearestD) { nearestD = d; nearest = p; }
      }
      if (nearest) {
        const dx = nearest.x - e.x;
        const dy = nearest.y - e.y;
        const dist = Math.sqrt(nearestD) || 1;
        let dirX = dx / dist;
        let dirY = dy / dist;
        if (e.type === 'shooter') {
          if (dist < 260) { dirX = -dirX; dirY = -dirY; }
          else if (dist < 380) { dirX = -dirY; dirY = dirX; }
          e.shootCd -= dt;
          if (e.shootCd <= 0 && dist < 760) {
            e.shootCd = 2.1;
            const angle = Math.atan2(dy, dx);
            this.projectiles.push({
              id: nextId(), team: 'enemy', x: e.x, y: e.y,
              vx: Math.cos(angle) * 300, vy: Math.sin(angle) * 300,
              r: 8, damage: e.damage, color: '#22d3ee', life: 2.6,
            });
          }
        }
        // gentle separation
        for (const other of this.enemies) {
          if (other === e) continue;
          const ox = e.x - other.x;
          const oy = e.y - other.y;
          const od = Math.hypot(ox, oy) || 1;
          if (od < e.r + other.r) {
            dirX += (ox / od) * 0.9;
            dirY += (oy / od) * 0.9;
          }
        }
        const dl = Math.hypot(dirX, dirY) || 1;
        e.x += (dirX / dl) * e.speed * dt;
        e.y += (dirY / dl) * e.speed * dt;
        // contact damage
        if (nearestD < (e.r + nearest.r) ** 2 && e.touchCd <= 0) {
          e.touchCd = 0.85;
          this.applyPlayerDamage(nearest, e.damage, e);
        }
      } else {
        e.wanderAngle += rand(-0.5, 0.5) * dt;
        e.x += Math.cos(e.wanderAngle) * e.speed * 0.4 * dt;
        e.y += Math.sin(e.wanderAngle) * e.speed * 0.4 * dt;
      }
      e.x = clamp(e.x, e.r, this.world.w - e.r);
      e.y = clamp(e.y, e.r, this.world.h - e.r);
    }

    // ----- Boss -----
    if (this.boss && this.boss.hp > 0) {
      this.updateBoss(dt, alivePlayers, now);
    }

    // ----- Projectiles -----
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      if (pr.life <= 0 || pr.x < -40 || pr.y < -40 || pr.x > this.world.w + 40 || pr.y > this.world.h + 40) {
        this.projectiles.splice(i, 1);
        continue;
      }
      let hit = false;
      if (pr.team === 'player') {
        if (this.boss && this.boss.hp > 0) {
          const bd = dist2(pr, this.boss);
          if (bd < (this.boss.r + pr.r) ** 2) {
            const owner = this.players.get(pr.ownerKey);
            if (owner) this.damageBoss(this.boss, pr.damage, owner);
            hit = true;
          }
        }
        if (!hit) {
          for (const e of this.enemies) {
            if (dist2(pr, e) < (e.r + pr.r) ** 2) {
              const owner = this.players.get(pr.ownerKey);
              this.damageEnemy(e, pr.damage, owner);
              hit = true;
              break;
            }
          }
        }
        if (!hit && this.mode === 'duel') {
          for (const p of this.players.values()) {
            if (p.alive && p.key !== pr.ownerKey && dist2(pr, p) < (p.r + pr.r) ** 2) {
              const owner = this.players.get(pr.ownerKey);
              this.applyPlayerDamage(p, pr.damage, owner);
              hit = true;
              break;
            }
          }
        }
      } else {
        // enemy / boss projectile hits players
        for (const p of this.players.values()) {
          if (p.alive && dist2(pr, p) < (p.r + pr.r) ** 2) {
            this.applyPlayerDamage(p, pr.damage, null);
            hit = true;
            break;
          }
        }
      }
      if (hit) this.projectiles.splice(i, 1);
    }

    // ----- Orbs -----
    for (let i = this.orbs.length - 1; i >= 0; i -= 1) {
      const orb = this.orbs[i];
      orb.life = (orb.life || 30) - dt;
      let nearest = null;
      let nd = 190 ** 2;
      for (const p of alivePlayers) {
        const d = dist2(orb, p);
        if (d < nd) { nd = d; nearest = p; }
      }
      if (nearest) {
        const dx = nearest.x - orb.x;
        const dy = nearest.y - orb.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        orb.x += (dx / d) * 340 * dt;
        orb.y += (dy / d) * 340 * dt;
        if (d < nearest.r + orb.r + 6) {
          if (orb.kind === 'coin') {
            nearest.coinsRun += orb.value;
            nearest.expRun += 1;
          } else if (orb.kind === 'flag') {
            nearest.flagsRun += orb.value;
            this.pushEvent('flag', { username: nearest.username, x: orb.x, y: orb.y });
          } else if (orb.kind === 'heal') {
            nearest.hp = Math.min(nearest.maxHp, nearest.hp + orb.value);
          }
          this.orbs.splice(i, 1);
          continue;
        }
      }
      if (orb.life <= 0) this.orbs.splice(i, 1);
    }

    // ----- Spawning -----
    if (this.mode === 'solo' || this.mode === 'multi') {
      this.spawnTimer -= dt;
      const cap = this.mode === 'solo' ? 14 : 12 + this.players.size * 2;
      if (this.spawnTimer <= 0 && this.enemies.length < cap && alivePlayers.length > 0) {
        this.spawnTimer = Math.max(0.9, 2.1 - this.avgLevel() * 0.03);
        this.spawnEnemy();
      }
    }

    // ----- Periodic wallet flush -----
    this.flushTimer -= dt;
    if (this.flushTimer <= 0) {
      this.flushTimer = 20;
      for (const p of this.players.values()) {
        if (p.coinsRun + p.expRun + p.flagsRun > 0) this.commitRun(p, 'checkpoint');
      }
    }

    // ----- Duel timer / room close -----
    if (this.mode === 'duel' && !this.settled) {
      if (!this.duel) this.duel = { startedAt: Date.now(), duration: 120000, target: 3 };
      if (now - this.duel.startedAt > this.duel.duration) {
        const players = [...this.players.values()];
        const best = players.sort((a, b) => b.kills - a.kills || b.hp - a.hp)[0];
        this.finishDuel(best || null);
      }
    }
    if (this.status === 'closing') this.players.clear();
  }

  findTargetFor(player) {
    if (!player.alive) return null;
    let best = null;
    let bd = 760 ** 2;
    if (this.boss && this.boss.hp > 0) {
      const d = dist2(player, this.boss);
      if (d < bd) { bd = d; best = this.boss; }
    }
    for (const e of this.enemies) {
      const d = dist2(player, e);
      if (d < bd) { bd = d; best = e; }
    }
    if (this.mode === 'duel') {
      for (const p of this.players.values()) {
        if (p.key !== player.key && p.alive) {
          const d = dist2(player, p);
          if (d < bd) { bd = d; best = p; }
        }
      }
    }
    return best;
  }

  updateBoss(dt, alivePlayers, now) {
    const boss = this.boss;
    boss.enraged = boss.hp / boss.maxHp < 0.4;
    if (boss.touchCd > 0) boss.touchCd -= dt;
    let target = null;
    let td = Infinity;
    for (const p of alivePlayers) {
      const d = dist2(boss, p);
      if (d < td) { td = d; target = p; }
    }
    if (!target) return;

    if (boss.state === 'idle') {
      boss.attackCd -= dt * (boss.enraged ? 1.45 : 1);
      const dx = target.x - boss.x;
      const dy = target.y - boss.y;
      const d = Math.hypot(dx, dy) || 1;
      boss.x += (dx / d) * 82 * dt;
      boss.y += (dy / d) * 82 * dt;
      if (boss.attackCd <= 0) {
        const options = boss.attacks;
        const pick = options[Math.floor(Math.random() * options.length)];
        boss.state = 'telegraph';
        boss.currentAttack = pick;
        boss.stateUntil = now + 720;
        boss.telegraphX = target.x;
        boss.telegraphY = target.y;
        this.pushEvent('boss_telegraph', { attack: pick, name: boss.name });
      }
    } else if (boss.state === 'telegraph') {
      if (now >= boss.stateUntil) {
        this.executeBossAttack(boss, target, now);
        boss.state = 'active';
        boss.stateUntil = now + (boss.currentAttack === 'charge' ? 520 : 360);
      }
    } else if (boss.state === 'active') {
      if (boss.currentAttack === 'charge') {
        boss.x += boss.chargeVx * dt;
        boss.y += boss.chargeVy * dt;
      }
      if (now >= boss.stateUntil) {
        boss.state = 'idle';
        boss.currentAttack = null;
        boss.attackCd = boss.enraged ? 1.35 : 2.1;
      }
    }
    boss.x = clamp(boss.x, boss.r, this.world.w - boss.r);
    boss.y = clamp(boss.y, boss.r, this.world.h - boss.r);

    if (td < (boss.r + target.r) ** 2 && boss.touchCd <= 0) {
      boss.touchCd = 0.9;
      this.applyPlayerDamage(target, boss.touchDamage, { userId: null, username: boss.name });
    }
  }

  executeBossAttack(boss, target, now) {
    const attack = boss.currentAttack;
    if (attack === 'charge') {
      const angle = Math.atan2(target.y - boss.y, target.x - boss.x);
      boss.chargeVx = Math.cos(angle) * 620;
      boss.chargeVy = Math.sin(angle) * 620;
      this.pushEvent('boss_charge', { name: boss.name });
    } else if (attack === 'ring') {
      const count = boss.enraged ? 22 : 16;
      for (let i = 0; i < count; i += 1) {
        const a = (Math.PI * 2 * i) / count;
        this.projectiles.push({
          id: nextId(), team: 'enemy', x: boss.x, y: boss.y,
          vx: Math.cos(a) * 265, vy: Math.sin(a) * 265, r: 9,
          damage: Math.round(boss.touchDamage * 0.7), color: boss.accent, life: 3.2,
        });
      }
      this.pushEvent('boss_ring', { x: boss.x, y: boss.y, color: boss.accent });
    } else if (attack === 'shard') {
      const base = Math.atan2(target.y - boss.y, target.x - boss.x);
      for (let i = -2; i <= 2; i += 1) {
        const a = base + i * 0.13;
        this.projectiles.push({
          id: nextId(), team: 'enemy', x: boss.x, y: boss.y,
          vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, r: 8,
          damage: Math.round(boss.touchDamage * 0.6), color: boss.accent, life: 2.4,
        });
      }
    } else if (attack === 'summon') {
      if (this.enemies.length < 10) {
        for (let i = 0; i < 3; i += 1) {
          const e = this.spawnEnemy(i === 2 ? 'rusher' : 'grunt');
          if (e) { e.x = boss.x + rand(-90, 90); e.y = boss.y + rand(-90, 90); }
        }
      }
    } else if (attack === 'timewarp') {
      for (const p of this.players.values()) p.slowUntil = now + 2400;
      for (let i = 0; i < 12; i += 1) {
        const a = (Math.PI * 2 * i) / 12;
        this.projectiles.push({
          id: nextId(), team: 'enemy', x: boss.x, y: boss.y,
          vx: Math.cos(a) * 190, vy: Math.sin(a) * 190, r: 10,
          damage: Math.round(boss.touchDamage * 0.55), color: '#a5f3fc', life: 3.6,
        });
      }
      this.pushEvent('boss_timewarp', { name: boss.name });
    }
  }

  snapshot(now) {
    const players = [...this.players.values()].map((p) => ({
      id: p.key, userId: p.userId, username: p.username, avatar: p.avatar, role: p.role,
      skin: p.skin, x: Math.round(p.x), y: Math.round(p.y), hp: Math.max(0, Math.round(p.hp)),
      maxHp: p.maxHp, alive: p.alive,
      respawnIn: p.alive ? 0 : Math.max(0, Math.ceil((p.respawnAt - now) / 1000)),
      kills: p.kills, deaths: p.deaths, level: p.level,
      dash: p.dashCd > now ? Math.ceil((p.dashCd - now) / 100) / 10 : 0,
      slow: p.slowUntil > now,
    }));
    const enemies = this.enemies.map((e) => ({
      id: e.id, x: Math.round(e.x), y: Math.round(e.y), r: e.r,
      hp: Math.max(0, Math.round(e.hp)), maxHp: e.maxHp, type: e.type, color: e.color,
    }));
    const shots = this.projectiles.map((p) => ({
      id: p.id, x: Math.round(p.x), y: Math.round(p.y), r: p.r,
      color: p.color, team: p.team,
    }));
    const orbs = this.orbs.map((o) => ({
      id: o.id, x: Math.round(o.x), y: Math.round(o.y), kind: o.kind,
    }));
    let boss = null;
    if (this.boss && this.boss.hp > 0) {
      const b = this.boss;
      boss = {
        name: b.name, title: b.title, x: Math.round(b.x), y: Math.round(b.y), r: b.r,
        hp: Math.round(b.hp), maxHp: b.maxHp, color: b.color, secondary: b.secondary,
        accent: b.accent, enraged: b.enraged, state: b.state,
        attack: b.currentAttack, telegraphX: Math.round(b.telegraphX || 0),
        telegraphY: Math.round(b.telegraphY || 0), bossId: b.bossId,
      };
    }
    return {
      t: now,
      roomId: this.id,
      mode: this.mode,
      world: this.world,
      status: this.status,
      players,
      enemies,
      shots,
      orbs,
      boss,
      duel: this.duel ? { startedAt: this.duel.startedAt, duration: this.duel.duration, target: this.duel.target } : null,
    };
  }
}

class GameServer {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.socketRooms = new Map();
    this.queue = [];
    this.online = new Map(); // userId -> { username, avatar, sockets:Set }
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  roomFor(mode, socket, user, opts = {}) {
    if (mode === 'multi') {
      let room = this.rooms.get('arena:public');
      if (!room || room.players.size >= MAX_PLAYERS_MULTI) {
        room = new Room('multi', { id: `arena:${crypto.randomBytes(3).toString('hex')}` });
        this.rooms.set(room.id, room);
      }
      return room;
    }
    if (mode === 'solo' || mode === 'boss') {
      const id = `${mode}:${user.id}`;
      let room = this.rooms.get(id);
      if (!room || room.status !== 'active') {
        room = new Room(mode, { id, bossId: opts.bossId });
        this.rooms.set(room.id, room);
      }
      return room;
    }
    return null;
  }

  join(socket, user, mode, opts = {}) {
    if (!['multi', 'solo', 'boss'].includes(mode)) return { error: 'Invalid mode' };
    this.leaveRoom(socket, { silent: true });
    if (mode === 'boss') {
      const def = getBoss(opts.bossId);
      if (!def) return { error: 'Unknown boss' };
      if (user.level < def.reqLevel) return { error: `Requires level ${def.reqLevel}` };
      if (user.flags < def.reqFlags) return { error: `Requires ${def.reqFlags} flags` };
    }
    const room = this.roomFor(mode, socket, user, opts);
    const result = room.addPlayer(socket, user);
    if (result.error) return result;
    this.socketRooms.set(socket.id, room.id);
    socket.join(`room:${room.id}`);
    const p = result.player;
    return {
      room,
      payload: {
        roomId: room.id,
        mode: room.mode,
        world: room.world,
        bossDef: room.bossDef ? {
          id: room.bossDef.id, name: room.bossDef.name, title: room.bossDef.title,
          hp: room.boss.maxHp, color: room.bossDef.color, attacks: room.bossDef.attacks,
        } : null,
        you: { key: p.key, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, skin: p.skin },
      },
    };
  }

  leaveRoom(socket, { silent = false } = {}) {
    const roomId = this.socketRooms.get(socket.id);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    this.socketRooms.delete(socket.id);
    socket.leave(`room:${roomId}`);
    if (!room) return null;
    const player = room.players.get(socket.id);
    if (player) {
      const updated = room.removePlayer(socket.id);
      if (!silent && socket.connected) {
        socket.emit('run:end', {
          reason: 'left',
          rewards: { coins: 0, exp: 0, flags: 0 },
          user: updated || null,
          stats: player ? { kills: player.kills, deaths: player.deaths, damage: Math.round(player.damageDealt) } : null,
        });
      }
    }
    if (room.players.size === 0) {
      setTimeout(() => {
        const current = this.rooms.get(room.id);
        if (current && current.players.size === 0) this.rooms.delete(room.id);
      }, 3000);
    }
    return player;
  }

  input(socket, data) {
    const roomId = this.socketRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    const now = Date.now();
    if (now - p.lastInputAt < 16) return;
    p.lastInputAt = now;
    const ix = Number(data && data.x);
    const iy = Number(data && data.y);
    p.input.x = Number.isFinite(ix) ? clamp(ix, -1, 1) : 0;
    p.input.y = Number.isFinite(iy) ? clamp(iy, -1, 1) : 0;
    if (data && data.dash && now >= p.dashCd && p.alive) {
      p.dashCd = now + 2800;
      p.dashUntil = now + 190;
      p.invulnUntil = Math.max(p.invulnUntil, now + 240);
      const mag = Math.hypot(p.input.x, p.input.y) || 1;
      p.dashVx = (p.input.x / mag) * 760;
      p.dashVy = (p.input.y / mag) * 760;
    }
  }

  queueDuel(socket, user) {
    this.leaveRoom(socket, { silent: true });
    this.queue = this.queue.filter((q) => q.socket.connected && q.user.id !== user.id);
    this.queue.push({ socket, user, at: Date.now() });
    const opponent = this.queue.find((q) => q.user.id !== user.id);
    if (!opponent) {
      socket.emit('duel:queue', { status: 'waiting', count: this.queue.length });
      return { waiting: true };
    }
    this.queue = this.queue.filter((q) => q !== socket && q !== opponent.socket && q.socket !== socket && q.socket !== opponent.socket);
    const room = new Room('duel', { id: `duel:${crypto.randomBytes(4).toString('hex')}` });
    this.rooms.set(room.id, room);
    const joinOne = (entry) => {
      const res = room.addPlayer(entry.socket, entry.user);
      if (res.error) return;
      this.socketRooms.set(entry.socket.id, room.id);
      entry.socket.join(`room:${room.id}`);
      entry.socket.emit('duel:found', {
        roomId: room.id,
        world: room.world,
        opponent: { username: entry === opponent ? user.username : opponent.user.username,
          level: entry === opponent ? user.level : opponent.user.level,
          avatar: entry === opponent ? user.avatar : opponent.user.avatar },
        you: { key: res.player.key, x: res.player.x, y: res.player.y, hp: res.player.hp, maxHp: res.player.maxHp, skin: res.player.skin },
      });
    };
    joinOne({ socket, user });
    joinOne(opponent);
    room.duel = { startedAt: Date.now(), duration: 120000, target: 3 };
    room.pushEvent('duel_start', { a: user.username, b: opponent.user.username });
    return { matched: true, roomId: room.id };
  }

  cancelQueue(socket, userId) {
    this.queue = this.queue.filter((q) => q.socket !== socket && q.user.id !== userId);
  }

  tick() {
    const now = Date.now();
    const dt = TICK_MS / 1000;
    for (const [id, room] of this.rooms) {
      if (room.players.size === 0) {
        this.rooms.delete(id);
        continue;
      }
      try {
        room.update(dt);
      } catch (err) {
        console.error('Room update error', room.id, err);
      }
      if (room.mode === 'duel' && room.status === 'closing') {
        for (const p of room.players.values()) p.socket?.leave(`room:${room.id}`);
        this.rooms.delete(id);
        continue;
      }
      if (now - room.lastSnapshot >= SNAPSHOT_MS) {
        room.lastSnapshot = now;
        this.broadcastState(room, now);
      }
    }
  }

  broadcastState(room, now) {
    const state = room.snapshot(now);
    const events = room.events.splice(0, room.events.length);
    for (const [socketId, p] of room.players) {
      const socket = p.socket;
      if (!socket || !socket.connected) continue;
      const payload = {
        ...state,
        you: {
          key: p.key,
          hp: Math.max(0, Math.round(p.hp)),
          maxHp: p.maxHp,
          alive: p.alive,
          respawnIn: p.alive ? 0 : Math.max(0, Math.ceil((p.respawnAt - now) / 1000)),
          kills: p.kills,
          deaths: p.deaths,
          coinsRun: Math.round(p.coinsRun),
          expRun: Math.round(p.expRun),
          flagsRun: Math.round(p.flagsRun),
          dashCd: p.dashCd > now ? Math.ceil((p.dashCd - now) / 100) / 10 : 0,
          fire: p.fireCd,
        },
        events,
      };
      socket.emit('state', payload);
      if (room.finishPayload && !p.sentFinish) {
        p.sentFinish = true;
        socket.emit('run:end', room.finishPayload);
      }
    }
  }

  markOnline(user, socket) {
    let entry = this.online.get(user.id);
    if (!entry) {
      entry = { userId: user.id, username: user.username, avatar: user.avatar, sockets: new Set() };
      this.online.set(user.id, entry);
    }
    entry.sockets.add(socket.id);
    return entry;
  }

  markOffline(userId, socketId) {
    const entry = this.online.get(userId);
    if (!entry) return;
    entry.sockets.delete(socketId);
    if (entry.sockets.size === 0) this.online.delete(userId);
  }

  onlineList() {
    return [...this.online.values()].map((e) => ({ userId: e.userId, username: e.username, avatar: e.avatar }));
  }

  roomStats() {
    const rooms = [];
    for (const room of this.rooms.values()) {
      rooms.push({ id: room.id, mode: room.mode, players: room.players.size, enemies: room.enemies.length, boss: !!room.boss });
    }
    return rooms;
  }
}

module.exports = { GameServer, Room, WORLD, TICK_MS, SNAPSHOT_MS, MAX_PLAYERS_MULTI };
