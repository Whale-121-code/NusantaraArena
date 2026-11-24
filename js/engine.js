import {
  CAMPS, DIFFICULTY, GAME_RULES, HEROES, HERO_IDS, ITEM_MAP, LANES, MINION_TYPES,
  STRUCTURES, TEAMS, TOWER_CONFIG, WAVE_INTERVAL, FIRST_WAVE_AT, WORLD,
} from './data.js';
import { clamp, dist, angleTo, lerp, rand, shuffle, pick } from './utils.js';
import { Hero, Minion, JungleCreep, Structure, createUnitId, resetUnitIds } from './units.js';
import { updateBot } from './ai.js';

export class Game {
  constructor(opts = {}) {
    resetUnitIds();
    this.playerTeam = 0;
    this.heroId = HEROES[opts.heroId] ? opts.heroId : 'garuda';
    this.diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    this.difficultyId = this.diff.id;
    this.playerLane = opts.lane && ['top', 'mid', 'bot', 'jungle'].includes(opts.lane) ? opts.lane : HEROES[this.heroId].lane;
    this.time = 0;
    this.over = false;
    this.winner = -1;
    this.result = null;
    this.units = [];
    this.unitMap = new Map();
    this.heroes = [];
    this.structures = [];
    this.camps = [];
    this.projectiles = [];
    this.zones = [];
    this.effects = [];
    this.texts = [];
    this.timers = [];
    this.events = [];
    this.killFeed = [];
    this.shake = 0;
    this.teamKills = [0, 0];
    this.firstBlood = false;
    this.waveIndex = 0;
    this.waveTimer = FIRST_WAVE_AT;
    this.nextProjectileId = 1;
    this.nextEffectId = 1;
    this.structureLockTimer = 0;
    this.passiveAuraTimer = 0;
    this.player = null;
    this.storm = { active: false, team: -1, level: 1, timer: 0 };
    this.lateGameShown = false;
    this.stormShown = false;

    this.createStructures();
    this.createCamps();
    this.createTeams();
    this.updateStructureLocks();
    this.emit('matchStart', { game: this });
  }

  // ---------- setup ----------
  getLanePath(team, lane) {
    const pts = (LANES[lane] || LANES.mid).points.map((p) => [p[0], p[1]]);
    return team === 0 ? pts : pts.slice().reverse();
  }

  spawnPos(team) {
    const base = TEAMS[team].base;
    const center = { x: WORLD / 2, y: WORLD / 2 };
    const a = angleTo(center.x, center.y, base.x, base.y) + rand(-0.55, 0.55);
    const r = rand(165, 245);
    return { x: clamp(base.x + Math.cos(a) * r, 160, WORLD - 160), y: clamp(base.y + Math.sin(a) * r, 160, WORLD - 160) };
  }

  createTeams() {
    const playerDef = HEROES[this.heroId];
    const alliesPool = shuffle(HERO_IDS.filter((id) => id !== playerDef.id));
    const enemyPool = shuffle(HERO_IDS);
    const allyIds = alliesPool.slice(0, 4);
    const enemyIds = enemyPool.slice(0, 5);
    const slots = ['jungle', 'mid', 'top', 'bot', 'bot'];

    const playerSlots = slots.slice();
    const pIndex = playerSlots.indexOf(this.playerLane) >= 0 ? playerSlots.indexOf(this.playerLane) : 0;
    playerSlots.splice(pIndex, 1);
    const allyLanes = {};
    for (const id of allyIds) {
      const pref = HEROES[id].lane;
      let lane = playerSlots.includes(pref) ? pref : playerSlots[0] || 'mid';
      playerSlots.splice(playerSlots.indexOf(lane), 1);
      allyLanes[id] = lane;
    }

    const enemySlots = slots.slice();
    const enemyLanes = {};
    for (const id of enemyIds) {
      const pref = HEROES[id].lane;
      let lane = enemySlots.includes(pref) ? pref : enemySlots[0] || 'mid';
      enemySlots.splice(enemySlots.indexOf(lane), 1);
      enemyLanes[id] = lane;
    }

    const playerSpawn = this.spawnPos(0);
    const player = new Hero(this, {
      def: playerDef, team: 0, x: playerSpawn.x, y: playerSpawn.y, isPlayer: true,
      lane: this.playerLane, pathPoints: this.getLanePath(0, this.playerLane),
    });
    this.player = player;
    this.addHero(player);

    allyIds.forEach((id, i) => {
      const pos = this.spawnPos(0);
      const h = new Hero(this, {
        def: HEROES[id], team: 0, x: pos.x, y: pos.y, lane: allyLanes[id],
        pathPoints: this.getLanePath(0, allyLanes[id]),
      });
      this.addHero(h);
    });

    enemyIds.forEach((id) => {
      const pos = this.spawnPos(1);
      const h = new Hero(this, {
        def: HEROES[id], team: 1, x: pos.x, y: pos.y, lane: enemyLanes[id],
        pathPoints: this.getLanePath(1, enemyLanes[id]),
      });
      this.addHero(h);
    });
  }

  addHero(hero) {
    this.heroes.push(hero);
    this.addUnit(hero);
  }

  addUnit(unit) {
    this.units.push(unit);
    this.unitMap.set(unit.id, unit);
  }

  createStructures() {
    for (const def of STRUCTURES) {
      const s = new Structure(this, def);
      this.structures.push(s);
      this.addUnit(s);
    }
  }

  createCamps() {
    for (const def of CAMPS) {
      const camp = { ...def, creep: null, respawnTimer: 0 };
      this.camps.push(camp);
      this.spawnCamp(camp);
    }
  }

  spawnCamp(camp) {
    const isRage = camp.kind === 'rage';
    const minute = this.time / 60;
    const creep = new JungleCreep(this, {
      x: camp.x + rand(-20, 20), y: camp.y + rand(-16, 16),
      campId: camp.id,
      name: isRage ? 'Roh Rimba' : 'Roh Kabut',
      kindType: camp.kind,
      hp: (isRage ? 1550 : 1250) * (1 + minute * 0.07),
      dmg: (isRage ? 82 : 66) * (1 + minute * 0.06),
      armor: isRage ? 32 : 22,
      gold: isRage ? 140 : 100,
      xp: isRage ? 150 : 120,
    });
    camp.creep = creep;
    this.addUnit(creep);
    this.fx('campSpawn', camp.x, camp.y, { color: camp.kind === 'rage' ? '#ffb347' : '#9b8cff', life: 0.8 });
  }

  // ---------- basic utilities ----------
  emit(type, payload = {}) {
    this.events.push({ type, ...payload });
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  }

  announce(text, sub = '', kind = 'info', duration = 2.6) {
    this.emit('announce', { text, sub, kind, duration });
  }

  fx(type, x, y, opts = {}) {
    this.effects.push({
      id: this.nextEffectId++, type, x, y, t: 0,
      life: opts.life || 0.5, radius: opts.radius || 30, color: opts.color || '#ffffff',
      color2: opts.color2 || null, angle: opts.angle || 0, size: opts.size || 1, data: opts.data || null,
    });
    if (this.effects.length > 420) this.effects.splice(0, this.effects.length - 420);
  }

  fxText(x, y, text, color = '#fff', opts = {}) {
    this.texts.push({ x, y, text, color, t: 0, life: opts.life || 0.85, size: opts.size || 16, vy: opts.vy || -45, crit: !!opts.crit });
    if (this.texts.length > 130) this.texts.splice(0, this.texts.length - 130);
  }

  getUnitById(id) {
    return this.unitMap.get(id) || null;
  }

  getTeamHeroes(team) {
    return this.heroes.filter((h) => h.team === team);
  }

  getAliveHeroes(team) {
    return this.heroes.filter((h) => h.team === team && h.alive);
  }

  // ---------- update ----------
  update(dt) {
    if (this.over) {
      this.updateVisuals(dt);
      return;
    }
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.shake = Math.max(0, this.shake - 60 * dt);
    this.structureLockTimer -= dt;
    if (this.structureLockTimer <= 0) {
      this.structureLockTimer = 0.4;
      this.updateStructureLocks();
    }

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        try { tm.fn(); } catch (err) { console.error(err); }
      }
    }

    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.spawnWave();
      this.waveTimer += WAVE_INTERVAL;
    }
    this.updateCamps(dt);
    this.updateStorm(dt);

    for (const hero of this.heroes) {
      if (hero.isBot && hero.alive) updateBot(this, hero, dt);
    }
    for (const unit of this.units) {
      if (unit.alive || unit.kind === 'hero') unit.update(dt);
      if (this.over) break;
    }
    if (this.over) {
      this.updateVisuals(dt);
      return;
    }

    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.updatePassiveAuras(dt);
    this.separateUnits(dt);
    this.cleanup();
    this.updateVisuals(dt);

    for (const u of this.units) {
      if (!u.alive) continue;
      u.x = clamp(u.x, 170, WORLD - 170);
      u.y = clamp(u.y, 170, WORLD - 170);
    }
    if (!this.over && this.time > 60 * 30) {
      this.endGame(this.teamKills[0] >= this.teamKills[1] ? 0 : 1);
    }
  }

  updateStorm(dt) {
    if (this.time >= 60 * 15 && !this.lateGameShown) {
      this.lateGameShown = true;
      this.announce('PERTEMPURAN SENGIT', 'Kerusakan semua pahlawan meningkat 20%', 'objective', 3);
    }
    if (this.time < 60 * 20) return;
    if (!this.stormShown) {
      this.stormShown = true;
      this.storm.active = true;
      this.announce('BADAI NUSANTARA', 'Langit murka menghukum pihak yang tertinggal!', 'storm', 3.4);
      this.shake = Math.max(this.shake, 10);
    }
    const score = (team) => {
      let s = 0;
      for (const st of this.structures) {
        if (st.team !== team || !st.alive) continue;
        s += st.kind === 'nexus' ? 8 : 2 + (st.hp / st.maxHp) * 2;
      }
      return s + this.teamKills[team] * 0.8;
    };
    const s0 = score(0);
    const s1 = score(1);
    this.storm.team = s0 === s1 ? (this.playerTeam) : (s0 < s1 ? 0 : 1);
    this.storm.timer += dt;
    if (this.storm.timer < 1) return;
    this.storm.timer -= 1;
    const rate = 0.012 + Math.min(0.008, Math.max(0, this.time - 60 * 20) / 60 * 0.001);
    const source = { team: 1 - this.storm.team, kind: 'storm', id: 'storm', x: 0, y: 0 };
    for (const st of this.structures) {
      if (!st.alive || st.team !== this.storm.team || st.invulnerable) continue;
      st.takeDamage(st.maxHp * rate * (st.kind === 'nexus' ? 0.65 : 1), source, 'true', { noNumber: true, storm: true });
      if (this.over) return;
    }
    if (Math.random() < 0.55) {
      const targets = this.structures.filter((st) => st.alive && st.team === this.storm.team && !st.invulnerable);
      if (targets.length) {
        const st = targets[Math.floor(Math.random() * targets.length)];
        this.fx('stormBolt', st.x + rand(-70, 70), st.y + rand(-70, 70), { color: st.team === 0 ? '#8fd6ff' : '#ff9db0', life: 0.5, radius: 54 });
      }
      this.shake = Math.max(this.shake, 4);
    }
  }

  updateVisuals(dt) {    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dt;
      if (e.t >= e.life) this.effects.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += dt;
      t.y += t.vy * dt;
      t.vy *= 0.96;
      if (t.t >= t.life) this.texts.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - 30 * dt);
  }

  updateCamps(dt) {
    for (const camp of this.camps) {
      if (!camp.creep && camp.respawnTimer > 0) {
        camp.respawnTimer -= dt;
        if (camp.respawnTimer <= 0) this.spawnCamp(camp);
      }
    }
  }

  updatePassiveAuras(dt) {
    this.passiveAuraTimer += dt;
    const tick = this.passiveAuraTimer >= 0.5;
    if (tick) this.passiveAuraTimer = 0;
    for (const h of this.heroes) {
      if (!h.alive || h.def.id !== 'nyai') continue;
      for (const ally of this.heroes) {
        if (!ally.alive || ally.team !== h.team) continue;
        if (dist(h.x, h.y, ally.x, ally.y) <= 520) {
          ally.hp = Math.min(ally.maxHp, ally.hp + 4 * dt);
        }
      }
    }
  }

  spawnWave() {
    this.waveIndex++;
    const minute = this.time / 60;
    const hpScale = 1 + minute * 0.15;
    const dmgScale = 1 + minute * 0.1;
    for (const team of [0, 1]) {
      for (const laneId of ['top', 'mid', 'bot']) {
        const path = this.getLanePath(team, laneId);
        const base = path[0];
        const toward = path[1];
        const baseAng = angleTo(base[0], base[1], toward[0], toward[1]);
        const types = ['melee', 'melee', 'melee', 'ranged'];
        if (this.waveIndex % 3 === 0) types.push('cannon');
        types.forEach((type, i) => {
          const conf = MINION_TYPES[type];
          const a = baseAng + (i - (types.length - 1) / 2) * 0.24 + rand(-0.05, 0.05);
          const r = rand(60, 150);
          const m = new Minion(this, {
            conf, type, team,
            x: clamp(base[0] + Math.cos(a) * r, 160, WORLD - 160),
            y: clamp(base[1] + Math.sin(a) * r, 160, WORLD - 160),
            pathPoints: path, lane: laneId, wave: this.waveIndex,
            hpScale, dmgScale,
          });
          m.pathIndex = 1;
          this.addUnit(m);
        });
      }
    }
    this.emit('wave', { index: this.waveIndex });
  }

  separateUnits(dt) {
    const movable = this.units.filter((u) => u.alive && !u.isStatic && !(u.kind === 'hero' && u.dash));
    for (let i = 0; i < movable.length; i++) {
      const a = movable[i];
      for (let j = i + 1; j < movable.length; j++) {
        const b = movable[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minD = (a.radius + b.radius) * 0.9;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < minD * minD) {
          const d = Math.sqrt(d2);
          const push = Math.min(70 * dt, (minD - d) * 0.42);
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
  }

  cleanup() {
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (!u.alive && (u.kind === 'minion' || u.kind === 'camp')) {
        this.unitMap.delete(u.id);
        this.units.splice(i, 1);
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].dead) this.projectiles.splice(i, 1);
    }
    for (let i = this.zones.length - 1; i >= 0; i--) {
      if (this.zones[i].dead) this.zones.splice(i, 1);
    }
  }

  updateStructureLocks() {
    const towers = this.structures.filter((s) => s.isTower);
    for (const s of this.structures) {
      if (s.isNexus) {
        const baseTower = towers.find((t) => t.team === s.team && t.tier === 'base');
        s.invulnerable = !!baseTower && baseTower.alive;
      } else if (s.tier === 'outer') {
        s.invulnerable = false;
      } else if (s.tier === 'inner') {
        const outer = towers.find((t) => t.team === s.team && t.lane === s.lane && t.tier === 'outer');
        s.invulnerable = !!outer && outer.alive;
      } else if (s.tier === 'base') {
        const inners = towers.filter((t) => t.team === s.team && t.tier === 'inner');
        s.invulnerable = inners.every((t) => t.alive);
      }
      if (s.isNexus) {
        const inners = towers.filter((t) => t.team === s.team && t.tier === 'inner');
        s.invulnerable = inners.every((t) => t.alive);
      }
    }
  }

  // ---------- visibility ----------
  isEnemyTeam(a, b) {
    return a !== b;
  }

  isInvisibleEnemy(unit, target) {
    if (!target || target.team === unit.team) return false;
    return target.hasBuff('invis') && dist(unit.x, unit.y, target.x, target.y) > 260;
  }

  isVisibleTo(team, unit) {
    if (!unit) return false;
    if (unit.team === team) return true;
    if (unit.isStructure) return true;
    if (unit.kind === 'minion' && !unit.alive) return false;
    const stealth = unit.hasBuff('invis');
    for (const source of this.units) {
      if (!source.alive || source.team !== team) continue;
      if (source.kind === 'minion' && !source.alive) continue;
      const d = dist(source.x, source.y, unit.x, unit.y);
      if (stealth && d > 260) continue;
      if (d <= (source.sight || 0) + unit.radius) return true;
    }
    return false;
  }

  getVisionCircles(team) {
    const circles = [];
    for (const u of this.units) {
      if (!u.alive || u.team !== team) continue;
      circles.push({ x: u.x, y: u.y, r: (u.sight || 500) * 0.95 });
    }
    return circles;
  }

  canPlayerSee(unit) {
    return this.isVisibleTo(this.playerTeam, unit);
  }

  // ---------- targeting ----------
  findEnemiesInRadius(team, x, y, radius, opts = {}) {
    const out = [];
    for (const u of this.units) {
      if (!u.alive || u.team === team) continue;
      if (u.isStructure && !opts.includeStructures) continue;
      if (u.kind === 'camp' && opts.excludeCamps) continue;
      if (u.hasBuff('invis') && dist(x, y, u.x, u.y) > 240) continue;
      if (dist(x, y, u.x, u.y) <= radius + u.radius) out.push(u);
    }
    return out;
  }

  findNearestEnemyUnit(unit, radius) {
    let best = null;
    let bestD = Infinity;
    for (const u of this.units) {
      if (!u.alive || u.team === unit.team) continue;
      if (u.isStructure) continue;
      const d = dist(unit.x, unit.y, u.x, u.y);
      if (d <= radius + u.radius && d < bestD) {
        best = u;
        bestD = d;
      }
    }
    return best;
  }

  findAutoAttackTarget(hero) {
    let bestHero = null;
    let bestHeroD = Infinity;
    let bestMinion = null;
    let bestMinionD = Infinity;
    for (const u of this.units) {
      if (!u.alive || u.team === hero.team) continue;
      if (u.kind !== 'hero' && u.kind !== 'minion') continue;
      if (u.hasBuff('invis') && dist(hero.x, hero.y, u.x, u.y) > 260) continue;
      const d = dist(hero.x, hero.y, u.x, u.y);
      if (d > hero.attackRangeTo(u)) continue;
      if (u.kind === 'hero' && d < bestHeroD) { bestHero = u; bestHeroD = d; }
      if (u.kind === 'minion' && d < bestMinionD) { bestMinion = u; bestMinionD = d; }
    }
    if (bestHero) return bestHero;
    if (bestMinion) return bestMinion;
    return null;
  }

  findMinionTarget(minion) {
    let bestMinion = null, bestMinionD = Infinity;
    let bestHero = null, bestHeroD = Infinity;
    for (const u of this.units) {
      if (!u.alive || u.team === minion.team) continue;
      if (u.kind !== 'hero' && u.kind !== 'minion') continue;
      if (u.hasBuff('invis') && dist(minion.x, minion.y, u.x, u.y) > 260) continue;
      const d = dist(minion.x, minion.y, u.x, u.y);
      if (d > minion.aggroRange + u.radius) continue;
      if (u.kind === 'minion' && d < bestMinionD) { bestMinion = u; bestMinionD = d; }
      if (u.kind === 'hero' && d < bestHeroD) { bestHero = u; bestHeroD = d; }
    }
    if (bestMinion) return bestMinion;
    if (bestHero) return bestHero;
    return this.findNearestVulnerableStructure(minion.team, minion.x, minion.y, 380);
  }

  findNearestVulnerableStructure(team, x, y, radius) {
    let best = null;
    let bestD = Infinity;
    for (const s of this.structures) {
      if (!s.alive || s.team === team || s.invulnerable) continue;
      const d = dist(x, y, s.x, s.y);
      if (d <= radius + s.radius && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  findTowerTarget(tower) {
    let first = null;
    let firstT = Infinity;
    for (const [id, enteredAt] of tower.seenInRange) {
      const u = this.getUnitById(id);
      if (!u || !u.alive || u.team === tower.team) continue;
      // Mode mudah: turret hanya memilih minion, bukan hero.
      if (this.difficultyId === 'easy' && u.kind !== 'minion') continue;
      if (enteredAt < firstT) { first = u; firstT = enteredAt; }
    }
    return first;
  }

  findNearestVisibleEnemyHero(hero, radius) {
    let best = null;
    let bestD = Infinity;
    for (const u of this.heroes) {
      if (!u.alive || u.team === hero.team) continue;
      if (!this.isVisibleTo(hero.team, u)) continue;
      const d = dist(hero.x, hero.y, u.x, u.y);
      if (d <= radius && d < bestD) {
        best = u;
        bestD = d;
      }
    }
    return best;
  }

  nearestAlly(hero, radius) {
    let best = null, bestPct = 2, bestD = Infinity;
    for (const h of this.heroes) {
      if (!h.alive || h.team !== hero.team) continue;
      const d = dist(hero.x, hero.y, h.x, h.y);
      if (d > radius) continue;
      const pct = h.hp / h.maxHp;
      if (pct < bestPct - 0.001 || (Math.abs(pct - bestPct) < 0.001 && d < bestD)) {
        best = h;
        bestPct = pct;
        bestD = d;
      }
    }
    return best || hero;
  }

  // ---------- player orders ----------
  commandMove(x, y) {
    const p = this.player;
    if (!p || !p.alive || this.over) return;
    p.cancelRecall(true);
    p.cancelRegen(true);
    p.moveTarget = { x: clamp(x, 170, WORLD - 170), y: clamp(y, 170, WORLD - 170) };
    p.attackTargetId = null;
  }

  commandAttack(target) {
    const p = this.player;
    if (!p || !p.alive || !target || !target.alive || this.over) return;
    if (target.team === p.team) return;
    if (target.isStructure && target.invulnerable) {
      this.fxText(target.x, target.y - 90, 'TERLINDUNGI', '#9fd8ff', { size: 16 });
      this.emit('notice', { text: 'Menara ini masih terlindungi!' });
      return;
    }
    p.cancelRecall(true);
    p.cancelRegen(true);
    p.attackTargetId = target.id;
    p.moveTarget = null;
  }

  commandStop() {
    const p = this.player;
    if (!p) return;
    p.cancelRecall(true);
    p.moveTarget = null;
    p.attackTargetId = null;
    p.vx = p.vy = 0;
  }

  commandRecall() {
    const p = this.player;
    if (!p || !p.alive) return;
    p.cancelRegen(true);
    p.startRecall();
  }

  commandRegen() {
    const p = this.player;
    if (!p || !p.alive || this.over) return;
    if (p.regenT > 0) return;
    if (p.regenCd > 0) {
      this.emit('notice', { text: `Regen siap dalam ${Math.ceil(p.regenCd)} detik` });
      return;
    }
    if (p.recallT > 0) p.cancelRecall(true);
    p.startRegen();
  }

  commandCast(index, aim, target) {
    const p = this.player;
    if (!p || !p.alive) return false;
    p.cancelRegen(true);
    return this.castAbility(p, index, aim, target);
  }

  commandUpgrade(index) {
    const p = this.player;
    if (!p) return;
    if (p.upgradeSkill(index)) {
      this.emit('notice', { text: `${p.def.abilities[index].name} meningkat ke peringkat ${p.ranks[index]}` });
    } else {
      const ab = p.def.abilities[index];
      if (p.skillPoints <= 0) this.emit('notice', { text: 'Tidak ada poin skill tersisa' });
      else if (p.ranks[index] >= ab.maxRank) this.emit('notice', { text: 'Skill sudah maksimal' });
      else this.emit('notice', { text: `Butuh level ${[4, 8, 12][p.ranks[index]]} untuk ultimate` });
    }
  }

  commandBuy(itemId) {
    const p = this.player;
    if (!p) return;
    const item = ITEM_MAP[itemId];
    if (!item) return;
    if (p.items.includes(itemId)) { this.emit('notice', { text: 'Item sudah dimiliki' }); return; }
    if (p.items.length >= 6) { this.emit('notice', { text: 'Slot item penuh' }); return; }
    if (p.gold < item.cost) { this.emit('notice', { text: 'Emas tidak cukup' }); return; }
    p.buyItem(itemId);
    this.emit('notice', { text: `${item.name} dibeli` });
  }

  commandSell(index) {
    const p = this.player;
    if (!p) return;
    if (p.sellItem(index)) this.emit('notice', { text: 'Item dijual (60% harga)' });
  }

  buyForBot(hero) {
    if (hero.items.length >= 6) return;
    for (const id of hero.def.build) {
      if (hero.items.includes(id)) continue;
      const item = ITEM_MAP[id];
      if (hero.gold >= item.cost) {
        hero.buyItem(id);
        return;
      }
    }
  }

  // ---------- misc ----------
  applyFountain(hero, dt) {
    if (!hero.alive) return;
    const base = TEAMS[hero.team].base;
    if (dist(hero.x, hero.y, base.x, base.y) <= GAME_RULES.fountainRadius) {
      hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * GAME_RULES.fountainHpPct * dt);
      hero.mp = Math.min(hero.maxMp, hero.mp + hero.maxMp * GAME_RULES.fountainMpPct * dt);
    }
  }

  completeRecall(hero) {
    const pos = this.spawnPos(hero.team);
    this.fx('teleport', hero.x, hero.y, { color: hero.def.color, life: 0.6 });
    hero.x = pos.x;
    hero.y = pos.y;
    hero.recallT = 0;
    hero.face = hero.team === 0 ? -Math.PI * 0.75 : Math.PI * 0.25;
    hero.attackTargetId = null;
    hero.moveTarget = null;
    this.fx('teleport', hero.x, hero.y, { color: hero.def.color, life: 0.7 });
    this.emit('recallDone', { hero });
  }

  respawnHero(hero) {
    hero.respawn();
    this.emit('notice', hero.isPlayer ? { text: 'Kamu kembali berjuang!' } : { text: '' });
  }

  endGame(winner) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.result = {
      winner,
      playerWon: winner === this.playerTeam,
      duration: this.time,
      mvp: this.computeMvp(),
      kills: this.teamKills.slice(),
      heroes: this.heroes.map((h) => this.serializeHero(h)),
    };
    this.fx('nexusBreak', TEAMS[winner].base.x, TEAMS[winner].base.y, { color: TEAMS[1 - winner].color, life: 2, radius: 300 });
    this.shake = 22;
    this.emit('gameOver', { result: this.result });
  }

  serializeHero(h) {
    return {
      id: h.id, name: h.def.name, heroId: h.def.id, team: h.team, isPlayer: h.isPlayer,
      kills: h.kills, deaths: h.deaths, assists: h.assists, lastHits: h.lastHits, gold: Math.round(h.goldEarned),
      damage: Math.round(h.damageDealt), healing: Math.round(h.healingDone), towerKills: h.towerKills,
      level: h.level, items: h.items.slice(),
    };
  }

  computeMvp() {
    const all = this.heroes.map((h) => ({
      hero: h,
      score: h.kills * 3 + h.assists * 1.5 - h.deaths * 1.5 + h.lastHits * 0.05 + h.damageDealt / 1200 + h.towerKills * 2 + h.healingDone / 2000,
    }));
    all.sort((a, b) => b.score - a.score);
    return all.length ? this.serializeHero(all[0].hero) : null;
  }

  // ---------- combat: basic attacks ----------
  heroBasicAttack(hero, target) {
    if (!hero.alive || !target || !target.alive || hero.attackCd > 0 || hero.stunned) return;
    if (!hero.inRange(target)) return;
    hero.attackCd = 1 / hero.attacksPerSec;
    hero.attackAnim = 0.24;
    hero.attackCount++;
    if (hero.def.id === 'garuda') {
      hero.focusStacks = Math.min(5, hero.focusStacks + 1);
      hero.focusT = 3;
    }
    if (hero.def.id === 'hanuman' && hero.attackCount % 4 === 0) {
      hero.heal(hero.maxHp * 0.03);
      this.fx('heal', hero.x, hero.y, { color: '#ffd9a0', life: 0.5 });
    }
    let steamBonus = 1;
    if (hero.hasBuff('invis')) {
      hero.buffs = hero.buffs.filter((b) => b.type !== 'invis');
      steamBonus = 1.55;
      this.fx('smoke', hero.x, hero.y, { color: hero.def.color, life: 0.5 });
    }
    let dmg = hero.stats.atk * hero.outgoingMultiplier() * steamBonus * this.heroDamageMult(hero);
    if (hero.def.id === 'kala' && target.hp / target.maxHp < 0.4) dmg *= 1.2;
    const crit = Math.random() < hero.stats.crit;
    if (crit) dmg *= 1.68;
    hero.face = angleTo(hero.x, hero.y, target.x, target.y);

    if (hero.stats.ranged) {
      this.spawnProjectile({
        x: hero.x + Math.cos(hero.face) * 26,
        y: hero.y + Math.sin(hero.face) * 26,
        team: hero.team, source: hero, sourceHero: hero,
        targetId: target.id, homing: true,
        speed: hero.stats.projSpeed || 1000, radius: 14, maxRange: 1200,
        damage: dmg, dmgType: 'physical', isBasic: true, crit,
        color: hero.def.color, size: 7,
      });
    } else {
      target.takeDamage(dmg, hero, 'physical', { isBasic: true, crit, color: crit ? '#ffd166' : '#ffffff' });
      this.fx('slash', target.x, target.y, { color: hero.def.accent || hero.def.color, angle: hero.face, life: 0.25, radius: 38 });
    }
    if (target.isHero && hero.isHero) this.notifyTowerAggro(hero, target);
    this.emit('attack', { x: hero.x, y: hero.y, ranged: hero.stats.ranged, hero, target, isPlayer: hero.isPlayer });
  }

  notifyTowerAggro(attacker, victim) {
    for (const t of this.structures) {
      if (!t.alive || t.team !== victim.team || !t.isTower) continue;
      if (dist(t.x, t.y, victim.x, victim.y) <= t.range + 60 && dist(t.x, t.y, attacker.x, attacker.y) <= t.range + 120) {
        t.forcedTargetId = attacker.id;
        t.forcedT = 3.5;
      }
    }
  }

  minionAttack(minion, target) {
    if (minion.attackCd > 0 || !target.alive) return;
    minion.attackCd = 1 / minion.stats.atkSpeed;
    minion.attackAnim = 0.2;
    minion.face = angleTo(minion.x, minion.y, target.x, target.y);
    if (minion.ranged) {
      this.spawnProjectile({
        x: minion.x, y: minion.y, team: minion.team, source: minion,
        targetId: target.id, homing: true, speed: 900, radius: 10, maxRange: 900,
        damage: minion.stats.atk, dmgType: 'physical', isBasic: true,
        color: minion.team === 0 ? '#8fd0ff' : '#ffa0a0', size: 5,
      });
    } else {
      target.takeDamage(minion.stats.atk, minion, 'physical', { isBasic: true, noNumber: Math.random() < 0.55 });
      this.fx('slash', target.x, target.y, { color: minion.team === 0 ? '#8fd0ff' : '#ffa0a0', angle: minion.face, life: 0.2, radius: 24 });
    }
  }

  campAttack(camp, target) {
    if (camp.attackCd > 0 || !target.alive) return;
    camp.attackCd = 1 / camp.stats.atkSpeed;
    camp.attackAnim = 0.25;
    camp.face = angleTo(camp.x, camp.y, target.x, target.y);
    target.takeDamage(camp.stats.atk, camp, 'physical', { isBasic: true });
    this.fx('slash', target.x, target.y, { color: '#d7c4a1', angle: camp.face, life: 0.2, radius: 30 });
  }

  towerAttack(tower, target) {
    if (tower.attackCd > 0 || !target.alive) return;
    tower.attackCd = tower.attackInterval;
    tower.attackAnim = 0.3;
    tower.face = angleTo(tower.x, tower.y, target.x, target.y);
    const dmg = tower.stats.atk + Math.min(140, (this.time / 60) * 8);
    this.spawnProjectile({
      x: tower.x + Math.cos(tower.face) * 40,
      y: tower.y + Math.sin(tower.face) * 40,
      team: tower.team, source: tower, sourceHero: null,
      targetId: target.id, homing: true, speed: 1500, radius: 16, maxRange: 1200,
      damage: dmg, dmgType: 'physical', isTowerShot: true,
      color: tower.team === 0 ? '#79c8ff' : '#ff7d8d', size: 13,
    });
    this.fx('towerShot', tower.x, tower.y, { color: tower.team === 0 ? '#79c8ff' : '#ff7d8d', angle: tower.face, life: 0.3, radius: 20 });
    this.emit('towerShot', { tower, target });
  }

  // ---------- projectiles ----------
  spawnProjectile(opts) {
    const p = {
      id: this.nextProjectileId++,
      x: opts.x, y: opts.y,
      team: opts.team,
      source: opts.source,
      sourceHero: opts.sourceHero || null,
      targetId: opts.targetId || null,
      homing: !!opts.homing,
      angle: opts.angle || 0,
      speed: opts.speed || 900,
      radius: opts.radius || 16,
      maxRange: opts.maxRange || 800,
      traveled: 0,
      damage: opts.damage || 0,
      dmgType: opts.dmgType || 'physical',
      effects: opts.effects || null,
      dot: opts.dot || null,
      pierce: opts.pierce || 0,
      hitCount: 0,
      hits: new Set(),
      isBasic: !!opts.isBasic,
      isTowerShot: !!opts.isTowerShot,
      crit: !!opts.crit,
      color: opts.color || '#ffffff',
      size: opts.size || 8,
      ability: opts.ability || null,
      rank: opts.rank || 1,
      dead: false,
    };
    if (opts.dirX !== undefined) {
      p.dirX = opts.dirX;
      p.dirY = opts.dirY;
      p.angle = Math.atan2(p.dirY, p.dirX);
    } else if (p.homing) {
      const target = this.getUnitById(p.targetId);
      if (target) {
        p.angle = angleTo(p.x, p.y, target.x, target.y);
        p.dirX = Math.cos(p.angle);
        p.dirY = Math.sin(p.angle);
      }
    } else {
      p.dirX = Math.cos(p.angle);
      p.dirY = Math.sin(p.angle);
    }
    this.projectiles.push(p);
    return p;
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      if (p.homing) {
        const target = this.getUnitById(p.targetId);
        if (!target || !target.alive) { p.dead = true; continue; }
        const d = dist(p.x, p.y, target.x, target.y);
        p.angle = angleTo(p.x, p.y, target.x, target.y);
        p.dirX = Math.cos(p.angle);
        p.dirY = Math.sin(p.angle);
        const step = p.speed * dt;
        p.x += p.dirX * step;
        p.y += p.dirY * step;
        p.traveled += step;
        if (d <= target.radius + p.radius || p.traveled >= p.maxRange) {
          if (d <= target.radius + p.radius + 8) this.applyProjectileHit(p, target);
          p.dead = true;
        }
      } else {
        const step = p.speed * dt;
        p.x += p.dirX * step;
        p.y += p.dirY * step;
        p.traveled += step;
        for (const u of this.units) {
          if (!u.alive || u.team === p.team || p.hits.has(u.id)) continue;
          if (u.isStructure) continue;
          if (u.hasBuff('invis') && dist(p.x, p.y, u.x, u.y) > 240) continue;
          if (dist(p.x, p.y, u.x, u.y) <= p.radius + u.radius) {
            p.hits.add(u.id);
            p.hitCount++;
            this.applyProjectileHit(p, u);
            if (p.dead) break;
            if (p.hitCount > p.pierce) {
              p.dead = true;
              break;
            }
          }
        }
        if (p.traveled >= p.maxRange) p.dead = true;
      }
      if (p.x < 100 || p.x > WORLD - 100 || p.y < 100 || p.y > WORLD - 100) p.dead = true;
    }
  }

  applyProjectileHit(p, target) {
    if (!target || !target.alive) return;
    if (p.isBasic || p.isTowerShot) {
      target.takeDamage(p.damage, p.sourceHero || p.source, p.dmgType, { isBasic: true, crit: p.crit, color: p.crit ? '#ffd166' : undefined });
    } else {
      target.takeDamage(p.damage, p.sourceHero || p.source, p.dmgType, { color: p.dmgType === 'magic' ? '#d9a6ff' : undefined });
      if (target.alive) {
        this.applyAbilityEffects(target, p.effects, p.sourceHero);
        if (p.dot && p.sourceHero) target.addBuff({ type: 'dot', dps: p.dot.dps, t: p.dot.t, sourceId: p.sourceHero.id });
        if (p.sourceHero) this.applySpellStatus(p.sourceHero, target);
      }
    }
    this.fx('impact', target.x, target.y, { color: p.color, life: 0.32, radius: 30 + p.size });
    this.fx('hitSpark', target.x, target.y, { color: p.color, life: 0.2, radius: 16 });
    this.emit('projectileHit', { x: target.x, y: target.y, isBasic: p.isBasic });
  }

  // ---------- ability helpers ----------
  rankValue(value, rank) {
    if (Array.isArray(value)) return value[Math.min(rank - 1, value.length - 1)] || 0;
    return value || 0;
  }

  statScale(hero, type) {
    if (type === 'ad') return hero.stats.atk;
    if (type === 'ap') return hero.stats.power;
    if (type === 'hp') return hero.maxHp;
    return 0;
  }

  abilityAmount(hero, ability, rank, key = 'damage') {
    const base = this.rankValue(ability[key], rank);
    const scale = (ability.scale || 0) * this.statScale(hero, ability.scaleType);
    return base + scale;
  }

  outgoingDamage(hero, target, amount, dmgType, opts = {}) {
    let dmg = amount * hero.outgoingMultiplier() * this.heroDamageMult(hero);
    if (hero.def.id === 'kala' && target.hp / target.maxHp < 0.4) dmg *= 1.2;
    return target.takeDamage(dmg, hero, dmgType, opts);
  }

  heroDamageMult(hero) {
    let mult = 1;
    if (hero.def.roleId === 'marksman') mult *= 1.15;
    if (this.time >= 60 * 15) mult *= 1.2;
    if (hero.team === 1 && hero.isBot) mult *= this.diff.botDmg || 1;
    return mult;
  }

  applyAbilityEffects(target, effects, sourceHero) {
    if (!target || !target.alive || !effects) return;
    for (const e of effects) {
      if (!e) continue;
      if (e.type === 'slow') {
        target.addBuff({ type: 'slow', value: e.value || 0.2, t: e.t || 1.5 });
      } else if (e.type === 'stun') {
        target.addBuff({ type: 'stun', t: e.t || 0.8 });
        target.recallT = 0;
        target.dash = null;
        target.vx = target.vy = 0;
        this.fx('stun', target.x, target.y, { color: '#ffe08a', life: 0.5, radius: 26 });
      } else if (e.type === 'root') {
        target.addBuff({ type: 'root', t: e.t || 1 });
      } else if (e.type === 'silence') {
        target.addBuff({ type: 'silence', t: e.t || 1.5 });
      } else if (e.type === 'vuln') {
        target.addBuff({ type: 'vuln', value: e.value || 0.08, t: e.t || 4, maxStacks: 3 });
      }
    }
  }

  applySpellStatus(hero, target) {
    if (!hero || !target || !target.alive) return;
    if (hero.def.id === 'rangda') {
      target.addBuff({ type: 'vuln', value: 0.08, t: 4, maxStacks: 3 });
    }
    if (hero.stats.spellSlow) {
      target.addBuff({ type: 'slow', value: hero.stats.spellSlow, t: 1.6 });
    }
  }

  applyAoe(hero, ability, rank, x, y) {
    const radius = ability.radius || 150;
    const amount = this.abilityAmount(hero, ability, rank);
    let dot = null;
    if (ability.dot) {
      const base = this.rankValue(ability.dot.dps, rank);
      dot = { dps: base + (ability.dot.scale || 0) * this.statScale(hero, ability.scaleType), t: ability.dot.t || 3 };
    }
    for (const u of this.units) {
      if (!u.alive || u.team === hero.team || u.isStructure) continue;
      if (u.hasBuff('invis') && dist(x, y, u.x, u.y) > 240) continue;
      if (dist(x, y, u.x, u.y) <= radius + u.radius * 0.6) {
        this.outgoingDamage(hero, u, amount, ability.dmgType || 'magic', { color: ability.dmgType === 'magic' ? '#d9a6ff' : undefined });
        if (u.alive) {
          this.applyAbilityEffects(u, ability.effects, hero);
          if (dot) u.addBuff({ type: 'dot', dps: dot.dps, t: dot.t, sourceId: hero.id });
          this.applySpellStatus(hero, u);
        }
      }
    }
    this.fx('aoe', x, y, { color: ability.color, life: 0.55, radius });
    this.emit('abilityExplode', { x, y, ability });
    if (ability.ult) this.shake = Math.max(this.shake, 6);
  }

  applyCone(hero, ability, rank, angle) {
    const range = ability.range || 250;
    const halfAngle = ((ability.angle || 100) * Math.PI) / 360;
    const amount = this.abilityAmount(hero, ability, rank);
    for (const u of this.units) {
      if (!u.alive || u.team === hero.team || u.isStructure) continue;
      if (u.hasBuff('invis') && dist(hero.x, hero.y, u.x, u.y) > 240) continue;
      const d = dist(hero.x, hero.y, u.x, u.y);
      if (d > range + u.radius) continue;
      let da = Math.abs(angleTo(hero.x, hero.y, u.x, u.y) - angle);
      da = Math.min(da, Math.PI * 2 - da);
      if (da <= halfAngle + 0.16) {
        this.outgoingDamage(hero, u, amount, ability.dmgType || 'physical', { color: ability.dmgType === 'magic' ? '#d9a6ff' : undefined });
        if (u.alive) {
          this.applyAbilityEffects(u, ability.effects, hero);
          this.applySpellStatus(hero, u);
        }
      }
    }
    this.fx('cone', hero.x, hero.y, { color: ability.color, angle, life: 0.4, radius: range, size: ability.angle || 100 });
    this.emit('abilityExplode', { x: hero.x + Math.cos(angle) * 60, y: hero.y + Math.sin(angle) * 60, ability });
  }

  addZone(hero, ability, rank, x, y) {
    const damage = ability.damage ? this.abilityAmount(hero, ability, rank, 'damage') : 0;
    const allyHeal = ability.allyHeal ? this.rankValue(ability.allyHeal, rank) + (ability.allyHealScale || 0) * this.statScale(hero, ability.scaleType) : 0;
    const enemyDamage = ability.enemyDamage ? this.rankValue(ability.enemyDamage, rank) + (ability.enemyDamageScale || 0) * this.statScale(hero, ability.scaleType) : 0;
    const zone = {
      id: this.nextProjectileId++,
      x, y,
      radius: ability.radius || 200,
      team: hero.team,
      sourceHero: hero,
      ability,
      rank,
      duration: ability.duration || 4,
      interval: ability.interval || 0.5,
      elapsed: 0,
      tickTimer: 0.08,
      damage,
      dmgType: ability.dmgType || 'magic',
      allyHeal,
      enemyDamage,
      enemyEffects: ability.enemyEffects || null,
      effects: ability.effects || null,
      color: ability.color,
      dead: false,
      ult: !!ability.ult,
    };
    this.zones.push(zone);
    this.fx('zoneStart', x, y, { color: ability.color, life: 0.6, radius: zone.radius });
    if (ability.ult) this.shake = Math.max(this.shake, 5);
    this.emit('abilityZone', { x, y, ability });
  }

  updateZones(dt) {
    for (const z of this.zones) {
      if (z.dead) continue;
      z.elapsed += dt;
      z.tickTimer -= dt;
      if (z.tickTimer <= 0) {
        z.tickTimer += z.interval;
        if (z.damage > 0 || z.enemyDamage > 0) {
          for (const u of this.units) {
            if (!u.alive || u.team === z.team || u.isStructure) continue;
            if (u.hasBuff('invis') && dist(z.x, z.y, u.x, u.y) > 240) continue;
            if (dist(z.x, z.y, u.x, u.y) <= z.radius + u.radius * 0.6) {
              if (z.damage > 0) this.outgoingDamage(z.sourceHero, u, z.damage, z.dmgType, { noNumber: true });
              if (u.alive && z.enemyDamage > 0) this.outgoingDamage(z.sourceHero, u, z.enemyDamage, 'magic', { noNumber: true });
              if (u.alive) {
                this.applyAbilityEffects(u, z.enemyEffects, z.sourceHero);
                if (z.sourceHero) this.applySpellStatus(z.sourceHero, u);
              }
            }
          }
          this.fx('zoneTick', z.x + rand(-z.radius * 0.5, z.radius * 0.5), z.y + rand(-z.radius * 0.5, z.radius * 0.5), { color: z.color, life: 0.35, radius: 36 });
        }
        if (z.allyHeal > 0) {
          for (const h of this.heroes) {
            if (!h.alive || h.team !== z.team) continue;
            if (dist(z.x, z.y, h.x, h.y) <= z.radius + h.radius) h.heal(z.allyHeal);
          }
        }
        this.emit('zoneTick', { zone: z });
      }
      if (z.elapsed >= z.duration) z.dead = true;
    }
  }

  // ---------- ability casting ----------
  castAbility(hero, index, aim = null, targetUnit = null) {
    if (!hero || !hero.alive || this.over) return false;
    const ability = hero.def.abilities[index];
    if (!ability) return false;
    if (hero.stunned || hero.silenced) return false;
    const rank = hero.ranks[index];
    if (rank <= 0) {
      if (hero.isPlayer) this.emit('notice', { text: 'Skill belum dipelajari' });
      return false;
    }
    if (hero.cd[index] > 0) return false;
    if (hero.mp < ability.mana) {
      if (hero.isPlayer) this.emit('notice', { text: 'Mana tidak cukup' });
      return false;
    }
    if (hero.dash) return false;

    let px = aim ? aim.x : hero.x + Math.cos(hero.face) * 120;
    let py = aim ? aim.y : hero.y + Math.sin(hero.face) * 120;
    if (!Number.isFinite(px) || !Number.isFinite(py)) { px = hero.x; py = hero.y; }
    const aimDist = dist(hero.x, hero.y, px, py);
    let angle = aimDist < 4 ? hero.face : angleTo(hero.x, hero.y, px, py);
    const range = ability.range || 0;

    let target = targetUnit || null;
    if (ability.aim === 'ally') {
      if (target && (!target.alive || target.team !== hero.team || dist(hero.x, hero.y, target.x, target.y) > range + target.radius + 40)) target = null;
      if (!target) target = this.nearestAlly(hero, range || 900);
    } else if (ability.aim === 'enemy') {
      if (target && (!target.alive || target.team === hero.team || dist(hero.x, hero.y, target.x, target.y) > range + target.radius + 30)) target = null;
      if (!target) target = this.findNearestVisibleEnemyHero(hero, range || 400);
      if (!target) {
        if (hero.isPlayer) this.emit('notice', { text: 'Tidak ada target dalam jangkauan' });
        return false;
      }
      px = target.x;
      py = target.y;
      angle = angleTo(hero.x, hero.y, target.x, target.y);
    }

    if (ability.kind === 'selfBuff' || ability.kind === 'auraShield' || ability.kind === 'stealth') {
      px = hero.x;
      py = hero.y;
    } else if (ability.aim === 'point') {
      const maxDist = Math.max(0, range);
      if (aimDist > maxDist) {
        px = hero.x + Math.cos(angle) * maxDist;
        py = hero.y + Math.sin(angle) * maxDist;
      }
    }

    hero.face = angle;
    hero.mp -= ability.mana;
    const cdValue = this.rankValue(ability.cooldown, rank);
    hero.cd[index] = cdValue * (1 - hero.stats.cdr);
    hero.castAnim = 0.32;
    hero.cancelRecall(true);
    if (hero.invisible && ability.kind !== 'stealth') {
      hero.buffs = hero.buffs.filter((b) => b.type !== 'invis');
    }
    this.fx('castGlow', hero.x, hero.y, { color: ability.color, life: 0.4, radius: 36 });
    this.emit('ability', { hero, ability, index, x: px, y: py, targetId: target ? target.id : null, ult: !!ability.ult, isPlayer: hero.isPlayer });

    switch (ability.kind) {
      case 'projectile': {
        const dmg = this.abilityAmount(hero, ability, rank);
        let dot = null;
        if (ability.dot) {
          dot = {
            dps: this.rankValue(ability.dot.dps, rank) + (ability.dot.scale || 0) * this.statScale(hero, ability.scaleType),
            t: ability.dot.t || 3,
          };
        }
        this.spawnProjectile({
          x: hero.x + Math.cos(angle) * 30,
          y: hero.y + Math.sin(angle) * 30,
          team: hero.team, source: hero, sourceHero: hero,
          dirX: Math.cos(angle), dirY: Math.sin(angle),
          speed: ability.speed || 900, radius: ability.radius || 24, maxRange: ability.range || 700,
          damage: dmg * hero.outgoingMultiplier() * this.heroDamageMult(hero),
          dmgType: ability.dmgType || 'magic',
          effects: ability.effects,
          dot, pierce: ability.pierce || 0,
          color: ability.color, size: Math.max(6, (ability.radius || 24) * 0.32),
          ability, rank,
        });
        break;
      }
      case 'aoe': {
        const run = () => this.applyAoe(hero, ability, rank, px, py);
        if (ability.delay) {
          this.fx('telegraph', px, py, { color: ability.color, life: ability.delay, radius: ability.radius || 150 });
          this.timers.push({ t: ability.delay, fn: run });
        } else run();
        break;
      }
      case 'zone':
        this.addZone(hero, ability, rank, px, py);
        break;
      case 'dash':
      case 'leap': {
        let dashDist = Math.min(aimDist, range || 300);
        if (dashDist < 12) dashDist = range || 300;
        const destX = clamp(hero.x + Math.cos(angle) * dashDist, 170, WORLD - 170);
        const destY = clamp(hero.y + Math.sin(angle) * dashDist, 170, WORLD - 170);
        const dmg = ability.damage ? this.abilityAmount(hero, ability, rank) * hero.outgoingMultiplier() * this.heroDamageMult(hero) : 0;
        hero.stopMoving();
        hero.attackTargetId = null;
        hero.dash = {
          x0: hero.x, y0: hero.y, x1: destX, y1: destY, t: 0,
          dur: ability.kind === 'leap' ? 0.38 : 0.2, arc: ability.kind === 'leap',
          radius: ability.radius || 100, damage: dmg, dmgType: ability.dmgType || 'physical',
          effects: ability.effects, color: ability.color, ability, rank, ult: !!ability.ult,
        };
        if (ability.selfEffects) for (const e of ability.selfEffects) hero.addBuff({ ...e, t: e.t || 2 });
        this.fx('dashStart', hero.x, hero.y, { color: ability.color, angle, life: 0.35, radius: 40 });
        break;
      }
      case 'blink': {
        const maxDist = range || 350;
        const d = Math.min(aimDist, maxDist);
        this.fx('blinkOut', hero.x, hero.y, { color: ability.color, life: 0.4 });
        hero.x = clamp(hero.x + Math.cos(angle) * d, 170, WORLD - 170);
        hero.y = clamp(hero.y + Math.sin(angle) * d, 170, WORLD - 170);
        hero.stopMoving();
        hero.attackTargetId = null;
        this.fx('blinkIn', hero.x, hero.y, { color: ability.color, life: 0.5 });
        break;
      }
      case 'cone':
        this.applyCone(hero, ability, rank, angle);
        break;
      case 'selfBuff': {
        const duration = ability.duration || 4;
        const shieldAmount = this.abilityAmount(hero, ability, rank, 'shield') + (ability.shieldHpScale || 0) * hero.maxHp;
        hero.addBuff({ type: 'shield', value: shieldAmount, t: duration });
        if (ability.selfEffects) for (const e of ability.selfEffects) hero.addBuff({ ...e, t: e.t || duration });
        if (ability.size) hero.addBuff({ type: 'size', value: ability.size - 1, t: duration });
        this.fx('buffBurst', hero.x, hero.y, { color: ability.color, life: 0.8, radius: 70 });
        this.fxText(hero.x, hero.y - 90, '+PERISAI', '#9ff6ff', { size: 17 });
        break;
      }
      case 'auraShield': {
        const duration = ability.duration || 3;
        const shieldAmount = this.abilityAmount(hero, ability, rank, 'shield') + (ability.shieldHpScale || 0) * hero.maxHp;
        for (const h of this.heroes) {
          if (!h.alive || h.team !== hero.team) continue;
          if (dist(hero.x, hero.y, h.x, h.y) <= (ability.radius || 400)) {
            h.addBuff({ type: 'shield', value: shieldAmount, t: duration });
            if (ability.allyEffects) for (const e of ability.allyEffects) h.addBuff({ ...e, t: e.t || duration });
          }
        }
        this.fx('shieldRing', hero.x, hero.y, { color: ability.color, life: 0.7, radius: ability.radius || 400 });
        break;
      }
      case 'healAlly': {
        if (!target) break;
        const healAmount = this.abilityAmount(hero, ability, rank, 'heal');
        target.heal(healAmount, hero);
        if (ability.allyEffects) for (const e of ability.allyEffects) target.addBuff({ ...e, t: e.t || 2 });
        this.fx('beam', target.x, target.y, { color: ability.color, life: 0.55, radius: 26 });
        this.fx('heal', target.x, target.y, { color: ability.color, life: 0.7, radius: 60 });
        this.emit('healAbility', { hero, target });
        break;
      }
      case 'shieldAlly': {
        if (!target) break;
        const shieldAmount = this.abilityAmount(hero, ability, rank, 'shield');
        target.addBuff({ type: 'shield', value: shieldAmount, t: ability.duration || 3 });
        if (ability.cleanse) target.cleanse();
        if (ability.allyEffects) for (const e of ability.allyEffects) target.addBuff({ ...e, t: e.t || 2 });
        this.fx('shield', target.x, target.y, { color: ability.color, life: 0.65, radius: 54 });
        this.fx('beam', target.x, target.y, { color: ability.color, life: 0.45, radius: 22 });
        break;
      }
      case 'stealth': {
        hero.addBuff({ type: 'invis', t: ability.duration || 2.5 });
        if (ability.selfEffects) for (const e of ability.selfEffects) hero.addBuff({ ...e, t: e.t || ability.duration });
        this.fx('smoke', hero.x, hero.y, { color: ability.color, life: 0.8, radius: 60 });
        break;
      }
      case 'execute': {
        if (!target) break;
        const base = this.abilityAmount(hero, ability, rank);
        const missing = (ability.missingHpScale || 0) * (target.maxHp - target.hp);
        const dmg = (base + missing) * hero.outgoingMultiplier() * this.heroDamageMult(hero);
        target.takeDamage(dmg, hero, 'true', { color: '#ff7090', crit: true });
        this.fx('execute', target.x, target.y, { color: ability.color, life: 0.7, radius: 70 });
        this.shake = Math.max(this.shake, 5);
        if (!target.alive && ability.resetOnKill) {
          hero.cd[index] = Math.max(0, hero.cd[index] - cdValue * ability.resetOnKill);
        }
        break;
      }
      default:
        break;
    }
    return true;
  }

  finishDash(hero, d) {
    const x = hero.x;
    const y = hero.y;
    if (d.damage > 0) {
      for (const u of this.units) {
        if (!u.alive || u.team === hero.team || u.isStructure) continue;
        if (u.hasBuff('invis') && dist(x, y, u.x, u.y) > 240) continue;
        if (dist(x, y, u.x, u.y) <= d.radius + u.radius * 0.7) {
          u.takeDamage(d.damage, hero, d.dmgType, { color: d.dmgType === 'magic' ? '#d9a6ff' : undefined });
          if (u.alive) {
            this.applyAbilityEffects(u, d.effects, hero);
            this.applySpellStatus(hero, u);
          }
        }
      }
    }
    this.fx('shockwave', x, y, { color: d.color, life: 0.5, radius: d.radius });
    this.fx('dust', x, y, { color: '#c8b78d', life: 0.6, radius: d.radius * 0.7 });
    if (d.ult) this.shake = Math.max(this.shake, 9);
    this.emit('dashEnd', { hero, x, y });
  }

  // ---------- deaths & rewards ----------
  onUnitDeath(unit, source, opts = {}) {
    const sourceHero = source ? (source.kind === 'hero' ? source : source.ownerHero || null) : null;
    const sourceTeam = sourceHero ? sourceHero.team : (source && source.team >= 0 ? source.team : -1);

    if (unit.kind === 'hero') {
      unit.deaths++;
      if (sourceTeam >= 0 && sourceTeam !== unit.team) this.teamKills[sourceTeam]++;
      const victim = unit;
      const streakBefore = victim.streak;
      const assists = [];
      for (const [key, t] of victim.damagers.entries()) {
        if (typeof key !== 'number') continue;
        if (this.time - t > 9) continue;
        const h = this.getUnitById(key);
        if (h && h.kind === 'hero' && h.team !== victim.team && h !== sourceHero) assists.push(h);
      }
      const killer = sourceHero && sourceHero.team !== victim.team ? sourceHero : null;
      if (killer) {
        killer.kills++;
        killer.streak++;
        killer.multiKill = killer.multiKillT > 0 ? killer.multiKill + 1 : 1;
        killer.multiKillT = 7;
        const bounty = GAME_RULES.heroKillGold + Math.min(280, streakBefore * GAME_RULES.streakBonus);
        killer.gainGold(bounty);
        killer.gainXp(180 + victim.level * 18);
        for (const a of assists) {
          a.assists++;
          a.gainGold(GAME_RULES.assistGold + 20);
          a.gainXp(100 + victim.level * 8);
        }
        if (!this.firstBlood) {
          this.firstBlood = true;
          this.announce('FIRST BLOOD', `${killer.def.name} menumpahkan darah pertama`, 'blood', 3);
        }
        if (killer.multiKill >= 2) {
          const label = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'MANIAC', 'SAVAGE'][Math.min(5, killer.multiKill)];
          if (label) this.announce(label, killer.def.name, 'multi', 2.8);
        }
        if (killer.streak === 5) this.announce('MENGAMUK', `${killer.def.name} sedang tak terhentikan`, 'multi', 2.2);
      }
      victim.streak = 0;
      victim.multiKill = 0;
      victim.multiKillT = 0;
      victim.respawnT = GAME_RULES.respawnBase + victim.level * GAME_RULES.respawnPerLevel;
      const killerName = killer ? killer.def.name : (source && source.isStructure ? 'Menara' : source ? 'Pasukan' : 'Roh Hutan');
      this.killFeed.unshift({
        killerName,
        killerHero: killer ? killer.def.id : null,
        killerTeam: sourceTeam >= 0 ? sourceTeam : 1 - victim.team,
        victimName: victim.def.name,
        victimHero: victim.def.id,
        victimTeam: victim.team,
        playerInvolved: killer ? killer.isPlayer : victim.isPlayer,
        time: this.time,
      });
      if (this.killFeed.length > 6) this.killFeed.length = 6;
      this.fx('death', victim.x, victim.y, { color: victim.def.color, life: 1.2, radius: 90 });
      this.fx('soul', victim.x, victim.y, { color: victim.def.color, life: 1.6, radius: 40 });
      this.shake = Math.max(this.shake, victim.isPlayer ? 12 : 5);
      this.emit('kill', {
        killer, victim, assists,
        killerName, victimName: victim.def.name,
        killerTeam: sourceTeam, victimTeam: victim.team,
        playerKilled: victim.isPlayer, playerKiller: !!killer && killer.isPlayer,
        multiKill: killer ? killer.multiKill : 0,
        firstBlood: this.firstBlood,
      });
      return;
    }

    if (unit.kind === 'tower' || unit.kind === 'nexus') {
      const creditTeam = sourceTeam;
      if (creditTeam >= 0) {
        for (const h of this.heroes) {
          if (h.team === creditTeam) h.gainGold(GAME_RULES.towerTeamGold);
        }
      }
      if (sourceHero) {
        sourceHero.towerKills += unit.kind === 'tower' ? 1 : 2;
        sourceHero.gainGold(150);
        sourceHero.gainXp(unit.xpValue || 120);
      }
      this.fx('towerDeath', unit.x, unit.y, { color: TEAMS[unit.team].color, life: 1.8, radius: 160 });
      this.fx('rubble', unit.x, unit.y, { color: '#c3b18c', life: 2.2, radius: 90 });
      this.shake = Math.max(this.shake, 14);
      if (unit.kind === 'tower') {
        this.announce('MENARA HANCUR', `${unit.name} milik ${TEAMS[unit.team].name} runtuh`, 'objective', 2.4);
        this.killFeed.unshift({
          killerName: sourceHero ? sourceHero.def.name : 'Pasukan',
          killerHero: sourceHero ? sourceHero.def.id : null,
          killerTeam: creditTeam >= 0 ? creditTeam : 1 - unit.team,
          victimName: unit.name,
          victimHero: null,
          victimTeam: unit.team,
          isTower: true,
          time: this.time,
        });
        if (this.killFeed.length > 6) this.killFeed.length = 6;
        this.updateStructureLocks();
        this.emit('towerDown', { tower: unit, team: unit.team, creditTeam });
      } else {
        this.emit('towerDown', { tower: unit, team: unit.team, creditTeam, nexus: true });
        this.endGame(creditTeam);
      }
      return;
    }

    if (unit.kind === 'camp') {
      const camp = this.camps.find((c) => c.id === unit.campId);
      if (camp) {
        camp.creep = null;
        camp.respawnTimer = camp.respawn;
      }
      if (sourceHero) {
        sourceHero.gainGold(unit.goldValue);
        sourceHero.gainXp(unit.xpValue);
        if (unit.kindType === 'rage') {
          sourceHero.addBuff({ type: 'dmg', value: 0.18, t: 60 });
          sourceHero.heal(sourceHero.maxHp * 0.08);
          if (sourceHero.isPlayer) this.announce('BERKAH RIMBA', '+18% kerusakan selama 60 detik', 'buff', 2.2);
        } else {
          sourceHero.heal(sourceHero.maxHp * 0.12);
          sourceHero.mp = Math.min(sourceHero.maxMp, sourceHero.mp + sourceHero.maxMp * 0.15);
          if (sourceHero.isPlayer) this.announce('BERKAH KABUT', 'Nyawa dan mana dipulihkan', 'buff', 2.2);
        }
        this.emit('campKilled', { hero: sourceHero, camp: unit.kindType });
      }
      this.fx('campDeath', unit.x, unit.y, { color: '#b8ffd9', life: 1, radius: 70 });
      return;
    }

    if (unit.kind === 'minion') {
      const creditTeam = sourceTeam;
      if (sourceHero) {
        sourceHero.gainGold(unit.goldValue);
        sourceHero.lastHits++;
        this.emit('lastHit', { hero: sourceHero, gold: unit.goldValue });
      }
      if (creditTeam >= 0) {
        for (const h of this.heroes) {
          if (h.team === creditTeam && h.alive && dist(h.x, h.y, unit.x, unit.y) <= GAME_RULES.xpShareRange) {
            h.gainXp(unit.xpValue);
          }
        }
      }
      this.fx('minionDeath', unit.x, unit.y, { color: unit.team === 0 ? '#8fd0ff' : '#ffa0a0', life: 0.4, radius: 22 });
    }
  }
}
