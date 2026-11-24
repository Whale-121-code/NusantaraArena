import { dist } from './utils.js';

const SKILL_CODES = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 };
const MOVE_CODES = { KeyW: [0, -1], KeyA: [-1, 0], KeyS: [0, 1], KeyD: [1, 0], ArrowUp: [0, -1], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowRight: [1, 0] };

export class InputController {
  constructor(renderer, hooks) {
    this.renderer = renderer;
    this.hooks = hooks;
    this.game = null;
    this.enabled = false;
    this.rightDown = false;
    this.lastMoveCmd = 0;
    this.skillHeld = -1;
    this.pointerAiming = false;
    this.moveKeys = new Set();
    this.wasdMoving = false;
    this.lastDir = { x: 0, y: -1 };
    this.pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.bind();
  }

  setGame(game) {
    this.game = game;
    this.enabled = true;
    this.skillHeld = -1;
    this.pointerAiming = false;
    this.moveKeys.clear();
    this.wasdMoving = false;
    this.renderer.aim = null;
  }

  disable() {
    this.enabled = false;
    this.rightDown = false;
    this.skillHeld = -1;
    this.pointerAiming = false;
    this.moveKeys.clear();
    this.wasdMoving = false;
    if (this.renderer) this.renderer.aim = null;
  }

  update() {
    if (!this.enabled || !this.game) return;
    const active = this.hooks.isGameplayActive?.() ?? true;
    let x = 0, y = 0;
    for (const code of this.moveKeys) {
      const v = MOVE_CODES[code];
      if (v) { x += v[0]; y += v[1]; }
    }
    if (!x && !y) {
      if (this.wasdMoving) {
        this.wasdMoving = false;
        const p = this.game.player;
        if (active && p && p.alive && !this.game.over) this.game.commandStop();
      }
      return;
    }
    if (!active) return;
    const p = this.game.player;
    if (!p || !p.alive || this.game.over) return;
    const len = Math.hypot(x, y) || 1;
    this.game.commandMove(p.x + (x / len) * 240, p.y + (y / len) * 240);
    this.wasdMoving = true;
  }

  bind() {
    const canvas = this.renderer.canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointermove', (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.renderer.mouse.x = e.clientX;
      this.renderer.mouse.y = e.clientY;
      if (this.skillHeld >= 0) this.updateAim();
      if (this.rightDown && this.enabled) {
        const now = performance.now();
        if (now - this.lastMoveCmd > 80) {
          this.lastMoveCmd = now;
          this.moveOrAttack();
        }
      }
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.button === 2) {
        this.rightDown = true;
        this.moveOrAttack();
      } else if (e.button === 0) {
        const unit = this.unitAt(e.clientX, e.clientY);
        if (unit && unit.team !== this.game.playerTeam) {
          this.game.commandAttack(unit);
          this.renderer.fxPing?.(unit.x, unit.y);
        }
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 2) this.rightDown = false;
    });
    window.addEventListener('blur', () => {
      this.rightDown = false;
      this.moveKeys.clear();
      this.cancelAim();
    });
    canvas.addEventListener('pointerleave', () => { this.rightDown = false; });

    canvas.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const next = this.renderer.userZoom * (e.deltaY > 0 ? 0.92 : 1.08);
      this.renderer.userZoom = Math.max(0.72, Math.min(1.35, next));
    }, { passive: false });

    window.addEventListener('pointermove', (e) => {
      this.pointer.x = e.clientX; this.pointer.y = e.clientY;
      this.renderer.mouse.x = e.clientX; this.renderer.mouse.y = e.clientY;
      if (this.skillHeld >= 0 && this.pointerAiming) this.updateAim();
    });
    window.addEventListener('pointerup', (e) => {
      if (this.skillHeld >= 0 && this.pointerAiming) this.releaseAim();
    });
    window.addEventListener('pointercancel', () => this.cancelAim());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  onKeyDown(e) {
    if (e.repeat) {
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      e.preventDefault();
      this.cancelAim();
      this.hooks.onEscape?.();
      return;
    }
    if (key === 'f1') {
      e.preventDefault();
      this.hooks.onHelp?.();
      return;
    }
    if (!this.enabled) return;
    const active = this.hooks.isGameplayActive?.() ?? true;
    if (!active) return;

    const dir = MOVE_CODES[e.code];
    if (dir) {
      e.preventDefault();
      this.moveKeys.add(e.code);
      this.lastDir = { x: dir[0], y: dir[1] };
      return;
    }
    if (key === 'tab') {
      e.preventDefault();
      this.hooks.onScoreboard?.(true);
      return;
    }
    if (key === 'p' || key === 'h') {
      e.preventDefault();
      this.hooks.onShop?.();
      return;
    }
    if (key === 'b') {
      e.preventDefault();
      this.game.commandRecall();
      return;
    }
    if (key === 'r') {
      e.preventDefault();
      this.game.commandRegen();
      return;
    }
    if (key === 'x') {
      e.preventDefault();
      this.game.commandStop();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      this.basicAttack();
      return;
    }
    const skill = SKILL_CODES[e.code];
    if (skill !== undefined) {
      e.preventDefault();
      if (e.shiftKey) {
        this.game.commandUpgrade(skill);
        this.hooks.onSkillUpgrade?.(skill);
        return;
      }
      const p = this.game.player;
      if (!p || !p.alive) return;
      if (p.ranks[skill] <= 0) {
        this.hooks.onSkillLocked?.(skill);
        return;
      }
      this.skillHeld = skill;
      this.pointerAiming = false;
      this.renderer.mouse.x = this.pointer.x;
      this.renderer.mouse.y = this.pointer.y;
      this.updateAim();
    }
  }

  onKeyUp(e) {
    if (MOVE_CODES[e.code]) {
      this.moveKeys.delete(e.code);
      return;
    }
    if (!this.enabled) return;
    const key = e.key.toLowerCase();
    if (key === 'tab') {
      this.hooks.onScoreboard?.(false);
      return;
    }
    const skill = SKILL_CODES[e.code];
    if (skill !== undefined && this.skillHeld === skill) {
      this.skillHeld = -1;
      this.castAtCursor(skill);
    }
  }

  beginAim(index, clientX, clientY) {
    if (!this.enabled || !this.game?.player?.alive) return;
    const p = this.game.player;
    if (p.ranks[index] <= 0) { this.hooks.onSkillLocked?.(index); return; }
    this.skillHeld = index;
    this.pointerAiming = true;
    if (Number.isFinite(clientX)) this.pointer.x = clientX;
    if (Number.isFinite(clientY)) this.pointer.y = clientY;
    this.renderer.mouse.x = this.pointer.x;
    this.renderer.mouse.y = this.pointer.y;
    this.updateAim();
  }

  releaseAim() {
    if (this.skillHeld < 0) return;
    const index = this.skillHeld;
    this.skillHeld = -1;
    this.pointerAiming = false;
    this.castAtCursor(index, true);
  }

  castAtCursor(index, forcePointerAim = false) {
    const game = this.game;
    const p = game.player;
    if (!p || !p.alive) return;
    const ability = p.def.abilities[index];
    if (!ability) return;
    const world = this.aimPoint(p, ability, forcePointerAim);
    let target = null;
    if (['healAlly', 'shieldAlly'].includes(ability.kind)) {
      const u = this.unitAt(this.pointer.x, this.pointer.y);
      if (u && u.team === p.team && u.kind === 'hero') target = u;
      else target = game.nearestAlly(p, 900);
    } else if (ability.kind === 'execute') {
      const u = this.unitAt(this.pointer.x, this.pointer.y);
      if (u && u.team !== p.team) target = u;
    }
    const ok = game.commandCast(index, world, target);
    if (ok) {
      this.renderer.aim = null;
      this.hooks.onCast?.(index, ability);
    } else {
      this.hooks.onCastFail?.(index);
      this.renderer.aim = null;
    }
  }

  aimPoint(p, ability, forcePointerAim = false) {
    if (ability.aim === 'dir' || ability.ult) {
      const range = (ability.range || 500) * (ability.ult ? 0.9 : 1);
      if (this.pointerAiming || forcePointerAim) {
        const cursor = this.renderer.screenToWorld(this.pointer.x, this.pointer.y);
        let dx = cursor.x - p.x, dy = cursor.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        return { x: p.x + dx * range, y: p.y + dy * range };
      }
      return { x: p.x + this.lastDir.x * range, y: p.y + this.lastDir.y * range };
    }
    return this.renderer.screenToWorld(this.pointer.x, this.pointer.y);
  }

  updateAim() {
    const p = this.game?.player;
    if (!p || !p.alive || this.skillHeld < 0) return;
    const ability = p.def.abilities[this.skillHeld];
    if (!ability) return;
    const world = this.aimPoint(p, ability, forcePointerAim);
    this.renderer.aim = { index: this.skillHeld, ability, wx: world.x, wy: world.y };
  }

  cancelAim() {
    this.skillHeld = -1;
    this.pointerAiming = false;
    if (this.renderer) this.renderer.aim = null;
  }

  moveOrAttack() {
    const game = this.game;
    if (!game || !game.player.alive) return;
    const unit = this.unitAt(this.pointer.x, this.pointer.y);
    if (unit && unit.team !== game.playerTeam) {
      game.commandAttack(unit);
      this.hooks.onTarget?.();
    } else {
      const world = this.renderer.screenToWorld(this.pointer.x, this.pointer.y);
      game.commandMove(world.x, world.y);
    }
  }

  basicAttack() {
    const game = this.game;
    const p = game.player;
    if (!p.alive) return;
    const target = typeof game.findAutoAttackTarget === 'function'
      ? game.findAutoAttackTarget(p)
      : null;
    if (target) game.commandAttack(target);
    else {
      const enemy = this.nearestEnemy(p);
      if (enemy) game.commandAttack(enemy);
    }
  }

  nearestEnemy(p) {
    let best = null;
    let bestD = 900;
    for (const u of this.game.units) {
      if (!u.alive || u.team === p.team) continue;
      if (!this.game.canPlayerSee(u)) continue;
      const d = dist(p.x, p.y, u.x, u.y);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  unitAt(sx, sy) {
    const game = this.game;
    if (!game) return null;
    const w = this.renderer.screenToWorld(sx, sy);
    let best = null;
    let bestD = Infinity;
    const pick = (u, extra) => {
      if (!u.alive) return;
      if (u.team !== game.playerTeam && !game.canPlayerSee(u)) return;
      const d = Math.hypot(w.x - u.x, w.y - (u.y - 8));
      const r = u.radius + extra;
      if (d <= r && d < bestD) { bestD = d; best = u; }
    };
    for (const u of game.units) {
      if (u.kind === 'hero') pick(u, 16);
      else if (u.kind === 'minion' || u.kind === 'camp') pick(u, 10);
    }
    for (const s of game.structures) {
      if (s.alive) pick(s, 14);
    }
    return best;
  }
}
