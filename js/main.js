import { Game } from './engine.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import { InputController } from './input.js';
import { audio } from './audio.js';

const SETTINGS_KEY = 'nusantara-arena-settings-v1';
const DEFAULT_SETTINGS = { volume: 0.7, music: 0.35, quality: true, showFps: false, shake: true };

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof parsed[k] === typeof DEFAULT_SETTINGS[k]) out[k] = parsed[k];
    }
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function detectSoftwareRendering() {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|softpipe|software|basic render|warp/i.test(name);
  } catch {
    return false;
  }
}

const settings = loadSettings();
const softwareRender = detectSoftwareRendering();
if (softwareRender) settings.quality = false;

const canvas = document.getElementById('game-canvas');
const minimap = document.getElementById('minimap');
const renderer = new Renderer(canvas, minimap);
const ui = new UI();
const input = new InputController(renderer, {
  isGameplayActive: () => isGameplayActive(),
  onEscape: () => handleEscape(),
  onHelp: () => handleHelp(),
  onScoreboard: (show) => handleScoreboard(show),
  onShop: () => handleShop(),
  onTarget: () => {},
  onCast: (index, ability) => audio.play(ability?.ult ? 'castUlt' : 'cast'),
  onCastFail: () => audio.play('error'),
  onSkillLocked: () => {
    ui.pushToast('Skill belum terbuka — naikkan level pahlawan');
    audio.play('error');
  },
  onSkillUpgrade: () => {},
});

let game = null;
let running = false;
let loopId = 0;
let lastTS = 0;
let fpsFrames = 0;
let fpsTime = 0;
let lastSelection = null;
let slowTime = 0;
let fastTime = 0;
let perfNotified = false;
let staticFrame = false;
let lightToastShown = false;
const pauseReasons = new Set();

// ---------------- settings ----------------
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable */
  }
}

function applyAudioSettings() {
  audio.setVolume(settings.volume);
  audio.setMusicVolume(settings.music);
}

function applyQualitySettings() {
  renderer.setSettings({ quality: settings.quality, shake: settings.shake, software: softwareRender });
  renderer.buildRain();
  renderer.buildFlies();
}

function updateSettingsLabels() {
  const vols = [['set-volume', 'set-volume-val'], ['set-volume2', 'set-volume2-val']];
  for (const [rangeId, labelId] of vols) {
    const range = document.getElementById(rangeId);
    const label = document.getElementById(labelId);
    if (range) range.value = String(Math.round(settings.volume * 100));
    if (label) label.textContent = String(Math.round(settings.volume * 100));
  }
  const musics = [['set-music', 'set-music-val'], ['set-music2', 'set-music2-val']];
  for (const [rangeId, labelId] of musics) {
    const range = document.getElementById(rangeId);
    const label = document.getElementById(labelId);
    if (range) range.value = String(Math.round(settings.music * 100));
    if (label) label.textContent = String(Math.round(settings.music * 100));
  }
  [
    ['set-quality', settings.quality], ['set-quality2', settings.quality],
    ['set-fps', settings.showFps], ['set-fps2', settings.showFps],
    ['set-shake', settings.shake], ['set-shake2', settings.shake],
  ].forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!value;
  });
  ui.actions.showFps = settings.showFps;
}

function bindSettings() {
  const volumeInputs = ['set-volume', 'set-volume2'];
  for (const id of volumeInputs) {
    document.getElementById(id)?.addEventListener('input', (e) => {
      settings.volume = Number(e.target.value) / 100;
      audio.setVolume(settings.volume);
      updateSettingsLabels();
      saveSettings();
    });
  }
  const musicInputs = ['set-music', 'set-music2'];
  for (const id of musicInputs) {
    document.getElementById(id)?.addEventListener('input', (e) => {
      settings.music = Number(e.target.value) / 100;
      audio.setMusicVolume(settings.music);
      updateSettingsLabels();
      saveSettings();
    });
  }
  for (const id of ['set-quality', 'set-quality2']) {
    document.getElementById(id)?.addEventListener('change', (e) => {
      settings.quality = e.target.checked;
      applyQualitySettings();
      updateSettingsLabels();
      saveSettings();
    });
  }
  for (const id of ['set-fps', 'set-fps2']) {
    document.getElementById(id)?.addEventListener('change', (e) => {
      settings.showFps = e.target.checked;
      updateSettingsLabels();
      saveSettings();
    });
  }
  for (const id of ['set-shake', 'set-shake2']) {
    document.getElementById(id)?.addEventListener('change', (e) => {
      settings.shake = e.target.checked;
      renderer.setSettings({ shake: settings.shake });
      updateSettingsLabels();
      saveSettings();
    });
  }
}

// ---------------- screen & modal state ----------------
function isGameplayActive() {
  return !!game && running && !game.over && ui.screen === 'game' && !ui.isModalOpen();
}

function isPaused() {
  return pauseReasons.size > 0;
}

function resumeGame() {
  pauseReasons.clear();
  if (ui.modal === 'pause') ui.closeModal('pause');
}

function handleEscape() {
  if (ui.screen === 'game') {
    if (ui.modal === 'help') {
      ui.closeModal('help');
      afterHelpClose();
      return;
    }
    if (ui.modal === 'shop') {
      ui.closeModal('shop');
      return;
    }
    if (ui.modal === 'menu-settings') {
      ui.closeModal('menu-settings');
      return;
    }
    if (ui.modal === 'pause') {
      resumeGame();
      return;
    }
    if (ui.modal === 'scoreboard') {
      ui.closeModal('scoreboard');
      return;
    }
    if (game && !game.over && !ui.isModalOpen()) ui.openModal('pause');
    return;
  }
  if (ui.screen === 'select') {
    ui.showScreen('menu');
    ui.startTips();
    return;
  }
  if (ui.modal) ui.closeModal(ui.modal);
}

function handleHelp() {
  if (ui.screen === 'menu' || ui.screen === 'select') {
    ui.openModal('help');
    return;
  }
  if (!isGameplayActive()) return;
  ui.openModal('help');
}

function handleScoreboard(show) {
  if (!game || !running || game.over) return;
  if (show) {
    if (!ui.isModalOpen()) ui.openModal('scoreboard');
  } else if (ui.modal === 'scoreboard') {
    ui.closeModal('scoreboard');
  }
}

function handleShop() {
  if (!game || !running || game.over) return;
  if (ui.modal === 'shop') {
    ui.closeModal('shop');
    return;
  }
  if (!ui.isModalOpen()) ui.openModal('shop');
}

function afterHelpClose() {
  if (pauseReasons.has('pause') && ui.screen === 'game' && !ui.isModalOpen()) {
    ui.openModal('pause');
  }
}

function quitToMenu() {
  running = false;
  if (loopId) cancelAnimationFrame(loopId);
  loopId = 0;
  pauseReasons.clear();
  input.disable();
  audio.stopAmbient();
  ui.game = null;
  game = null;
  if (ui.modal) ui.closeModal(ui.modal);
  ui.showScreen('menu');
  ui.startTips();
  window.__arena = { game: null, renderer, ui, input, audio };
}

// ---------------- game lifecycle ----------------
function startGame(selection) {
  try {
    game = new Game(selection);
  } catch (err) {
    console.error('Gagal memulai pertempuran:', err);
    ui.pushToast('Gagal memulai pertempuran. Coba lagi.');
    ui.showScreen('menu');
    return;
  }
  lastSelection = selection;
  pauseReasons.clear();
  renderer.setGame(game);
  ui.initGame(game, renderer);
  ui.showScreen('game');
  input.setGame(game);
  ui.pushAnnounce('PERTEMPURAN DIMULAI', 'Hancurkan kristal inti musuh', 'info', 3);
  ui.pushToast('WASD untuk bergerak · 1 2 3 4 untuk skill · R regen · B recall');
  if (softwareRender && !lightToastShown) {
    lightToastShown = true;
    setTimeout(() => ui.pushToast('GPU browser nonaktif — mode performa maksimum aktif'), 2800);
  }

  audio.init();
  applyAudioSettings();
  audio.startAmbient();

  running = true;
  lastTS = performance.now();
  fpsFrames = 0;
  fpsTime = 0;
  slowTime = 0;
  fastTime = 0;
  staticFrame = false;
  renderer.setAutoScale(softwareRender ? 0.5 : 1);
  renderer.setDecor(!softwareRender);
  if (!loopId) loopId = requestAnimationFrame(frame);
  window.__arena = { game, renderer, ui, input, audio };
}

function finishMatch() {
  running = false;
  if (loopId) cancelAnimationFrame(loopId);
  loopId = 0;
  pauseReasons.clear();
  input.disable();
  audio.stopAmbient();
}

function processEvents() {
  if (!game) return;
  for (const ev of game.events) {
    ui.handleEvent(ev);
    soundForEvent(ev);
  }
  game.events.length = 0;
}

function soundForEvent(ev) {
  switch (ev.type) {
    case 'announce':
      audio.play(ev.kind === 'storm' ? 'storm' : 'announce');
      break;
    case 'attack':
      if (ev.isPlayer) audio.play(ev.ranged ? 'arrow' : 'hit');
      break;
    case 'ability':
      break;
    case 'kill':
      if (ev.playerKiller) audio.play('kill');
      break;
    case 'towerDown':
      audio.play('tower');
      break;
    case 'levelUp':
      if (ev.hero?.isPlayer) audio.play('levelup');
      break;
    case 'recallDone':
      if (ev.hero?.isPlayer) audio.play('teleport');
      break;
    case 'campKilled':
      if (ev.hero?.isPlayer) audio.play('buy');
      break;
    case 'gameOver':
      audio.play(ev.result?.playerWon ? 'victory' : 'defeat');
      break;
    default:
      break;
  }
}

function adaptPerformance(fps) {
  if (!game || game.over || isPaused() || game.time < 2) return;
  if (fps < 42) { slowTime += 0.5; fastTime = 0; }
  else if (fps > 57) { fastTime += 0.5; slowTime = 0; }
  else { slowTime = 0; fastTime = 0; }
  if (slowTime >= 1.5) {
    slowTime = 0;
    const floor = renderer.settings.software ? 0.4 : 0.5;
    if (renderer.autoScale > floor + 0.001) {
      renderer.setAutoScale(Math.max(floor, renderer.autoScale - 0.1));
      if (!perfNotified) {
        perfNotified = true;
        ui.pushToast('Mode performa otomatis: resolusi render diturunkan');
      }
    } else if (renderer.decor) {
      renderer.setDecor(false);
    }
  }
  if (fastTime >= 6 && renderer.autoScale < 0.999) {
    fastTime = 0;
    renderer.setAutoScale(Math.min(1, renderer.autoScale + 0.05));
  } else if (fastTime >= 12 && !renderer.decor) {
    fastTime = 0;
    renderer.setDecor(true);
  }
}

function frame(ts) {
  loopId = 0;
  if (!running) return;
  const rawDt = Math.max(0.0001, (ts - lastTS) / 1000);
  lastTS = ts;
  const dt = Math.min(0.1, rawDt);

  if (rawDt > 0.35) { fpsFrames = 0; fpsTime = 0; }
  else { fpsFrames++; fpsTime += rawDt; }
  if (fpsTime >= 0.5) {
    const fps = fpsFrames / fpsTime;
    ui.setFps(fps);
    adaptPerformance(fps);
    fpsFrames = 0;
    fpsTime = 0;
  }

  const paused = isPaused();
  if (game) {
    if (!paused && !game.over) {
      input.update();
      let remain = Math.min(0.2, rawDt);
      for (let i = 0; i < 4 && remain > 1e-4; i++) {
        const step = Math.min(0.05, remain);
        game.update(step);
        remain -= step;
      }
      processEvents();
      ui.update(dt);
    }
    if (!paused && !game.over) {
      renderer.updateCamera(dt);
      renderer.render();
      staticFrame = false;
    } else if (!staticFrame || renderer._fogDirty || renderer._miniDirty) {
      renderer.updateCamera(0);
      renderer.render();
      staticFrame = true;
    }
  }

  if (game && game.over) finishMatch();
  if (running) loopId = requestAnimationFrame(frame);
}

// ---------------- UI actions ----------------
ui.setActions({
  onClick: () => audio.play('click'),
  onHover: () => audio.play('hover'),
  onPlay: () => {
    ui.syncDiffChips();
    ui.showScreen('select');
  },
  onBackMenu: () => {
    ui.showScreen('menu');
    ui.startTips();
  },
  onStartMatch: (selection) => {
    if (selection) ui.showLoading(selection, () => startGame(selection));
  },
  onEnterGame: () => {
    renderer.resize();
  },
  onModalOpen: (name) => {
    if (name === 'pause' || name === 'shop') pauseReasons.add(name);
    input.cancelAim();
  },
  onModalClose: (name) => {
    if (name === 'shop') {
      setTimeout(() => {
        if (ui.modal !== 'shop') pauseReasons.delete('shop');
      }, 40);
    }
  },
  onPause: () => {
    if (game && !game.over && !ui.isModalOpen()) ui.openModal('pause');
  },
  onResume: () => resumeGame(),
  onQuit: () => quitToMenu(),
  onRematch: () => {
    if (lastSelection) ui.showLoading(lastSelection, () => startGame(lastSelection));
  },
  onMenu: () => quitToMenu(),
  onHelp: () => handleHelp(),
  afterHelpClose: () => afterHelpClose(),
  onShop: () => handleShop(),
  onRecall: () => {
    if (!game || !game.player.alive) return;
    game.commandRecall();
  },
  onRegen: () => {
    if (!game || !game.player.alive) return;
    game.commandRegen();
  },
  onStop: () => {
    if (!game) return;
    game.commandStop();
  },
  onBasicAttack: () => {
    if (!game || !game.player.alive) return;
    input.basicAttack();
  },
  onSkillStart: (index, x, y) => {
    if (!game || !game.player.alive) return;
    input.beginAim(index, x, y);
  },
  onSkillClick: (index) => {
    if (!game || !game.player.alive) return;
    if (game.player.ranks[index] <= 0) {
      ui.pushToast('Skill belum terbuka');
      audio.play('error');
      return;
    }
    input.castAtCursor(index);
  },
  onUpgradeSkill: (index) => {
    if (!game) return;
    const before = game.player.ranks[index];
    game.commandUpgrade(index);
    if (game.player.ranks[index] > before) audio.play('levelup');
  },
  onBuy: (itemId) => {
    if (!game) return;
    const p = game.player;
    game.commandBuy(itemId);
    if (p.items.includes(itemId)) {
      audio.play('buy');
      ui.renderShop();
      ui.updateItemBar(true);
    } else {
      audio.play('error');
    }
  },
  onSell: (index) => {
    if (!game) return;
    const before = game.player.items.length;
    game.commandSell(index);
    if (game.player.items.length < before) {
      audio.play('buy');
      ui.renderShop();
      ui.updateItemBar(true);
    }
  },
  onResetSettings: () => {
    Object.assign(settings, DEFAULT_SETTINGS);
    applyAudioSettings();
    applyQualitySettings();
    updateSettingsLabels();
    ui.syncSettings(settings);
    saveSettings();
    ui.pushToast('Pengaturan dikembalikan ke default');
  },
  showFps: settings.showFps,
});

// ---------------- startup ----------------
ui.syncSettings(settings);
ui.selectHero(ui.selectedHero);
ui.syncDiffChips();
bindSettings();
applyAudioSettings();
applyQualitySettings();
ui.actions.showFps = settings.showFps;

function unlockAudio() {
  audio.init();
  applyAudioSettings();
  if (running && game && !game.over) audio.startAmbient();
}
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && running && game && !game.over && !isPaused()) {
    ui.openModal('pause');
  }
});

window.addEventListener('pagehide', () => {
  audio.stopAmbient();
});

// Progressive offline shell for Cloudflare Pages (the game still runs locally).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline support is optional; never interrupt gameplay if registration fails.
    });
  }, { once: true });
}

window.__arena = { game: null, renderer, ui, input, audio, settings };
