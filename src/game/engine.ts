import {
  AURA,
  BOSS,
  BOSS_KILL_BONUS,
  CRIT,
  DESPAWN_FACTOR,
  ENEMY_BASE,
  ENEMY_KINDS,
  ENEMY_SCALING,
  FIRE_CANNON,
  LASER,
  LEVEL_UP_HEAL,
  MAX_LEVEL,
  OBSTACLES,
  PICKUP,
  PLAYER,
  RUN_DURATION,
  RUN_UPGRADE_LINES,
  SHOOTER,
  SPAWN_LEAD_BIAS,
  STAGE_HP_MULTIPLIER,
  VICTORY,
  VIEW_SHORT_SIDE,
  WAVES,
  WAVES_STAGE2,
  WAVE_SECONDS,
  WORLD,
  XP_TABLE,
  type EnemyKind,
  type EnemyKindId,
  type EquipmentId,
  type Obstacle,
  type StageId,
  type WaveDef,
} from './config';
import { SpatialGrid } from './grid';
import { Pool } from './pool';
import type { Bullet, Enemy, EnemyBolt, Fireball, FloatText, LaserBeam, Particle, Pickup, RunResult, Vec, ViewInfo } from './types';
import {
  emptyPicks,
  pickMultiplier,
  rollChoices,
  type RunPicks,
  type RunUpgradeId,
  type UpgradeChoice,
} from './upgrades';

const MAX_ENEMIES = 340;
// Missed shots used to die at the firing radius; now they fly until they leave
// the map or hit a wall, so more are in the air at any one instant.
const MAX_BULLETS = 260;
const MAX_PARTICLES = 420;
// Damage numbers fire far more often than gold/bounty text ever did — a maxed
// multi-hand build can land a dozen hits a second — so this pool is sized for
// that, not for the occasional reward popup.
const MAX_FLOATS = 200;
/** Two orbs per kill at up to ten kills a second, times an 18 second lifetime. */
const MAX_PICKUPS = 640;
// Shooters fire on a 2.2s cooldown each and only exist in stage 2 waves —
// generous headroom for a screen full of them, not sized for every enemy.
const MAX_ENEMY_BOLTS = 80;

export type Phase = 'idle' | 'running' | 'levelup' | 'paused' | 'victory' | 'ended';

export interface EngineHooks {
  onLevelUp(choices: UpgradeChoice[], level: number): void;
  onBossSpawn(): void;
  /** The boss is dead and the map-wide gold vacuum has begun — see `Game.equipment` for what's owned. */
  onVictoryStart(): void;
  onEnd(result: RunResult): void;
  onKill(): void;
  onPlayerHit(): void;
  onShoot(): void;
  /** One orb landed during the victory-sequence vacuum, for the coin-counting cue. */
  onCoinCollect(amount: number): void;
}

/** Multiplier per upgrade line; also the shape the meta screen hands to start(). */
export type PlayerStats = Record<RunUpgradeId, number>;

/** Absolute, ready-to-use values derived from base x meta x in-run picks. */
export interface DerivedStats {
  damage: number;
  fireRate: number;
  range: number;
  magnet: number;
  maxHp: number;
  moveSpeed: number;
  /** Simultaneous firing directions this volley — see RUN_UPGRADE_LINES.hands. */
  hands: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class Game {
  phase: Phase = 'idle';
  view: ViewInfo = { cssW: 1, cssH: 1, scale: 1, worldW: 1, worldH: 1, spawnRx: 1, spawnRy: 1 };

  /**
   * The square's position in world space. The camera follows the player and
   * bots are spawned and recycled relative to it, which is what makes a
   * survivor-style run feel open rather than arena-shaped — but the world
   * itself is a real, finite square (WORLD.halfSize in config.ts): the fence
   * and its obstacles are physical, not scenery.
   */
  readonly player: Vec = { x: 0, y: 0 };
  readonly velocity: Vec = { x: 0, y: 0 };
  /** Last non-zero heading, used to bias spawns ahead of the player. */
  readonly heading: Vec = { x: 0, y: 1 };

  /** Seconds of gameplay elapsed; frozen while a level-up card is open. */
  elapsed = 0;
  hp: number = PLAYER.maxHp;
  maxHp: number = PLAYER.maxHp;
  level = 1;
  /** XP collected toward the next level. */
  xpThisLevel = 0;
  kills = 0;
  gold = 0;
  bossActive = false;
  bossKilled = false;
  /** Seconds since the boss appeared; drives its enrage ramp. */
  bossTimer = 0;
  /** Screen shake amplitude in world units, decays every frame. */
  shake = 0;
  /** Rendering-only pulse used by the range circle when it grows. */
  rangePulse = 0;

  picks: RunPicks = emptyPicks();
  stats: DerivedStats = {
    damage: PLAYER.damage,
    fireRate: PLAYER.fireRate,
    range: PLAYER.range,
    magnet: PLAYER.magnetRadius,
    maxHp: PLAYER.maxHp,
    moveSpeed: PLAYER.moveSpeed,
    hands: PLAYER.hands,
  };

  readonly enemies = new Pool<Enemy>(MAX_ENEMIES, () => ({
    active: false, x: 0, y: 0, kx: 0, ky: 0, hp: 1, maxHp: 1, radius: 10,
    speed: 50, damage: 1, gold: 1, xp: 1, kind: 'grunt', color: '#fff', hitTimer: 0, flash: 0, isBoss: false,
    shape: 'circle', shootCooldown: 0, strafeSign: 1,
  }));
  readonly bullets = new Pool<Bullet>(MAX_BULLETS, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, damage: 1,
  }));
  readonly particles = new Pool<Particle>(MAX_PARTICLES, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 3, color: '#fff',
  }));
  readonly floats = new Pool<FloatText>(MAX_FLOATS, () => ({
    active: false, x: 0, y: 0, life: 0, maxLife: 1, text: '', color: '#fff', size: 26, crit: false,
  }));
  readonly pickups = new Pool<Pickup>(MAX_PICKUPS, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, kind: 'gold', value: 1,
  }));
  // Cadence is slow (7s) and one shot is almost always resolved before the
  // next is due, so this only ever needs to be big enough to be safe, not big.
  readonly fireballs = new Pool<Fireball>(6, () => ({
    active: false, x: 0, y: 0, originX: 0, originY: 0, targetX: 0, targetY: 0, t: 0, duration: 1,
  }));
  readonly enemyBolts = new Pool<EnemyBolt>(MAX_ENEMY_BOLTS, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, damage: 1,
  }));

  boss: Enemy | null = null;
  /** Which stage this run is on — see STAGE_HP_MULTIPLIER and WAVES_STAGE2 in config.ts. */
  stage: StageId = 1;

  /**
   * Boss-dropped gear (see meta/equipment.ts), passed in at start() and fixed
   * for the run. Ownership itself lives in the profile, outside the engine —
   * this is just which of it is switched on for the run in progress.
   */
  equipment: Record<EquipmentId, boolean> = { laser: false, fireCannon: false, aura: false };
  /** The laser's current beam, if one was fired recently enough to still be drawn. */
  laserBeam: LaserBeam = { active: false, originX: 0, originY: 0, dirX: 0, dirY: 1, length: 0, life: 0, maxLife: 1 };

  private readonly grid = new SpatialGrid(44);
  private readonly hooks: EngineHooks;
  private metaMultipliers: PlayerStats = {
    damage: 1, fireRate: 1, range: 1, magnet: 1, maxHp: 1, moveSpeed: 1, hands: 1,
  };

  private fireCooldown = 0;
  private laserCooldown = 0;
  private cannonCooldown = 0;
  private auraTick = 0;
  /** Seconds left in the post-boss gold vacuum; see startVictory(). */
  private victoryTimer = 0;
  private spawnCarry = 0;
  private invuln = 0;
  /** Normalised movement input, magnitude 0..1. */
  private moveX = 0;
  private moveY = 0;

  constructor(hooks: EngineHooks) {
    this.hooks = hooks;
  }

  // ---------------------------------------------------------------- lifecycle

  resize(cssW: number, cssH: number): void {
    const scale = Math.min(cssW, cssH) / VIEW_SHORT_SIDE;
    const worldW = cssW / scale;
    const worldH = cssH / scale;
    this.view = {
      cssW,
      cssH,
      scale,
      worldW,
      worldH,
      // An ellipse hugging the viewport, not a circle through its corners: on a
      // 20:9 phone the circumscribed circle sits 800+ units above the player and
      // the first bots would need fifteen seconds to walk on screen.
      spawnRx: worldW / 2 + 40,
      spawnRy: worldH / 2 + 40,
    };
  }

  /**
   * `meta` carries the permanent, gold-bought multipliers. `equipment` is
   * which boss-dropped gear is owned — everything owned is active for the
   * whole run; there's no loadout to manage for three items. `stage` picks
   * which wave table and HP multiplier the run uses (see config.ts) and is
   * fixed for the whole run, same as everything else start() sets up.
   */
  start(
    meta: PlayerStats,
    equipment: Record<EquipmentId, boolean> = { laser: false, fireCannon: false, aura: false },
    stage: StageId = 1,
  ): void {
    this.metaMultipliers = meta;
    this.equipment = equipment;
    this.stage = stage;
    this.picks = emptyPicks();
    this.refreshStats();
    this.maxHp = this.stats.maxHp;
    this.hp = this.maxHp;
    this.elapsed = 0;
    this.level = 1;
    this.kills = 0;
    this.xpThisLevel = 0;
    this.gold = 0;
    this.bossActive = false;
    this.bossKilled = false;
    this.bossTimer = 0;
    this.boss = null;
    this.fireCooldown = 0;
    this.laserCooldown = LASER.cooldown;
    this.cannonCooldown = FIRE_CANNON.cooldown;
    this.auraTick = 0;
    this.victoryTimer = 0;
    this.laserBeam.active = false;
    this.spawnCarry = 0;
    this.invuln = 0;
    this.shake = 0;
    this.rangePulse = 0;
    this.player.x = 0;
    this.player.y = 0;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.heading.x = 0;
    this.heading.y = 1;
    this.moveX = 0;
    this.moveY = 0;
    this.enemies.clear();
    this.bullets.clear();
    this.fireballs.clear();
    this.enemyBolts.clear();
    this.particles.clear();
    this.floats.clear();
    this.pickups.clear();
    this.grid.clear();
    this.phase = 'running';
    this.prewarm();
  }

  abandon(): void {
    this.phase = 'idle';
  }

  /** Leaving mid-vacuum still means the boss is dead — skip straight to the
   *  result with whatever gold had already landed, rather than losing the win. */
  skipVictory(): void {
    if (this.phase === 'victory') this.end(true);
  }

  private refreshStats(): void {
    const of = (id: RunUpgradeId, base: number): number =>
      base * this.metaMultipliers[id] * pickMultiplier(id, this.picks[id]);
    this.stats = {
      damage: of('damage', PLAYER.damage),
      fireRate: of('fireRate', PLAYER.fireRate),
      range: of('range', PLAYER.range),
      magnet: of('magnet', PLAYER.magnetRadius),
      maxHp: of('maxHp', PLAYER.maxHp),
      moveSpeed: of('moveSpeed', PLAYER.moveSpeed),
      // Flat count, not a multiplier: pickMultiplier's (1+step)^picks formula
      // would blow this up geometrically, which is why hands is computed here
      // instead of going through of().
      hands: PLAYER.hands + this.picks.hands,
    };
  }

  // ------------------------------------------------------------------- input

  /** Joystick or keyboard direction. Magnitude above 1 is clamped. */
  setMove(x: number, y: number): void {
    const len = Math.hypot(x, y);
    if (len < 0.001) {
      this.moveX = 0;
      this.moveY = 0;
      return;
    }
    const m = Math.min(1, len);
    this.moveX = (x / len) * m;
    this.moveY = (y / len) * m;
    this.heading.x = x / len;
    this.heading.y = y / len;
  }

  stopMove(): void {
    this.moveX = 0;
    this.moveY = 0;
  }

  // ------------------------------------------------------------- progression

  /** XP still needed for the next level, or null at the cap. */
  xpForNextLevel(): number | null {
    if (this.level >= MAX_LEVEL) return null;
    return XP_TABLE[this.level - 1];
  }

  xpProgress(): number {
    const need = this.xpForNextLevel();
    return need === null ? 1 : clamp(this.xpThisLevel / need, 0, 1);
  }

  /**
   * Applying the pick itself is instant — the stat updates right away so the
   * HUD reflects it immediately — but simulation stays frozen afterward
   * (`'paused'`, not `'running'`) until resume() is called. Auto-resuming the
   * instant a card is dismissed threw the player back into a crowd they had
   * no chance to look at first; this is the beat that lets them actually see
   * what they just picked and where the danger is before diving back in.
   */
  applyChoice(id: RunUpgradeId): void {
    const before = this.stats.maxHp;
    this.picks[id] = Math.min(RUN_UPGRADE_LINES[id].maxPicks, this.picks[id] + 1);
    this.refreshStats();

    if (id === 'maxHp') {
      // A bigger bar you have to refill is a downgrade in the moment, so the
      // added health is granted outright.
      this.maxHp = this.stats.maxHp;
      this.hp += this.maxHp - before;
    }
    if (id === 'range' || id === 'magnet') this.rangePulse = 1;

    this.phase = 'paused';
  }

  /** Leaves the post-level-up pause. A no-op from any other phase, so the
   *  UI can call it unconditionally on every touch without checking first. */
  resume(): void {
    if (this.phase === 'paused') this.phase = 'running';
  }

  private gainXp(amount: number): void {
    if (this.level >= MAX_LEVEL) return;
    this.xpThisLevel += amount;
    let need = this.xpForNextLevel();
    while (need !== null && this.xpThisLevel >= need) {
      this.xpThisLevel -= need;
      this.level += 1;
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * LEVEL_UP_HEAL);
      if (this.level >= MAX_LEVEL) {
        this.xpThisLevel = 0;
        need = null;
      } else {
        need = this.xpForNextLevel();
      }
      this.phase = 'levelup';
      this.hooks.onLevelUp(rollChoices(this.picks, Math.random), this.level);
      // Only one level-up card is presented per frame; any surplus XP stays
      // banked in xpThisLevel and rolls into the next card.
      break;
    }
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    if (this.phase === 'victory') {
      this.updateVictory(dt);
      return;
    }
    if (this.phase !== 'running') return;

    this.elapsed += dt;
    this.shake = Math.max(0, this.shake - dt * 34);
    this.rangePulse = Math.max(0, this.rangePulse - dt * 1.6);
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.laserBeam.life > 0) this.laserBeam.life -= dt;

    if (!this.bossActive && !this.bossKilled && this.elapsed >= RUN_DURATION) this.spawnBoss();
    if (this.bossActive) this.bossTimer += dt;

    this.updatePlayer(dt);
    this.grid.rebuild(this.enemies.items);
    this.updateSpawning(dt);
    this.updateEnemies(dt);
    this.updateWeapon(dt);
    this.updateLaser(dt);
    this.updateFireCannon(dt);
    this.updateFireballs(dt);
    this.updateAura(dt);
    this.updateBullets(dt);
    this.updateEnemyBolts(dt);
    this.updatePickups(dt);
    this.updateParticles(dt);
    this.updateFloats(dt);

    if (this.hp <= 0) this.end(false);
  }

  private updatePlayer(dt: number): void {
    const targetVx = this.moveX * this.stats.moveSpeed;
    const targetVy = this.moveY * this.stats.moveSpeed;
    // Framerate-independent approach to the target velocity.
    const t = 1 - Math.exp(-PLAYER.moveResponse * dt);
    this.velocity.x = lerp(this.velocity.x, targetVx, t);
    this.velocity.y = lerp(this.velocity.y, targetVy, t);
    this.player.x += this.velocity.x * dt;
    this.player.y += this.velocity.y * dt;
    this.constrainToWorld(this.player, PLAYER.halfSize * 1.15);
  }

  // ------------------------------------------------------------- world bounds

  /**
   * Pushes a point out of every obstacle it overlaps, then clamps it inside the
   * outer fence. Shared by the player, every bot, and a fresh spawn point — a
   * bot that rolled a spawn location inside a wall gets shoved clear by the
   * exact same code that keeps it from walking into one later.
   */
  private constrainToWorld(target: { x: number; y: number }, radius: number): void {
    for (const o of OBSTACLES) {
      const closestX = clamp(target.x, o.x - o.halfW, o.x + o.halfW);
      const closestY = clamp(target.y, o.y - o.halfH, o.y + o.halfH);
      const dx = target.x - closestX;
      const dy = target.y - closestY;
      const distSq = dx * dx + dy * dy;
      if (distSq >= radius * radius) continue;

      if (distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const push = radius - dist;
        target.x += (dx / dist) * push;
        target.y += (dy / dist) * push;
      } else {
        // Dead centre of the rectangle (or exactly on an edge) — push out along
        // whichever side has the least penetration rather than leaving a
        // division by zero.
        const left = target.x - (o.x - o.halfW);
        const right = o.x + o.halfW - target.x;
        const top = target.y - (o.y - o.halfH);
        const bottom = o.y + o.halfH - target.y;
        const min = Math.min(left, right, top, bottom);
        if (min === left) target.x = o.x - o.halfW - radius;
        else if (min === right) target.x = o.x + o.halfW + radius;
        else if (min === top) target.y = o.y - o.halfH - radius;
        else target.y = o.y + o.halfH + radius;
      }
    }

    const bound = WORLD.halfSize - radius;
    target.x = clamp(target.x, -bound, bound);
    target.y = clamp(target.y, -bound, bound);
  }

  private pointInObstacle(x: number, y: number): boolean {
    for (const o of OBSTACLES) {
      if (x >= o.x - o.halfW && x <= o.x + o.halfW && y >= o.y - o.halfH && y <= o.y + o.halfH) return true;
    }
    return false;
  }

  /** True if any obstacle stands between the two points — used to keep the
   *  turret from locking onto a bot it has no line to, and nothing else. */
  private segmentBlocked(x1: number, y1: number, x2: number, y2: number): boolean {
    for (const o of OBSTACLES) {
      if (this.segmentIntersectsRect(x1, y1, x2, y2, o)) return true;
    }
    return false;
  }

  /** Liang-Barsky segment/rectangle clipping: true if the segment [P1,P2]
   *  passes through the rectangle `o` anywhere along its length. */
  private segmentIntersectsRect(x1: number, y1: number, x2: number, y2: number, o: Obstacle): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const minX = o.x - o.halfW;
    const maxX = o.x + o.halfW;
    const minY = o.y - o.halfH;
    const maxY = o.y + o.halfH;

    let tMin = 0;
    let tMax = 1;
    const clipEdge = (p: number, q: number): boolean => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > tMax) return false;
        if (r > tMin) tMin = r;
      } else {
        if (r < tMin) return false;
        if (r < tMax) tMax = r;
      }
      return true;
    };

    return (
      clipEdge(-dx, x1 - minX) &&
      clipEdge(dx, maxX - x1) &&
      clipEdge(-dy, y1 - minY) &&
      clipEdge(dy, maxY - y1) &&
      tMin <= tMax
    );
  }

  // ---------------------------------------------------------------- spawning

  /** Stage 2 has its own wave table (adds the shooter kind into the mix) —
   *  everything that reads WAVES to drive spawning goes through this instead. */
  private waves(): readonly WaveDef[] {
    return this.stage === 2 ? WAVES_STAGE2 : WAVES;
  }

  private waveIndex(): number {
    const waves = this.waves();
    return clamp(Math.floor(this.elapsed / WAVE_SECONDS), 0, waves.length - 1);
  }

  /** 0 at the start of the run, 1 at the boss. */
  private difficultyT(): number {
    return clamp(this.elapsed / RUN_DURATION, 0, 1);
  }

  private updateSpawning(dt: number): void {
    const waves = this.waves();
    const wave = waves[this.waveIndex()];
    const rate = this.bossActive ? waves[waves.length - 1].rate * BOSS.addSpawnRatio : wave.rate;
    this.spawnCarry += rate * dt;
    // The budget is spent in BOTS, not spawn events: a swarm cluster costs five.
    // Counting events instead silently multiplied the real wave rate by ~2.2x.
    while (this.spawnCarry >= 1) {
      this.spawnCarry -= this.spawnFromWave(wave.mix);
    }
  }

  /**
   * Picks a spawn angle. Most bots appear in the hemisphere the player is running
   * toward, so that sprinting in a straight line runs you into the wave rather
   * than away from it — otherwise kiting forever is the dominant strategy.
   */
  private spawnAngle(): number {
    const forward = Math.atan2(this.heading.y, this.heading.x);
    if (Math.random() < SPAWN_LEAD_BIAS) return forward + (Math.random() - 0.5) * Math.PI;
    return forward + Math.PI + (Math.random() - 0.5) * Math.PI;
  }

  /** Returns how many bots were actually placed. */
  private spawnFromWave(mix: Partial<Record<EnemyKindId, number>>): number {
    const entries = Object.entries(mix) as [EnemyKindId, number][];
    let total = 0;
    for (const [, weight] of entries) total += weight;
    let roll = Math.random() * total;
    let picked: EnemyKindId = entries[0][0];
    for (const [id, weight] of entries) {
      roll -= weight;
      if (roll <= 0) {
        picked = id;
        break;
      }
    }

    const kind = ENEMY_KINDS[picked];
    const angle = this.spawnAngle();
    for (let i = 0; i < kind.cluster; i++) {
      // Cluster members fan out around the anchor so they arrive as a pack.
      const a = angle + (i - (kind.cluster - 1) / 2) * 0.09;
      const pad = 1 + (i % 2) * 0.04;
      this.spawnEnemy(
        kind,
        this.player.x + Math.cos(a) * this.view.spawnRx * pad,
        this.player.y + Math.sin(a) * this.view.spawnRy * pad,
      );
    }
    return kind.cluster;
  }

  private spawnEnemy(kind: EnemyKind, x: number, y: number): void {
    const e = this.enemies.obtain();
    if (!e) return;
    const t = this.difficultyT();
    const hpMul = lerp(1, ENEMY_SCALING.hpAtEnd, t);
    const speedMul = lerp(1, ENEMY_SCALING.speedAtEnd, t);
    const dmgMul = lerp(1, ENEMY_SCALING.damageAtEnd, t);
    const goldMul = lerp(1, ENEMY_SCALING.goldAtEnd, t);
    const xpMul = lerp(1, ENEMY_SCALING.xpAtEnd, t);

    e.x = x;
    e.y = y;
    e.kx = 0;
    e.ky = 0;
    e.maxHp = ENEMY_BASE.hp * kind.hp * hpMul * STAGE_HP_MULTIPLIER[this.stage];
    e.hp = e.maxHp;
    e.radius = ENEMY_BASE.radius * kind.radius;
    e.speed = ENEMY_BASE.speed * kind.speed * speedMul;
    e.damage = ENEMY_BASE.damage * kind.damage * dmgMul;
    e.gold = ENEMY_BASE.gold * kind.gold * goldMul;
    e.xp = kind.xp * xpMul;
    e.kind = kind.id;
    e.color = kind.color;
    e.hitTimer = 0;
    e.flash = 0;
    e.isBoss = false;
    e.shape = this.stage === 2 ? 'triangle' : 'circle';
    // Randomised so a wave of shooters doesn't fire in lockstep or all strafe
    // the same way — irrelevant, and left at these defaults, for every other kind.
    e.shootCooldown = kind.id === 'shooter' ? Math.random() * SHOOTER.cooldown : 0;
    e.strafeSign = Math.random() < 0.5 ? 1 : -1;
    // A spawn point computed from the player's position and the viewport can
    // land outside the fence or inside a wall when the player is near one;
    // shove it back in exactly the way movement already does every frame.
    this.constrainToWorld(e, e.radius);
  }

  private spawnBoss(): void {
    const e = this.enemies.obtain();
    if (!e) return;
    const angle = this.spawnAngle();
    e.x = this.player.x + Math.cos(angle) * this.view.spawnRx;
    e.y = this.player.y + Math.sin(angle) * this.view.spawnRy;
    e.kx = 0;
    e.ky = 0;
    e.maxHp = ENEMY_BASE.hp * ENEMY_SCALING.hpAtEnd * BOSS.hpMultiplier * BOSS.extraHpFactor * STAGE_HP_MULTIPLIER[this.stage];
    e.hp = e.maxHp;
    e.radius = ENEMY_BASE.radius * BOSS.radiusMultiplier;
    e.speed = ENEMY_BASE.speed * BOSS.speedMultiplier;
    e.damage = ENEMY_BASE.damage * BOSS.damageMultiplier;
    e.gold = ENEMY_BASE.gold * ENEMY_SCALING.goldAtEnd * BOSS.goldMultiplier;
    e.xp = 10;
    e.kind = 'boss';
    e.color = BOSS.color;
    e.hitTimer = 0;
    e.flash = 0;
    e.isBoss = true;
    e.shape = this.stage === 2 ? 'triangle' : 'circle';
    e.shootCooldown = 0;
    e.strafeSign = 1;
    this.constrainToWorld(e, e.radius);

    this.boss = e;
    this.bossActive = true;
    this.shake = 16;
    this.hooks.onBossSpawn();
  }

  /**
   * Seeds a handful of bots already halfway in, so the run opens with something
   * to shoot instead of several seconds of an empty field.
   */
  private prewarm(): void {
    const kind = ENEMY_KINDS.grunt;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
      this.spawnEnemy(kind, Math.cos(a) * this.view.spawnRx * 0.55, Math.sin(a) * this.view.spawnRy * 0.55);
    }
  }

  // ----------------------------------------------------------------- enemies

  private updateEnemies(dt: number): void {
    const contactPad = PLAYER.halfSize * 1.15;
    const cullSq = Math.pow(Math.max(this.view.spawnRx, this.view.spawnRy) * DESPAWN_FACTOR, 2);

    for (const e of this.enemies.items) {
      if (!e.active) continue;

      e.hitTimer = Math.max(0, e.hitTimer - dt);
      e.flash = Math.max(0, e.flash - dt * 6);

      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const distSq = dx * dx + dy * dy;

      // A bot the player has outrun is dead weight in the pool; recycling it frees
      // the slot for one that spawns where the player actually is.
      if (!e.isBoss && distSq > cullSq) {
        e.active = false;
        continue;
      }

      const dist = Math.sqrt(distSq) || 1;
      const speed = e.isBoss ? e.speed * this.bossEnrage() : e.speed;
      let vx: number;
      let vy: number;
      if (e.kind === 'shooter' && !e.isBoss) {
        [vx, vy] = this.shooterVelocity(e, dx, dy, dist, speed);
        this.updateShooterFire(e, dx, dy, dist, dt);
      } else {
        vx = (dx / dist) * speed;
        vy = (dy / dist) * speed;
      }

      // Separation keeps the swarm readable instead of collapsing to one dot.
      if (!e.isBoss) {
        let sx = 0;
        let sy = 0;
        this.grid.query(e.x, e.y, e.radius * 2.1, (other) => {
          if (other === e || other.isBoss) return;
          const ox = e.x - other.x;
          const oy = e.y - other.y;
          const d2 = ox * ox + oy * oy;
          const minD = e.radius + other.radius;
          if (d2 > 0.0001 && d2 < minD * minD) {
            const d = Math.sqrt(d2);
            sx += (ox / d) * (1 - d / minD);
            sy += (oy / d) * (1 - d / minD);
          }
        });
        vx += sx * ENEMY_BASE.separation;
        vy += sy * ENEMY_BASE.separation;
      }

      // Knockback decays exponentially; framerate-independent.
      const decay = Math.pow(0.0025, dt);
      e.kx *= decay;
      e.ky *= decay;

      e.x += (vx + e.kx) * dt;
      e.y += (vy + e.ky) * dt;
      this.constrainToWorld(e, e.radius);

      if (dist < e.radius + contactPad) this.contact(e, dx / dist, dy / dist);
    }
  }

  /** Speed multiplier the boss has earned by taking too long to die. */
  bossEnrage(): number {
    if (!this.bossActive) return 1;
    const over = this.bossTimer - BOSS.enrageAfter;
    if (over <= 0) return 1;
    return Math.min(BOSS.enrageMaxSpeedMultiplier, 1 + over * BOSS.enrageRatePerSecond);
  }

  /** `nx, ny` points from the bot toward the player. */
  private contact(e: Enemy, nx: number, ny: number): void {
    if (e.hitTimer > 0) return;
    e.hitTimer = e.isBoss ? BOSS.hitCooldown : ENEMY_BASE.hitCooldown;

    // Bots always bounce off, whether or not the hit landed, so they cannot park
    // on top of the square and grind it down through the invulnerability window.
    const push = e.isBoss ? ENEMY_BASE.knockback * 0.45 : ENEMY_BASE.knockback;
    e.kx = -nx * push;
    e.ky = -ny * push;

    this.damagePlayer(e.damage, nx, ny, e.isBoss ? 18 : 7);
  }

  /**
   * `nx, ny` points from whatever hit the player toward the player. Shared by
   * bot contact and a shooter's bolt — the game's only two sources of damage
   * to the player — so the iframes/shake/damage-number treatment is
   * identical no matter which one lands.
   */
  private damagePlayer(amount: number, nx: number, ny: number, shakeAmt: number): void {
    if (this.invuln > 0) return;
    this.invuln = PLAYER.iframes;
    const dealt = Math.min(this.hp, amount);
    this.hp = Math.max(0, this.hp - amount);
    this.shake = Math.min(22, this.shake + shakeAmt);
    this.burst(this.player.x - nx * 12, this.player.y - ny * 12, 6, '#ff4d6d', 130);
    this.spawnFloat(
      this.player.x - nx * 20,
      this.player.y - ny * 20 - PLAYER.halfSize,
      `-${Math.round(dealt)}`,
      '#ff4d6d',
      { size: 25, life: 1.0 },
    );
    this.hooks.onPlayerHit();
  }

  /**
   * Holds a preferred distance instead of closing to contact range: too far
   * out and it closes in, too close and it backs off, right in the band and
   * it strafes — which is what keeps a shooter from ever standing still
   * long enough to feel like a turret.
   */
  private shooterVelocity(e: Enemy, dx: number, dy: number, dist: number, speed: number): [number, number] {
    if (dist > SHOOTER.standoffRange + SHOOTER.standoffSlop) return [(dx / dist) * speed, (dy / dist) * speed];
    if (dist < SHOOTER.standoffRange - SHOOTER.standoffSlop) return [-(dx / dist) * speed, -(dy / dist) * speed];
    return [(-dy / dist) * speed * e.strafeSign, (dx / dist) * speed * e.strafeSign];
  }

  /**
   * `shootCooldown` doubles as the fire timer and the visible wind-up the
   * renderer draws as a growing ring (SHOOTER.telegraph) — it only ever
   * ticks down while the shooter can actually see and reach the player, so
   * the telegraph never lies about a shot that isn't coming.
   */
  private updateShooterFire(e: Enemy, dx: number, dy: number, dist: number, dt: number): void {
    const eligible = dist <= SHOOTER.engageRange && !this.segmentBlocked(e.x, e.y, this.player.x, this.player.y);
    if (!eligible) {
      e.shootCooldown = SHOOTER.cooldown;
      return;
    }
    e.shootCooldown = Math.max(0, e.shootCooldown - dt);
    if (e.shootCooldown > 0) return;
    this.fireEnemyBolt(e, dx / dist, dy / dist);
    e.shootCooldown = SHOOTER.cooldown;
  }

  private fireEnemyBolt(e: Enemy, dirX: number, dirY: number): void {
    const b = this.enemyBolts.obtain();
    if (!b) return;
    b.x = e.x + dirX * (e.radius + 6);
    b.y = e.y + dirY * (e.radius + 6);
    b.vx = dirX * SHOOTER.projectileSpeed;
    b.vy = dirY * SHOOTER.projectileSpeed;
    b.life = 3;
    // Reuses the same per-enemy damage value contact() would deal — one
    // number for "how much this kind hurts you," whether by touch or by shot.
    b.damage = e.damage;
    this.burst(b.x, b.y, 4, e.color, 90);
  }

  private updateEnemyBolts(dt: number): void {
    const hitRadiusSq = (PLAYER.halfSize + SHOOTER.projectileRadius) ** 2;
    for (const b of this.enemyBolts.items) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || Math.abs(b.x) > WORLD.halfSize || Math.abs(b.y) > WORLD.halfSize || this.pointInObstacle(b.x, b.y)) {
        b.active = false;
        continue;
      }
      const dx = this.player.x - b.x;
      const dy = this.player.y - b.y;
      if (dx * dx + dy * dy <= hitRadiusSq) {
        b.active = false;
        const len = Math.hypot(b.vx, b.vy) || 1;
        this.damagePlayer(b.damage, b.vx / len, b.vy / len, 6);
      }
    }
  }

  // ------------------------------------------------------------------ weapon

  /**
   * Up to `count` nearest bots in range, one per hand. Each hand needs its own
   * bot to aim at — firing two shots at the same target would not read as
   * "another hand," so a hand with nothing left to aim at simply doesn't fire.
   */
  private pickTargets(count: number): Enemy[] {
    const range = this.stats.range;
    const found: { e: Enemy; d: number }[] = [];
    this.grid.query(this.player.x, this.player.y, range, (e) => {
      const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
      if (d > range + e.radius) return;
      // A bot standing behind a wall is a bot the turret has no shot at — this
      // is what makes cover a real place to stand, not just a speed bump for
      // an approaching bot that still gets shot through it.
      if (this.segmentBlocked(this.player.x, this.player.y, e.x, e.y)) return;
      found.push({ e, d });
    });
    found.sort((a, b) => a.d - b.d);
    found.length = Math.min(found.length, count);
    return found.map((f) => f.e);
  }

  private updateWeapon(dt: number): void {
    this.fireCooldown -= dt;
    if (this.fireCooldown > 0) return;

    const targets = this.pickTargets(Math.max(1, Math.round(this.stats.hands)));
    if (targets.length === 0) {
      this.fireCooldown = 0;
      return;
    }

    const interval = 1 / this.stats.fireRate;
    // Carry the overshoot so very high fire rates stay accurate at low framerates.
    this.fireCooldown += interval;
    if (this.fireCooldown < 0) this.fireCooldown = interval;

    // One cooldown tick, one volley: every hand fires together, each at its own
    // bot. The nearest bot gets the primary (full-damage) hand; anything beyond
    // that is an extra hand at reduced damage — see PLAYER.extraHandDamageShare.
    targets.forEach((target, i) => this.fireAt(target, i === 0 ? 1 : PLAYER.extraHandDamageShare));
    this.hooks.onShoot();
  }

  // -------------------------------------------------------------- equipment

  /**
   * Distance from the player to wherever a ray first leaves the map, along a
   * unit direction. The player is always inside the fence, so this is a plain
   * slab test against the one box it starts in, not a general AABB entry test.
   */
  private rayBoundsExit(dirX: number, dirY: number): number {
    const h = WORLD.halfSize;
    let t = Infinity;
    if (dirX > 1e-9) t = Math.min(t, (h - this.player.x) / dirX);
    else if (dirX < -1e-9) t = Math.min(t, (-h - this.player.x) / dirX);
    if (dirY > 1e-9) t = Math.min(t, (h - this.player.y) / dirY);
    else if (dirY < -1e-9) t = Math.min(t, (-h - this.player.y) / dirY);
    return t;
  }

  /** Standard slab-method ray/AABB entry distance, or null if the ray misses
   *  the rectangle (or only meets it behind the origin). */
  private rayRectDistance(x: number, y: number, dx: number, dy: number, o: Obstacle): number | null {
    const minX = o.x - o.halfW;
    const maxX = o.x + o.halfW;
    const minY = o.y - o.halfH;
    const maxY = o.y + o.halfH;
    let tMin = -Infinity;
    let tMax = Infinity;

    if (Math.abs(dx) < 1e-9) {
      if (x < minX || x > maxX) return null;
    } else {
      let t1 = (minX - x) / dx;
      let t2 = (maxX - x) / dx;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
    }
    if (Math.abs(dy) < 1e-9) {
      if (y < minY || y > maxY) return null;
    } else {
      let t1 = (minY - y) / dy;
      let t2 = (maxY - y) / dy;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
    }
    if (tMax < tMin || tMax < 0) return null;
    return tMin >= 0 ? tMin : tMax;
  }

  /** How far the laser can reach before the map edge or a wall stops it. */
  private laserRange(dirX: number, dirY: number): number {
    let dist = this.rayBoundsExit(dirX, dirY);
    for (const o of OBSTACLES) {
      const hit = this.rayRectDistance(this.player.x, this.player.y, dirX, dirY, o);
      if (hit !== null && hit < dist) dist = hit;
    }
    return dist;
  }

  /**
   * Fires at the nearest bot the same way the main gun's primary hand does
   * (so a wall that blocks the gun blocks this too), then damages every other
   * bot the beam passes through on its way to the map edge or a wall — the
   * one attack in the game that punishes bots for lining up behind each other.
   */
  private updateLaser(dt: number): void {
    if (!this.equipment.laser) return;
    this.laserCooldown -= dt;
    if (this.laserCooldown > 0) return;
    this.laserCooldown = LASER.cooldown;

    const target = this.pickTargets(1)[0];
    if (!target) return;

    const dx = target.x - this.player.x;
    const dy = target.y - this.player.y;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len;
    const dirY = dy / len;
    const range = this.laserRange(dirX, dirY);

    this.grid.query(this.player.x, this.player.y, range, (e) => {
      const px = e.x - this.player.x;
      const py = e.y - this.player.y;
      const along = px * dirX + py * dirY;
      if (along < -e.radius || along > range) return;
      const perp = Math.abs(px * dirY - py * dirX);
      if (perp <= e.radius + LASER.beamWidth) this.damageEnemy(e, LASER.damage, dirX, dirY);
    });

    this.laserBeam.active = true;
    this.laserBeam.originX = this.player.x;
    this.laserBeam.originY = this.player.y;
    this.laserBeam.dirX = dirX;
    this.laserBeam.dirY = dirY;
    this.laserBeam.length = range;
    this.laserBeam.life = LASER.visualLife;
    this.laserBeam.maxLife = LASER.visualLife;
  }

  /**
   * Targets whichever bot is closest to sitting exactly on the firing-range
   * ring — "arriving at the boundary" — rather than the nearest bot overall,
   * which the main gun and the laser already cover. Arcs rather than flies
   * straight, and (deliberately, unlike everything else in the game) ignores
   * obstacles: a lobbed shot going over a wall is what makes it read as an
   * arc instead of just a slower bullet.
   */
  private updateFireCannon(dt: number): void {
    if (!this.equipment.fireCannon) return;
    this.cannonCooldown -= dt;
    if (this.cannonCooldown > 0) return;
    this.cannonCooldown = FIRE_CANNON.cooldown;

    const range = this.stats.range;
    let best: Enemy | null = null;
    let bestDelta = Infinity;
    this.grid.query(this.player.x, this.player.y, range * 1.4, (e) => {
      const delta = Math.abs(Math.hypot(e.x - this.player.x, e.y - this.player.y) - range);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = e;
      }
    });
    if (!best) return;

    const fb = this.fireballs.obtain();
    if (!fb) return;
    const target = best as Enemy;
    fb.originX = this.player.x;
    fb.originY = this.player.y;
    fb.x = fb.originX;
    fb.y = fb.originY;
    fb.targetX = target.x;
    fb.targetY = target.y;
    fb.t = 0;
    fb.duration = FIRE_CANNON.arcTime;
  }

  private updateFireballs(dt: number): void {
    for (const fb of this.fireballs.items) {
      if (!fb.active) continue;
      fb.t += dt;
      const p = Math.min(1, fb.t / fb.duration);
      fb.x = lerp(fb.originX, fb.targetX, p);
      fb.y = lerp(fb.originY, fb.targetY, p);
      if (p < 1) continue;

      fb.active = false;
      this.grid.query(fb.targetX, fb.targetY, FIRE_CANNON.splashRadius, (e) => {
        const dx = e.x - fb.targetX;
        const dy = e.y - fb.targetY;
        if (dx * dx + dy * dy <= (FIRE_CANNON.splashRadius + e.radius) ** 2) {
          this.damageEnemy(e, FIRE_CANNON.damage, dx, dy);
        }
      });
      this.burst(fb.targetX, fb.targetY, 16, '#ff8f4d', 230);
      this.shake = Math.min(22, this.shake + 5);
    }
  }

  /** A tick rather than a per-frame drain, so it reads as distinct pulses of
   *  heat instead of a silent number going down. Reaches the boss too — an
   *  aura that stopped at "regular bots only" would have no reason to. */
  private updateAura(dt: number): void {
    if (!this.equipment.aura) return;
    this.auraTick -= dt;
    if (this.auraTick > 0) return;
    this.auraTick = AURA.tickInterval;

    this.grid.query(this.player.x, this.player.y, AURA.radius, (e) => {
      const dx = e.x - this.player.x;
      const dy = e.y - this.player.y;
      if (dx * dx + dy * dy <= (AURA.radius + e.radius) ** 2) {
        this.damageEnemy(e, AURA.damagePerTick, dx || 1, dy);
      }
    });
  }

  private fireAt(target: Enemy, damageShare: number): void {
    const b = this.bullets.obtain();
    if (!b) return;

    // Lead the shot: aim where the bot will be when the bullet arrives.
    const dx = target.x - this.player.x;
    const dy = target.y - this.player.y;
    const dist = Math.hypot(dx, dy) || 1;
    const travelTime = dist / PLAYER.bulletSpeed;
    // The bot is heading straight at the player, so its velocity is -normal * speed.
    const aimX = dx - (dx / dist) * target.speed * travelTime;
    const aimY = dy - (dy / dist) * target.speed * travelTime;
    const len = Math.hypot(aimX, aimY) || 1;

    b.x = this.player.x + (aimX / len) * (PLAYER.halfSize + 4);
    b.y = this.player.y + (aimY / len) * (PLAYER.halfSize + 4);
    b.vx = (aimX / len) * PLAYER.bulletSpeed;
    b.vy = (aimY / len) * PLAYER.bulletSpeed;
    b.life = PLAYER.bulletLife;
    b.damage = this.stats.damage * damageShare;
  }

  private updateBullets(dt: number): void {
    for (const b of this.bullets.items) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      // A miss keeps flying until it leaves the map or hits a wall — the
      // firing radius only ever gated which bot the turret could pick as a
      // target, never how far the resulting shot travels. bulletLife is a
      // safety cap, not the normal way a miss ends.
      if (b.life <= 0 || Math.abs(b.x) > WORLD.halfSize || Math.abs(b.y) > WORLD.halfSize) {
        b.active = false;
        continue;
      }

      if (this.pointInObstacle(b.x, b.y)) {
        b.active = false;
        this.burst(b.x, b.y, 4, '#a8b0c4', 90);
        continue;
      }

      let hit: Enemy | null = null;
      this.grid.query(b.x, b.y, PLAYER.bulletRadius + 40, (e) => {
        if (hit) return;
        const dx = e.x - b.x;
        const dy = e.y - b.y;
        const rr = e.radius + PLAYER.bulletRadius;
        if (dx * dx + dy * dy <= rr * rr) hit = e;
      });

      if (hit) {
        b.active = false;
        this.damageEnemy(hit, b.damage, b.vx, b.vy);
      }
    }
  }

  private damageEnemy(e: Enemy, damage: number, vx: number, vy: number): void {
    const crit = Math.random() < CRIT.chance;
    if (crit) damage *= CRIT.multiplier;
    e.hp -= damage;
    e.flash = 1;
    const len = Math.hypot(vx, vy) || 1;
    if (!e.isBoss) {
      e.kx += (vx / len) * 26;
      e.ky += (vy / len) * 26;
    }
    this.burst(e.x, e.y, 3, e.color, 90);
    this.spawnFloat(e.x, e.y - e.radius, `${Math.round(damage)}`, crit ? '#ff4d6d' : '#eaf6ff', {
      size: crit ? 30 : 21,
      life: crit ? 1.15 : 0.9,
      crit,
    });

    if (e.hp > 0) return;

    e.active = false;
    this.kills += 1;
    this.burst(e.x, e.y, e.isBoss ? 46 : 9, e.color, e.isBoss ? 320 : 170);
    this.hooks.onKill();

    if (e.isBoss) {
      this.boss = null;
      this.bossActive = false;
      this.bossKilled = true;
      // The boss's own reward is credited directly rather than dropped as an
      // orb — the run is about to end and an orb nobody can walk over isn't a
      // reward. Every OTHER orb still lying around the map from earlier in the
      // run is a different story: those get their moment in startVictory().
      this.gold += e.gold + BOSS_KILL_BONUS;
      this.gainXp(e.xp);
      this.spawnFloat(this.player.x, this.player.y - PLAYER.halfSize * 4, `+${BOSS_KILL_BONUS}`, '#ffd23a');
      this.startVictory();
      return;
    }

    this.dropLoot(e);
  }

  // ----------------------------------------------------------------- pickups

  /**
   * Every bot leaves a gold orb and an XP orb where it fell. Nothing is credited
   * until the player walks over them, which is what gives movement a reason to go
   * toward the fight instead of only away from it.
   */
  private dropLoot(e: Enemy): void {
    this.dropOrb(e.x, e.y, 'gold', e.gold);
    this.dropOrb(e.x, e.y, 'xp', e.xp);
  }

  private dropOrb(x: number, y: number, kind: Pickup['kind'], value: number): void {
    const p = this.pickups.obtain();
    if (!p) {
      // The field is saturated. Credit it rather than delete it: being swarmed is
      // already the punishment, silently voiding the reward on top of that is not.
      if (kind === 'gold') this.gold += value;
      else this.gainXp(value);
      return;
    }
    const a = Math.random() * Math.PI * 2;
    const s = PICKUP.scatter * (0.35 + Math.random() * 0.65);
    p.x = x;
    p.y = y;
    p.vx = Math.cos(a) * s;
    p.vy = Math.sin(a) * s;
    p.life = PICKUP.life;
    p.kind = kind;
    p.value = value;
  }

  private updatePickups(dt: number): void {
    const magnet = this.stats.magnet;
    const collect = PLAYER.halfSize + PICKUP.collectPad;
    const collectSq = collect * collect;
    const drag = Math.pow(PICKUP.drag, dt);

    for (const p of this.pickups.items) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }

      const dx = this.player.x - p.x;
      const dy = this.player.y - p.y;
      const d2 = dx * dx + dy * dy;

      if (d2 < magnet * magnet) {
        // Accelerate on approach. A constant pull reads as a slow drift and makes
        // the magnet feel broken even when the radius is right.
        const d = Math.sqrt(d2) || 1;
        const t = 1 - d / magnet;
        const speed = PICKUP.pullMin + (PICKUP.pullMax - PICKUP.pullMin) * t * t;
        p.vx = (dx / d) * speed;
        p.vy = (dy / d) * speed;
      } else {
        p.vx *= drag;
        p.vy *= drag;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (d2 < collectSq) {
        p.active = false;
        if (p.kind === 'gold') this.gold += p.value;
        else this.gainXp(p.value);
      }
    }
  }

  // ---------------------------------------------------------------- fx + end

  private burst(x: number, y: number, count: number, color: string, speed: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.particles.obtain();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.maxLife = 0.24 + Math.random() * 0.4;
      p.life = p.maxLife;
      p.size = 2 + Math.random() * 3;
      p.color = color;
    }
  }

  private spawnFloat(
    x: number,
    y: number,
    text: string,
    color: string,
    opts?: { size?: number; life?: number; crit?: boolean },
  ): void {
    const f = this.floats.obtain();
    if (!f) return;
    // A little scatter so a run of hits on the same bot doesn't stack into one
    // unreadable smear of digits.
    f.x = x + (Math.random() - 0.5) * 14;
    f.y = y + (Math.random() - 0.5) * 10;
    f.life = opts?.life ?? 1.1;
    f.maxLife = f.life;
    f.text = text;
    f.color = color;
    f.size = opts?.size ?? 26;
    f.crit = opts?.crit ?? false;
  }

  private updateParticles(dt: number): void {
    const decay = Math.pow(0.02, dt);
    for (const p of this.particles.items) {
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= decay;
      p.vy *= decay;
      p.life -= dt;
      if (p.life <= 0) p.active = false;
    }
  }

  private updateFloats(dt: number): void {
    for (const f of this.floats.items) {
      if (!f.active) continue;
      f.y -= 42 * dt;
      f.life -= dt;
      if (f.life <= 0) f.active = false;
    }
  }

  /**
   * The run doesn't end the instant the boss does. Every gold orb still on the
   * map — everything the magnet never reached over the whole run — gets
   * vacuumed to the square while the total visibly counts up, so a win pays
   * off the ground you covered instead of abandoning it the second the fight
   * is over.
   */
  private startVictory(): void {
    this.phase = 'victory';
    this.victoryTimer = VICTORY.duration;
    this.hooks.onVictoryStart();
  }

  private updateVictory(dt: number): void {
    this.victoryTimer -= dt;
    this.updateParticles(dt);
    this.updateFloats(dt);

    let anyGoldLeft = false;
    for (const p of this.pickups.items) {
      if (!p.active || p.kind !== 'gold') continue;
      anyGoldLeft = true;

      const dx = this.player.x - p.x;
      const dy = this.player.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      p.x += (dx / d) * VICTORY.pullSpeed * dt;
      p.y += (dy / d) * VICTORY.pullSpeed * dt;

      if (d < PLAYER.halfSize + PICKUP.collectPad + VICTORY.pullSpeed * dt) {
        p.active = false;
        this.gold += p.value;
        this.hooks.onCoinCollect(p.value);
      }
    }

    if (this.victoryTimer <= 0 || !anyGoldLeft) this.end(true);
  }

  private end(won: boolean): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.hooks.onEnd({
      won,
      bossKilled: this.bossKilled,
      kills: this.kills,
      gold: Math.floor(this.gold),
      level: this.level,
      survivedSeconds: Math.min(this.elapsed, RUN_DURATION + 120),
    });
  }
}
