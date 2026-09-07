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
  /**
   * How long a bullet lives if it never hits anything, in seconds. A miss now
   * flies until it leaves the map or hits a wall rather than despawning at the
   * firing radius — that radius only ever gated which bots the turret could
   * pick as a target, not how far the resulting shot travels. This is sized to
   * comfortably outlast the trip from the middle of the map to a wall
   * (WORLD.halfSize / bulletSpeed ≈ 3.6s); it exists as a safety cap, not the
   * thing that normally ends a miss.
   */
  bulletLife: 4.5,
  /** Seconds of invulnerability after taking a hit (prevents multi-hit spikes). */
  iframes: 0.22,
  /** Top movement speed in vu/s. Compare with ENEMY_BASE.speed and the kind multipliers. */
  moveSpeed: 152,
  /** Radius inside which dropped orbs are pulled toward the square, in vu. */
  magnetRadius: 150,
  /** Simultaneous firing directions before any upgrade — one target at a time. */
  hands: 1,
  /**
   * Every hand beyond the first fires at this share of normal damage. A second
   * full-damage gun would double single-pick value against anything but a lone
   * bot — measured at 100%, "third" meta tier went from a 17% to a 100% win
   * rate off a single pick. At this share extra hands are still clearly worth
   * taking against a crowd (their whole reason to exist) without silently
   * doubling the value of every other stat in the build.
   */
  extraHandDamageShare: 0.32,
  /**
   * How fast the square reaches its target velocity, in 1/s. High enough to feel
   * instant, low enough that a flick of the thumb does not read as a teleport.
   */
  moveResponse: 16,
} as const;

/**
 * A flat chance for any hit on a bot — bullet, laser, fireball splash, or aura
 * tick alike, since damageEnemy() is the one funnel all of them go through —
 * to land for extra damage. Kept modest on purpose: chance × (multiplier - 1)
 * is the average DPS gain across the whole run (9% here), so it reads as an
 * exciting spike rather than silently reshaping the win-rate ladder the way
 * an uncapped "More Hands" once did.
 */
export const CRIT = {
  chance: 0.15,
  multiplier: 1.6,
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
 * The map is a real, finite square, not an infinite plane — a fence you can
 * actually run into. At base movement speed the centre is about 16 seconds
 * from the nearest wall (less once Sprint is upgraded), so the boundary is
 * reachable within a run if you commit to running in one direction, not a
 * formality — but 2000 was tight enough, once obstacles were also in play,
 * to measurably change the outcome for an invested build that used to win
 * outright (two-thirds-upgraded went from a 100% to a 60% win rate on the
 * balance harness); this is the smallest size that gave that back.
 */
export const WORLD = {
  halfSize: 2500,
  /** Visual thickness of the fence line, in vu — not a collision surface. */
  fenceWidth: 14,
} as const;

/** A static rectangle neither the square, a bot, nor a bullet can pass through. */
export interface Obstacle {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}

/**
 * Hand-placed, not generated: a level, however small, reads as designed rather
 * than random, and a fixed layout means a screenshot or a returning player's
 * mental map of "there's a wall near the north gate" stays true from run to
 * run. The centre is left clear so the first several seconds of a run —
 * before the wave has built up enough to make cover matter — aren't spent
 * puzzling around furniture.
 */
export const OBSTACLES: readonly Obstacle[] = [
  { x: 620, y: 260, halfW: 190, halfH: 42 },
  { x: -560, y: 640, halfW: 42, halfH: 170 },
  { x: 880, y: -580, halfW: 90, halfH: 90 },
  { x: -760, y: -420, halfW: 220, halfH: 46 },
  { x: 1420, y: 780, halfW: 46, halfH: 200 },
  { x: -1380, y: 520, halfW: 110, halfH: 110 },
  { x: 240, y: -1300, halfW: 200, halfH: 50 },
  { x: -320, y: 1360, halfW: 50, halfH: 210 },
  { x: 1300, y: -1280, halfW: 130, halfH: 130 },
  { x: -1260, y: -1080, halfW: 190, halfH: 60 },
  { x: 1680, y: 60, halfW: 60, halfH: 220 },
  { x: -1700, y: -140, halfW: 220, halfH: 60 },
] as const;

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
  /**
   * Hands is a flat count, not a percentage: each pick adds one more
   * simultaneously-fired shot, each aimed at its own nearest bot instead of
   * piling every bullet onto one target. `step` is unused by the multiplier
   * formula (pickMultiplier) — refreshStats() computes this stat directly as
   * PLAYER.hands + picks — and is kept here only so this line fits the same
   * table shape as its siblings.
   */
  hands: { step: 1, maxPicks: 3 },
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

export type EnemyKindId = 'grunt' | 'runner' | 'tank' | 'swarm' | 'shooter';

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
  /**
   * Stage 2 only (see WAVES_STAGE2). Deliberately fragile — hp below even a
   * runner — because its threat is the shot, not its own durability: reaching
   * it and killing it fast is always the right answer, so it never becomes a
   * damage sponge that also outranges you. `damage` doubles as its bolt
   * damage too (see SHOOTER in updateEnemies) — one number for "how much this
   * kind hurts you," whether that happens by touch or by shot.
   */
  shooter: { id: 'shooter', hp: 0.7, speed: 0.9, radius: 1, damage: 1, gold: 1.5, xp: 1, color: '#e64cff', cluster: 1 },
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

/**
 * Stage 2's wave table. Same nine 20-second slots and the same `rate` per
 * slot as WAVES — the difficulty step comes from STAGE_HP_MULTIPLIER
 * doubling every bot's HP and from shooter sharing the spawn budget with the
 * stage-1 kinds, not from spawning bots faster on top of that.
 */
export const WAVES_STAGE2: readonly WaveDef[] = [
  { rate: 1.4, mix: { grunt: 1 } },
  { rate: 1.9, mix: { grunt: 3, runner: 1, shooter: 1 } },
  { rate: 2.5, mix: { grunt: 3, runner: 2, tank: 1, shooter: 1 } },
  { rate: 3.2, mix: { grunt: 3, runner: 2, tank: 1, swarm: 1, shooter: 1 } },
  { rate: 4.2, mix: { grunt: 2, runner: 3, tank: 1, swarm: 2, shooter: 2 } },
  { rate: 5.4, mix: { grunt: 2, runner: 3, tank: 2, swarm: 2, shooter: 2 } },
  { rate: 6.8, mix: { grunt: 2, runner: 3, tank: 2, swarm: 3, shooter: 2 } },
  { rate: 8.2, mix: { grunt: 1, runner: 3, tank: 3, swarm: 3, shooter: 3 } },
  { rate: 9.8, mix: { grunt: 1, runner: 4, tank: 3, swarm: 4, shooter: 3 } },
];

export type StageId = 1 | 2;
export const STAGE_IDS: readonly StageId[] = [1, 2];

/**
 * Stage 2's one across-the-board rule: every bot (and the boss) has double
 * the HP of its stage-1 counterpart at the same point in the run. Nothing
 * else about a shared kind (speed, damage, gold) changes between stages —
 * only HP and, separately, the stage-2-only shooter kind and the triangle
 * shape (see Enemy.shape) mark a run as "the harder stage."
 */
export const STAGE_HP_MULTIPLIER: Record<StageId, number> = { 1: 1, 2: 2 };

/**
 * The shooter's behavior, not its power level (that's ENEMY_KINDS.shooter,
 * same as every other kind). It holds a preferred distance instead of
 * closing to contact range, and its cooldown doubles as the visible wind-up
 * before it fires — see the `shootCooldown <= SHOOTER.telegraph` check in
 * renderer.ts — so a hit always comes with a fair beat of warning, which is
 * what makes "forces the player to keep moving" a fair pressure instead of
 * an unavoidable chip-damage tax.
 */
export const SHOOTER = {
  standoffRange: 260,
  standoffSlop: 40,
  cooldown: 2.2,
  telegraph: 0.45,
  projectileSpeed: 340,
  projectileRadius: 6,
  /** Beyond this it just keeps closing in rather than opening fire from way out. */
  engageRange: 420,
} as const;

/** Purely visual: the stage-2 boss's triangle is drawn a bit past its actual
 *  hit-radius so "a big triangle boss" reads as bigger without moving the
 *  hitbox or the HP math (that's STAGE_HP_MULTIPLIER's job alone). */
export const STAGE2_BOSS_VISUAL_BONUS = 1.15;

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

/**
 * The victory sequence: the run doesn't end the instant the boss dies. Every
 * gold orb still on the map — not just the ones inside the magnet — gets
 * vacuumed straight to the square while the total on screen counts up, coin by
 * coin, before the result screen appears.
 */
export const VICTORY = {
  /** Seconds the sequence runs, unless every orb is collected sooner. */
  duration: 5,
  /** Pull speed during the vacuum, well past the normal magnet's pace — this
   *  is a payoff moment, not gameplay to react to. */
  pullSpeed: 950,
} as const;

/**
 * Equipment: gear that visibly attaches to the square and adds a second
 * (third, fourth) way to fight, running alongside the ordinary gun rather than
 * replacing it. Unlike the gold-bought Upgrade screen or the in-run level-up
 * picks, these are never purchased — each is a permanent, one-time unlock that
 * drops from defeating the boss (see meta/equipment.ts for the drop roll), and
 * once owned it's active in every run from then on. The Gear screen
 * (src/ui/screens/gear.ts) is a gallery of what's been found, not a shop.
 */
export const EQUIPMENT_IDS = ['laser', 'fireCannon', 'aura'] as const;
export type EquipmentId = (typeof EQUIPMENT_IDS)[number];

export interface EquipmentDef {
  name: string;
  description: string;
  icon: string;
  accent: string;
}

export const EQUIPMENT: Record<EquipmentId, EquipmentDef> = {
  laser: {
    name: 'Piercing Laser',
    description: 'Every few seconds, a beam sweeps through the nearest bot and everything behind it.',
    icon: '║',
    accent: '#5ad1ff',
  },
  fireCannon: {
    name: 'Fire Cannon',
    description: 'Lobs an exploding fireball at whatever is crossing the edge of your range.',
    icon: '☄',
    accent: '#ff8f4d',
  },
  aura: {
    name: 'Hellfire Aura',
    description: 'A ring of fire around you that burns anything that gets close.',
    icon: '♨',
    accent: '#ff2f6d',
  },
} as const;

export const LASER = {
  cooldown: 3,
  damage: 24,
  /** Half-width of the beam's hit-test corridor, in vu. */
  beamWidth: 14,
  /** How long the beam stays drawn after firing, in seconds — purely visual. */
  visualLife: 0.18,
} as const;

export const FIRE_CANNON = {
  cooldown: 7,
  damage: 46,
  splashRadius: 80,
  /** Flight time from launch to impact, in seconds — the arc's visual height
   *  is derived from this so a longer lob reads as a higher one. */
  arcTime: 0.65,
} as const;

export const AURA = {
  radius: 95,
  /** Damage applied per tick, not per second — see AURA.tickInterval. */
  damagePerTick: 7,
  tickInterval: 0.4,
} as const;

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
