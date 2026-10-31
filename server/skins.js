'use strict';

/**
 * BALL ARENA LEGENDS — Skin catalog.
 * Tier counts are exact and asserted at load time:
 * COMMON 20, UNCOMMON 18, RARE 16, EPIC 14, LEGEND 12,
 * MYTHIC 8, SECRET 4, GODLY 2, ULTIMAX 1 (+ GODMAX owner skin).
 */

const RARITY_META = {
  COMMON:   { label: 'Common',   color: '#9fb3c8', glow: '#64748b', order: 1 },
  UNCOMMON: { label: 'Uncommon', color: '#4ade80', glow: '#22c55e', order: 2 },
  RARE:     { label: 'Rare',     color: '#38bdf8', glow: '#0ea5e9', order: 3 },
  EPIC:     { label: 'Epic',     color: '#c084fc', glow: '#a855f7', order: 4 },
  LEGEND:   { label: 'Legend',   color: '#fbbf24', glow: '#f59e0b', order: 5 },
  MYTHIC:   { label: 'Mythic',   color: '#fb7185', glow: '#f43f5e', order: 6 },
  SECRET:   { label: 'Secret',   color: '#e2e8f0', glow: '#94a3b8', order: 7 },
  GODLY:    { label: 'Godly',    color: '#a3e635', glow: '#84cc16', order: 8 },
  ULTIMAX:  { label: 'Ultimax',  color: '#f472b6', glow: '#ec4899', order: 9 },
  GODMAX:   { label: 'GODMAX',   color: '#ffffff', glow: '#ff00d4', order: 10 },
};

// [name, primary, secondary, accent, pattern]
const TIERS = {
  COMMON: [
    ['Pebble', '#9ca3af', '#6b7280', '#e5e7eb', 'solid'],
    ['Bubblegum', '#f9a8d4', '#ec4899', '#fdf2f8', 'ring'],
    ['Minty', '#6ee7b7', '#10b981', '#ecfdf5', 'solid'],
    ['Sunset', '#fdba74', '#f97316', '#fff7ed', 'stripe'],
    ['Sandy', '#e7c9a9', '#c19a6b', '#fff8ee', 'solid'],
    ['Skye', '#93c5fd', '#3b82f6', '#eff6ff', 'ring'],
    ['Coral', '#fb923c', '#ef4444', '#fff1e6', 'stripe'],
    ['Lime', '#bef264', '#84cc16', '#f7fee7', 'solid'],
    ['Ember', '#f87171', '#b91c1c', '#fee2e2', 'core'],
    ['Frosty', '#bae6fd', '#38bdf8', '#f0f9ff', 'ring'],
    ['Violet', '#c4b5fd', '#7c3aed', '#f5f3ff', 'solid'],
    ['Amber', '#fcd34d', '#d97706', '#fffbeb', 'core'],
    ['Snow', '#f8fafc', '#cbd5e1', '#ffffff', 'solid'],
    ['Slate', '#94a3b8', '#334155', '#f1f5f9', 'ring'],
    ['Peach', '#fecdd3', '#fb7185', '#fff1f2', 'solid'],
    ['Jade', '#5eead4', '#0d9488', '#ecfeff', 'stripe'],
    ['Berry', '#e879f9', '#a21caf', '#fdf4ff', 'solid'],
    ['Dusk', '#818cf8', '#4338ca', '#eef2ff', 'ring'],
    ['Cloud', '#e2e8f0', '#94a3b8', '#ffffff', 'solid'],
    ['Moss', '#a3b18a', '#588157', '#f0f5ea', 'solid'],
  ],
  UNCOMMON: [
    ['Neon Pulse', '#22d3ee', '#0891b2', '#ecfeff', 'pulse'],
    ['Copper Coil', '#d97706', '#92400e', '#fde68a', 'stripe'],
    ['Aqua Drift', '#67e8f9', '#0284c7', '#e0f2fe', 'orbit'],
    ['Solar Flare', '#facc15', '#ea580c', '#fefce8', 'core'],
    ['Rose Quartz', '#fda4af', '#be123c', '#fff1f2', 'ring'],
    ['Emerald Ring', '#34d399', '#047857', '#d1fae5', 'ring'],
    ['Cobalt Spark', '#60a5fa', '#1d4ed8', '#dbeafe', 'pulse'],
    ['Magma Core', '#fb923c', '#7f1d1d', '#ffedd5', 'core'],
    ['Silver Lining', '#e5e7eb', '#9ca3af', '#f8fafc', 'stripe'],
    ['Lavender Haze', '#ddd6fe', '#8b5cf6', '#f5f3ff', 'orbit'],
    ['Tangerine', '#fb923c', '#c2410c', '#ffedd5', 'solid'],
    ['Arctic Wave', '#7dd3fc', '#0369a1', '#e0f2fe', 'stripe'],
    ['Bronze Orb', '#c08457', '#7c4a1e', '#f5d7b0', 'ring'],
    ['Sakura', '#fbcfe8', '#db2777', '#fdf2f8', 'petal'],
    ['Cyber Lime', '#a3e635', '#3f6212', '#f7fee7', 'circuit'],
    ['Indigo Shift', '#818cf8', '#312e81', '#e0e7ff', 'orbit'],
    ['Honeycomb', '#fbbf24', '#b45309', '#fef3c7', 'hex'],
    ['Onyx Glow', '#4b5563', '#111827', '#a3e635', 'pulse'],
  ],
  RARE: [
    ['Thunderball', '#fde047', '#2563eb', '#fef9c3', 'bolt'],
    ['Glacier Core', '#a5f3fc', '#0e7490', '#ecfeff', 'core'],
    ['Vortex', '#a78bfa', '#4c1d95', '#ede9fe', 'swirl'],
    ['Blood Moon', '#ef4444', '#450a0a', '#fecaca', 'ring'],
    ['Radioactive', '#a3e635', '#365314', '#ecfccb', 'pulse'],
    ['Celestial', '#c7d2fe', '#4338ca', '#eef2ff', 'star'],
    ['Storm Surge', '#7dd3fc', '#1e3a8a', '#e0f2fe', 'swirl'],
    ['Phantom', '#64748b', '#0f172a', '#cbd5e1', 'core'],
    ['Pyro Sphere', '#f97316', '#7c2d12', '#fed7aa', 'flame'],
    ['Deep Sea', '#22d3ee', '#082f49', '#cffafe', 'orbit'],
    ['Golden Comet', '#fbbf24', '#78350f', '#fef3c7', 'streak'],
    ['Clockwork', '#d6d3d1', '#57534e', '#fef3c7', 'gear'],
    ['Runic', '#7dd3fc', '#1e1b4b', '#bae6fd', 'rune'],
    ['Prism Shard', '#f0abfc', '#67e8f9', '#fdf4ff', 'prism'],
    ['Venom', '#84cc16', '#14532d', '#ecfccb', 'swirl'],
    ['Mirage', '#fda4af', '#f59e0b', '#fff7ed', 'orbit'],
  ],
  EPIC: [
    ['Nova Burst', '#f0abfc', '#7e22ce', '#fae8ff', 'star'],
    ['Obsidian Flame', '#111827', '#be123c', '#f97316', 'flame'],
    ['Crystal Veil', '#a5f3fc', '#c084fc', '#ffffff', 'crystal'],
    ['Cosmic Ripple', '#6366f1', '#1e1b4b', '#a5b4fc', 'ripple'],
    ['Dragon Scale', '#10b981', '#064e3b', '#fbbf24', 'scale'],
    ['Aether Orb', '#c4b5fd', '#06b6d4', '#f5f3ff', 'orbit'],
    ['Spectre', '#e2e8f0', '#334155', '#a3e635', 'swirl'],
    ['Solar Eclipse', '#f59e0b', '#0b0b12', '#fde68a', 'ring'],
    ['Frostborne', '#e0f2fe', '#1d4ed8', '#ffffff', 'crystal'],
    ['Nether Gate', '#a21caf', '#2e1065', '#f0abfc', 'rune'],
    ['Thunder Crown', '#facc15', '#1e293b', '#fef08a', 'bolt'],
    ['Lava Lotus', '#fb7185', '#9a3412', '#fde68a', 'petal'],
    ['Starforge', '#fef08a', '#b45309', '#ffffff', 'star'],
    ['Dreamweaver', '#c084fc', '#312e81', '#f5d0fe', 'ripple'],
  ],
  LEGEND: [
    ['Chrono Sphere', '#f8fafc', '#0ea5e9', '#fbbf24', 'gear'],
    ['Phoenix Soul', '#fb923c', '#dc2626', '#fde68a', 'flame'],
    ['Abyss Sovereign', '#4c1d95', '#0b1023', '#22d3ee', 'swirl'],
    ['Celestial Wing', '#fef3c7', '#6366f1', '#ffffff', 'star'],
    ['Titan Heart', '#f97316', '#7f1d1d', '#fbbf24', 'core'],
    ['Oracle Eye', '#22d3ee', '#1e1b4b', '#e0f2fe', 'eye'],
    ['Empyrean', '#fef9c3', '#f59e0b', '#ffffff', 'halo'],
    ['Void Walker', '#0f172a', '#6d28d9', '#c4b5fd', 'void'],
    ['Infinity Loop', '#34d399', '#065f46', '#fbbf24', 'infinity'],
    ['Archangel', '#e0f2fe', '#0284c7', '#fde68a', 'halo'],
    ['Meteor King', '#f97316', '#1c1917', '#fda4af', 'streak'],
    ['Spectral Queen', '#ddd6fe', '#4338ca', '#f0abfc', 'crown'],
  ],
  MYTHIC: [
    ['Genesis', '#fef08a', '#7c3aed', '#22d3ee', 'genesis'],
    ['Ragnarok', '#ef4444', '#111827', '#fbbf24', 'flame'],
    ['Eclipse Seraph', '#f5d0fe', '#1e1b4b', '#fbbf24', 'halo'],
    ['Eldritch', '#84cc16', '#0f172a', '#a855f7', 'void'],
    ['Chronomancer', '#67e8f9', '#312e81', '#fbbf24', 'gear'],
    ['Astral Dragon', '#fbbf24', '#7f1d1d', '#22d3ee', 'scale'],
    ['Hypernova', '#f0abfc', '#db2777', '#fef08a', 'star'],
    ['Aeon', '#a5b4fc', '#0b1023', '#67e8f9', 'infinity'],
  ],
  SECRET: [
    ['Glitch #404', '#22d3ee', '#111827', '#f43f5e', 'glitch'],
    ['Shadow Protocol', '#111827', '#6d28d9', '#22d3ee', 'circuit'],
    ['Code Breaker', '#a3e635', '#052e16', '#f0abfc', 'matrix'],
    ['White Hole', '#ffffff', '#94a3b8', '#fde68a', 'genesis'],
  ],
  GODLY: [
    ['Omniscient', '#fef9c3', '#7c3aed', '#ffffff', 'eye'],
    ['Divine Radiance', '#ffffff', '#f59e0b', '#fef08a', 'halo'],
  ],
  ULTIMAX: [
    ['Ultimax Prime', '#ffffff', '#f0abfc', '#22d3ee', 'ultimax'],
  ],
  GODMAX: [
    ['GODMAX', '#ff004c', '#00e5ff', '#fff700', 'rainbow'],
  ],
};

const BASE_PRICE = {
  COMMON: 40, UNCOMMON: 120, RARE: 280, EPIC: 520, LEGEND: 950,
  MYTHIC: 1800, SECRET: 3200, GODLY: 6000, ULTIMAX: 12000, GODMAX: 0,
};
const BASE_LEVEL = {
  COMMON: 1, UNCOMMON: 3, RARE: 6, EPIC: 10, LEGEND: 15,
  MYTHIC: 22, SECRET: 30, GODLY: 40, ULTIMAX: 50, GODMAX: 1,
};

const DESCRIPTIONS = {
  COMMON: 'A humble arena ball. Every legend starts somewhere.',
  UNCOMMON: 'Tuned plating that hums with early arena energy.',
  RARE: 'Forged in ranked circuits. Leaves a visible trail.',
  EPIC: 'High-voltage core with animated armour plating.',
  LEGEND: 'Only veteran champions ever equip this shell.',
  MYTHIC: 'Reality bends around this orb.',
  SECRET: 'Unlisted in the arena archives. Few have seen it.',
  GODLY: 'Divine energy radiates from every particle.',
  ULTIMAX: 'The pinnacle shell. One exists in the known arena.',
  GODMAX: 'Beyond all tiers. Reserved for the Owner and their chosen. Rainbow core, eternal animation.',
};

const PATTERNS = ['solid', 'ring', 'pulse', 'orbit', 'core', 'stripe', 'swirl', 'flame',
  'star', 'halo', 'rune', 'circuit', 'crystal', 'gear', 'bolt', 'petal', 'hex',
  'ripple', 'scale', 'eye', 'void', 'infinity', 'crown', 'streak', 'prism',
  'genesis', 'glitch', 'matrix', 'ultimax', 'rainbow'];

const SKINS = [];
let skinCounter = 0;
for (const rarity of Object.keys(TIERS)) {
  TIERS[rarity].forEach((entry, index) => {
    const [name, primary, secondary, accent, pattern] = entry;
    if (!PATTERNS.includes(pattern)) throw new Error(`Unknown skin pattern: ${pattern}`);
    skinCounter += 1;
    SKINS.push({
      id: `skin_${String(skinCounter).padStart(3, '0')}`,
      name,
      rarity,
      primary,
      secondary,
      accent,
      pattern,
      price: BASE_PRICE[rarity] + index * Math.round(BASE_PRICE[rarity] * 0.06),
      minLevel: BASE_LEVEL[rarity],
      description: DESCRIPTIONS[rarity],
      grantOnly: rarity === 'GODMAX' || rarity === 'SECRET' || rarity === 'GODLY' || rarity === 'ULTIMAX',
      animated: ['rainbow', 'pulse', 'swirl', 'ripple', 'flame', 'glitch',
        'matrix', 'orbit', 'ultimax', 'halo', 'void', 'gear'].includes(pattern),
    });
  });
}

const EXPECTED_COUNTS = {
  COMMON: 20, UNCOMMON: 18, RARE: 16, EPIC: 14, LEGEND: 12,
  MYTHIC: 8, SECRET: 4, GODLY: 2, ULTIMAX: 1, GODMAX: 1,
};
for (const [rarity, expected] of Object.entries(EXPECTED_COUNTS)) {
  const actual = SKINS.filter((s) => s.rarity === rarity).length;
  if (actual !== expected) {
    throw new Error(`Skin tier ${rarity} expected ${expected}, got ${actual}`);
  }
}

const SKIN_MAP = new Map(SKINS.map((s) => [s.id, s]));
const DEFAULT_SKIN_ID = SKINS[0].id;
const GODMAX_SKIN_ID = SKINS.find((s) => s.rarity === 'GODMAX').id;

function getSkin(id) {
  return SKIN_MAP.get(id) || null;
}

function publicSkin(skin, owned = false, equipped = false) {
  return { ...skin, owned, equipped };
}

module.exports = {
  SKINS,
  SKIN_MAP,
  RARITY_META,
  DEFAULT_SKIN_ID,
  GODMAX_SKIN_ID,
  getSkin,
  publicSkin,
};
