import { GAME_RULES, ITEM_MAP, MAX_LEVEL, TEAMS } from './data.js';
import { clamp, dist, angleTo, lerp, rand } from './utils.js';

let nextId = 1;
const resetIds = () => { nextId = 1; };

export function createUnitId() {
  return nextId++;
}

export class Unit {
  constructor(game, opts) {
    this.game = game;
    this.id = createUnitId();
    this.kind = opts.kind;
    this.team = opts.team;
    this.x = opts.x;
    this.y = opts.y;
    this.radius = opts.radius || 20;
    this.name = opts.name || '';
    this.sight = opts.sight || 600;
    this.stats = opts.stats || {};
    this.maxHp = opts.maxHp || this.stats.maxHp || 100;
    this.hp = this.maxHp;
    this.maxMp = opts.maxMp || this.stats.maxMp || 0;
    this.mp = this.maxMp;
    this.alive = true;
    this.face = opts.face !== undefined ? opts.face : rand(0, Math.PI * 2);
    this.buffs = [];
    this.vx = 0;
    this.vy = 0;
    this.attackCd = 0;
    this.attackAnim = 0;
    this.castAnim = 0;
    this.hitFlash = 0;
    this.damagers = new Map();
    this.isStatic = !!opts.isStatic;
    this.invulnerable = false;
    this.moveTarget = null;
    this.attackTargetId = null;
    this.recallT = 0;
    this.regenT = 0;
    this.regenCd = 0;
    this.regenFxT = 0;
    this.sizeScale = 1;
    this.deathTime = 0;
    this.totalDamageTaken = 0;
    this.isUnit = true;
  }

  get maxShield() {
    let s = 0;
    for (const b of this.buffs) if (b.type === 'shield') s += Math.max(0, b.remaining);
    return s;
  }

  get shield() {
    return this.maxShield;
  }

  get isHero() { return this.kind === 'hero'; }
  get isMinion() { return this.kind === 'minion'; }
  get isStructure() { return this.kind === 'tower' || this.kind === 'nexus'; }
  get isCamp() { return this.kind === 'camp'; }

  get armor() { return this.stats.armor || 0; }
  get mr() { return this.stats.mr || 0; }
  get hpPct() { return this.maxHp <= 0 ? 0 : clamp(this.hp / this.maxHp, 0, 1); }
  get mpPct() { return this.maxMp <= 0 ? 0 : clamp(this.mp / this.maxMp, 0, 1); }

  hasBuff(type) {
    return this.buffs.some((b) => b.type === type && (!b.remaining || b.remaining > 0));
  }

  getBuff(type) {
    return this.buffs.find((b) => b.type === type);
  }

  get stunned() { return this.hasBuff('stun'); }
  get rooted() { return this.hasBuff('root'); }
  get invisible() { return this.hasBuff('invis'); }
  get silenced() { return this.hasBuff('silence'); }

  canAct() {
    return this.alive && !this.stunned && !this.invulnerable && !(this.kind === 'hero' && this.dash);
  }

  addBuff(buff) {
    if (!this.alive) return;
    if (!buff) return;
    if (buff.type === 'cleanse') {
      this.cleanse();
      return;
    }
    const dur = buff.t || buff.duration || 1;
    if (buff.key) {
      const existing = this.buffs.find((b) => b.key === buff.key);
      if (existing) {
        existing.t = Math.max(existing.t, dur);
        existing.stacks = Math.min(existing.maxStacks || 1, (existing.stacks || 1) + 1);
        existing.value = Math.max(existing.value || 0, buff.value || 0);
        return;
      }
    }
    if (buff.type === 'vuln') {
      const existing = this.buffs.find((b) => b.type === 'vuln');
      if (existing) {
        existing.stacks = Math.min(existing.maxStacks || 3, (existing.stacks || 1) + 1);
        existing.t = Math.max(existing.t, dur);
        return;
      }
    }
    if (buff.type === 'shield') {
      this.buffs.push({ type: 'shield', remaining: buff.value || 0, t: dur, value: buff.value || 0, sourceId: buff.sourceId });
      return;
    }
    this.buffs.push({ stacks: 1, ...buff, t: dur });
  }

  cleanse() {
    this.buffs = this.buffs.filter((b) => !['slow', 'root', 'stun', 'dot', 'vuln'].includes(b.type));
  }

  speedMultiplier() {
    let slow = 0;
    let haste = 0;
    for (const b of this.buffs) {
      if (b.type === 'slow') slow = Math.max(slow, b.value || 0);
      if (b.type === 'haste') haste += b.value || 0;
    }
    return clamp(1 + haste - slow, 0.25, 2);
  }

  attackSpeedMultiplier() {
    let bonus = 0;
    for (const b of this.buffs) if (b.type === 'atkSpeed') bonus += (b.value || 0) * (b.stacks || 1);
    return 1 + bonus;
  }

  outgoingMultiplier() {
    let bonus = 0;
    for (const b of this.buffs) if (b.type === 'dmg') bonus += b.value || 0;
    return 1 + bonus;
  }

  incomingMultiplier(source) {
    let vuln = 0;
    for (const b of this.buffs) if (b.type === 'vuln') vuln += (b.value || 0.08) * (b.stacks || 1);
    let mult = 1 + vuln;
    if (this.kind === 'hero' && this.def && this.def.id === 'barong' && this.hp / this.maxHp < 0.35) mult *= 0.78;
    return mult;
  }

  updateBuffs(dt) {
    for (const b of this.buffs) {
      b.t -= dt;
      if (b.type === 'dot') {
        b.tick = (b.tick || 0) + dt;
        if (b.tick >= 0.5) {
          b.tick -= 0.5;
          const src = this.game.getUnitById(b.sourceId);
          this.takeDamage((b.dps || 0) * 0.5, src || b.source, 'magic', { dot: true, noNumber: Math.random() < 0.5 });
          if (!this.alive) return;
        }
      }
    }
    this.buffs = this.buffs.filter((b) => b.t > 0 && (b.type !== 'shield' || b.remaining > 0));
  }

  takeDamage(raw, source, dmgType = 'physical', opts = {}) {
    if (!this.alive || raw <= 0) return 0;
    if (this.invulnerable) {
      if (opts.showImmune) this.game.fxText(this.x, this.y - 70, 'KEBAL', '#9fd8ff', { size: 18 });
      return 0;
    }
    if (source && source.team >= 0 && source.team === this.team) return 0;
    let dmg = raw * this.incomingMultiplier(source);
    if (dmgType === 'physical') dmg *= 100 / (100 + this.armor);
    else if (dmgType === 'magic') dmg *= 100 / (100 + this.mr);
    dmg = Math.max(1, dmg);

    const sourceHero = source ? (source.kind === 'hero' ? source : source.ownerHero || null) : null;
    if (sourceHero) {
      sourceHero.damageDealt = (sourceHero.damageDealt || 0) + dmg;
      this.damagers.set(sourceHero.id, this.game.time);
    } else if (source) {
      this.damagers.set('u' + source.id, this.game.time);
    }

    let remaining = dmg;
    for (const b of this.buffs) {
      if (remaining <= 0) break;
      if (b.type === 'shield' && b.remaining > 0) {
        const absorbed = Math.min(b.remaining, remaining);
        b.remaining -= absorbed;
        remaining -= absorbed;
        this.game.fx(b.remaining > 0 ? 'shieldHit' : 'shieldBreak', this.x, this.y, { color: '#9ff6ff' });
      }
    }
    this.buffs = this.buffs.filter((b) => b.type !== 'shield' || b.remaining > 0);

    const dealt = Math.min(remaining, this.hp);
    this.hp -= remaining;
    this.totalDamageTaken += dealt;
    this.hitFlash = 0.18;
    this.lastHitTime = this.game.time;
    if (this.recallT > 0) {
      this.cancelRecall(true);
    }
    if (this.regenT > 0) {
      this.cancelRegen(true);
    }
    if (!opts.noNumber) {
      const color = opts.color || (dmgType === 'magic' ? '#d9a6ff' : opts.crit ? '#ffd166' : '#ffffff');
      this.game.fxText(this.x + rand(-12, 12), this.y - 58 - rand(0, 18), opts.crit ? `${Math.round(dmg)}!` : `${Math.round(dmg)}`, color, { size: opts.crit ? 24 : 16, vy: -55 });
    }
    if (sourceHero && opts.isBasic && sourceHero.stats.lifesteal) {
      sourceHero.heal(dmg * sourceHero.stats.lifesteal);
    }
    this.game.emit('hit', { x: this.x, y: this.y, dmgType, crit: !!opts.crit, targetKind: this.kind });
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(sourceHero || source, opts);
    }
    return dmg;
  }

  heal(amount, source) {
    if (!this.alive || amount <= 0) return 0;
    const healed = Math.min(amount, this.maxHp - this.hp);
    this.hp += healed;
    if (healed > 1) this.game.fxText(this.x + rand(-8, 8), this.y - 62, `+${Math.round(healed)}`, '#7dffb0', { size: 15, vy: -45 });
    if (source && source.kind === 'hero' && this.kind === 'hero' && source.team === this.team && source !== this) {
      source.healingDone = (source.healingDone || 0) + healed;
    }
    return healed;
  }

  die(source, opts = {}) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.deathTime = this.game.time;
    this.vx = 0;
    this.vy = 0;
    this.buffs = [];
    this.moveTarget = null;
    this.attackTargetId = null;
    this.recallT = 0;
    this.regenT = 0;
    this.dash = null;
    this.game.onUnitDeath(this, source, opts);
  }

  moveToward(tx, ty, dt, stopDist = 0) {
    const d = dist(this.x, this.y, tx, ty);
    if (d <= stopDist || d < 1) {
      this.vx = 0;
      this.vy = 0;
      return true;
    }
    const speed = (this.stats.speed || 200) * this.speedMultiplier() * (this.sizeScale > 1 ? 0.97 : 1);
    const nx = (tx - this.x) / d;
    const ny = (ty - this.y) / d;
    const step = Math.min(d - stopDist, speed * dt);
    this.x += nx * step;
    this.y += ny * step;
    this.face = Math.atan2(ny, nx);
    this.vx = nx * speed;
    this.vy = ny * speed;
    return false;
  }

  stopMoving() {
    this.vx = 0;
    this.vy = 0;
    this.moveTarget = null;
  }

  attackRangeTo(other) {
    return (this.stats.range || 100) + (other.radius || 0) * 0.5;
  }

  inRange(other, pad = 0) {
    return dist(this.x, this.y, other.x, other.y) <= this.attackRangeTo(other) + pad;
  }

  cancelRecall(silent = false) {
    if (this.recallT <= 0) return;
    this.recallT = 0;
    this.game.emit('recallInterrupted', { unit: this });
    if (!silent) this.game.fx('fizzle', this.x, this.y, { color: '#9fd8ff' });
  }

  cancelRegen(silent = false) {
    if (this.regenT <= 0) return;
    this.regenT = 0;
    this.game.emit('regenInterrupted', { unit: this });
    if (!silent) this.game.fx('fizzle', this.x, this.y, { color: '#7dffb0' });
  }
}

export class Hero extends Unit {
  constructor(game, opts) {
    const def = opts.def;
    const base = def.stats;
    super(game, {
      kind: 'hero', team: opts.team, x: opts.x, y: opts.y, radius: 24,
      name: opts.name || def.name, sight: 880,
      stats: { ...base, maxHp: base.hp, maxMp: base.mp },
      maxHp: base.hp, maxMp: base.mp,
    });
    this.def = def;
    this.level = 1;
    this.xp = 0;
    this.xpNext = this.calcXpNext(1);
    this.gold = GAME_RULES.startGold;
    this.goldEarned = GAME_RULES.startGold;
    this.skillPoints = 0;
    this.ranks = [1, 0, 0, 0];
    this.cd = [0, 0, 0, 0];
    this.items = [];
    this.isPlayer = !!opts.isPlayer;
    this.isBot = !opts.isPlayer;
    this.lane = opts.lane || def.lane || 'mid';
    this.pathPoints = opts.pathPoints;
    this.pathIndex = 1;
    this.respawnT = 0;
    this.dash = null;
    this.focusStacks = 0;
    this.focusT = 0;
    this.streak = 0;
    this.multiKill = 0;
    this.multiKillT = 0;
    this.kills = 0;
    this.deaths = 0;
    this.assists = 0;
    this.lastHits = 0;
    this.damageDealt = 0;
    this.healingDone = 0;
    this.towerKills = 0;
    this.attackCount = 0;
    this.brain = { think: rand(0, 0.3), mode: 'lane', campId: null, safeTime: 0, recallCooldown: 0, buyTimer: 0 };
    this.recalcStats(false);
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.face = opts.team === 0 ? -Math.PI * 0.75 : Math.PI * 0.25;
  }

  calcXpNext(level) {
    return 100 + (level - 1) * 52;
  }

  get hpPct() { return clamp(this.hp / this.maxHp, 0, 1); }

  get attacksPerSec() {
    return clamp(this.stats.atkSpeed * this.attackSpeedMultiplier() + this.focusStacks * 0.06, 0.3, 3.2);
  }

  recalcStats(addCurrent = true) {
    const b = this.def.stats;
    const lv = this.level;
    const prevMaxHp = this.maxHp || 0;
    const prevMaxMp = this.maxMp || 0;
    const s = {
      maxHp: b.hp + b.hpGrow * (lv - 1),
      maxMp: b.mp + b.mpGrow * (lv - 1),
      atk: b.atk + b.atkGrow * (lv - 1),
      armor: b.armor + b.armorGrow * (lv - 1),
      mr: b.mr + b.mrGrow * (lv - 1),
      speed: b.speed,
      range: b.range,
      atkSpeed: b.atkSpeed,
      hpRegen: b.hpRegen + lv * 0.35,
      mpRegen: b.mpRegen + lv * 0.25,
      power: 0,
      cdr: 0,
      lifesteal: 0,
      crit: 0,
      spellSlow: 0,
      ranged: b.ranged,
      projSpeed: b.projSpeed || 1000,
    };
    for (const itemId of this.items) {
      const item = ITEM_MAP[itemId];
      if (!item) continue;
      for (const [key, val] of Object.entries(item.stats)) {
        if (key === 'maxHp' || key === 'maxMp') continue;
        if (key === 'hp') s.maxHp += val;
        else if (key === 'mana') s.maxMp += val;
        else if (key === 'atkSpeed') s.atkSpeed += val;
        else if (key === 'cdr') s.cdr += val;
        else s[key] = (s[key] || 0) + val;
      }
    }
    s.cdr = Math.min(s.cdr, 0.4);
    s.crit = Math.min(s.crit, 0.6);
    this.stats = s;
    this.maxHp = Math.round(s.maxHp);
    this.maxMp = Math.round(s.maxMp);
    if (addCurrent) {
      this.hp = clamp(this.hp + (this.maxHp - prevMaxHp), 1, this.maxHp);
      this.mp = clamp(this.mp + (this.maxMp - prevMaxMp), 0, this.maxMp);
    } else {
      this.hp = Math.min(this.hp, this.maxHp);
      this.mp = Math.min(this.mp, this.maxMp);
    }
  }

  gainXp(amount) {
    if (!this.alive) return;
    this.xp += amount;
    let leveled = false;
    while (this.level < MAX_LEVEL && this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.skillPoints++;
      this.xpNext = this.calcXpNext(this.level);
      leveled = true;
      this.game.fx('levelup', this.x, this.y, { color: this.def.color });
      this.game.emit('levelUp', { hero: this });
    }
    if (leveled) {
      this.recalcStats();
      this.game.fxText(this.x, this.y - 90, 'LEVEL UP', '#ffe08a', { size: 20, vy: -40 });
      this.game.emit('announceLevel', { hero: this });
    }
  }

  gainGold(amount) {
    this.gold += amount;
    this.goldEarned += amount;
  }

  spendGold(amount) {
    if (this.gold < amount) return false;
    this.gold -= amount;
    return true;
  }

  buyItem(itemId) {
    const item = ITEM_MAP[itemId];
    if (!item || this.items.length >= 6 || this.items.includes(itemId)) return false;
    if (!this.spendGold(item.cost)) return false;
    this.items.push(itemId);
    this.recalcStats();
    this.game.emit('buy', { hero: this, item });
    return true;
  }

  sellItem(index) {
    const itemId = this.items[index];
    if (!itemId) return false;
    const item = ITEM_MAP[itemId];
    this.items.splice(index, 1);
    this.gold += Math.floor(item.cost * 0.6);
    this.recalcStats();
    this.game.emit('sell', { hero: this, item });
    return true;
  }

  canUpgrade(index) {
    const ab = this.def.abilities[index];
    if (!ab || this.skillPoints <= 0 || this.ranks[index] >= ab.maxRank) return false;
    if (ab.ult) {
      const need = [4, 8, 12][this.ranks[index]];
      if (this.level < need) return false;
    }
    return true;
  }

  upgradeSkill(index) {
    if (!this.canUpgrade(index)) return false;
    this.ranks[index]++;
    this.skillPoints--;
    this.game.emit('skillUp', { hero: this, index });
    return true;
  }

  autoLevel() {
    if (this.skillPoints <= 0) return;
    const order = [3, ...this.def.skillPriority.map((k) => ['Q', 'W', 'E'].indexOf(k)), 1, 2, 0];
    for (const idx of order) {
      if (this.canUpgrade(idx)) {
        this.upgradeSkill(idx);
        return;
      }
    }
    for (let i = 0; i < 4; i++) {
      if (this.canUpgrade(i)) {
        this.upgradeSkill(i);
        return;
      }
    }
  }

  startRecall() {
    if (!this.alive || this.recallT > 0 || this.regenT > 0 || this.dash || this.stunned) return false;
    this.recallT = GAME_RULES.recallTime;
    this.moveTarget = null;
    this.attackTargetId = null;
    this.game.emit('recall', { hero: this });
    return true;
  }

  startRegen() {
    if (!this.alive || this.regenT > 0 || this.regenCd > 0 || this.recallT > 0 || this.dash || this.stunned) return false;
    this.regenT = GAME_RULES.regenTime;
    this.regenCd = GAME_RULES.regenCooldown;
    this.regenFxT = 0;
    this.moveTarget = null;
    this.attackTargetId = null;
    this.game.emit('regen', { hero: this });
    return true;
  }

  update(dt) {
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.game.respawnHero(this);
      return;
    }
    this.updateBuffs(dt);
    if (!this.alive) return;
    if (this.focusT > 0) {
      this.focusT -= dt;
      if (this.focusT <= 0) this.focusStacks = 0;
    }
    if (this.multiKillT > 0) {
      this.multiKillT -= dt;
      if (this.multiKillT <= 0) this.multiKill = 0;
    }
    this.sizeScale = 1;
    for (const b of this.buffs) if (b.type === 'size') this.sizeScale += b.value || 0;
    for (let i = 0; i < 4; i++) this.cd[i] = Math.max(0, this.cd[i] - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.attackAnim = Math.max(0, this.attackAnim - dt);
    this.castAnim = Math.max(0, this.castAnim - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    this.hp = Math.min(this.maxHp, this.hp + this.stats.hpRegen * dt);
    this.mp = Math.min(this.maxMp, this.mp + this.stats.mpRegen * dt);
    this.gainGold(GAME_RULES.passiveGold * dt);
    this.game.applyFountain(this, dt);

    this.regenCd = Math.max(0, this.regenCd - dt);
    if (this.regenT > 0) {
      this.regenT = Math.max(0, this.regenT - dt);
      this.vx = this.vy = 0;
      const hpRate = (this.maxHp * GAME_RULES.regenHpPct) / GAME_RULES.regenTime;
      const mpRate = (this.maxMp * GAME_RULES.regenMpPct) / GAME_RULES.regenTime;
      this.hp = Math.min(this.maxHp, this.hp + hpRate * dt);
      this.mp = Math.min(this.maxMp, this.mp + mpRate * dt);
      this.regenFxT += dt;
      if (this.regenFxT >= 0.7) {
        this.game.fxText(this.x + rand(-8, 8), this.y - 64, `+${Math.round(hpRate * this.regenFxT)}`, '#7dffb0', { size: 13, vy: -36 });
        this.regenFxT = 0;
      }
      if (this.regenT <= 0) {
        this.game.emit('regenDone', { hero: this });
      }
      return;
    }

    if (this.recallT > 0) {
      this.recallT -= dt;
      this.vx = this.vy = 0;
      if (this.recallT <= 0) this.game.completeRecall(this);
      return;
    }
    if (this.dash) {
      this.updateDash(dt);
      return;
    }
    if (this.stunned) return;

    const target = this.attackTargetId ? this.game.getUnitById(this.attackTargetId) : null;
    if (target && (!target.alive || this.game.isInvisibleEnemy(this, target))) {
      this.attackTargetId = null;
    }
    const atkTarget = this.attackTargetId ? this.game.getUnitById(this.attackTargetId) : null;

    if (atkTarget && atkTarget.alive) {
      if (this.inRange(atkTarget)) {
        this.stopMoving();
        this.face = angleTo(this.x, this.y, atkTarget.x, atkTarget.y);
        if (this.attackCd <= 0) this.game.heroBasicAttack(this, atkTarget);
      } else {
        this.moveToward(atkTarget.x, atkTarget.y, dt, this.attackRangeTo(atkTarget) * 0.92);
      }
    } else if (this.moveTarget) {
      const arrived = this.moveToward(this.moveTarget.x, this.moveTarget.y, dt, 6);
      if (arrived) this.moveTarget = null;
    } else {
      this.vx = this.vy = 0;
    }

    if (this.attackCd <= 0) {
      const auto = this.game.findAutoAttackTarget(this);
      if (auto) {
        this.face = angleTo(this.x, this.y, auto.x, auto.y);
        this.game.heroBasicAttack(this, auto);
      }
    }
  }

  updateDash(dt) {
    const d = this.dash;
    d.t += dt;
    const k = clamp(d.t / d.dur, 0, 1);
    const ease = d.arc ? k : k * k * (3 - 2 * k);
    this.x = lerp(d.x0, d.x1, ease);
    this.y = lerp(d.y0, d.y1, ease);
    this.face = angleTo(d.x0, d.y0, d.x1, d.y1);
    this.vx = this.vy = 0;
    if (k >= 1) {
      this.dash = null;
      this.game.finishDash(this, d);
    }
  }

  respawn() {
    const pos = this.game.spawnPos(this.team);
    this.x = pos.x;
    this.y = pos.y;
    this.alive = true;
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.buffs = [];
    this.recallT = 0;
    this.regenT = 0;
    this.regenCd = 0;
    this.dash = null;
    this.attackTargetId = null;
    this.moveTarget = null;
    this.cd = [0, 0, 0, 0];
    this.attackCd = 0;
    this.focusStacks = 0;
    this.face = this.team === 0 ? -Math.PI * 0.75 : Math.PI * 0.25;
    this.game.fx('respawn', this.x, this.y, { color: this.def.color });
    this.game.emit('respawn', { hero: this });
  }
}

export class Minion extends Unit {
  constructor(game, opts) {
    const conf = opts.conf;
    const scaleHp = opts.hpScale || 1;
    const scaleDmg = opts.dmgScale || 1;
    super(game, {
      kind: 'minion', team: opts.team, x: opts.x, y: opts.y, radius: conf.radius,
      name: opts.type === 'cannon' ? 'Minion Meriam' : (conf.ranged ? 'Minion Pemanah' : 'Minion Pejuang'),
      sight: conf.sight,
      stats: {
        maxHp: conf.hp * scaleHp, maxMp: 0, atk: conf.dmg * scaleDmg,
        armor: conf.armor, mr: conf.mr, speed: conf.speed, range: conf.range, atkSpeed: conf.atkSpeed,
        hpRegen: 0.5, mpRegen: 0,
      },
      maxHp: conf.hp * scaleHp,
      face: opts.team === 0 ? -Math.PI * 0.75 : Math.PI * 0.25,
    });
    this.type = opts.type;
    this.conf = conf;
    this.ranged = !!conf.ranged;
    this.lane = opts.lane;
    this.pathPoints = opts.pathPoints;
    this.pathIndex = 1;
    this.jitter = rand(-26, 26);
    this.aggroRange = 430;
    this.atk = conf.dmg * scaleDmg;
    this.goldValue = conf.gold;
    this.xpValue = conf.xp;
    this.wave = opts.wave || 1;
    this.scaleHp = scaleHp;
    this.scaleDmg = scaleDmg;
    this.moveTarget = null;
    this.attackTargetId = null;
  }

  update(dt) {
    if (!this.alive) return;
    this.updateBuffs(dt);
    if (!this.alive) return;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.attackAnim = Math.max(0, this.attackAnim - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.stunned) return;

    let target = this.attackTargetId ? this.game.getUnitById(this.attackTargetId) : null;
    if (target && (!target.alive || this.game.isInvisibleEnemy(this, target) || dist(this.x, this.y, target.x, target.y) > this.aggroRange + 180)) {
      target = null;
      this.attackTargetId = null;
    }
    if (!target) {
      target = this.game.findMinionTarget(this);
      if (target) this.attackTargetId = target.id;
    }
    if (target) {
      if (this.inRange(target)) {
        this.stopMoving();
        this.face = angleTo(this.x, this.y, target.x, target.y);
        if (this.attackCd <= 0) this.game.minionAttack(this, target);
      } else {
        this.moveToward(target.x, target.y, dt, this.attackRangeTo(target) * 0.92);
      }
      return;
    }

    const pts = this.pathPoints;
    if (!pts) return;
    if (this.pathIndex >= pts.length) {
      const struct = this.game.findNearestVulnerableStructure(this.team, this.x, this.y, 420);
      if (struct) {
        if (this.inRange(struct)) {
          if (this.attackCd <= 0) this.game.minionAttack(this, struct);
        } else {
          this.moveToward(struct.x, struct.y, dt, this.attackRangeTo(struct) * 0.92);
        }
        return;
      }
      this.vx = this.vy = 0;
      return;
    }
    let [wx, wy] = pts[this.pathIndex];
    wx += this.jitter;
    wy += this.jitter * 0.5;
    if (dist(this.x, this.y, wx, wy) < 58) {
      this.pathIndex++;
      return;
    }
    this.moveToward(wx, wy, dt, 10);
  }
}

export class JungleCreep extends Unit {
  constructor(game, opts) {
    super(game, {
      kind: 'camp', team: -1, x: opts.x, y: opts.y, radius: 34, name: opts.name, sight: 420,
      stats: { maxHp: opts.hp, maxMp: 0, atk: opts.dmg, armor: opts.armor || 20, mr: 20, speed: 170, range: 120, atkSpeed: 0.7, hpRegen: 0, mpRegen: 0 },
      maxHp: opts.hp, isStatic: false,
      face: rand(0, Math.PI * 2),
    });
    this.campId = opts.campId;
    this.homeX = opts.x;
    this.homeY = opts.y;
    this.kindType = opts.kindType;
    this.goldValue = opts.gold;
    this.xpValue = opts.xp;
    this.leash = 420;
    this.attackTargetId = null;
    this.aggroed = false;
  }

  update(dt) {
    if (!this.alive) return;
    this.updateBuffs(dt);
    if (!this.alive) return;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.attackAnim = Math.max(0, this.attackAnim - dt);
    this.hp = Math.min(this.maxHp, this.hp + (this.aggroed ? 0 : this.maxHp * 0.12) * dt);
    if (this.stunned) return;
    if (!this.aggroed) {
      this.face += dt * 0.4;
      return;
    }
    let target = this.attackTargetId ? this.game.getUnitById(this.attackTargetId) : null;
    if (!target || !target.alive) {
      target = this.game.findNearestEnemyUnit(this, 480);
      this.attackTargetId = target ? target.id : null;
    }
    if (!target) {
      this.aggroed = false;
      return;
    }
    if (dist(this.x, this.y, this.homeX, this.homeY) > this.leash) {
      this.aggroed = false;
      this.attackTargetId = null;
      this.moveToward(this.homeX, this.homeY, dt, 8);
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.25 * dt);
      if (dist(this.x, this.y, this.homeX, this.homeY) < 20) {
        this.hp = this.maxHp;
        this.attackCd = 0;
      }
      return;
    }
    if (this.inRange(target)) {
      this.stopMoving();
      this.face = angleTo(this.x, this.y, target.x, target.y);
      if (this.attackCd <= 0) this.game.campAttack(this, target);
    } else {
      this.moveToward(target.x, target.y, dt, this.attackRangeTo(target) * 0.9);
    }
  }
}

export class Structure extends Unit {
  constructor(game, def) {
    const conf = def.config;
    super(game, {
      kind: def.type === 'nexus' ? 'nexus' : 'tower', team: def.team, x: def.x, y: def.y,
      radius: conf.radius, name: def.name, sight: 1000, isStatic: true,
      stats: { maxHp: conf.hp, maxMp: 0, atk: conf.dmg, armor: conf.armor, mr: conf.mr, speed: 0, range: conf.range, atkSpeed: 1 / conf.interval, hpRegen: 0, mpRegen: 0 },
      maxHp: conf.hp,
      face: def.team === 0 ? -Math.PI * 0.75 : Math.PI * 0.25,
    });
    this.def = def;
    this.tier = def.tier;
    this.lane = def.lane;
    this.range = conf.range;
    this.attackInterval = conf.interval;
    this.invulnerable = false;
    this.forcedTargetId = null;
    this.forcedT = 0;
    this.attackTargetId = null;
    this.seenInRange = new Map();
    this.isTower = def.type === 'tower';
    this.isNexus = def.type === 'nexus';
    this.goldValue = conf.gold;
    this.xpValue = conf.xp;
  }

  update(dt) {
    if (!this.alive) return;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.isNexus) return;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.trackRangeEntries();
    if (this.forcedT > 0) {
      this.forcedT -= dt;
      if (this.forcedT <= 0) this.forcedTargetId = null;
    }
    if (this.stunned) return;
    let target = this.attackTargetId ? this.game.getUnitById(this.attackTargetId) : null;
    if (!target || !target.alive || dist(this.x, this.y, target.x, target.y) > this.range + target.radius) {
      target = null;
      this.attackTargetId = null;
    }
    if (!target) {
      target = this.game.findTowerTarget(this);
      if (target) {
        this.attackTargetId = target.id;
        this.attackCd = 0.25;
      }
    }
    if (target) {
      this.face = angleTo(this.x, this.y, target.x, target.y);
      if (this.attackCd <= 0) this.game.towerAttack(this, target);
    }
  }

  trackRangeEntries() {
    const inside = new Set();
    for (const u of this.game.units) {
      if (!u.alive || u.team === this.team) continue;
      if (u.kind !== 'hero' && u.kind !== 'minion') continue;
      if (this.game.difficultyId === 'easy' && u.kind !== 'minion') continue;
      const d = dist(this.x, this.y, u.x, u.y);
      if (d > this.range + u.radius) continue;
      if (u.hasBuff('invis') && d > 250) continue;
      inside.add(u.id);
      if (!this.seenInRange.has(u.id)) this.seenInRange.set(u.id, this.game.time);
    }
    for (const id of this.seenInRange.keys()) {
      if (!inside.has(id)) this.seenInRange.delete(id);
    }
  }
}

export const resetUnitIds = resetIds;
