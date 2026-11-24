import { DIFFICULTY, HEROES, HERO_IDS, HERO_LIST, ITEMS, ITEM_MAP, LANE_INFO, LORE_TIPS, ROLE_INFO, TEAMS } from './data.js';
import { formatTime } from './utils.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icon = (name, cls = '') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;


const ITEM_SKINS = {
  warblade:['⚔️','#c98b4b'], boots:['🥾','#7cb6d9'], barongShield:['🛡️','#54c99a'],
  vampfang:['🦷','#d95d76'], arcaneTome:['📜','#a88be8'], frostStaff:['🪄','#83dce8'],
  dragonEdge:['🐉','#e58c4e'], titanBelt:['⛓️','#a5a5b4'], grail:['🏆','#e5c36b'],
  stormCloak:['🌩️','#6e9fd8'], demonBlade:['🗡️','#c75b68'], immortalArmor:['🛡️','#d1b77c'],
  soulGem:['💎','#b27be8'], wings:['🪽','#77d4e6'], berserker:['🪓','#db8950'],
  moonAmulet:['🌙','#9e8de2'], ironRoot:['🪨','#9b9b82'], sunSpear:['🔱','#edb64f'],
  mistBoots:['🌫️','#8ab8cb'], spiritLantern:['🏮','#e9a45a'], krisEternal:['🔪','#d98b59'],
  guardianShell:['🐚','#6cb8aa'], windTalisman:['🌀','#79c9dd'],
};
const itemVisual = (item, cls='') => {
  const [glyph, tint] = ITEM_SKINS[item.id] || ['✦','#d8bd78'];
  return `<span class="item-visual ${cls}" style="--item-tint:${tint}" aria-hidden="true">${glyph}</span>`;
};

const SKILL_KEYS = ['1', '2', '3', '4'];
const ABILITY_ICON_FALLBACK = { projectile: 'arrow', aoe: 'rain', zone: 'storm', dash: 'dash', leap: 'leap', blink: 'blink', cone: 'fan', selfBuff: 'pulse', auraShield: 'shield', healAlly: 'heal', shieldAlly: 'shield', stealth: 'smoke', execute: 'skull' };

export class UI {
  constructor() {
    this.game = null;
    this.renderer = null;
    this.actions = {};
    this.screen = 'menu';
    this.difficulty = 'normal';
    this.selectedHero = 'garuda';
    this.selectedLane = HEROES.garuda.lane;
    this.modal = null;
    this.feed = [];
    this.announces = [];
    this.toasts = [];
    this.tipTimer = null;
    this.tipIndex = 0;
    this.fps = 60;
    this.itemSig = '';
    this.skillEls = [];
    this.updateAcc = 0;
    this.menuDiff = 'normal';
    this.cache();
    this.buildStatic();
  }

  cache() {
    this.screens = {
      menu: $('screen-menu'),
      select: $('screen-select'),
      loading: $('screen-loading'),
      game: $('screen-game'),
      results: $('screen-results'),
    };
    this.el = {
      menuTip: $('menu-tip-text'),
      menuModeLabel: $('menu-mode-label'),
      heroGrid: $('hero-grid'),
      showroomImg: $('showroom-img'),
      showroomGlow: $('showroom-glow'),
      showroomRole: $('showroom-role'),
      showroomName: $('showroom-name'),
      showroomTitle: $('showroom-title'),
      showroomLore: $('showroom-lore'),
      showroomPassive: $('showroom-passive'),
      showroomStats: $('showroom-stats'),
      heroKit: $('hero-kit'),
      lanePicker: $('lane-picker'),
      laneRecommend: $('lane-recommend'),
      teamPreview: $('team-preview'),
      loadingFill: $('loading-fill'),
      loadingTip: $('loading-tip'),
      loadingVs: $('loading-vs'),
      scoreBlue: $('score-blue'),
      scoreRed: $('score-red'),
      matchTime: $('match-time'),
      matchPhase: $('match-phase'),
      killfeed: $('killfeed'),
      announceLayer: $('announce-layer'),
      toastLayer: $('toast-layer'),
      barHp: $('bar-hp'),
      barShield: $('bar-shield'),
      barMp: $('bar-mp'),
      barXp: $('bar-xp'),
      hpText: $('hp-text'),
      mpText: $('mp-text'),
      xpText: $('xp-text'),
      heroLevel: $('hero-level'),
      heroNameHud: $('hero-name-hud'),
      heroRoleHud: $('hero-role-hud'),
      heroPortrait: $('hero-portrait'),
      heroQuickstats: $('hero-quickstats'),
      skillRow: $('skill-row'),
      itemSlots: $('item-slots'),
      goldAmount: $('gold-amount'),
      shopGold: $('shop-gold'),
      deathOverlay: $('death-overlay'),
      respawnTimer: $('respawn-timer'),
      recallRing: $('recall-ring'),
      regenRing: $('regen-ring'),
      regenBtn: $('btn-regen'),
      regenCd: $('regen-cd'),
      minimapLane: $('minimap-lane'),
      fpsTag: $('fps-tag'),
      minimapFps: $('minimap-fps'),
      shopGrid: $('shop-grid'),
      shopOwned: $('shop-owned'),
      shopSlotCount: $('shop-slot-count'),
      scoreboard: $('scoreboard'),
      scoreMini: $('score-mini'),
      resultTable: $('result-table'),
      resultMvp: $('result-mvp'),
      resultVerdict: $('result-verdict'),
      resultSub: $('result-sub'),
      resultKicker: $('result-kicker'),
      resultsScreen: $('screen-results'),
      resultsBurst: $('results-burst'),
    };
    this.skillEls = [];
  }

  buildStatic() {
    this.buildEmbers();
    this.buildHeroGrid();
    this.buildShop();
    this.bindMenu();
    this.bindSelect();
    this.startTips();
  }

  setActions(actions) {
    this.actions = actions;
  }

  // ---------------- screens ----------------
  showScreen(name) {
    this.screen = name;
    for (const [key, el] of Object.entries(this.screens)) {
      if (!el) continue;
      el.classList.toggle('is-active', key === name);
    }
    if (name === 'game') {
      if (this.actions.onEnterGame) this.actions.onEnterGame();
    }
    if (name !== 'menu') this.stopTips();
  }

  openModal(name) {
    const map = { shop: 'overlay-shop', scoreboard: 'overlay-scoreboard', help: 'overlay-help', pause: 'overlay-pause', 'menu-settings': 'overlay-menu-settings' };
    const el = $(map[name]);
    if (!el) return;
    el.classList.add('is-open');
    this.modal = name;
    if (name === 'shop') this.renderShop();
    if (name === 'scoreboard') this.renderScoreboard();
    if (this.actions.onModalOpen) this.actions.onModalOpen(name);
  }

  closeModal(name) {
    const map = { shop: 'overlay-shop', scoreboard: 'overlay-scoreboard', help: 'overlay-help', pause: 'overlay-pause', 'menu-settings': 'overlay-menu-settings' };
    const target = name || this.modal;
    if (!target) return;
    const el = $(map[target]);
    if (el) el.classList.remove('is-open');
    if (this.modal === target) this.modal = null;
    if (this.actions.onModalClose) this.actions.onModalClose(target);
  }

  isModalOpen() {
    return !!this.modal;
  }

  // ---------------- menu ----------------
  buildEmbers() {
    const wrap = $('menu-embers');
    if (!wrap) return;
    for (let i = 0; i < 34; i++) {
      const e = document.createElement('span');
      e.className = 'ember';
      e.style.left = `${Math.random() * 100}%`;
      e.style.bottom = `${-5 + Math.random() * 30}%`;
      e.style.animationDuration = `${9 + Math.random() * 12}s`;
      e.style.animationDelay = `${-Math.random() * 18}s`;
      e.style.width = e.style.height = `${1.5 + Math.random() * 2.6}px`;
      wrap.appendChild(e);
    }
  }

  bindMenu() {
    document.querySelectorAll('.mode-chip').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.mode-chip').forEach((x) => x.classList.remove('is-active'));
        b.classList.add('is-active');
        this.menuDiff = b.dataset.diff;
        this.difficulty = b.dataset.diff;
        this.syncDiffChips();
        const info = DIFFICULTY[this.menuDiff];
        if (this.el.menuModeLabel) this.el.menuModeLabel.textContent = info.name;
        if (this.actions.onClick) this.actions.onClick();
      });
      b.addEventListener('mouseenter', () => this.actions.onHover?.());
    });
    $('btn-play')?.addEventListener('click', () => {
      this.actions.onClick?.();
      this.actions.onPlay?.();
    });
    $('btn-menu-help')?.addEventListener('click', () => { this.actions.onClick?.(); this.openModal('help'); });
    $('btn-menu-settings')?.addEventListener('click', () => { this.actions.onClick?.(); this.openModal('menu-settings'); });
    $('btn-menu-help')?.addEventListener('mouseenter', () => this.actions.onHover?.());
    $('btn-menu-settings')?.addEventListener('mouseenter', () => this.actions.onHover?.());
    this.bindModalClose();
  }

  bindModalClose() {
    document.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => {
        this.actions.onClick?.();
        const name = b.dataset.close;
        this.closeModal(name);
        if (name === 'pause') this.actions.onResume?.();
        if (name === 'help') this.actions.afterHelpClose?.();
      });
    });
    document.querySelectorAll('.modal-backdrop').forEach((bd) => {
      bd.addEventListener('pointerdown', (e) => {
        if (e.target !== bd) return;
        const name = bd.id.replace('overlay-', '');
        this.closeModal(name);
        if (name === 'pause') this.actions.onResume?.();
        if (name === 'help') this.actions.afterHelpClose?.();
      });
    });
  }

  startTips() {
    this.stopTips();
    this.tipIndex = Math.floor(Math.random() * LORE_TIPS.length);
    const set = () => {
      if (!this.el.menuTip) return;
      this.el.menuTip.textContent = LORE_TIPS[this.tipIndex % LORE_TIPS.length];
      this.tipIndex++;
    };
    set();
    this.tipTimer = setInterval(set, 7000);
  }

  stopTips() {
    if (this.tipTimer) clearInterval(this.tipTimer);
    this.tipTimer = null;
  }

  // ---------------- hero select ----------------
  buildHeroGrid() {
    if (!this.el.heroGrid) return;
    this.el.heroGrid.innerHTML = '';
    for (const h of HERO_LIST) {
      const card = document.createElement('button');
      card.className = 'hero-card';
      card.dataset.hero = h.id;
      card.innerHTML = `
        <img src="${h.portrait}" alt="${esc(h.name)}" draggable="false" />
        <span class="hc-role">${esc(ROLE_INFO[h.roleId].name)}</span>
        <span class="hc-name">${esc(h.name)}</span>`;
      card.addEventListener('click', () => {
        this.actions.onClick?.();
        this.selectHero(h.id);
      });
      card.addEventListener('mouseenter', () => this.actions.onHover?.());
      this.el.heroGrid.appendChild(card);
    }
  }

  bindSelect() {
    $('btn-select-back')?.addEventListener('click', () => { this.actions.onClick?.(); this.actions.onBackMenu?.(); });
    document.querySelectorAll('#select-diff-chips button').forEach((b) => {
      b.addEventListener('click', () => {
        this.actions.onClick?.();
        this.difficulty = b.dataset.diff;
        this.menuDiff = b.dataset.diff;
        this.syncDiffChips();
      });
    });
    this.el.lanePicker?.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        this.actions.onClick?.();
        this.selectedLane = b.dataset.lane;
        this.updateLaneUI();
      });
    });
    $('btn-start-match')?.addEventListener('click', () => {
      this.actions.onClick?.();
      this.actions.onStartMatch?.(this.getSelection());
    });
    const showroom = $('showroom');
    if (showroom) {
      showroom.addEventListener('mousemove', (e) => {
        const r = showroom.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        const wrap = $('showroom-img-wrap');
        if (wrap) wrap.style.transform = `translate(${nx * 10}px, ${ny * 8}px) rotateY(${nx * 3}deg)`;
      });
      showroom.addEventListener('mouseleave', () => {
        const wrap = $('showroom-img-wrap');
        if (wrap) wrap.style.transform = '';
      });
    }
  }

  syncDiffChips() {
    document.querySelectorAll('.mode-chip').forEach((x) => x.classList.toggle('is-active', x.dataset.diff === this.difficulty));
    document.querySelectorAll('#select-diff-chips button').forEach((x) => x.classList.toggle('is-active', x.dataset.diff === this.difficulty));
    if (this.el.menuModeLabel) this.el.menuModeLabel.textContent = DIFFICULTY[this.difficulty].name;
  }

  selectHero(id) {
    this.selectedHero = id;
    const h = HEROES[id];
    this.selectedLane = h.lane;
    document.querySelectorAll('.hero-card').forEach((c) => c.classList.toggle('is-active', c.dataset.hero === id));
    if (this.el.showroomImg) {
      this.el.showroomImg.src = h.portrait;
      this.el.showroomImg.alt = h.name;
    }
    if (this.el.showroomGlow) {
      this.el.showroomGlow.style.background = `radial-gradient(circle, ${h.color}77, transparent 65%)`;
    }
    if (this.el.showroomRole) this.el.showroomRole.textContent = `${ROLE_INFO[h.roleId].name} · ${ROLE_INFO[h.roleId].desc}`;
    if (this.el.showroomName) this.el.showroomName.textContent = h.name;
    if (this.el.showroomTitle) this.el.showroomTitle.textContent = h.title;
    if (this.el.showroomLore) this.el.showroomLore.textContent = h.lore;
    if (this.el.showroomPassive) {
      this.el.showroomPassive.innerHTML = `<div class="sp-icon">${icon('gem')}</div><div><b>PASIF · ${esc(h.passive.name)}</b><span>${esc(h.passive.desc)}</span></div>`;
    }
    this.renderHeroStats(h);
    this.renderHeroKit(h);
    this.updateLaneUI();
    this.renderTeamPreview(h);
    this.syncDiffChips();
  }

  renderHeroStats(h) {
    if (!this.el.showroomStats) return;
    const atk = Math.round(((h.stats.atk - 45) / 40) * 100);
    const def = Math.round(((h.stats.armor - 12) / 16) * 100);
    const spd = Math.round(((h.stats.speed - 300) / 50) * 100);
    const diff = Math.round((h.difficulty / 3) * 100);
    const rows = [
      ['Serangan', atk, h.stats.atk],
      ['Ketahanan', def, h.stats.armor],
      ['Kecepatan', spd, h.stats.speed],
      ['Kesulitan', diff, ['', 'Rendah', 'Sedang', 'Tinggi'][h.difficulty]],
    ];
    this.el.showroomStats.innerHTML = rows.map(([label, pct, val]) => `
      <div class="stat-line"><span>${label}</span><div class="stat-bar"><i style="width:${Math.max(6, Math.min(100, pct))}%"></i></div><b>${val}</b></div>`).join('');
  }

  renderHeroKit(h) {
    if (!this.el.heroKit) return;
    const passive = `<div class="ability-row">
      <div class="ab-icon"><span class="ab-key passive">P</span>${icon('gem')}</div>
      <div class="ab-info"><b>${esc(h.passive.name)}</b><p>${esc(h.passive.desc)}</p></div>
    </div>`;
    const rows = h.abilities.map((ab, i) => {
      const cdv = Array.isArray(ab.cooldown) ? ab.cooldown[0] : ab.cooldown;
      return `<div class="ability-row">
        <div class="ab-icon"><span class="ab-key">${SKILL_KEYS[i]}</span>${icon(ab.icon || ABILITY_ICON_FALLBACK[ab.kind] || 'bolt')}</div>
        <div class="ab-info"><b>${esc(ab.name)}</b><p>${esc(ab.desc)}</p>
          <div class="ab-meta"><span>CD <i>${cdv}s</i></span><span>MANA <i>${ab.mana}</i></span></div>
        </div>
      </div>`;
    }).join('');
    this.el.heroKit.innerHTML = passive + rows;
  }

  updateLaneUI() {
    if (this.el.lanePicker) {
      this.el.lanePicker.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.lane === this.selectedLane));
    }
    if (this.el.laneRecommend) {
      const rec = HEROES[this.selectedHero].lane;
      this.el.laneRecommend.textContent = `Rekomendasi: ${LANE_INFO[rec].name}`;
    }
  }

  renderTeamPreview(h) {
    if (!this.el.teamPreview) return;
    const others = HERO_IDS.filter((id) => id !== h.id).slice(0, 4);
    const avatars = others.map((id) => `<img src="${HEROES[id].portrait}" alt="${esc(HEROES[id].name)}" />`).join('');
    this.el.teamPreview.innerHTML = `<span>SEKUTUMU</span><div class="tp-avatars">${avatars}</div>`;
  }

  getSelection() {
    return { heroId: this.selectedHero, difficulty: this.difficulty, lane: this.selectedLane };
  }

  // ---------------- loading ----------------
  showLoading(selection, onDone) {
    const h = HEROES[selection.heroId];
    if (this.el.loadingVs) {
      this.el.loadingVs.innerHTML = `<span class="team blue">TIM BIRU</span><span class="vs">VS</span><span class="team red">TIM MERAH</span>`;
    }
    if (this.el.loadingTip) this.el.loadingTip.textContent = LORE_TIPS[Math.floor(Math.random() * LORE_TIPS.length)];
    this.showScreen('loading');
    let p = 0;
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      const target = Math.min(100, (elapsed / 1500) * 100);
      p += (target - p) * 0.18;
      if (this.el.loadingFill) this.el.loadingFill.style.width = `${Math.min(100, p)}%`;
      if (p < 99.2) requestAnimationFrame(tick);
      else {
        if (this.el.loadingFill) this.el.loadingFill.style.width = '100%';
        setTimeout(onDone, 180);
      }
    };
    requestAnimationFrame(tick);
  }

  // ---------------- game init ----------------
  initGame(game, renderer) {
    this.game = game;
    this.renderer = renderer;
    this.itemSig = '';
    this.feed = [];
    this.announces = [];
    this.toasts = [];
    if (this.el.heroPortrait) {
      this.el.heroPortrait.querySelector('img').src = game.player.def.portrait;
      this.el.heroPortrait.querySelector('img').alt = game.player.def.name;
    }
    if (this.el.heroNameHud) this.el.heroNameHud.textContent = game.player.def.name;
    if (this.el.heroRoleHud) this.el.heroRoleHud.textContent = ROLE_INFO[game.player.def.roleId].name;
    if (this.el.minimapLane) this.el.minimapLane.textContent = LANE_INFO[game.playerLane]?.name || 'JALUR';
    this.buildSkillBar(game.player);
    this.buildItemBar();
    this.bindGameButtons();
    this.updateHUD(0, true);
    this.destroyAnnouncements();
    this.el.killfeed.innerHTML = '';
    this.el.toastLayer.innerHTML = '';
  }

  bindGameButtons() {
    if (this._gameBound) return;
    this._gameBound = true;
    $('btn-pause')?.addEventListener('click', () => { this.actions.onClick?.(); this.actions.onPause?.(); });
    $('btn-help')?.addEventListener('click', () => { this.actions.onClick?.(); this.actions.onHelp?.(); });
    $('btn-shop')?.addEventListener('click', () => { this.actions.onClick?.(); this.actions.onShop?.(); });
    $('btn-recall')?.addEventListener('click', () => { this.actions.onClick?.(); this.actions.onRecall?.(); });
    $('btn-regen')?.addEventListener('click', () => { this.actions.onClick?.(); this.actions.onRegen?.(); });
    $('btn-stop')?.addEventListener('click', () => { this.actions.onClick?.(); this.actions.onStop?.(); });
    $('btn-attack')?.addEventListener('click', () => { this.actions.onClick?.(); this.actions.onBasicAttack?.(); });
    $('btn-resume')?.addEventListener('click', () => { this.actions.onClick?.(); this.closeModal('pause'); this.actions.onResume?.(); });
    $('btn-pause-help')?.addEventListener('click', () => { this.actions.onClick?.(); this.closeModal('pause'); this.openModal('help'); });
    $('btn-quit')?.addEventListener('click', () => { this.actions.onClick?.(); this.actions.onQuit?.(); });
    $('btn-rematch')?.addEventListener('click', () => { this.actions.onClick?.(); this.actions.onRematch?.(); });
    $('btn-results-menu')?.addEventListener('click', () => { this.actions.onClick?.(); this.actions.onMenu?.(); });
    document.querySelectorAll('#shop-tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        this.actions.onClick?.();
        document.querySelectorAll('#shop-tabs button').forEach((x) => x.classList.remove('is-active'));
        b.classList.add('is-active');
        this.shopCategory = b.dataset.cat;
        this.renderShop();
      });
    });
    // clicking a modal backdrop closes it (bound once at startup via bindModalClose)
    $('btn-pause-settings-reset')?.addEventListener('click', () => { this.actions.onClick?.(); this.actions.onResetSettings?.(); });
  }

  buildSkillBar(player) {
    if (!this.el.skillRow) return;
    this.skillEls = [];
    this.el.skillRow.innerHTML = '';
    player.def.abilities.forEach((ab, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `skill-card${ab.ult ? ' ult' : ''} locked`;
      card.dataset.skill = String(i);
      card.title = `${ab.name} — ${ab.desc}`;
      card.innerHTML = `
        <div class="sk-icon">${icon(ab.icon || ABILITY_ICON_FALLBACK[ab.kind] || 'bolt')}</div>
        <span class="sk-key">${SKILL_KEYS[i]}</span>
        <div class="sk-rank"></div>
        <div class="sk-name">${esc(ab.name)}</div>
        <span class="sk-cost">${ab.mana}</span>
        <div class="sk-cd"></div>
        <span class="sk-levelup" title="Naikkan level skill">+</span>`;
      card.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.sk-levelup')) return;
        e.preventDefault();
        this.actions.onSkillStart?.(i, e.clientX, e.clientY);
      });
      card.addEventListener('click', (e) => {
        if (e.target.closest('.sk-levelup')) {
          e.stopPropagation();
          this.actions.onClick?.();
          this.actions.onUpgradeSkill?.(i);
        } else if (e.detail === 0) {
          this.actions.onSkillClick?.(i);
        }
      });
      card.addEventListener('mouseenter', () => this.actions.onHover?.());
      this.el.skillRow.appendChild(card);
      this.skillEls.push({
        card,
        cd: card.querySelector('.sk-cd'),
        rank: card.querySelector('.sk-rank'),
        cost: card.querySelector('.sk-cost'),
        plus: card.querySelector('.sk-levelup'),
      });
    });
  }

  buildItemBar() {
    if (!this.el.itemSlots) return;
    this.el.itemSlots.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'item-slot empty';
      slot.dataset.index = String(i);
      slot.addEventListener('click', () => {
        this.actions.onClick?.();
        this.actions.onShop?.();
      });
      this.el.itemSlots.appendChild(slot);
    }
  }

  updateItemBar(force = false) {
    const p = this.game?.player;
    if (!p) return;
    const sig = p.items.join('|');
    if (!force && sig === this.itemSig) return;
    this.itemSig = sig;
    const slots = this.el.itemSlots.querySelectorAll('.item-slot');
    slots.forEach((slot, i) => {
      const item = ITEM_MAP[p.items[i]];
      slot.className = `item-slot${item ? '' : ' empty'}`;
      if (item) {
        slot.innerHTML = `${itemVisual(item)}<span class="is-name">${esc(item.name)}</span>`;
        slot.title = `${item.name} — ${item.desc}`;
        slot.classList.add('just');
        setTimeout(() => slot.classList.remove('just'), 600);
      } else {
        slot.innerHTML = '';
        slot.title = 'Slot kosong';
      }
    });
  }

  // ---------------- HUD ----------------
  update(dt) {
    if (!this.game) return;
    this.updateAcc += dt;
    if (this.updateAcc >= 0.06) {
      this.updateHUD(dt);
      this.updateAcc = 0;
    }
  }

  updateHUD(dt, force = false) {
    const g = this.game;
    if (!g) return;
    const p = g.player;
    const time = formatTime(g.time);
    if (this.el.matchTime) this.el.matchTime.textContent = time;
    if (this.el.scoreBlue) this.el.scoreBlue.textContent = g.teamKills[0];
    if (this.el.scoreRed) this.el.scoreRed.textContent = g.teamKills[1];
    if (this.el.matchPhase) {
      let phase = 'FASE AWAL';
      if (g.time >= 1200) phase = 'BADAI NUSANTARA';
      else if (g.time >= 900) phase = 'PERTEMPURAN SENGIT';
      else if (g.time >= 300) phase = 'PERTEMPURAN';
      this.el.matchPhase.textContent = phase;
    }
    if (this.el.barHp) this.el.barHp.style.width = `${p.hpPct * 100}%`;
    if (this.el.barMp) this.el.barMp.style.width = `${p.mpPct * 100}%`;
    if (this.el.barXp) this.el.barXp.style.width = `${Math.min(100, (p.xp / p.xpNext) * 100)}%`;
    if (this.el.barShield) this.el.barShield.style.width = `${Math.min(100, (p.shield / p.maxHp) * 100)}%`;
    if (this.el.hpText) this.el.hpText.textContent = `${Math.max(0, Math.round(p.hp))} / ${Math.round(p.maxHp)}`;
    if (this.el.mpText) this.el.mpText.textContent = `${Math.round(p.mp)} / ${Math.round(p.maxMp)}`;
    if (this.el.xpText) this.el.xpText.textContent = `Lv. ${p.level}`;
    if (this.el.heroLevel) this.el.heroLevel.textContent = String(p.level);
    if (this.el.goldAmount) this.el.goldAmount.textContent = String(Math.floor(p.gold));
    if (this.el.heroQuickstats) {
      this.el.heroQuickstats.innerHTML = `<span>ATK <b>${Math.round(p.stats.atk)}</b></span><span>ARM <b>${Math.round(p.stats.armor)}</b></span><span>SPD <b>${Math.round(p.stats.speed)}</b></span><span>REG <b>${p.stats.hpRegen.toFixed(1)}/s</b></span>`;
    }
    this.updateSkillBar(p);
    this.updateItemBar(force);
    if (this.el.deathOverlay) {
      const dead = !p.alive;
      this.el.deathOverlay.classList.toggle('show', dead);
      if (dead && this.el.respawnTimer) this.el.respawnTimer.textContent = String(Math.max(0, Math.ceil(p.respawnT)));
    }
    if (this.el.recallRing) this.el.recallRing.classList.toggle('show', p.recallT > 0);
    if (this.el.regenRing) this.el.regenRing.classList.toggle('show', p.regenT > 0);
    if (this.el.regenBtn) {
      const cooling = p.regenCd > 0 && p.regenT <= 0;
      this.el.regenBtn.classList.toggle('cooling', cooling);
      this.el.regenBtn.classList.toggle('healing', p.regenT > 0);
      this.el.regenBtn.title = cooling ? `Regen siap dalam ${Math.ceil(p.regenCd)} detik` : 'Regen: pulihkan HP & MP (R)';
    }
    if (this.el.regenCd) this.el.regenCd.textContent = p.regenCd > 0 ? String(Math.ceil(p.regenCd)) : '';
    if (this.el.goldAmount) this.el.goldAmount.textContent = String(Math.floor(p.gold));
    if (this.el.shopGold && this.modal === 'shop') this.el.shopGold.textContent = String(Math.floor(p.gold));
    if (this.el.fpsTag) this.el.fpsTag.textContent = this.actions.showFps ? `${Math.round(this.fps)} FPS` : '';
    if (this.el.minimapFps) this.el.minimapFps.textContent = this.actions.showFps ? `${Math.round(this.fps)} FPS` : '';
  }

  updateSkillBar(p) {
    p.def.abilities.forEach((ab, i) => {
      const s = this.skillEls[i];
      if (!s) return;
      const rank = p.ranks[i];
      const cd = p.cd[i];
      const maxCd = Array.isArray(ab.cooldown) ? ab.cooldown[Math.max(0, rank - 1)] || ab.cooldown[0] : ab.cooldown;
      s.card.classList.toggle('locked', rank <= 0);
      s.card.classList.toggle('unaffordable', p.mp < ab.mana);
      const dots = s.rank.querySelectorAll('i');
      if (dots.length !== ab.maxRank) {
        s.rank.innerHTML = Array.from({ length: ab.maxRank }, () => '<i></i>').join('');
      }
      s.rank.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k < rank));
      let text = '';
      if (cd > 0) {
        text = cd >= 1 ? String(Math.ceil(cd)) : cd.toFixed(1);
        const pct = maxCd ? Math.min(100, (cd / maxCd) * 100) : 0;
        s.cd.style.setProperty('--cd', `${pct}%`);
      } else {
        s.cd.style.removeProperty('--cd');
      }
      if (s.cd.textContent !== text) s.cd.textContent = text;
      const canUp = p.canUpgrade(i);
      s.plus.style.display = canUp ? 'grid' : 'none';
      if (rank <= 0) s.cost.textContent = ab.ult ? `Lv ${ab.unlock}` : '—';
      else s.cost.textContent = String(ab.mana);
    });
  }

  // ---------------- events ----------------
  handleEvent(ev) {
    switch (ev.type) {
      case 'announce':
        this.pushAnnounce(ev.text, ev.sub, ev.kind, ev.duration);
        break;
      case 'notice':
        if (ev.text) this.pushToast(ev.text);
        break;
      case 'kill':
        this.pushKillFeed(ev);
        break;
      case 'towerDown':
        if (ev.tower) {
          this.pushToast(ev.nexus ? `${TEAMS[ev.tower.team].short} · Kristal Inti hancur!` : `${ev.tower.name} ${TEAMS[ev.tower.team].short} hancur`);
        }
        break;
      case 'wave':
        this.pushToast(`Gelombang minion #${ev.index} berbaris`);
        break;
      case 'levelUp':
        if (ev.hero?.isPlayer) this.pushToast(`Level ${ev.hero.level}! Poin skill tersedia`);
        break;
      case 'gameOver':
        this.showResults(ev.result);
        break;
      default:
        break;
    }
  }

  pushAnnounce(text, sub = '', kind = 'info', duration = 2.6) {
    if (!this.el.announceLayer) return;
    const el = document.createElement('div');
    el.className = `announce kind-${kind}`;
    el.innerHTML = `<div class="an-text">${esc(text)}</div>${sub ? `<div class="an-sub">${esc(sub)}</div>` : ''}`;
    this.el.announceLayer.appendChild(el);
    this.announces.push(el);
    while (this.announces.length > 2) {
      const old = this.announces.shift();
      old?.remove();
    }
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => {
        el.remove();
        this.announces = this.announces.filter((a) => a !== el);
      }, 420);
    }, duration * 1000);
  }

  destroyAnnouncements() {
    if (this.el.announceLayer) this.el.announceLayer.innerHTML = '';
    this.announces = [];
  }

  pushToast(text) {
    if (!this.el.toastLayer) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.el.toastLayer.appendChild(el);
    this.toasts.push(el);
    while (this.toasts.length > 3) {
      const old = this.toasts.shift();
      old?.remove();
    }
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => {
        el.remove();
        this.toasts = this.toasts.filter((t) => t !== el);
      }, 380);
    }, 2300);
  }

  pushKillFeed(ev) {
    if (!this.el.killfeed) return;
    const el = document.createElement('div');
    el.className = `kf-item${ev.playerKilled || ev.playerKiller ? ' is-player' : ''}`;
    const kTeam = ev.killerTeam === 0 ? 'blue' : ev.killerTeam === 1 ? 'red' : '';
    const kName = ev.killerName || 'Pasukan';
    const vName = ev.victimName || 'Pahlawan';
    el.innerHTML = `<span class="kf-a ${kTeam}">${esc(kName)}</span><span class="kf-icon">⚔</span><span class="kf-v">${esc(vName)}</span>`;
    this.el.killfeed.prepend(el);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild.remove();
    setTimeout(() => {
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 420);
    }, 6500);
  }

  // ---------------- shop ----------------
  buildShop() {
    this.shopCategory = 'all';
    this.renderShop();
  }

  renderShop() {
    if (!this.game) return;
    const p = this.game.player;
    if (this.el.shopGold) this.el.shopGold.textContent = String(Math.floor(p.gold));
    if (!this.el.shopGrid) return;
    const cat = this.shopCategory || 'all';
    const items = ITEMS.filter((i) => cat === 'all' || i.category === cat);
    this.el.shopGrid.innerHTML = items.map((item) => {
      const owned = p.items.includes(item.id);
      const can = !owned && p.gold >= item.cost && p.items.length < 6;
      return `<div class="shop-card${owned ? ' owned' : ''}" data-item="${item.id}">
        <div class="sc-top">
          <div class="sc-icon">${itemVisual(item)}</div>
          <div><div class="sc-name">${esc(item.name)}</div><div class="sc-cat">${item.category}</div></div>
        </div>
        <div class="sc-desc">${esc(item.desc)}</div>
        <div class="sc-bottom">
          <span class="sc-cost">${icon('coin')} ${item.cost}</span>
          <button class="sc-buy" data-buy="${item.id}" ${can ? '' : 'disabled'}>${owned ? 'DIMILIKI' : 'BELI'}</button>
        </div>
      </div>`;
    }).join('');
    this.el.shopGrid.querySelectorAll('[data-buy]').forEach((b) => {
      b.addEventListener('click', () => {
        this.actions.onClick?.();
        this.actions.onBuy?.(b.dataset.buy);
        this.renderShop();
        this.updateHUD(0, true);
      });
    });
    this.renderOwnedItems();
  }

  renderOwnedItems() {
    if (!this.el.shopOwned) return;
    const p = this.game.player;
    if (this.el.shopSlotCount) this.el.shopSlotCount.textContent = `${p.items.length} / 6`;
    if (!p.items.length) {
      this.el.shopOwned.innerHTML = '<div class="shop-owned-empty">Belum ada item.<br>Kalahkan minion dan pahlawan untuk mengumpulkan emas.</div>';
      return;
    }
    this.el.shopOwned.innerHTML = p.items.map((id, i) => {
      const item = ITEM_MAP[id];
      return `<div class="owned-row">
        <div class="or-icon">${itemVisual(item)}</div>
        <div><b>${esc(item.name)}</b><small>${esc(item.desc)}</small></div>
        <button data-sell="${i}">JUAL ${Math.floor(item.cost * 0.6)}</button>
      </div>`;
    }).join('');
    this.el.shopOwned.querySelectorAll('[data-sell]').forEach((b) => {
      b.addEventListener('click', () => {
        this.actions.onClick?.();
        this.actions.onSell?.(Number(b.dataset.sell));
        this.renderShop();
        this.updateHUD(0, true);
      });
    });
  }

  // ---------------- scoreboard ----------------
  renderScoreboard() {
    const g = this.game;
    if (!g || !this.el.scoreboard) return;
    if (this.el.scoreMini) {
      this.el.scoreMini.innerHTML = `<span class="blue">${g.teamKills[0]}</span><span>—</span><span class="red">${g.teamKills[1]}</span>`;
    }
    const order = [0, 1];
    const head = `<div class="score-row head"><span></span><span>PAHLAWAN</span><span>K</span><span>D</span><span>A</span><span>LVL</span><span>EMAS</span><span style="text-align:right">ITEM</span></div>`;
    this.el.scoreboard.innerHTML = order.map((team) => {
      const heroes = g.heroes.filter((h) => h.team === team).sort((a, b) => b.kills + b.assists - (a.kills + a.assists));
      const rows = heroes.map((h) => {
        const items = h.items.map((id) => `<span title="${esc(ITEM_MAP[id].name)}">${itemVisual(ITEM_MAP[id])}</span>`).join('');
        const empty = Array.from({ length: Math.max(0, 6 - h.items.length) }, () => '<i></i>').join('');
        return `<div class="score-row${h.isPlayer ? ' is-player' : ''}">
          <img src="${h.def.portrait}" alt="" />
          <div class="sr-name">${esc(h.def.name)}${h.isPlayer ? ' <small>KAMU</small>' : ''}<small>${ROLE_INFO[h.def.roleId].name}</small></div>
          <span class="sr-num">${h.kills}</span><span class="sr-num">${h.deaths}</span><span class="sr-num">${h.assists}</span>
          <span class="sr-num">${h.level}</span><span class="sr-num">${Math.floor(h.gold)}</span>
          <div class="sr-items">${items}${empty}</div>
        </div>`;
      }).join('');
      return `<div><div class="score-team-head ${team === 0 ? 'blue' : 'red'}"><span class="dot"></span>${TEAMS[team].name}<span style="margin-left:auto;color:var(--muted)">${g.teamKills[team]} kill</span></div>${head}${rows}</div>`;
    }).join('');
  }

  // ---------------- results ----------------
  showResults(result) {
    if (!result) return;
    const won = result.playerWon;
    this.el.resultsScreen.classList.toggle('lose', !won);
    if (this.el.resultVerdict) this.el.resultVerdict.textContent = won ? 'KEMENANGAN' : 'KEKALAHAN';
    if (this.el.resultKicker) this.el.resultKicker.textContent = won ? 'KRISTAL MUSUH HANCUR' : 'KRISTAL KITA HANCUR';
    if (this.el.resultSub) this.el.resultSub.textContent = `Durasi ${formatTime(result.duration)} · Skor ${result.kills[0]} — ${result.kills[1]}`;
    if (this.el.resultMvp && result.mvp) {
      const m = result.mvp;
      this.el.resultMvp.innerHTML = `
        <img src="${HEROES[m.heroId]?.portrait || 'assets/heroes/garuda.webp'}" alt="" />
        <div><div class="mvp-label">MVP PERTEMPURAN</div><div class="mvp-name">${esc(m.name)}</div></div>
        <div class="mvp-stats">
          <div><b>${m.kills}/${m.deaths}/${m.assists}</b>KDA</div>
          <div><b>${Math.round(m.damage / 100) / 10}k</b>DMG</div>
          <div><b>${m.level}</b>LEVEL</div>
        </div>`;
    }
    if (this.el.resultTable) {
      const rows = result.heroes.slice().sort((a, b) => (a.team - b.team) || (b.kills + b.assists - (a.kills + a.assists)));
      const head = `<tr><th>PAHLAWAN</th><th>K / D / A</th><th>LEVEL</th><th>EMAS</th><th>DMG</th><th>ITEM</th></tr>`;
      const body = rows.map((h) => {
        const items = h.items.map((id) => `<span title="${esc(ITEM_MAP[id].name)}" style="margin-right:3px;color:var(--gold)">${itemVisual(ITEM_MAP[id])}</span>`).join('');
        return `<tr class="${h.team === 0 ? 'blue' : 'red'}${h.isPlayer ? ' player' : ''}">
          <td><div class="rt-hero"><img src="${HEROES[h.heroId]?.portrait || 'assets/heroes/garuda.webp'}" alt="" />${esc(h.name)}${h.team === result.winner ? ' <span class="rt-win">✦</span>' : ''}</div></td>
          <td class="rt-kda">${h.kills} / ${h.deaths} / ${h.assists}</td>
          <td>${h.level}</td><td>${h.gold}</td><td>${h.damage}</td>
          <td>${items}</td>
        </tr>`;
      }).join('');
      this.el.resultTable.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
    }
    this.closeModal();
    this.showScreen('results');
  }

  // ---------------- misc ----------------
  setFps(fps) {
    this.fps = fps;
  }

  syncSettings(s) {
    const setRange = (id, val) => {
      const el = $(id);
      if (el) el.value = String(val);
      const valEl = $(`${id}-val`);
      if (valEl) valEl.textContent = String(val);
    };
    setRange('set-volume', Math.round(s.volume * 100));
    setRange('set-volume2', Math.round(s.volume * 100));
    setRange('set-music', Math.round(s.music * 100));
    setRange('set-music2', Math.round(s.music * 100));
    [['set-quality', s.quality], ['set-quality2', s.quality], ['set-fps', s.showFps], ['set-fps2', s.showFps], ['set-shake', s.shake], ['set-shake2', s.shake]].forEach(([id, val]) => {
      const el = $(id);
      if (el) el.checked = !!val;
    });
  }
}
