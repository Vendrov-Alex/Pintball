import { RUN_UPGRADES } from './config';

export type RunUpgradeId = 'fireRate' | 'damage' | 'range';
export type FillerId = 'repair' | 'bounty';
export type ChoiceId = RunUpgradeId | FillerId;

export interface UpgradeChoice {
  id: ChoiceId;
  name: string;
  detail: string;
  icon: string;
  accent: string;
  /** Picks already spent on this line, and the cap. Null for one-shot fillers. */
  picks: number | null;
  maxPicks: number | null;
}

export type RunPicks = Record<RunUpgradeId, number>;

const STAT_META: Record<RunUpgradeId, { name: string; detail: string; icon: string; accent: string }> = {
  fireRate: { name: 'Rapid Fire', detail: `+${RUN_UPGRADES.step * 100}% attack speed`, icon: '⚡', accent: '#ffd23a' },
  damage: { name: 'Heavy Rounds', detail: `+${RUN_UPGRADES.step * 100}% shot damage`, icon: '⚔', accent: '#ff5d5d' },
  range: { name: 'Wide Scope', detail: `+${RUN_UPGRADES.step * 100}% firing radius`, icon: '◎', accent: '#4ce6b0' },
};

const FILLER_META: Record<FillerId, { name: string; detail: string; icon: string; accent: string }> = {
  repair: { name: 'Field Repair', detail: 'Restore 35% of max HP', icon: '✚', accent: '#5ad1ff' },
  bounty: { name: 'Bounty', detail: 'Instantly bank 150 gold', icon: '◈', accent: '#ffb03a' },
};

export const REPAIR_SHARE = 0.35;
export const BOUNTY_GOLD = 150;

export function emptyPicks(): RunPicks {
  return { fireRate: 0, damage: 0, range: 0 };
}

/** Multiplier a stat has earned from its level-up picks. */
export function pickMultiplier(picks: number): number {
  return Math.pow(1 + RUN_UPGRADES.step, picks);
}

function choiceFor(id: RunUpgradeId, picks: RunPicks): UpgradeChoice {
  return { id, ...STAT_META[id], picks: picks[id], maxPicks: RUN_UPGRADES.maxPicks };
}

function fillerFor(id: FillerId): UpgradeChoice {
  return { id, ...FILLER_META[id], picks: null, maxPicks: null };
}

/**
 * Builds the three cards shown on level-up.
 *
 * There are only three upgrade lines and each caps at five picks, so late in a
 * strong run fewer than three lines remain. The one-shot fillers keep the choice
 * meaningful instead of degrading to a single forced card.
 */
export function rollChoices(picks: RunPicks, rand: () => number): UpgradeChoice[] {
  const open = (Object.keys(picks) as RunUpgradeId[]).filter((id) => picks[id] < RUN_UPGRADES.maxPicks);
  shuffle(open, rand);

  const chosen: UpgradeChoice[] = open.slice(0, 3).map((id) => choiceFor(id, picks));
  if (chosen.length < 3) {
    const fillers: FillerId[] = ['repair', 'bounty'];
    shuffle(fillers, rand);
    for (const id of fillers) {
      if (chosen.length >= 3) break;
      chosen.push(fillerFor(id));
    }
  }
  return chosen;
}

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
