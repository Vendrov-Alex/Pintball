import {
  BOSS,
  BOSS_KILL_BONUS,
  DESPAWN_FACTOR,
  ENEMY_BASE,
  ENEMY_KINDS,
  ENEMY_SCALING,
  LEVEL_UP_HEAL,
  MAX_LEVEL,
  PICKUP,
  PLAYER,
  RUN_DURATION,
  RUN_UPGRADE_LINES,
  SPAWN_LEAD_BIAS,
  VIEW_SHORT_SIDE,
  WAVES,
  WAVE_SECONDS,
  XP_TABLE,
  type EnemyKind,
  type EnemyKindId,
} from './config';
import { SpatialGrid } from './grid';
import { Pool } from './pool';
import type { Bullet, Enemy, FloatText, Particle, Pickup, RunResult, Vec, ViewInfo } from './types';
import {
  emptyPicks,
  pickMultiplier,
  rollChoices,
  type RunPicks,
  type RunUpgradeId,
  type UpgradeChoice,
} from './upgrades';

const MAX_ENEMIES = 340;
const MAX_BULLETS = 160;
const MAX_PARTICLES = 420;
// Damage numbers fire far more often than gold/bounty text ever did — a maxed
// multi-hand build can land a dozen hits a second — so this pool is sized for
// that, not for the occasional reward popup.
const MAX_FLOATS = 200;
/** Two orbs per kill at up to ten kills a second, times an 18 second lifetime. */
const MAX_PICKUPS = 640;

export type Phase = 'idle' | 'running' | 'levelup' | 'ended';

export interface EngineHooks {
  onLevelUp(choices: UpgradeChoice[], level: number): void;
  onBossSpawn(): void;
  onEnd(result: RunResult): void;
  onKill(): void;
  onPlayerHit(): void;
  onShoot(): void;
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
   * The square's position in world space. The world is unbounded: the camera
   * follows the player and bots are spawned and recycled relative to it, which is
   * what makes a survivor-style run feel open instead of arena-shaped.
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
  }));
  readonly bullets = new Pool<Bullet>(MAX_BULLETS, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, travel: 0, damage: 1,
  }));
  readonly particles = new Pool<Particle>(MAX_PARTICLES, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 3, color: '#fff',
  }));
  readonly floats = new Pool<FloatText>(MAX_FLOATS, () => ({
    active: false, x: 0, y: 0, life: 0, maxLife: 1, text: '', color: '#fff', size: 26,
  }));
  readonly pickups = new Pool<Pickup>(MAX_PICKUPS, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, kind: 'gold', value: 1,
  }));

  boss: Enemy | null = null;

  private readonly grid = new SpatialGrid(44);
  private readonly hooks: EngineHooks;
  private metaMultipliers: PlayerStats = {
    damage: 1, fireRate: 1, range: 1, magnet: 1, maxHp: 1, moveSpeed: 1, hands: 1,
  };

  private fireCooldown = 0;
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

  /** `meta` carries the permanent, gold-bought multipliers. */
  start(meta: PlayerStats): void {
    this.metaMultipliers = meta;
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

    this.phase = 'running';
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
    if (this.phase !== 'running') return;

    this.elapsed += dt;
    this.shake = Math.max(0, this.shake - dt * 34);
    this.rangePulse = Math.max(0, this.rangePulse - dt * 1.6);
    this.invuln = Math.max(0, this.invuln - dt);

    if (!this.bossActive && !this.bossKilled && this.elapsed >= RUN_DURATION) this.spawnBoss();
    if (this.bossActive) this.bossTimer += dt;

    this.updatePlayer(dt);
    this.grid.rebuild(this.enemies.items);
    this.updateSpawning(dt);
    this.updateEnemies(dt);
    this.updateWeapon(dt);
    this.updateBullets(dt);
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
  }

  // ---------------------------------------------------------------- spawning

  private waveIndex(): number {
    return clamp(Math.floor(this.elapsed / WAVE_SECONDS), 0, WAVES.length - 1);
  }

  /** 0 at the start of the run, 1 at the boss. */
  private difficultyT(): number {
    return clamp(this.elapsed / RUN_DURATION, 0, 1);
  }

  private updateSpawning(dt: number): void {
    const wave = WAVES[this.waveIndex()];
    const rate = this.bossActive ? WAVES[WAVES.length - 1].rate * BOSS.addSpawnRatio : wave.rate;
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
    e.maxHp = ENEMY_BASE.hp * kind.hp * hpMul;
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
  }

  private spawnBoss(): void {
    const e = this.enemies.obtain();
    if (!e) return;
    const angle = this.spawnAngle();
    e.x = this.player.x + Math.cos(angle) * this.view.spawnRx;
    e.y = this.player.y + Math.sin(angle) * this.view.spawnRy;
    e.kx = 0;
    e.ky = 0;
    e.maxHp = ENEMY_BASE.hp * ENEMY_SCALING.hpAtEnd * BOSS.hpMultiplier * BOSS.extraHpFactor;
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
      let vx = (dx / dist) * speed;
      let vy = (dy / dist) * speed;

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

    if (this.invuln > 0) return;
    this.invuln = PLAYER.iframes;
    const dealt = Math.min(this.hp, e.damage);
    this.hp = Math.max(0, this.hp - e.damage);
    this.shake = Math.min(22, this.shake + (e.isBoss ? 18 : 7));
    this.burst(this.player.x - nx * 12, this.player.y - ny * 12, 6, '#ff4d6d', 130);
    this.spawnFloat(
      this.player.x - nx * 20,
      this.player.y - ny * 20 - PLAYER.halfSize,
      `-${Math.round(dealt)}`,
      '#ff4d6d',
      { size: 19, life: 0.7 },
    );
    this.hooks.onPlayerHit();
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
      if (d <= range + e.radius) found.push({ e, d });
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
    b.travel = this.stats.range + 24;
    b.damage = this.stats.damage * damageShare;
  }

  private updateBullets(dt: number): void {
    for (const b of this.bullets.items) {
      if (!b.active) continue;
      const step = Math.hypot(b.vx, b.vy) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      b.travel -= step;

      if (b.life <= 0 || b.travel <= 0) {
        b.active = false;
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
    e.hp -= damage;
    e.flash = 1;
    const len = Math.hypot(vx, vy) || 1;
    if (!e.isBoss) {
      e.kx += (vx / len) * 26;
      e.ky += (vy / len) * 26;
    }
    this.burst(e.x, e.y, 3, e.color, 90);
    this.spawnFloat(e.x, e.y - e.radius, `${Math.round(damage)}`, '#eaf6ff', { size: 15, life: 0.55 });

    if (e.hp > 0) return;

    e.active = false;
    this.kills += 1;
    this.burst(e.x, e.y, e.isBoss ? 46 : 9, e.color, e.isBoss ? 320 : 170);
    this.hooks.onKill();

    if (e.isBoss) {
      this.boss = null;
      this.bossActive = false;
      this.bossKilled = true;
      // Killing the boss ends the run on the spot, so its reward is credited
      // directly — orbs nobody can walk over are not a reward.
      this.gold += e.gold + BOSS_KILL_BONUS;
      this.gainXp(e.xp);
      this.spawnFloat(this.player.x, this.player.y - PLAYER.halfSize * 4, `+${BOSS_KILL_BONUS}`, '#ffd23a');
      this.end(true);
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
    opts?: { size?: number; life?: number },
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
