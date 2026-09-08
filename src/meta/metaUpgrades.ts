import { META_UPGRADES, PLAYER, type MetaUpgradeId } from '../game/config';
import { RUN_UPGRADE_IDS, type RunUpgradeId } from '../game/upgrades';
import { getProfile, setUpgradeLevel, spendGold } from './profile';

export interface MetaUpgradeView {
  id: MetaUpgradeId;
  name: string;
  description: string;
  icon: string;
  level: number;
  maxLevel: number;
  /** The actual in-game value at the current level, already formatted
   *  ("14 dmg", "2.4/s") — what a level-up really does, not a bare percent. */
  value: string;
  /** Same, one level up. Null when maxed. */
  nextValue: string | null;
  /** Cost of the next level, or null when maxed. */
  cost: number | null;
  affordable: boolean;
}

const LABELS: Record<MetaUpgradeId, { name: string; description: string; icon: string }> = {
  damage: { name: 'Attack', description: 'Damage dealt by every shot', icon: '⚔' },
  fireRate: { name: 'Attack Speed', description: 'Shots fired per second', icon: '⚡' },
  range: { name: 'Range', description: 'Radius of the firing circle', icon: '◎' },
  maxHp: { name: 'Health', description: 'Size of your health bar', icon: '✚' },
  magnet: { name: 'Magnet', description: 'Pull radius for gold and XP', icon: '⬤' },
  moveSpeed: { name: 'Speed', description: 'Movement speed on the map', icon: '➤' },
};

/**
 * What each upgrade actually moves, in the same units the engine simulates
 * with — the Upgrade screen used to show "+6%" per level, which is accurate
 * but tells you nothing about what the number underneath actually is. `base`
 * is the level-0 value from PLAYER in game/config.ts, the same constant the
 * engine itself multiplies at run start (see refreshStats() in engine.ts).
 */
const STAT_FORMAT: Record<MetaUpgradeId, { base: number; decimals: number; suffix: string }> = {
  damage: { base: PLAYER.damage, decimals: 0, suffix: ' dmg' },
  fireRate: { base: PLAYER.fireRate, decimals: 1, suffix: '/s' },
  range: { base: PLAYER.range, decimals: 0, suffix: ' u' },
  maxHp: { base: PLAYER.maxHp, decimals: 0, suffix: ' HP' },
  magnet: { base: PLAYER.magnetRadius, decimals: 0, suffix: ' u' },
  moveSpeed: { base: PLAYER.moveSpeed, decimals: 0, suffix: ' u/s' },
};

function formatStat(id: MetaUpgradeId, level: number): string {
  const f = STAT_FORMAT[id];
  const value = f.base * (1 + bonusOf(id, level));
  return `${value.toFixed(f.decimals)}${f.suffix}`;
}

/** Costs grow geometrically and are rounded to a readable step. */
export function costOf(id: MetaUpgradeId, level: number): number | null {
  const def = META_UPGRADES[id];
  if (level >= def.maxLevel) return null;
  const raw = def.baseCost * Math.pow(def.costGrowth, level);
  const step = raw < 500 ? 5 : raw < 5000 ? 25 : 100;
  return Math.round(raw / step) * step;
}

export function bonusOf(id: MetaUpgradeId, level: number): number {
  return level * META_UPGRADES[id].step;
}

/** Multiplier applied to the matching base stat at the start of a run. */
export function metaMultiplier(id: MetaUpgradeId): number {
  return 1 + bonusOf(id, getProfile().upgrades[id]);
}

/**
 * Every in-run line's multiplier, in the shape the engine takes at run start.
 * Not every RunUpgradeId has a matching permanent upgrade — Hands is in-run
 * only (see RUN_UPGRADE_LINES.hands) — so those default to a no-op 1.
 */
export function allMetaMultipliers(): Record<RunUpgradeId, number> {
  const out = {} as Record<RunUpgradeId, number>;
  for (const id of RUN_UPGRADE_IDS) {
    out[id] = id in META_UPGRADES ? metaMultiplier(id as MetaUpgradeId) : 1;
  }
  return out;
}

export function viewOf(id: MetaUpgradeId): MetaUpgradeView {
  const profile = getProfile();
  const level = profile.upgrades[id];
  const def = META_UPGRADES[id];
  const cost = costOf(id, level);
  return {
    id,
    ...LABELS[id],
    level,
    maxLevel: def.maxLevel,
    value: formatStat(id, level),
    nextValue: cost === null ? null : formatStat(id, level + 1),
    cost,
    affordable: cost !== null && profile.gold >= cost,
  };
}

export function allUpgradeViews(): MetaUpgradeView[] {
  return (Object.keys(META_UPGRADES) as MetaUpgradeId[]).map(viewOf);
}

/** Returns true when the purchase went through. */
export function buyUpgrade(id: MetaUpgradeId): boolean {
  const profile = getProfile();
  const level = profile.upgrades[id];
  const cost = costOf(id, level);
  if (cost === null || !spendGold(cost)) return false;
  setUpgradeLevel(id, level + 1);
  return true;
}
