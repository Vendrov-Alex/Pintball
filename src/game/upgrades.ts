import { RUN_UPGRADE_LINES } from './config';

export type RunUpgradeId = keyof typeof RUN_UPGRADE_LINES;
export type RunPicks = Record<RunUpgradeId, number>;

export interface UpgradeChoice {
  id: RunUpgradeId;
  name: string;
  detail: string;
  icon: string;
  accent: string;
  picks: number;
  maxPicks: number;
}

const META: Record<RunUpgradeId, { name: string; detail: (step: number) => string; icon: string; accent: string }> = {
  fireRate: { name: 'Rapid Fire', detail: (s) => `+${s}% attack speed`, icon: '⚡', accent: '#ffd23a' },
  damage: { name: 'Heavy Rounds', detail: (s) => `+${s}% shot damage`, icon: '⚔', accent: '#ff5d5d' },
  range: { name: 'Wide Scope', detail: (s) => `+${s}% firing radius`, icon: '◎', accent: '#4ce6b0' },
  magnet: { name: 'Magnet', detail: (s) => `+${s}% pickup radius`, icon: '⬤', accent: '#c07bff' },
  maxHp: { name: 'Reinforce', detail: (s) => `+${s}% max health, healed`, icon: '✚', accent: '#5ad1ff' },
  moveSpeed: { name: 'Sprint', detail: (s) => `+${s}% movement speed`, icon: '➤', accent: '#7affc4' },
  hands: { name: 'More Hands', detail: () => '+1 firing direction', icon: '✋', accent: '#ff8f4d' },
};

export const RUN_UPGRADE_IDS = Object.keys(RUN_UPGRADE_LINES) as RunUpgradeId[];

export function emptyPicks(): RunPicks {
  const picks = {} as RunPicks;
  for (const id of RUN_UPGRADE_IDS) picks[id] = 0;
  return picks;
}

/** Multiplier a line has earned from its picks. */
export function pickMultiplier(id: RunUpgradeId, picks: number): number {
  return Math.pow(1 + RUN_UPGRADE_LINES[id].step, picks);
}

export function isMaxed(id: RunUpgradeId, picks: number): boolean {
  return picks >= RUN_UPGRADE_LINES[id].maxPicks;
}

/**
 * Three random cards from the lines that are not yet maxed.
 *
 * Seven lines against fourteen level-ups means a run can never exhaust them: the
 * most a player can close off is two full lines plus change, so there is always
 * something left to offer and no filler card is needed.
 */
export function rollChoices(picks: RunPicks, rand: () => number): UpgradeChoice[] {
  const open = RUN_UPGRADE_IDS.filter((id) => !isMaxed(id, picks[id]));
  for (let i = open.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [open[i], open[j]] = [open[j], open[i]];
  }
  return open.slice(0, 3).map((id) => {
    const line = RUN_UPGRADE_LINES[id];
    return {
      id,
      name: META[id].name,
      detail: META[id].detail(Math.round(line.step * 100)),
      icon: META[id].icon,
      accent: META[id].accent,
      picks: picks[id],
      maxPicks: line.maxPicks,
    };
  });
}
