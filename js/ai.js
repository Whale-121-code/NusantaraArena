import { dist, angleTo, rand, clamp } from './utils.js';
import { TEAMS } from './data.js';

const ALLY_PROFILE = { reaction: 0.3, aimError: 34, aggression: 1, retreatHp: 0.34, botDmg: 1 };
const SKILL_KINDS_DAMAGE = ['projectile', 'aoe', 'zone', 'cone', 'dash', 'leap', 'execute'];
const DEFENSIVE_KINDS = ['selfBuff', 'auraShield', 'healAlly', 'shieldAlly', 'stealth', 'blink'];

export function updateBot(game, hero, dt) {
  const b = hero.brain;
  b.think -= dt;
  if (b.recallCooldown > 0) b.recallCooldown -= dt;
  if (b.buyTimer > 0) b.buyTimer -= dt;
  if (hero.multiKillT) hero.multiKillT = Math.max(0, hero.multiKillT - dt);

  if (!hero.alive || hero.dash) return;

  if (hero.recallT > 0) {
    const threat = game.findNearestVisibleEnemyHero(hero, 460);
    if (threat) {
      hero.cancelRecall(true);
    } else {
      return;
    }
  }

  const isEnemyBot = hero.team === 1;
  const prof = isEnemyBot ? game.diff : ALLY_PROFILE;
  if (b.think > 0) return;
  b.think = prof.reaction * rand(0.8, 1.35);

  if (hero.skillPoints > 0) hero.autoLevel();
  if (b.buyTimer <= 0) {
    b.buyTimer = 1.6;
    game.buyForBot(hero);
  }

  const base = TEAMS[hero.team].base;
  const distBase = dist(hero.x, hero.y, base.x, base.y);
  const hpPct = hero.hp / hero.maxHp;

  const enemyHeroes = game.heroes.filter((h) => h.alive && h.team !== hero.team && game.isVisibleTo(hero.team, h));
  const nearestEnemy = enemyHeroes.reduce((best, e) => {
    const d = dist(hero.x, hero.y, e.x, e.y);
    return !best || d < best.d ? { e, d } : best;
  }, null);
  const inFight = nearestEnemy && nearestEnemy.d < 980;

  const alliesNear = game.heroes.filter((h) => h.alive && h.team === hero.team && h !== hero && dist(hero.x, hero.y, h.x, h.y) < 780).length;
  const enemiesNear = enemyHeroes.filter((e) => dist(hero.x, hero.y, e.x, e.y) < 780).length;
  const outnumbered = inFight && hpPct < 0.56 && nearestEnemy && nearestEnemy.d < 540 && enemiesNear > alliesNear;
  if (hpPct < prof.retreatHp || (hpPct < 0.42 && inFight && nearestEnemy.d < 300) || outnumbered) {
    useDefensive(game, hero, nearestEnemy ? nearestEnemy.e : null, prof);
    if (distBase < 480) {
      hero.moveTarget = { x: base.x, y: base.y };
      hero.attackTargetId = null;
      return;
    }
    const safe = !nearestEnemy || nearestEnemy.d > 760;
    if (safe && b.recallCooldown <= 0 && distBase > 900) {
      if (hero.startRecall()) {
        b.recallCooldown = 13;
        return;
      }
    }
    const dir = angleTo(hero.x, hero.y, base.x, base.y);
    hero.attackTargetId = null;
    hero.moveTarget = {
      x: clamp(hero.x + Math.cos(dir) * 320, 180, 3420),
      y: clamp(hero.y + Math.sin(dir) * 320, 180, 3420),
    };
    return;
  }

  if (distBase < 420 && hero.hp < hero.maxHp * 0.88) {
    hero.attackTargetId = null;
    hero.moveTarget = { x: base.x, y: base.y };
    if (hero.recallT > 0) hero.cancelRecall(true);
    return;
  }

  const role = hero.def.roleId;
  const lane = hero.lane;
  const support = role === 'support';
  const jungler = lane === 'jungle';

  if (support) {
    const hurtAlly = game.heroes
      .filter((h) => h.alive && h.team === hero.team && h !== hero)
      .map((h) => ({ h, d: dist(hero.x, hero.y, h.x, h.y), pct: h.hp / h.maxHp }))
      .sort((a, b2) => a.pct - b2.pct)[0];
    if (hurtAlly && hurtAlly.pct < 0.58 && hurtAlly.d < 750) {
      for (let i = 0; i < 4; i++) {
        const ab = hero.def.abilities[i];
        if (!ab || hero.ranks[i] <= 0 || hero.cd[i] > 0 || hero.mp < ab.mana) continue;
        if (ab.kind === 'healAlly' || ab.kind === 'shieldAlly') {
          game.castAbility(hero, i, { x: hurtAlly.h.x, y: hurtAlly.h.y }, hurtAlly.h);
          break;
        }
      }
    }
    if (hurtAlly && hurtAlly.d < 900 && hurtAlly.pct < 0.7 && !inFight) {
      const dir = angleTo(hurtAlly.h.x, hurtAlly.h.y, hero.x, hero.y);
      hero.moveTarget = { x: hurtAlly.h.x + Math.cos(dir) * 170, y: hurtAlly.h.y + Math.sin(dir) * 170 };
      hero.attackTargetId = null;
      return;
    }
  }

  if (inFight) {
    const target = chooseCombatTarget(game, hero, enemyHeroes, prof);
    if (target) {
      const danger = towerDanger(game, hero, target.x, target.y);
      if (!danger) {
        hero.attackTargetId = target.id;
        hero.moveTarget = null;
        if (dist(hero.x, hero.y, target.x, target.y) <= (hero.stats.range + target.radius) * 1.15) {
          useOffensive(game, hero, target, prof);
        }
        if (role === 'support') {
          for (let i = 0; i < 4; i++) {
            const ab = hero.def.abilities[i];
            if (ab && (ab.kind === 'healAlly' || ab.kind === 'shieldAlly') && hero.ranks[i] > 0 && hero.cd[i] <= 0 && hpPct < 0.5) {
              game.castAbility(hero, i, null, null);
              break;
            }
          }
        }
        return;
      }
      hero.attackTargetId = null;
      const dir = angleTo(target.x, target.y, hero.x, hero.y);
      hero.moveTarget = { x: hero.x + Math.cos(dir) * 260, y: hero.y + Math.sin(dir) * 260 };
      return;
    }
  }

  if (support) {
    const ally = game.heroes.find((h) => h.alive && h.team === hero.team && h !== hero && h.def.roleId === 'marksman' && dist(hero.x, hero.y, h.x, h.y) < 950)
      || game.heroes.find((h) => h.alive && h.team === hero.team && h !== hero && dist(hero.x, hero.y, h.x, h.y) < 700);
    if (ally && !inFight) {
      const d = dist(hero.x, hero.y, ally.x, ally.y);
      if (d > 260) {
        hero.moveTarget = { x: ally.x, y: ally.y };
        hero.attackTargetId = null;
        return;
      }
    }
  }

  if (jungler) {
    const camp = nearestCamp(game, hero);
    if (camp && camp.d < 1700 && (!nearestEnemy || nearestEnemy.d > 700)) {
      hero.attackTargetId = camp.creep.id;
      hero.moveTarget = null;
      if (camp.d < 380) {
        for (let i = 0; i < 4; i++) {
          const ab = hero.def.abilities[i];
          if (!ab || ab.ult || hero.ranks[i] <= 0 || hero.cd[i] > 0 || hero.mp < ab.mana) continue;
          if (SKILL_KINDS_DAMAGE.includes(ab.kind) && ab.kind !== 'execute') {
            const c = camp.creep;
            game.castAbility(hero, i, { x: c.x, y: c.y }, c);
            break;
          }
        }
      }
      return;
    }
  }

  const enemyMinion = findFarmTarget(game, hero);
  if (enemyMinion && !towerDanger(game, hero, enemyMinion.x, enemyMinion.y)) {
    hero.attackTargetId = enemyMinion.id;
    hero.moveTarget = null;
    return;
  }

  const structure = game.findNearestVulnerableStructure(hero.team, hero.x, hero.y, 760);
  if (structure) {
    if (dist(hero.x, hero.y, structure.x, structure.y) <= hero.stats.range + structure.radius + 100 && !towerDanger(game, hero, structure.x, structure.y)) {
      hero.attackTargetId = structure.id;
      hero.moveTarget = null;
      return;
    }
    if (!towerDanger(game, hero, structure.x, structure.y) && hasMinionCover(game, hero)) {
      hero.attackTargetId = structure.id;
      hero.moveTarget = null;
      return;
    }
  }

  followLane(game, hero);
}

function chooseCombatTarget(game, hero, enemies, prof) {
  if (!enemies.length) return null;
  const scored = enemies.map((e) => {
    const d = dist(hero.x, hero.y, e.x, e.y);
    const hpPct = e.hp / e.maxHp;
    const role = e.def.roleId;
    let score = d;
    if (role === 'marksman' || role === 'mage') score -= 140;
    if (hpPct < 0.35) score -= 260;
    score -= (1 - hpPct) * 160;
    if (e === game.player) score -= 60 * (prof.aggression || 1);
    return { e, d, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0].e;
}

function findFarmTarget(game, hero) {
  let best = null;
  let bestScore = Infinity;
  for (const u of game.units) {
    if (!u.alive || u.team === hero.team || u.kind !== 'minion') continue;
    if (!game.isVisibleTo(hero.team, u)) continue;
    const d = dist(hero.x, hero.y, u.x, u.y);
    if (d > 760) continue;
    let score = d - (1 - u.hp / u.maxHp) * 220;
    if (d < hero.stats.range + u.radius + 30) score -= 250;
    if (score < bestScore) { bestScore = score; best = u; }
  }
  return best;
}

function nearestCamp(game, hero) {
  let best = null;
  for (const camp of game.camps) {
    if (!camp.creep || !camp.creep.alive) continue;
    const d = dist(hero.x, hero.y, camp.creep.x, camp.creep.y);
    if (camp.team !== -1 && camp.team !== hero.team) continue;
    if (!best || d < best.d) best = { camp, creep: camp.creep, d };
  }
  return best;
}

function towerDanger(game, hero, x, y) {
  for (const t of game.structures) {
    if (!t.alive || !t.isTower || t.team === hero.team) continue;
    if (dist(x, y, t.x, t.y) < t.range + 80) {
      let cover = false;
      for (const u of game.units) {
        if (u.alive && u.team === hero.team && u.kind === 'minion' && dist(u.x, u.y, t.x, t.y) <= t.range + 40) {
          cover = true;
          break;
        }
      }
      if (!cover) return true;
    }
  }
  const base = TEAMS[1 - hero.team].base;
  if (dist(x, y, base.x, base.y) < 420) {
    for (const u of game.units) {
      if (u.alive && u.team === hero.team && u.kind === 'minion' && dist(u.x, u.y, base.x, base.y) < 420) return false;
    }
    return true;
  }
  return false;
}

function hasMinionCover(game, hero) {
  for (const u of game.units) {
    if (u.alive && u.team === hero.team && u.kind === 'minion' && dist(u.x, u.y, hero.x, hero.y) < 520) return true;
  }
  return false;
}

function laneLook(hero, path, ahead) {
  if (!path || path.length < 2) return null;
  let best = null;
  let cum = 0;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1][0], ay = path[i - 1][1];
    const bx = path[i][0], by = path[i][1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 === 0 ? 0 : ((hero.x - ax) * dx + (hero.y - ay) * dy) / l2;
    t = clamp(t, 0, 1);
    const px = ax + dx * t, py = ay + dy * t;
    const d = dist(hero.x, hero.y, px, py);
    if (!best || d < best.d) best = { d, s: cum + Math.sqrt(l2) * t };
    cum += Math.sqrt(l2);
  }
  if (!best) return null;
  let target = clamp(best.s + ahead, 0, cum);
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1][0], ay = path[i - 1][1];
    const bx = path[i][0], by = path[i][1];
    const seg = dist(ax, ay, bx, by);
    if (walked + seg >= target) {
      const k = seg === 0 ? 0 : (target - walked) / seg;
      return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k };
    }
    walked += seg;
  }
  return { x: path[path.length - 1][0], y: path[path.length - 1][1] };
}

function followLane(game, hero) {
  const path = hero.pathPoints;
  if (!path || !path.length) return;
  let look = laneLook(hero, path, 480);
  if (hero.pathIndex >= path.length - 1) {
    const s = game.findNearestVulnerableStructure(hero.team, hero.x, hero.y, 1400);
    if (s) look = { x: s.x, y: s.y };
  }
  if (!look) return;
  hero.attackTargetId = null;
  if (towerDanger(game, hero, look.x, look.y)) {
    if (towerDanger(game, hero, hero.x, hero.y)) {
      const back = laneLook(hero, path, -180);
      if (back) hero.moveTarget = { x: back.x, y: back.y };
    } else {
      hero.moveTarget = null;
    }
    return;
  }
  hero.moveTarget = { x: look.x + rand(-24, 24), y: look.y + rand(-24, 24) };
}

function useDefensive(game, hero, enemy, prof) {
  const base = TEAMS[hero.team].base;
  const away = angleTo(hero.x, hero.y, base.x, base.y);
  for (let i = 0; i < 4; i++) {
    const ab = hero.def.abilities[i];
    if (!ab || hero.ranks[i] <= 0 || hero.cd[i] > 0 || hero.mp < ab.mana) continue;
    if (!DEFENSIVE_KINDS.includes(ab.kind)) continue;
    if (ab.kind === 'healAlly' || ab.kind === 'shieldAlly') {
      game.castAbility(hero, i, null, hero);
    } else if (ab.kind === 'blink' || ab.kind === 'dash' || ab.kind === 'leap') {
      game.castAbility(hero, i, { x: hero.x + Math.cos(away) * (ab.range || 300), y: hero.y + Math.sin(away) * (ab.range || 300) });
    } else {
      game.castAbility(hero, i, null, null);
    }
    if (enemy && enemy.alive) break;
  }
}

function useOffensive(game, hero, target, prof) {
  const d = dist(hero.x, hero.y, target.x, target.y);
  const lead = 0.28;
  const err = prof.aimError || 30;
  const predicted = {
    x: target.x + (target.vx || 0) * lead + rand(-err, err),
    y: target.y + (target.vy || 0) * lead + rand(-err, err),
  };
  const order = [3, 0, 1, 2];
  for (const i of order) {
    const ab = hero.def.abilities[i];
    if (!ab || hero.ranks[i] <= 0 || hero.cd[i] > 0 || hero.mp < ab.mana) continue;
    if (!SKILL_KINDS_DAMAGE.includes(ab.kind)) continue;
    if (ab.kind === 'execute') {
      if (d > ab.range + target.radius) continue;
      if (target.hp / target.maxHp > 0.7 && Math.random() < 0.5) continue;
      game.castAbility(hero, i, { x: target.x, y: target.y }, target);
      return;
    }
    const range = ab.range || 300;
    if (ab.kind === 'dash' || ab.kind === 'leap') {
      if (d < 140 || d > range * 0.95) continue;
      game.castAbility(hero, i, predicted, null);
      return;
    }
    if (d > range + target.radius) continue;
    if (ab.ult && Math.random() < 0.2) continue;
    game.castAbility(hero, i, predicted, null);
    return;
  }
  if (hero.ranks[3] > 0 && hero.cd[3] <= 0) return;
  for (let i = 0; i < 4; i++) {
    const ab = hero.def.abilities[i];
    if (!ab || hero.ranks[i] <= 0 || hero.cd[i] > 0 || hero.mp < ab.mana) continue;
    if (ab.kind === 'selfBuff' || ab.kind === 'auraShield' || ab.kind === 'stealth') {
      if (d < 360) game.castAbility(hero, i, null, null);
      return;
    }
  }
}
