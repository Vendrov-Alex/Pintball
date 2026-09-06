import { META_UPGRADES, type MetaUpgradeId } from '../game/config';
import { RUN_UPGRADE_IDS, type RunUpgradeId } from '../game/upgrades';
import { getProfile, setUpgradeLevel, spendGold } from './profile';

export interface MetaUpgradeView {
  id: MetaUpgradeId;
  name: string;
  description: string;
  icon: string;
  level: number;
  maxLevel: number;
  /** Current total bonus, e.g. 0.24 for +24%. */
  bonus: number;
  /** Bonus after the next purchase, or null when maxed. */
  nextBonus: number | null;
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
    bonus: bonusOf(id, level),
    nextBonus: cost === null ? null : bonusOf(id, level + 1),
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
