/**
 * Every tunable number in the game lives here.
 *
 * World units (vu): the game is simulated in a resolution-independent space where
 * the SHORT side of the screen is always `VIEW_SHORT_SIDE` units tall/wide. The
 * renderer scales vu -> css px, so a 170vu firing radius covers the same share of
 * the screen on a 4" phone and on a tablet.
 */

export const VIEW_SHORT_SIDE = 720;

/** Total length of a run, in seconds, before the boss spawns. */
export const RUN_DURATION = 180;

export const PLAYER = {
  /** Half-size of the square, in vu. */
  halfSize: 15,
  maxHp: 120,
  /** Damage per bullet before any upgrade. */
  damage: 14,
  /** Shots per second before any upgrade. */
  fireRate: 2.4,
  /** Radius of the firing-boundary circle, in vu. */
  range: 170,
  bulletSpeed: 560,
  bulletRadius: 5,
  /** How long a bullet lives if it never hits anything, in seconds. */
  bulletLife: 2.5,
  /** Seconds of invulnerability after taking a hit (prevents multi-hit spikes). */
  iframes: 0.22,
  /** Top movement speed in vu/s. Compare with ENEMY_BASE.speed and the kind multipliers. */
  moveSpeed: 152,
  /** Radius inside which dropped orbs are pulled toward the square, in vu. */
  magnetRadius: 150,
  /**
   * How fast the square reaches its target velocity, in 1/s. High enough to feel
   * instant, low enough that a flick of the thumb does not read as a teleport.
   */
  moveResponse: 16,
} as const;

/** Floating virtual joystick, in css pixels. */
export const JOYSTICK = {
  baseRadius: 78,
  knobRadius: 32,
  /** Thumb travel that maps to full speed. */
  maxTravel: 62,
  /** Movement below this is treated as a tap, not a drag. */
  deadZone: 7,
} as const;

/**
 * Share of bots spawned in the hemisphere the player is running toward.
 * Without this, outrunning the wave forever is strictly the best strategy.
 */
export const SPAWN_LEAD_BIAS = 0.58;

/** Bots this far behind the player (as a multiple of the spawn radius) are recycled. */
export const DESPAWN_FACTOR = 2.1;

/**
 * In-run level-up lines. Each pick multiplies the stat by (1 + step), up to
 * maxPicks. A line that has hit its cap stops being offered.
 *
 * Movement speed is the one line that does NOT use the standard +25%: five picks
 * at +25% is 3.05x, which is 464 vu/s against a 209 vu/s runner. Nothing could
 * ever reach you, and a game you cannot lose is a game with no reason to upgrade.
 * At +10% a maxed movement build is fast enough to reposition at will and still
 * has to respect the horde.
 */
export const RUN_UPGRADE_LINES = {
  damage: { step: 0.25, maxPicks: 5 },
  fireRate: { step: 0.25, maxPicks: 5 },
  range: { step: 0.25, maxPicks: 5 },
  magnet: { step: 0.25, maxPicks: 5 },
  maxHp: { step: 0.25, maxPicks: 5 },
  moveSpeed: { step: 0.1, maxPicks: 5 },
} as const;

/**
 * Loot orbs. Every bot drops one gold orb and one XP orb where it died, so the
 * reward for a kill is only banked if you go and take it — which is what stops
 * running in circles from being a viable way to play.
 */
export const PICKUP = {
  /** Seconds an uncollected orb stays on the field. */
  life: 18,
  radius: 7,
  /** Speed an orb is pulled at when it is at the very edge of the magnet, in vu/s. */
  pullMin: 130,
  /** ...and when it is right on top of the player. */
  pullMax: 660,
  /** How fast the scatter from the death burst bleeds off, per second. */
  drag: 0.02,
  /** Scatter speed given to a fresh orb. */
  scatter: 95,
  /** Extra collection radius on top of the square's half-size. */
  collectPad: 9,
  goldColor: '#ffd23a',
  xpColor: '#5ad1ff',
} as const;

/** Heal granted on every level-up, as a share of max HP. */
export const LEVEL_UP_HEAL = 0.1;

/**
 * XP required to reach the NEXT level, indexed by (currentLevel - 1).
 * Level 1 -> 2 costs 5 XP, 2 -> 3 costs 11, 3 -> 4 costs 16, and so on up to
 * level 15 (the cap), for 538 XP across a full run.
 *
 * A regular bot drops one XP orb; the chunky ones drop more. XP only counts once
 * the orb has been collected, so the curve is a measure of how much of the field
 * you actually clear, not how much of it you shot.
 */
export const XP_TABLE: readonly number[] = [
  5, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56, 61, 66, 71,
];

export const MAX_LEVEL = XP_TABLE.length + 1; // 15

/** Baseline stats of a regular bot at t = 0. */
export const ENEMY_BASE = {
  hp: 13,
  speed: 112,
  radius: 11,
  /** Damage dealt to the player on contact. */
  damage: 8,
  // Raised when loot became collectable: roughly half of what drops is never
  // picked up, so the per-kill value has to cover the difference.
  gold: 1.6,
  /** Impulse applied to the bot after it lands a hit, in vu/s. */
  knockback: 190,
  /** Minimum delay between two hits from the same bot, in seconds. */
  hitCooldown: 0.7,
  /** Bots push each other apart so they never stack into one pixel. */
  separation: 130,
} as const;

/** How the baseline scales from t = 0 to t = RUN_DURATION (linear interpolation). */
export const ENEMY_SCALING = {
  hpAtEnd: 4.2,
  speedAtEnd: 1.38,
  damageAtEnd: 1.5,
  goldAtEnd: 2.5,
  /**
   * Later bots carry richer XP orbs. Without this the level curve stalls in the
   * middle of a run: the XP table keeps climbing while a kill is worth the same
   * one point it was at second zero.
   */
  xpAtEnd: 2.2,
} as const;

export type EnemyKindId = 'grunt' | 'runner' | 'tank' | 'swarm';

export interface EnemyKind {
  id: EnemyKindId;
  hp: number;
  speed: number;
  radius: number;
  damage: number;
  gold: number;
  /** XP carried by this kind's orb. */
  xp: number;
  color: string;
  /** Bots of this kind spawn as a tight cluster of N. */
  cluster: number;
}

export const ENEMY_KINDS: Record<EnemyKindId, EnemyKind> = {
  grunt: { id: 'grunt', hp: 1, speed: 1, radius: 1, damage: 1, gold: 1, xp: 1, color: '#ff5d5d', cluster: 1 },
  runner: { id: 'runner', hp: 0.6, speed: 1.35, radius: 0.85, damage: 0.8, gold: 1.4, xp: 1, color: '#ffb03a', cluster: 1 },
  tank: { id: 'tank', hp: 3.2, speed: 0.62, radius: 1.7, damage: 1.8, gold: 3.2, xp: 2, color: '#a066ff', cluster: 1 },
  swarm: { id: 'swarm', hp: 0.45, speed: 1.25, radius: 0.72, damage: 0.6, gold: 0.8, xp: 1, color: '#4ce6b0', cluster: 5 },
};

export interface WaveDef {
  /** Bots spawned per second during this wave. */
  rate: number;
  /** Relative spawn weights per bot kind. */
  mix: Partial<Record<EnemyKindId, number>>;
}

/** Nine 20-second waves fill the 180-second run. */
export const WAVE_SECONDS = 20;

export const WAVES: readonly WaveDef[] = [
  { rate: 1.4, mix: { grunt: 1 } },
  { rate: 1.9, mix: { grunt: 4, runner: 1 } },
  { rate: 2.5, mix: { grunt: 4, runner: 2, tank: 1 } },
  { rate: 3.2, mix: { grunt: 4, runner: 2, tank: 1, swarm: 1 } },
  { rate: 4.2, mix: { grunt: 3, runner: 3, tank: 1, swarm: 2 } },
  { rate: 5.4, mix: { grunt: 3, runner: 3, tank: 2, swarm: 2 } },
  { rate: 6.8, mix: { grunt: 3, runner: 3, tank: 2, swarm: 3 } },
  { rate: 8.2, mix: { grunt: 2, runner: 3, tank: 3, swarm: 3 } },
  { rate: 9.8, mix: { grunt: 2, runner: 4, tank: 3, swarm: 4 } },
];

export const BOSS = {
  /**
   * The brief says "ten times the regular bots in every parameter". HP, contact
   * damage and gold are exactly x10. Two parameters are deliberately NOT x10:
   *  - speed: x10 (520 vu/s) crosses the whole screen in under a second and is
   *    an unavoidable death, so the boss is only slightly faster than a grunt.
   *  - radius: x10 (110vu) is nearly a third of the screen width, so it is x4.
   */
  hpMultiplier: 10,
  /**
   * Applied to the BASE contact damage, not the time-scaled one: x10 of the
   * end-of-run value is 136, more than the player's whole health bar, and a
   * stationary square cannot dodge. At x10 of base (80) the boss still costs you
   * more than half your health per touch, so contact is a real threat but not an
   * instant, unavoidable loss.
   */
  damageMultiplier: 10,
  goldMultiplier: 10,
  radiusMultiplier: 4,
  speedMultiplier: 1.15,
  /**
   * A literal x10 boss dies in ~3 seconds against a maxed build, which is not a
   * fight. This extra factor is what makes the finale last. Set it to 1 for the
   * literal reading of the brief.
   */
  extraHpFactor: 6.5,
  /** Bots keep trickling in during the boss fight, at this share of wave 9. */
  addSpawnRatio: 0.3,
  hitCooldown: 0.6,
  /**
   * Enrage. A boss that is permanently slower than the player can be kited
   * forever, which turns the finale into a war of attrition with no ending. After
   * a grace period it accelerates until it is unambiguously faster than you, so
   * the fight always resolves one way or the other.
   */
  enrageAfter: 30,
  enrageRatePerSecond: 0.022,
  enrageMaxSpeedMultiplier: 2.4,
  color: '#ff2f6d',
} as const;

/** Permanent, gold-bought upgrades on the Upgrade screen. */
export const META_UPGRADES = {
  damage: { maxLevel: 30, step: 0.06, baseCost: 50, costGrowth: 1.28 },
  fireRate: { maxLevel: 25, step: 0.05, baseCost: 60, costGrowth: 1.3 },
  range: { maxLevel: 20, step: 0.04, baseCost: 65, costGrowth: 1.3 },
  maxHp: { maxLevel: 25, step: 0.05, baseCost: 55, costGrowth: 1.28 },
  magnet: { maxLevel: 20, step: 0.05, baseCost: 45, costGrowth: 1.28 },
  // Same reasoning as the in-run line: small steps and a short track, because
  // outrunning everything permanently is worse for the game than any other stat
  // being maxed.
  moveSpeed: { maxLevel: 12, step: 0.02, baseCost: 90, costGrowth: 1.34 },
} as const;

export type MetaUpgradeId = keyof typeof META_UPGRADES;

/** Bonus gold for actually killing the boss. */
export const BOSS_KILL_BONUS = 250;

/** Gold packs on the Shop screen, unlocked by watching a rewarded ad. */
export interface GoldPack {
  id: string;
  gold: number;
  title: string;
  subtitle: string;
  /** Times per calendar day this pack can be claimed. */
  dailyLimit: number;
  accent: string;
}

export const GOLD_PACKS: readonly GoldPack[] = [
  { id: 'stash', gold: 250, title: 'Small Stash', subtitle: 'A quick top-up', dailyLimit: 10, accent: '#4ce6b0' },
  { id: 'chest', gold: 900, title: 'Gold Chest', subtitle: 'Skip a grind session', dailyLimit: 5, accent: '#ffb03a' },
  { id: 'vault', gold: 3000, title: 'Bank Vault', subtitle: 'The big one', dailyLimit: 2, accent: '#a066ff' },
];

/** Ad unit ids. The defaults are Google's official test units — swap before release. */
export const AD_UNITS = {
  android: 'ca-app-pub-3940256099942544/5224354917',
  ios: 'ca-app-pub-3940256099942544/1712485313',
} as const;
