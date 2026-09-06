import {
  BOSS,
  BOSS_KILL_BONUS,
  ENEMY_BASE,
  ENEMY_KINDS,
  ENEMY_SCALING,
  LEVEL_UP_HEAL,
  MAX_LEVEL,
  PLAYER,
  RUN_DURATION,
  RUN_UPGRADES,
  VIEW_SHORT_SIDE,
  WAVES,
  WAVE_SECONDS,
  XP_TABLE,
  type EnemyKind,
  type EnemyKindId,
} from './config';
import { SpatialGrid } from './grid';
import { Pool } from './pool';
import type { Bullet, Enemy, FloatText, Particle, RunResult, ViewInfo } from './types';
import {
  BOUNTY_GOLD,
  REPAIR_SHARE,
  emptyPicks,
  pickMultiplier,
  rollChoices,
  type ChoiceId,
  type RunPicks,
  type UpgradeChoice,
} from './upgrades';

const MAX_ENEMIES = 340;
const MAX_BULLETS = 160;
const MAX_PARTICLES = 420;
const MAX_FLOATS = 40;

export type Phase = 'idle' | 'running' | 'levelup' | 'ended';

export interface EngineHooks {
  onLevelUp(choices: UpgradeChoice[], level: number): void;
  onBossSpawn(): void;
  onEnd(result: RunResult): void;
  onKill(): void;
  onPlayerHit(): void;
  onShoot(): void;
}

export interface PlayerStats {
  damage: number;
  fireRate: number;
  range: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class Game {
  phase: Phase = 'idle';
  view: ViewInfo = { cssW: 1, cssH: 1, scale: 1, worldW: 1, worldH: 1, spawnRx: 1, spawnRy: 1 };

  /** Seconds of gameplay elapsed; frozen while a level-up card is open. */
  elapsed = 0;
  hp: number = PLAYER.maxHp;
  maxHp: number = PLAYER.maxHp;
  level = 1;
  killsThisLevel = 0;
  kills = 0;
  gold = 0;
  bossActive = false;
  bossKilled = false;
  /** Screen shake amplitude in world units, decays every frame. */
  shake = 0;
  /** Rendering-only pulse used by the range circle when it grows. */
  rangePulse = 0;

  picks: RunPicks = emptyPicks();
  stats: PlayerStats = { damage: PLAYER.damage, fireRate: PLAYER.fireRate, range: PLAYER.range };

  readonly enemies = new Pool<Enemy>(MAX_ENEMIES, () => ({
    active: false, x: 0, y: 0, kx: 0, ky: 0, hp: 1, maxHp: 1, radius: 10,
    speed: 50, damage: 1, gold: 1, kind: 'grunt', color: '#fff', hitTimer: 0, flash: 0, isBoss: false,
  }));
  readonly bullets = new Pool<Bullet>(MAX_BULLETS, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, damage: 1,
  }));
  readonly particles = new Pool<Particle>(MAX_PARTICLES, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 3, color: '#fff',
  }));
  readonly floats = new Pool<FloatText>(MAX_FLOATS, () => ({
    active: false, x: 0, y: 0, life: 0, text: '', color: '#fff',
  }));

  boss: Enemy | null = null;

  private readonly grid = new SpatialGrid(44);
  private readonly hooks: EngineHooks;
  private metaMultipliers: PlayerStats = { damage: 1, fireRate: 1, range: 1 };

  private fireCooldown = 0;
  private spawnCarry = 0;
  private invuln = 0;
  private aimActive = false;
  private aimX = 0;
  private aimY = 0;

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
    this.maxHp = PLAYER.maxHp;
    this.hp = this.maxHp;
    this.elapsed = 0;
    this.level = 1;
    this.kills = 0;
    this.killsThisLevel = 0;
    this.gold = 0;
    this.bossActive = false;
    this.bossKilled = false;
    this.boss = null;
    this.picks = emptyPicks();
    this.fireCooldown = 0;
    this.spawnCarry = 0;
    this.invuln = 0;
    this.shake = 0;
    this.rangePulse = 0;
    this.aimActive = false;
    this.enemies.clear();
    this.bullets.clear();
    this.particles.clear();
    this.floats.clear();
    this.grid.clear();
    this.refreshStats();
    this.phase = 'running';
    this.prewarm();
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

  abandon(): void {
    this.phase = 'idle';
  }

  private refreshStats(): void {
    this.stats = {
      damage: PLAYER.damage * this.metaMultipliers.damage * pickMultiplier(this.picks.damage),
      fireRate: PLAYER.fireRate * this.metaMultipliers.fireRate * pickMultiplier(this.picks.fireRate),
      range: PLAYER.range * this.metaMultipliers.range * pickMultiplier(this.picks.range),
    };
  }

  // ------------------------------------------------------------------- input

  setAim(worldX: number, worldY: number): void {
    const len = Math.hypot(worldX, worldY);
    if (len < 1) {
      this.aimActive = false;
      return;
    }
    this.aimActive = PLAYER.touchAim;
    this.aimX = worldX / len;
    this.aimY = worldY / len;
  }

  clearAim(): void {
    this.aimActive = false;
  }

  // ------------------------------------------------------------- progression

  /** Kills still needed for the next level, or null at the cap. */
  killsForNextLevel(): number | null {
    if (this.level >= MAX_LEVEL) return null;
    return XP_TABLE[this.level - 1];
  }

  xpProgress(): number {
    const need = this.killsForNextLevel();
    return need === null ? 1 : clamp(this.killsThisLevel / need, 0, 1);
  }

  applyChoice(id: ChoiceId): void {
    switch (id) {
      case 'fireRate':
      case 'damage':
      case 'range':
        this.picks[id] = Math.min(RUN_UPGRADES.maxPicks, this.picks[id] + 1);
        this.refreshStats();
        if (id === 'range') this.rangePulse = 1;
        break;
      case 'repair':
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * REPAIR_SHARE);
        break;
      case 'bounty':
        this.gold += BOUNTY_GOLD;
        this.spawnFloat(0, -PLAYER.halfSize * 3, `+${BOUNTY_GOLD}`, '#ffd23a');
        break;
    }
    this.phase = 'running';
  }

  private gainKillXp(amount: number): void {
    if (this.level >= MAX_LEVEL) return;
    this.killsThisLevel += amount;
    let need = this.killsForNextLevel();
    while (need !== null && this.killsThisLevel >= need) {
      this.killsThisLevel -= need;
      this.level += 1;
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * LEVEL_UP_HEAL);
      if (this.level >= MAX_LEVEL) {
        this.killsThisLevel = 0;
        need = null;
      } else {
        need = this.killsForNextLevel();
      }
      this.phase = 'levelup';
      this.hooks.onLevelUp(rollChoices(this.picks, Math.random), this.level);
      // Only one level-up card is presented per frame; any surplus kills stay
      // banked in killsThisLevel and roll into the next card.
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

    this.grid.rebuild(this.enemies.items);
    this.updateSpawning(dt);
    this.updateEnemies(dt);
    this.updateWeapon(dt);
    this.updateBullets(dt);
    this.updateParticles(dt);
    this.updateFloats(dt);

    if (this.hp <= 0) this.end(false);
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
    const angle = Math.random() * Math.PI * 2;
    for (let i = 0; i < kind.cluster; i++) {
      // Cluster members fan out around the anchor so they arrive as a pack.
      const a = angle + (i - (kind.cluster - 1) / 2) * 0.09;
      const pad = 1 + (i % 2) * 0.04;
      this.spawnEnemy(kind, Math.cos(a) * this.view.spawnRx * pad, Math.sin(a) * this.view.spawnRy * pad);
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
    e.kind = kind.id;
    e.color = kind.color;
    e.hitTimer = 0;
    e.flash = 0;
    e.isBoss = false;
  }

  private spawnBoss(): void {
    const e = this.enemies.obtain();
    if (!e) return;
    const angle = Math.random() * Math.PI * 2;
    e.x = Math.cos(angle) * this.view.spawnRx;
    e.y = Math.sin(angle) * this.view.spawnRy;
    e.kx = 0;
    e.ky = 0;
    e.maxHp = ENEMY_BASE.hp * ENEMY_SCALING.hpAtEnd * BOSS.hpMultiplier * BOSS.extraHpFactor;
    e.hp = e.maxHp;
    e.radius = ENEMY_BASE.radius * BOSS.radiusMultiplier;
    e.speed = ENEMY_BASE.speed * BOSS.speedMultiplier;
    e.damage = ENEMY_BASE.damage * BOSS.damageMultiplier;
    e.gold = ENEMY_BASE.gold * ENEMY_SCALING.goldAtEnd * BOSS.goldMultiplier;
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

  // ----------------------------------------------------------------- enemies

  private updateEnemies(dt: number): void {
    const contactPad = PLAYER.halfSize * 1.15;
    for (const e of this.enemies.items) {
      if (!e.active) continue;

      e.hitTimer = Math.max(0, e.hitTimer - dt);
      e.flash = Math.max(0, e.flash - dt * 6);

      // Seek the square at the origin.
      const dist = Math.hypot(e.x, e.y) || 1;
      let vx = (-e.x / dist) * e.speed;
      let vy = (-e.y / dist) * e.speed;

      // Separation keeps the swarm readable instead of collapsing to one dot.
      if (!e.isBoss) {
        let sx = 0;
        let sy = 0;
        this.grid.query(e.x, e.y, e.radius * 2.1, (other) => {
          if (other === e || other.isBoss) return;
          const dx = e.x - other.x;
          const dy = e.y - other.y;
          const d2 = dx * dx + dy * dy;
          const minD = e.radius + other.radius;
          if (d2 > 0.0001 && d2 < minD * minD) {
            const d = Math.sqrt(d2);
            sx += (dx / d) * (1 - d / minD);
            sy += (dy / d) * (1 - d / minD);
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

      if (dist < e.radius + contactPad) this.contact(e);
    }
  }

  private contact(e: Enemy): void {
    if (e.hitTimer > 0) return;
    e.hitTimer = e.isBoss ? BOSS.hitCooldown : ENEMY_BASE.hitCooldown;

    // Bots always bounce off, whether or not the hit landed, so they cannot park
    // on top of the square and grind it down through the invulnerability window.
    const d = Math.hypot(e.x, e.y) || 1;
    const push = e.isBoss ? ENEMY_BASE.knockback * 0.45 : ENEMY_BASE.knockback;
    e.kx = (e.x / d) * push;
    e.ky = (e.y / d) * push;

    if (this.invuln > 0) return;
    this.invuln = PLAYER.iframes;
    this.hp = Math.max(0, this.hp - e.damage);
    this.shake = Math.min(22, this.shake + (e.isBoss ? 18 : 7));
    this.burst(e.x * 0.4, e.y * 0.4, 6, '#ff4d6d', 130);
    this.hooks.onPlayerHit();
  }

  // ------------------------------------------------------------------ weapon

  private pickTarget(): Enemy | null {
    const range = this.stats.range;
    let best: Enemy | null = null;
    let bestScore = Infinity;
    this.grid.query(0, 0, range, (e) => {
      const d = Math.hypot(e.x, e.y);
      if (d > range + e.radius) return;
      let score = d;
      if (this.aimActive) {
        // A finger on the screen biases targeting toward that direction without
        // ever letting the turret shoot something outside its circle.
        const dot = (e.x / (d || 1)) * this.aimX + (e.y / (d || 1)) * this.aimY;
        score = d * (1 - PLAYER.touchAimWeight * Math.max(0, dot));
      }
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    });
    return best;
  }

  private updateWeapon(dt: number): void {
    this.fireCooldown -= dt;
    if (this.fireCooldown > 0) return;

    const target = this.pickTarget();
    if (!target) {
      this.fireCooldown = 0;
      return;
    }

    const interval = 1 / this.stats.fireRate;
    // Carry the overshoot so very high fire rates stay accurate at low framerates.
    this.fireCooldown += interval;
    if (this.fireCooldown < 0) this.fireCooldown = interval;

    this.fireAt(target);
    this.hooks.onShoot();
  }

  private fireAt(target: Enemy): void {
    const b = this.bullets.obtain();
    if (!b) return;
    // Lead the shot: aim where the bot will be when the bullet arrives.
    const dist = Math.hypot(target.x, target.y);
    const travel = dist / PLAYER.bulletSpeed;
    const speed = target.speed;
    const tDist = dist || 1;
    const px = target.x + (-target.x / tDist) * speed * travel;
    const py = target.y + (-target.y / tDist) * speed * travel;
    const len = Math.hypot(px, py) || 1;

    b.x = (px / len) * (PLAYER.halfSize + 4);
    b.y = (py / len) * (PLAYER.halfSize + 4);
    b.vx = (px / len) * PLAYER.bulletSpeed;
    b.vy = (py / len) * PLAYER.bulletSpeed;
    b.life = PLAYER.bulletLife;
    b.damage = this.stats.damage;
  }

  private updateBullets(dt: number): void {
    const range = this.stats.range;
    for (const b of this.bullets.items) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      // Bullets die at the edge of the firing circle: the circle is the weapon's
      // stated boundary, so it has to be a real limit, not decoration.
      if (b.life <= 0 || Math.hypot(b.x, b.y) > range + 24) {
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

    if (e.hp > 0) return;

    e.active = false;
    this.kills += 1;
    this.gold += e.gold;
    this.burst(e.x, e.y, e.isBoss ? 46 : 9, e.color, e.isBoss ? 320 : 170);
    this.hooks.onKill();

    if (e.isBoss) {
      this.boss = null;
      this.bossActive = false;
      this.bossKilled = true;
      this.gold += BOSS_KILL_BONUS;
      this.gainKillXp(10);
      this.spawnFloat(0, -PLAYER.halfSize * 4, `+${BOSS_KILL_BONUS}`, '#ffd23a');
      this.end(true);
      return;
    }

    this.gainKillXp(1);
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

  private spawnFloat(x: number, y: number, text: string, color: string): void {
    const f = this.floats.obtain();
    if (!f) return;
    f.x = x;
    f.y = y;
    f.life = 1.1;
    f.text = text;
    f.color = color;
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
