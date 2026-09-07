import { load, save } from '../core/storage';
import { EQUIPMENT_IDS, META_UPGRADES, type EquipmentId, type MetaUpgradeId } from '../game/config';

const STORAGE_KEY = 'roblaksim.profile.v1';
/**
 * The key this game shipped under before the rename. Read once, so a player who
 * already has progress does not lose it. Safe to delete after the first release.
 */
const LEGACY_STORAGE_KEY = 'pintball.profile.v1';
const PROFILE_VERSION = 1;

export interface RunStats {
  runs: number;
  wins: number;
  bestKills: number;
  bestLevel: number;
  bestSurvivedSeconds: number;
  totalGoldEarned: number;
}

export interface Profile {
  version: number;
  gold: number;
  upgrades: Record<MetaUpgradeId, number>;
  stats: RunStats;
  /** Rewarded-ad claims, reset every calendar day. */
  ads: { day: string; counts: Record<string, number> };
  settings: { sound: boolean; haptics: boolean };
  /** Boss-dropped gear that's been found — see EQUIPMENT in game/config.ts. */
  equipment: Record<EquipmentId, boolean>;
  /**
   * Epoch ms of the last change, local or from the cloud. This is how an
   * optional cloud sync (see meta/cloudSync.ts) decides which copy of the
   * profile is newer when reconciling two devices — last-write-wins on the
   * whole document, not a field-by-field merge. Field merging looks safer but
   * silently breaks for spendable gold: it only ever increases, so a naive
   * merge would "un-spend" a purchase made on the other device.
   */
  updatedAt: number;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultProfile(): Profile {
  return {
    version: PROFILE_VERSION,
    gold: 0,
    upgrades: { damage: 0, fireRate: 0, range: 0, maxHp: 0, magnet: 0, moveSpeed: 0 },
    stats: { runs: 0, wins: 0, bestKills: 0, bestLevel: 1, bestSurvivedSeconds: 0, totalGoldEarned: 0 },
    ads: { day: today(), counts: {} },
    settings: { sound: true, haptics: true },
    equipment: { laser: false, fireCannon: false, aura: false },
    updatedAt: 0,
  };
}

let profile: Profile = defaultProfile();
let flushTimer: number | null = null;
const listeners = new Set<(p: Profile) => void>();

/** Merges a stored profile over the defaults so new fields never come back undefined. */
function hydrate(raw: string): Profile {
  const parsed = JSON.parse(raw) as Partial<Profile>;
  const base = defaultProfile();
  const merged: Profile = {
    ...base,
    ...parsed,
    upgrades: { ...base.upgrades, ...(parsed.upgrades ?? {}) },
    stats: { ...base.stats, ...(parsed.stats ?? {}) },
    ads: { ...base.ads, ...(parsed.ads ?? {}) },
    settings: { ...base.settings, ...(parsed.settings ?? {}) },
    equipment: { ...base.equipment, ...(parsed.equipment ?? {}) },
    updatedAt: Number.isFinite(parsed.updatedAt) ? (parsed.updatedAt as number) : 0,
    version: PROFILE_VERSION,
  };
  // A tampered or corrupted save could set an equipment flag to something
  // other than a real boolean; force it back to the same on/off shape the
  // rest of the game assumes rather than letting a truthy string through.
  for (const id of EQUIPMENT_IDS) merged.equipment[id] = merged.equipment[id] === true;
  // Clamp anything a tampered save could have inflated past the design limits.
  for (const id of Object.keys(base.upgrades) as MetaUpgradeId[]) {
    const level = Number(merged.upgrades[id]);
    merged.upgrades[id] = Number.isFinite(level) ? Math.max(0, Math.min(META_UPGRADES[id].maxLevel, Math.floor(level))) : 0;
  }
  merged.gold = Number.isFinite(merged.gold) ? Math.max(0, Math.floor(merged.gold)) : 0;
  return merged;
}

export async function initProfile(): Promise<Profile> {
  const raw = (await load(STORAGE_KEY)) ?? (await load(LEGACY_STORAGE_KEY));
  if (raw) {
    try {
      profile = hydrate(raw);
    } catch {
      profile = defaultProfile();
    }
  }
  rolloverAdDay();
  return profile;
}

export function getProfile(): Profile {
  return profile;
}

export function onProfileChange(fn: (p: Profile) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Debounced write-behind: the UI stays synchronous, the disk catches up. */
function commit(): void {
  profile.updatedAt = Date.now();
  for (const fn of listeners) fn(profile);
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void save(STORAGE_KEY, JSON.stringify(profile));
  }, 250);
}

/**
 * Swaps in a whole profile from elsewhere — the one call cloudSync.ts needs
 * when the cloud copy turns out to be the newer one. Goes through the same
 * hydrate() a stored save does, so a malformed cloud document degrades the
 * same safe way a corrupted local one does, and listeners/local storage stay
 * in sync with what just landed.
 */
export function replaceProfile(next: Profile): void {
  profile = hydrate(JSON.stringify(next));
  for (const fn of listeners) fn(profile);
  void save(STORAGE_KEY, JSON.stringify(profile));
}

export function flushProfile(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  return save(STORAGE_KEY, JSON.stringify(profile));
}

export function addGold(amount: number): void {
  if (amount <= 0) return;
  profile.gold += Math.floor(amount);
  profile.stats.totalGoldEarned += Math.floor(amount);
  commit();
}

export function spendGold(amount: number): boolean {
  if (amount > profile.gold) return false;
  profile.gold -= amount;
  commit();
  return true;
}

export function setUpgradeLevel(id: MetaUpgradeId, level: number): void {
  profile.upgrades[id] = level;
  commit();
}

export function recordRun(result: { kills: number; level: number; survivedSeconds: number; won: boolean }): void {
  const s = profile.stats;
  s.runs += 1;
  if (result.won) s.wins += 1;
  s.bestKills = Math.max(s.bestKills, result.kills);
  s.bestLevel = Math.max(s.bestLevel, result.level);
  s.bestSurvivedSeconds = Math.max(s.bestSurvivedSeconds, result.survivedSeconds);
  commit();
}

function rolloverAdDay(): void {
  const day = today();
  if (profile.ads.day !== day) {
    profile.ads = { day, counts: {} };
    commit();
  }
}

export function adClaimsLeft(packId: string, dailyLimit: number): number {
  rolloverAdDay();
  return Math.max(0, dailyLimit - (profile.ads.counts[packId] ?? 0));
}

export function recordAdClaim(packId: string): void {
  rolloverAdDay();
  profile.ads.counts[packId] = (profile.ads.counts[packId] ?? 0) + 1;
  commit();
}

export function setSetting<K extends keyof Profile['settings']>(key: K, value: Profile['settings'][K]): void {
  profile.settings[key] = value;
  commit();
}

/** Returns true the first time a piece of gear is unlocked, false if it was already owned. */
export function unlockEquipment(id: EquipmentId): boolean {
  if (profile.equipment[id]) return false;
  profile.equipment[id] = true;
  commit();
  return true;
}
