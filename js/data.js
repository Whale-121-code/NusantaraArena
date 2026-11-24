import { pointOnPolyline, polylineLength } from './utils.js';

export const WORLD = 3600;
export const CENTER = WORLD / 2;
export const MAX_LEVEL = 15;
export const PLAYER_TEAM = 0;
export const TEAMS = [
  { id: 0, key: 'blue', name: 'Tim Biru', short: 'BIRU', color: '#4ea8ff', color2: '#7fe3ff', dark: '#0a2240', base: { x: 640, y: 2960 } },
  { id: 1, key: 'red', name: 'Tim Merah', short: 'MERAH', color: '#ff5a6e', color2: '#ffb199', dark: '#3a0c17', base: { x: 2960, y: 640 } },
];

export const LANES = {
  top: { id: 'top', name: 'Jalur Atas', short: 'ATAS', points: [[640, 2960], [620, 560], [2980, 560], [2960, 640]] },
  mid: { id: 'mid', name: 'Jalur Tengah', short: 'TENGAH', points: [[640, 2960], [2960, 640]] },
  bot: { id: 'bot', name: 'Jalur Bawah', short: 'BAWAH', points: [[640, 2960], [2980, 2980], [2980, 640]] },
};

for (const lane of Object.values(LANES)) lane.length = polylineLength(lane.points);

export const RIVER = { from: { x: 120, y: 120 }, to: { x: 3480, y: 3480 }, width: 320 };

export const CAMPS = [
  { id: 'camp-blue-rage', name: 'Rimba Biru', x: 1450, y: 2450, kind: 'rage', team: 0, respawn: 100 },
  { id: 'camp-red-rage', name: 'Rimba Merah', x: 2150, y: 1150, kind: 'rage', team: 1, respawn: 100 },
  { id: 'camp-neutral-nw', name: 'Altar Kabut', x: 1200, y: 1650, kind: 'spirit', team: -1, respawn: 90 },
  { id: 'camp-neutral-se', name: 'Altar Kabut', x: 2400, y: 1950, kind: 'spirit', team: -1, respawn: 90 },
  { id: 'camp-blue-spirit', name: 'Gua Biru', x: 1750, y: 2550, kind: 'spirit', team: 0, respawn: 90 },
  { id: 'camp-red-spirit', name: 'Gua Merah', x: 1850, y: 1050, kind: 'spirit', team: 1, respawn: 90 },
];

const TOWER_SLOTS = {
  top: [[0.17, 'inner'], [0.31, 'outer'], [0.69, 'outer'], [0.83, 'inner']],
  mid: [[0.17, 'inner'], [0.31, 'outer'], [0.69, 'outer'], [0.83, 'inner']],
  bot: [[0.17, 'inner'], [0.31, 'outer'], [0.69, 'outer'], [0.83, 'inner']],
};

export const TOWER_CONFIG = {
  outer: { hp: 2400, armor: 55, mr: 45, range: 290, dmg: 130, interval: 1.1, radius: 66, name: 'Menara Penjaga', gold: 150, xp: 120 },
  inner: { hp: 2800, armor: 60, mr: 50, range: 305, dmg: 150, interval: 1.05, radius: 70, name: 'Menara Suci', gold: 170, xp: 150 },
  base: { hp: 3200, armor: 65, mr: 55, range: 320, dmg: 175, interval: 1.0, radius: 76, name: 'Menara Inti', gold: 200, xp: 160 },
  nexus: { hp: 6000, armor: 50, mr: 50, range: 0, dmg: 0, interval: 1, radius: 92, name: 'Kristal Inti', gold: 0, xp: 0 },
};

export const STRUCTURES = [];
for (const [laneId, lane] of Object.entries(LANES)) {
  for (const [t, tier] of TOWER_SLOTS[laneId]) {
    const team = t < 0.5 ? 0 : 1;
    const p = pointOnPolyline(lane.points, t);
    STRUCTURES.push({
      id: `tower-${team}-${laneId}-${tier}`,
      type: 'tower', team, lane: laneId, tier,
      x: p.x, y: p.y,
      config: TOWER_CONFIG[tier],
      name: TOWER_CONFIG[tier].name,
    });
  }
}
for (const team of [0, 1]) {
  const base = TEAMS[team].base;
  const dir = team === 0 ? 1 : -1;
  STRUCTURES.push({
    id: `tower-${team}-base`, type: 'tower', team, lane: 'base', tier: 'base',
    x: base.x + dir * 330, y: base.y - dir * 330,
    config: TOWER_CONFIG.base, name: TOWER_CONFIG.base.name,
  });
  STRUCTURES.push({
    id: `nexus-${team}`, type: 'nexus', team, lane: 'base', tier: 'nexus',
    x: base.x, y: base.y, config: TOWER_CONFIG.nexus, name: TOWER_CONFIG.nexus.name,
  });
}

export const MINION_TYPES = {
  melee: { hp: 330, dmg: 26, armor: 10, mr: 10, speed: 195, range: 105, atkSpeed: 1.0, radius: 19, gold: 24, xp: 36, sight: 520 },
  ranged: { hp: 235, dmg: 31, armor: 4, mr: 8, speed: 195, range: 285, atkSpeed: 0.9, radius: 17, gold: 20, xp: 32, sight: 540, ranged: true },
  cannon: { hp: 620, dmg: 55, armor: 16, mr: 12, speed: 175, range: 350, atkSpeed: 0.65, radius: 26, gold: 52, xp: 68, sight: 560, ranged: true },
};

export const WAVE_INTERVAL = 25;
export const FIRST_WAVE_AT = 8;
export const GAME_RULES = {
  passiveGold: 4.2,
  startGold: 550,
  heroKillGold: 220,
  assistGold: 90,
  streakBonus: 35,
  towerTeamGold: 55,
  respawnBase: 5,
  respawnPerLevel: 1.25,
  recallTime: 3,
  regenTime: 3.5,
  regenCooldown: 40,
  regenHpPct: 0.22,
  regenMpPct: 0.18,
  xpShareRange: 950,
  goldShareRange: 850,
  fountainRadius: 400,
  fountainHpPct: 0.11,
  fountainMpPct: 0.12,
};

export const ITEMS = [
  { id: 'warblade', name: 'Pedang Prajurit', icon: 'sword', cost: 900, category: 'attack', stats: { atk: 32 }, desc: '+32 Serangan' },
  { id: 'boots', name: 'Sepatu Angin', icon: 'boots', cost: 700, category: 'speed', stats: { speed: 45, cdr: 0.06 }, desc: '+45 Kecepatan Gerak, +6% Pengurangan Rekoil' },
  { id: 'barongShield', name: 'Perisai Barong', icon: 'shield', cost: 1100, category: 'defense', stats: { hp: 500, armor: 26 }, desc: '+500 Nyawa, +26 Zirah' },
  { id: 'vampfang', name: 'Taring Vampir', icon: 'fang', cost: 1250, category: 'attack', stats: { atk: 20, lifesteal: 0.12 }, desc: '+20 Serangan, +12% Sedot Darah' },
  { id: 'arcaneTome', name: 'Kitab Mantra', icon: 'book', cost: 1200, category: 'magic', stats: { power: 55, cdr: 0.1 }, desc: '+55 Kekuatan Sihir, +10% Pengurangan Rekoil' },
  { id: 'frostStaff', name: 'Tongkat Embun', icon: 'staff', cost: 1350, category: 'magic', stats: { power: 45, hp: 150, spellSlow: 0.18 }, desc: '+45 Kekuatan Sihir, sihir memperlambat 18%' },
  { id: 'dragonEdge', name: 'Tebasan Naga', icon: 'katana', cost: 1650, category: 'attack', stats: { atk: 45, crit: 0.12 }, desc: '+45 Serangan, +12% Kritikal' },
  { id: 'titanBelt', name: 'Sabuk Titan', icon: 'belt', cost: 1000, category: 'defense', stats: { hp: 850 }, desc: '+850 Nyawa' },
  { id: 'grail', name: 'Cawan Suci', icon: 'grail', cost: 950, category: 'magic', stats: { mana: 300, mpRegen: 9, cdr: 0.1 }, desc: '+300 Mana, +9 Regen Mana, +10% Pengurangan Rekoil' },
  { id: 'stormCloak', name: 'Jubah Badai', icon: 'cloak', cost: 1150, category: 'defense', stats: { hp: 250, armor: 15, speed: 20 }, desc: '+250 Nyawa, +15 Zirah, +20 Kecepatan' },
  { id: 'demonBlade', name: 'Bilah Pemburu', icon: 'blade', cost: 2100, category: 'attack', stats: { atk: 58, lifesteal: 0.18 }, desc: '+58 Serangan, +18% Sedot Darah' },
  { id: 'immortalArmor', name: 'Zirah Abadi', icon: 'armor', cost: 2000, category: 'defense', stats: { hp: 1200, armor: 35 }, desc: '+1200 Nyawa, +35 Zirah' },
  { id: 'soulGem', name: 'Permata Sukma', icon: 'gem', cost: 1800, category: 'magic', stats: { power: 80, hp: 300 }, desc: '+80 Kekuatan Sihir, +300 Nyawa' },
  { id: 'wings', name: 'Sayap Garuda', icon: 'wings', cost: 1500, category: 'speed', stats: { speed: 55, atkSpeed: 0.18 }, desc: '+55 Kecepatan, +18% Kecepatan Serang' },
  { id: 'berserker', name: 'Tebasan Bergelora', icon: 'axe', cost: 1700, category: 'attack', stats: { atk: 38, atkSpeed: 0.22, crit: 0.08 }, desc: '+38 Serangan, +22% Kecepatan Serang, +8% Kritikal' },
];


ITEMS.push(
  { id: 'moonAmulet', name: 'Jimat Rembulan', icon: 'gem', cost: 1450, category: 'magic', stats: { power: 62, mpRegen: 5, hp: 180 }, desc: '+62 Sihir, +5 Regen Mana, +180 Nyawa' },
  { id: 'ironRoot', name: 'Akar Wesi', icon: 'shield', cost: 1550, category: 'defense', stats: { hp: 650, armor: 32 }, desc: '+650 Nyawa, +32 Zirah' },
  { id: 'sunSpear', name: 'Tombak Surya', icon: 'sword', cost: 1850, category: 'attack', stats: { atk: 48, crit: 0.1, speed: 18 }, desc: '+48 Serangan, +10% Kritikal, +18 Kecepatan' },
  { id: 'mistBoots', name: 'Selop Kabut', icon: 'boots', cost: 1250, category: 'speed', stats: { speed: 70, cdr: 0.05 }, desc: '+70 Kecepatan, +5% Pengurangan Cooldown' },
  { id: 'spiritLantern', name: 'Lentera Sukma', icon: 'book', cost: 1600, category: 'magic', stats: { power: 48, hp: 280, cdr: 0.08 }, desc: '+48 Sihir, +280 Nyawa, +8% Pengurangan Cooldown' },
  { id: 'krisEternal', name: 'Keris Pusaka', icon: 'katana', cost: 2200, category: 'attack', stats: { atk: 66, lifesteal: 0.1 }, desc: '+66 Serangan, +10% Sedot Darah' },
  { id: 'guardianShell', name: 'Cangkang Penjaga', icon: 'armor', cost: 1900, category: 'defense', stats: { hp: 900, armor: 20, mr: 20 }, desc: '+900 Nyawa, +20 Zirah, +20 Tahan Sihir' },
  { id: 'windTalisman', name: 'Jimat Pusaran', icon: 'cloak', cost: 1750, category: 'speed', stats: { speed: 45, atkSpeed: 0.14, cdr: 0.06 }, desc: '+45 Kecepatan, +14% Kecepatan Serang, +6% Pengurangan Cooldown' },
);

export const ITEM_MAP = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

const abilityHelpers = {
  q: (data) => ({ key: 'Q', maxRank: 4, unlock: 1, ...data }),
  w: (data) => ({ key: 'W', maxRank: 4, unlock: 1, ...data }),
  e: (data) => ({ key: 'E', maxRank: 4, unlock: 1, ...data }),
  r: (data) => ({ key: 'R', maxRank: 3, unlock: 4, ult: true, ...data }),
};

const K = (key, data) => abilityHelpers[key](data);

export const HEROES = {
  garuda: {
    id: 'garuda', name: 'Garuda', title: 'Sayap Badai', role: 'Marksman', roleId: 'marksman', lane: 'bot',
    color: '#59d6ff', accent: '#e9c879', portrait: 'assets/heroes/garuda.webp',
    tagline: 'Hujan panah dari langit',
    lore: 'Raja para burung yang menjelma sebagai penjaga angkasa. Garuda menembak dari jarak aman dan menutup pertempuran dengan badai bulu.',
    difficulty: 2,
    stats: { hp: 600, hpGrow: 88, mp: 340, mpGrow: 36, atk: 60, atkGrow: 7.2, armor: 18, armorGrow: 2.6, mr: 16, mrGrow: 2.2, speed: 325, range: 430, atkSpeed: 0.9, hpRegen: 3, mpRegen: 7, ranged: true, projSpeed: 1150 },
    passive: { name: 'Fokus Angin', desc: 'Setiap serangan dasar menambah 6% kecepatan serang selama 3 detik (maksimal 5 tumpukan).' },
    abilities: [
      K('q', { name: 'Panah Bayu', icon: 'arrow', kind: 'projectile', aim: 'dir', range: 800, radius: 34, speed: 980, pierce: 2, damage: [70, 115, 160, 205], scale: 0.55, scaleType: 'ad', dmgType: 'physical', effects: [{ type: 'slow', value: 0.2, t: 1.5 }], mana: 45, cooldown: [5.5, 5, 4.5, 4], color: '#7fe3ff', desc: 'Tembakkan panah angin yang menembus hingga 3 musuh dan memperlambat mereka.' }),
      K('w', { name: 'Langkah Angin', icon: 'dash', kind: 'dash', aim: 'dir', range: 360, radius: 80, mana: 40, cooldown: [9, 8.5, 8, 7.5], color: '#9ef0ff', selfEffects: [{ type: 'haste', value: 0.3, t: 2 }, { type: 'atkSpeed', value: 0.35, t: 4 }], desc: 'Meluncur deras ke arah kursor dan mempercepat serangan selama 4 detik.' }),
      K('e', { name: 'Badai Bulu', icon: 'rain', kind: 'aoe', aim: 'point', range: 680, radius: 170, delay: 0.35, damage: [85, 130, 175, 220], scale: 0.5, scaleType: 'ad', dmgType: 'magic', effects: [{ type: 'slow', value: 0.35, t: 2 }], mana: 60, cooldown: [10, 9.5, 9, 8.5], color: '#bfefff', desc: 'Panggil hujan bulu tajam di area target, memperlambat musuh yang tertangkap.' }),
      K('r', { name: 'Langit Garuda', icon: 'storm', kind: 'zone', aim: 'point', range: 900, radius: 250, duration: 3.5, interval: 0.5, damage: [40, 65, 90], scale: 0.16, scaleType: 'ad', dmgType: 'magic', enemyEffects: [{ type: 'slow', value: 0.22, t: 0.6 }], mana: 120, cooldown: [60, 55, 50], color: '#a5ecff', desc: 'Badai panah turun selama 3,5 detik. Sangat kuat untuk mengunci area.' }),
    ],
    build: ['warblade', 'boots', 'dragonEdge', 'vampfang', 'berserker', 'demonBlade'],
    skillPriority: ['Q', 'W', 'E'],
  },
  hanuman: {
    id: 'hanuman', name: 'Hanuman', title: 'Kera Sakti', role: 'Fighter', roleId: 'fighter', lane: 'top',
    color: '#ffb454', accent: '#fff0c9', portrait: 'assets/heroes/hanuman.webp',
    tagline: 'Gada emas, nyali tanpa batas',
    lore: 'Pahlawan berlengan baja dari kisah Ramayana. Hanuman melompat ke tengah pertempuran, memutar gadanya, lalu berubah menjadi raksasa yang tak terhentikan.',
    difficulty: 2,
    stats: { hp: 800, hpGrow: 105, mp: 300, mpGrow: 30, atk: 68, atkGrow: 8.5, armor: 24, armorGrow: 3.4, mr: 20, mrGrow: 2.6, speed: 332, range: 255, atkSpeed: 0.95, hpRegen: 4, mpRegen: 6, ranged: false },
    passive: { name: 'Kera Sakti', desc: 'Setiap serangan dasar ke-4 memulihkan 3% nyawa maksimal.' },
    abilities: [
      K('q', { name: 'Tongkat Kilat', icon: 'staff', kind: 'dash', aim: 'dir', range: 320, radius: 105, damage: [95, 140, 185, 230], scale: 0.7, scaleType: 'ad', dmgType: 'physical', effects: [{ type: 'slow', value: 0.2, t: 1 }], mana: 45, cooldown: [6, 5.5, 5, 4.5], color: '#ffc46b', desc: 'Terjang ke depan dengan ujung gada. Musuh di titik akhir melambat.' }),
      K('w', { name: 'Sapuan Gada', icon: 'fan', kind: 'cone', aim: 'dir', range: 290, angle: 115, damage: [75, 115, 155, 195], scale: 0.6, scaleType: 'ad', dmgType: 'physical', effects: [{ type: 'slow', value: 0.25, t: 1.5 }], mana: 50, cooldown: [7, 6.5, 6, 5.5], color: '#ffd58a', desc: 'Putaran gada yang menghantam semua musuh di depan.' }),
      K('e', { name: 'Lompatan Sakti', icon: 'leap', kind: 'leap', aim: 'point', range: 560, radius: 160, damage: [80, 125, 170, 215], scale: 0.5, scaleType: 'ad', dmgType: 'physical', effects: [{ type: 'stun', t: 0.7 }], mana: 60, cooldown: [12, 11.5, 11, 10.5], color: '#ffe19c', desc: 'Lompat ke titik target dan menghentak tanah, membuat musuh terpana.' }),
      K('r', { name: 'Wujud Raksasa', icon: 'giant', kind: 'selfBuff', aim: 'self', shield: [350, 500, 650], shieldHpScale: 0.2, selfEffects: [{ type: 'dmg', value: 0.25, t: 8 }, { type: 'haste', value: 0.12, t: 8 }], size: 1.3, duration: 8, mana: 120, cooldown: [70, 65, 60], color: '#ffb454', desc: 'Berubah menjadi raksasa selama 8 detik: perisai besar, +25% serangan, tubuh membesar.' }),
    ],
    build: ['warblade', 'boots', 'titanBelt', 'demonBlade', 'immortalArmor', 'stormCloak'],
    skillPriority: ['Q', 'W', 'E'],
  },
  barong: {
    id: 'barong', name: 'Barong', title: 'Penjaga Sakral', role: 'Tank', roleId: 'tank', lane: 'top',
    color: '#63e6a2', accent: '#e9f7ff', portrait: 'assets/heroes/barong.webp',
    tagline: 'Benteng terakhir para dewa',
    lore: 'Roh pelindung berwujud singa yang menjaga gerbang dunia. Barong menahan semua hantaman dan membalas dengan auman yang mengguncang bumi.',
    difficulty: 1,
    stats: { hp: 950, hpGrow: 132, mp: 320, mpGrow: 32, atk: 56, atkGrow: 6.5, armor: 30, armorGrow: 4.2, mr: 26, mrGrow: 3.2, speed: 304, range: 245, atkSpeed: 0.8, hpRegen: 6, mpRegen: 6, ranged: false },
    passive: { name: 'Perisai Suci', desc: 'Saat nyawa di bawah 35%, Barong menerima 22% lebih sedikit kerusakan.' },
    abilities: [
      K('q', { name: 'Auman Barong', icon: 'roar', kind: 'cone', aim: 'dir', range: 330, angle: 115, damage: [60, 95, 130, 165], scale: 0.45, scaleType: 'ad', dmgType: 'magic', effects: [{ type: 'slow', value: 0.4, t: 2 }], mana: 50, cooldown: [8, 7.5, 7, 6.5], color: '#8effc4', desc: 'Auman sakral memperlambat semua musuh di depan hingga 40%.' }),
      K('w', { name: 'Benteng Roh', icon: 'shield', kind: 'auraShield', aim: 'self', radius: 430, shield: [170, 230, 290, 350], shieldHpScale: 0.08, allyEffects: [{ type: 'haste', value: 0.12, t: 3 }], duration: 3, mana: 60, cooldown: [13, 12.5, 12, 11.5], color: '#a9ffd8', desc: 'Memberi perisai kepada Barong dan sekutu di sekitarnya selama 3 detik.' }),
      K('e', { name: 'Hantaman Sakral', icon: 'charge', kind: 'dash', aim: 'dir', range: 300, radius: 115, damage: [70, 105, 140, 175], scale: 0.5, scaleType: 'ad', dmgType: 'physical', effects: [{ type: 'stun', t: 0.8 }], mana: 55, cooldown: [11, 10.5, 10, 9.5], color: '#c5ffe4', desc: 'Menerjang ke depan dan membuat musuh yang tertabrak terpana.' }),
      K('r', { name: 'Kemunculan Raja', icon: 'pulse', kind: 'aoe', aim: 'self', range: 0, radius: 340, damage: [150, 230, 310], scale: 0.8, scaleType: 'ad', dmgType: 'magic', effects: [{ type: 'stun', t: 1.2 }], mana: 120, cooldown: [75, 70, 65], color: '#c2ffdf', desc: 'Menghentak bumi dan membuat semua musuh di sekitar terpana 1,2 detik.' }),
    ],
    build: ['barongShield', 'boots', 'titanBelt', 'immortalArmor', 'grail', 'stormCloak'],
    skillPriority: ['Q', 'W', 'E'],
  },
  rangda: {
    id: 'rangda', name: 'Rangda', title: 'Ratu Leyak', role: 'Mage', roleId: 'mage', lane: 'mid',
    color: '#c77dff', accent: '#ff7b9c', portrait: 'assets/heroes/rangda.webp',
    tagline: 'Kutukan dalam setiap bayangan',
    lore: 'Ratu dunia gelap yang menguasai leyak. Rangda melemahkan jiwa musuh dengan kutukan yang menumpuk, lalu menghapus mereka dalam badai sihir.',
    difficulty: 2,
    stats: { hp: 620, hpGrow: 85, mp: 430, mpGrow: 45, atk: 52, atkGrow: 6, armor: 16, armorGrow: 2.4, mr: 22, mrGrow: 2.8, speed: 300, range: 405, atkSpeed: 0.8, hpRegen: 2.5, mpRegen: 9, ranged: true, projSpeed: 1000 },
    passive: { name: 'Kutukan Leyak', desc: 'Setiap sihir yang mengenai musuh menambah 8% kerusakan yang mereka terima selama 4 detik (maksimal 3 tumpukan).' },
    abilities: [
      K('q', { name: 'Sihir Bayangan', icon: 'bolt', kind: 'projectile', aim: 'dir', range: 780, radius: 30, speed: 880, pierce: 0, damage: [85, 125, 165, 205], scale: 0.7, scaleType: 'ap', dmgType: 'magic', mana: 50, cooldown: [5, 4.6, 4.2, 3.8], color: '#d59bff', desc: 'Tembakkan bola sihir gelap ke arah kursor.' }),
      K('w', { name: 'Kutukan Leyak', icon: 'hex', kind: 'aoe', aim: 'point', range: 620, radius: 175, delay: 0.5, damage: [80, 120, 160, 200], scale: 0.55, scaleType: 'ap', dmgType: 'magic', dot: { dps: [25, 35, 45, 55], scale: 0.1, t: 3 }, effects: [{ type: 'slow', value: 0.2, t: 2 }], mana: 60, cooldown: [9, 8.5, 8, 7.5], color: '#e0aaff', desc: 'Kutuk area target: kerusakan awal, racun leyak, dan perlambatan.' }),
      K('e', { name: 'Kedipan', icon: 'blink', kind: 'blink', aim: 'point', range: 380, mana: 40, cooldown: [14, 13, 12, 11], color: '#c77dff', desc: 'Berpindah seketika ke titik target yang masih dalam jangkauan.' }),
      K('r', { name: 'Badai Leyak', icon: 'storm', kind: 'zone', aim: 'point', range: 780, radius: 240, duration: 4, interval: 0.45, damage: [45, 70, 95], scale: 0.2, scaleType: 'ap', dmgType: 'magic', enemyEffects: [{ type: 'slow', value: 0.2, t: 0.6 }], mana: 130, cooldown: [55, 50, 45], color: '#da8bff', desc: 'Badai sihir selama 4 detik yang mengoyak semua musuh di dalamnya.' }),
    ],
    build: ['arcaneTome', 'boots', 'frostStaff', 'soulGem', 'grail', 'immortalArmor'],
    skillPriority: ['Q', 'W', 'E'],
  },
  nyai: {
    id: 'nyai', name: 'Nyi Roro Kidul', title: 'Ratu Laut Selatan', role: 'Support', roleId: 'support', lane: 'bot',
    color: '#3ce6cf', accent: '#baf7ff', portrait: 'assets/heroes/nyai.webp',
    tagline: 'Ombak yang menyembuhkan, arus yang menenggelamkan',
    lore: 'Penguasa samudra selatan yang mengendalikan pasang. Nyai menjaga sekutunya dengan berkah laut dan menenggelamkan musuh dalam pusaran yang tak berujung.',
    difficulty: 1,
    stats: { hp: 680, hpGrow: 94, mp: 450, mpGrow: 48, atk: 50, atkGrow: 5.8, armor: 18, armorGrow: 2.6, mr: 24, mrGrow: 3, speed: 306, range: 385, atkSpeed: 0.82, hpRegen: 4, mpRegen: 10, ranged: true, projSpeed: 950 },
    passive: { name: 'Restu Laut', desc: 'Sekutu dalam radius 520 memulihkan 8 nyawa per detik.' },
    abilities: [
      K('q', { name: 'Gelombang Selatan', icon: 'wave', kind: 'projectile', aim: 'dir', range: 720, radius: 60, speed: 700, pierce: 4, damage: [65, 95, 125, 155], scale: 0.55, scaleType: 'ap', dmgType: 'magic', effects: [{ type: 'slow', value: 0.35, t: 2 }], mana: 55, cooldown: [7, 6.5, 6, 5.5], color: '#68f5e2', desc: 'Kirim gelombang lebar yang menembus musuh dan memperlambat mereka.' }),
      K('w', { name: 'Berkah Samudra', icon: 'heal', kind: 'healAlly', aim: 'ally', range: 720, heal: [110, 160, 210, 260], scale: 0.55, scaleType: 'ap', allyEffects: [{ type: 'haste', value: 0.25, t: 2 }], mana: 60, cooldown: [8, 7.5, 7, 6.5], color: '#8ffff0', desc: 'Sembuhkan sekutu dengan nyawa terendah dan percepat langkahnya.' }),
      K('e', { name: 'Selubung Ombak', icon: 'bubble', kind: 'shieldAlly', aim: 'ally', range: 680, shield: [140, 190, 240, 290], scale: 0.6, scaleType: 'ap', cleanse: true, allyEffects: [{ type: 'haste', value: 0.2, t: 2 }], duration: 3, mana: 55, cooldown: [11, 10.5, 10, 9.5], color: '#a8fff4', desc: 'Beri perisai dan bersihkan perlambatan dari sekutu.' }),
      K('r', { name: 'Ratu Pantai Selatan', icon: 'tide', kind: 'zone', aim: 'point', range: 700, radius: 300, duration: 4.5, interval: 0.5, allyHeal: [22, 32, 42], allyHealScale: 0.08, enemyDamage: [18, 26, 34], enemyDamageScale: 0.08, enemyEffects: [{ type: 'slow', value: 0.35, t: 0.6 }], mana: 130, cooldown: [65, 60, 55], color: '#5ff2e0', desc: 'Pusaran laut: menyembuhkan sekutu dan meremukkan musuh selama 4,5 detik.' }),
    ],
    build: ['grail', 'boots', 'soulGem', 'frostStaff', 'barongShield', 'immortalArmor'],
    skillPriority: ['W', 'Q', 'E'],
  },
  kala: {
    id: 'kala', name: 'Kala', title: 'Pemburu Bayangan', role: 'Assassin', roleId: 'assassin', lane: 'jungle',
    color: '#9d8cff', accent: '#4ef0d0', portrait: 'assets/heroes/kala.webp',
    tagline: 'Kematian datang tanpa suara',
    lore: 'Roh pemburu dari kegelapan yang memangsa mereka yang lemah. Kala menyusup dari bayangan, menandai target, lalu mengeksekusi dalam satu tikaman.',
    difficulty: 3,
    stats: { hp: 700, hpGrow: 96, mp: 300, mpGrow: 30, atk: 74, atkGrow: 9, armor: 22, armorGrow: 3.2, mr: 18, mrGrow: 2.4, speed: 344, range: 265, atkSpeed: 1.0, hpRegen: 3.5, mpRegen: 6, ranged: false },
    passive: { name: 'Pemburu', desc: 'Kala memberi 20% kerusakan tambahan kepada musuh dengan nyawa di bawah 40%.' },
    abilities: [
      K('q', { name: 'Tikaman Bayangan', icon: 'stab', kind: 'dash', aim: 'dir', range: 340, radius: 100, damage: [100, 145, 190, 235], scale: 0.8, scaleType: 'ad', dmgType: 'physical', mana: 45, cooldown: [6, 5.5, 5, 4.5], color: '#b3a6ff', desc: 'Menusuk ke arah kursor, menghantam musuh di titik akhir.' }),
      K('w', { name: 'Kipas Bilah', icon: 'blades', kind: 'cone', aim: 'dir', range: 290, angle: 100, damage: [80, 120, 160, 200], scale: 0.65, scaleType: 'ad', dmgType: 'physical', effects: [{ type: 'slow', value: 0.2, t: 1.2 }], mana: 45, cooldown: [6.5, 6, 5.5, 5], color: '#c9c0ff', desc: 'Lepaskan bilah bayangan ke semua musuh di depan.' }),
      K('e', { name: 'Asap Tengkorak', icon: 'smoke', kind: 'stealth', aim: 'self', duration: 2.5, mana: 45, cooldown: [14, 13, 12, 11], color: '#7f6dff', selfEffects: [{ type: 'haste', value: 0.3, t: 2.5 }], desc: 'Menghilang dalam asap selama 2,5 detik. Serangan berikutnya dari bayangan lebih mematikan.' }),
      K('r', { name: 'Eksekusi Kala', icon: 'skull', kind: 'execute', aim: 'enemy', range: 430, damage: [200, 300, 400], scale: 0.9, scaleType: 'ad', dmgType: 'true', missingHpScale: 0.25, mana: 120, cooldown: [55, 50, 45], resetOnKill: 0.35, color: '#ff5f8f', desc: 'Tandai dan hancurkan satu musuh. Kerusakan sejati +25% dari nyawa yang hilang.' }),
    ],
    build: ['warblade', 'boots', 'dragonEdge', 'demonBlade', 'vampfang', 'immortalArmor'],
    skillPriority: ['Q', 'W', 'E'],
  },
};


// Tiga legenda tambahan menggunakan kit dasar yang sudah teruji, dengan statistik dan identitas tersendiri.
const cloneHero = (sourceId, id, name, title, role, roleId, lane, color, accent, tagline, lore, passiveName, passiveDesc, portrait) => {
  const base = HEROES[sourceId];
  HEROES[id] = {
    ...base, id, name, title, role, roleId, lane, color, accent, tagline, lore,
    portrait: portrait || base.portrait,
    stats: { ...base.stats },
    passive: { name: passiveName, desc: passiveDesc },
    abilities: base.abilities.map((a) => ({ ...a, damage: a.damage ? [...a.damage] : a.damage, cooldown: a.cooldown ? [...a.cooldown] : a.cooldown })),
    build: [...base.build], skillPriority: [...base.skillPriority],
  };
};
cloneHero('garuda', 'sriKandi', 'Srikandi', 'Panah Senja', 'Marksman', 'marksman', 'bot', '#ff9c72', '#ffe0ad', 'Bidikan tak pernah meleset', 'Pemanah legendaris yang menjaga garis belakang dengan rentetan panah presisi.', 'Bidikan Jitu', 'Serangan beruntun meningkatkan kecepatan serang untuk sementara.', 'assets/heroes/srikandi.webp');
HEROES.sriKandi.stats = { ...HEROES.sriKandi.stats, hp: 640, atk: 64, range: 445, speed: 318 };
HEROES.sriKandi.abilities[0] = { ...HEROES.sriKandi.abilities[0], name: 'Panah Senja', desc: 'Panah energi menembus barisan lawan.' };
cloneHero('hanuman', 'gajahMada', 'Gajah Mada', 'Sumpah Palapa', 'Fighter', 'fighter', 'top', '#e6b85c', '#fff0bd', 'Pantang mundur sebelum bersatu', 'Panglima besar yang memimpin serangan dan menguatkan barisan depan.', 'Sumpah Setia', 'Bertahan di tengah pertempuran memperkuat serangan berikutnya.', 'assets/heroes/gajah-mada.webp');
HEROES.gajahMada.stats = { ...HEROES.gajahMada.stats, hp: 880, atk: 65, armor: 29, speed: 310 };
HEROES.gajahMada.abilities[0] = { ...HEROES.gajahMada.abilities[0], name: 'Terjang Palapa', desc: 'Terjang maju dan hantam lawan di hadapan.' };
cloneHero('nyai', 'dewiSri', 'Dewi Sri', 'Berkah Padi', 'Support', 'support', 'bot', '#8fe0a0', '#e2ffc0', 'Kesuburan dan kehidupan', 'Dewi pelindung kehidupan yang memulihkan sekutu dan menjaga mereka tetap bertahan.', 'Berkah Kehidupan', 'Efek pemulihan pada sekutu menjadi lebih kuat.', 'assets/heroes/dewi-sri.webp');
HEROES.dewiSri.stats = { ...HEROES.dewiSri.stats, hp: 730, mp: 470, power: 54, speed: 300 };
HEROES.dewiSri.abilities[0] = { ...HEROES.dewiSri.abilities[0], name: 'Gelombang Berkah', desc: 'Arus berkah memulihkan sekutu di area sasaran.' };

export const MAP_LOCATIONS = [
  { id: 'candi-langit', name: 'Candi Langit', subtitle: 'Reruntuhan Kuno', x: 900, y: 2050, kind: 'ruin' },
  { id: 'hutan-beringin', name: 'Hutan Beringin', subtitle: 'Rimba Purba', x: 2700, y: 1500, kind: 'forest' },
  { id: 'telaga-biru', name: 'Telaga Biru', subtitle: 'Mata Air Sakral', x: 1250, y: 1050, kind: 'water' },
  { id: 'gerbang-surya', name: 'Gerbang Surya', subtitle: 'Jalur Para Raja', x: 2450, y: 2650, kind: 'ruin' },
];

export const HERO_LIST = Object.values(HEROES);
export const HERO_IDS = Object.keys(HEROES);
export const ROLE_INFO = {
  marksman: { name: 'Marksman', icon: 'bow', desc: 'Kerusakan jarak jauh' },
  fighter: { name: 'Fighter', icon: 'sword', desc: 'Tahan banting & agresif' },
  tank: { name: 'Tank', icon: 'shield', desc: 'Pelindung tim' },
  mage: { name: 'Mage', icon: 'bolt', desc: 'Ledakan sihir' },
  support: { name: 'Support', icon: 'heal', desc: 'Penyembuh & pengendali' },
  assassin: { name: 'Assassin', icon: 'dagger', desc: 'Pembunuh cepat' },
};

export const LANE_INFO = {
  top: { name: 'Jalur Atas', short: 'ATAS', icon: 'top' },
  mid: { name: 'Jalur Tengah', short: 'TENGAH', icon: 'mid' },
  bot: { name: 'Jalur Bawah', short: 'BAWAH', icon: 'bot' },
  jungle: { name: 'Hutan', short: 'HUTAN', icon: 'jungle' },
};

export const DIFFICULTY = {
  easy: { id: 'easy', name: 'Mudah', desc: 'Bot santai, cocok untuk belajar.', botDmg: 0.82, reaction: 0.6, aimError: 90, aggression: 0.75, retreatHp: 0.42, gold: 0.95, xp: 0.95 },
  normal: { id: 'normal', name: 'Normal', desc: 'Pertarungan seimbang dan seru.', botDmg: 1, reaction: 0.36, aimError: 48, aggression: 1, retreatHp: 0.32, gold: 1, xp: 1 },
  hard: { id: 'hard', name: 'Sulit', desc: 'Bot tajam dan tanpa ampun.', botDmg: 1.12, reaction: 0.2, aimError: 16, aggression: 1.2, retreatHp: 0.24, gold: 1.1, xp: 1.08 },
};

export const LORE_TIPS = [
  'Hancurkan kristal inti musuh untuk memenangkan pertempuran.',
  'Menara dalam memberi perisai sampai menara luar di jalur itu hancur.',
  'Ambil monster hutan untuk mendapatkan berkah dan emas ekstra.',
  'Beli item di toko kapan saja dengan menekan P.',
  'Tahan B untuk kembali ke markas. Gerakan atau serangan akan membatalkannya.',
  'Besarkan skill dengan mengklik tombol + pada ikon skill.',
];
