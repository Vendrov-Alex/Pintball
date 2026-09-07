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
