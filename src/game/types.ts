import type { EnemyKindId } from './config';

export interface Vec {
  x: number;
  y: number;
}

export interface Enemy {
  active: boolean;
  x: number;
  y: number;
  /** Knockback velocity, decays every frame. Seek velocity is applied on top. */
  kx: number;
  ky: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  damage: number;
  gold: number;
  /** XP dropped on death. */
  xp: number;
  kind: EnemyKindId | 'boss';
  color: string;
  /** Seconds until this bot can land another hit. */
  hitTimer: number;
  /** Seconds of white "just got shot" flash left. */
  flash: number;
  isBoss: boolean;
}

export interface Bullet {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds left before the shot expires if it hits nothing — see PLAYER.bulletLife. */
  life: number;
  damage: number;
}

/** A gold or XP orb dropped where a bot died. */
export interface Pickup {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds before an uncollected orb disappears. */
  life: number;
  kind: 'gold' | 'xp';
  value: number;
}

/** A Fire Cannon shot: launched, flies its arc, then explodes at a fixed point. */
export interface Fireball {
  active: boolean;
  /** Current rendered position, interpolated between origin and target. */
  x: number;
  y: number;
  originX: number;
  originY: number;
  /** Where it detonates — fixed at launch, not tracking the target afterward,
   *  the way a real lobbed shot would. */
  targetX: number;
  targetY: number;
  /** 0..1 through the flight. */
  t: number;
  duration: number;
}

/** The laser's visible beam for the brief window after it fires. Purely a
 *  render concern — the hit-test happens once, instantly, when it's cast. */
export interface LaserBeam {
  active: boolean;
  originX: number;
  originY: number;
  dirX: number;
  dirY: number;
  length: number;
  life: number;
  maxLife: number;
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface FloatText {
  active: boolean;
  x: number;
  y: number;
  life: number;
  /** `life` this float started at; alpha fades as life/maxLife. */
  maxLife: number;
  text: string;
  color: string;
  /** Font size in px (world units, so it scales with the camera like everything else). */
  size: number;
  /** Critical hits get a red lightning-bolt glyph drawn next to the number. */
  crit: boolean;
}

export interface RunResult {
  won: boolean;
  bossKilled: boolean;
  /** The player left the fight on purpose rather than being killed. */
  retreated?: boolean;
  kills: number;
  gold: number;
  level: number;
  survivedSeconds: number;
}

/** Screen geometry, recomputed on every resize/orientation change. */
export interface ViewInfo {
  cssW: number;
  cssH: number;
  /** World units -> css pixels. */
  scale: number;
  worldW: number;
  worldH: number;
  /** Half-axes of the spawn ellipse: bots enter just outside the viewport. */
  spawnRx: number;
  spawnRy: number;
}
