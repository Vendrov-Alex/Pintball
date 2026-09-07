import { EQUIPMENT, EQUIPMENT_IDS, type EquipmentId } from '../game/config';
import { addGold, getProfile, unlockEquipment } from './profile';

/** Consolation payout once every piece of gear has already dropped. */
const ALL_OWNED_BONUS_GOLD = 400;

export interface EquipmentView {
  id: EquipmentId;
  name: string;
  description: string;
  icon: string;
  accent: string;
  owned: boolean;
}

export function allEquipmentViews(): EquipmentView[] {
  const owned = getProfile().equipment;
  return EQUIPMENT_IDS.map((id) => ({ id, ...EQUIPMENT[id], owned: owned[id] }));
}

/** What the engine needs at start(): which gear is owned, active for the whole run. */
export function ownedEquipmentMap(): Record<EquipmentId, boolean> {
  return { ...getProfile().equipment };
}

export interface BossDropResult {
  /** The piece that dropped, or null if everything is already owned. */
  id: EquipmentId | null;
  /** Paid instead, only when there was nothing left to drop. */
  bonusGold: number;
}

/**
 * Called once per boss kill. Always drops something you don't already have —
 * "a different one every time" only stays true if the roll is limited to gear
 * you don't own yet rather than picked from all three unconditionally, which
 * could hand back a repeat. Once all three are owned, a boss kill pays a flat
 * gold bonus instead so it never stops feeling like a reward.
 */
export function rollBossDrop(): BossDropResult {
  const owned = getProfile().equipment;
  const available = EQUIPMENT_IDS.filter((id) => !owned[id]);
  if (available.length === 0) return { id: null, bonusGold: ALL_OWNED_BONUS_GOLD };

  const id = available[Math.floor(Math.random() * available.length)];
  unlockEquipment(id);
  return { id, bonusGold: 0 };
}

/** Applies a roll's gold side-effect; the caller still needs to surface `id` in its own UI. */
export function applyBossDrop(result: BossDropResult): void {
  if (result.bonusGold > 0) addGold(result.bonusGold);
}
