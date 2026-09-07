import { AURA, EQUIPMENT, JOYSTICK, LASER, OBSTACLES, PICKUP, PLAYER, WORLD } from './config';
import type { Game } from './engine';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Screen-space joystick state handed in by the battle UI, in css pixels. */
export interface JoystickView {
  active: boolean;
  baseX: number;
  baseY: number;
  knobX: number;
  knobY: number;
}

const GRID_TILE = 48;

/**
 * Canvas renderer.
 *
 * The camera is locked to the player, so the world is drawn translated by the
 * player's position and the background grid scrolls under it — that scrolling is
 * the only cue that the square is moving through an open world rather than
 * standing still while things come to it.
 *
 * Everything is drawn in world units and the context is scaled once per frame, so
 * the same code produces identical framing on a 4" phone and a tablet. Shadow
 * blur is deliberately restricted to the handful of large, static elements — it is
 * the single most expensive 2D canvas operation on mobile GPUs and cannot be used
 * per bot or per bullet at these entity counts.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  private gridPattern: CanvasPattern | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number): void {
    // Cap the pixel ratio: a 3x buffer on a 6.7" screen costs ~40% of the frame
    // budget on mid-range hardware for no visible gain at this art style.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = cssW;
    this.cssH = cssH;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.gridPattern = null;
  }

  private ensureGrid(): CanvasPattern | null {
    if (this.gridPattern) return this.gridPattern;
    const tile = document.createElement('canvas');
    tile.width = GRID_TILE;
    tile.height = GRID_TILE;
    const tctx = tile.getContext('2d');
    if (!tctx) return null;
    tctx.strokeStyle = 'rgba(120, 150, 220, 0.075)';
    tctx.lineWidth = 1;
    tctx.beginPath();
    tctx.moveTo(0.5, 0);
    tctx.lineTo(0.5, GRID_TILE);
    tctx.moveTo(0, 0.5);
    tctx.lineTo(GRID_TILE, 0.5);
    tctx.stroke();
    this.gridPattern = this.ctx.createPattern(tile, 'repeat');
    return this.gridPattern;
  }

  render(game: Game, time: number, joystick: JoystickView): void {
    const ctx = this.ctx;
    const { scale, worldW, worldH } = game.view;

    // The camera follows the player but stops at the map's own edge, so
    // standing at the fence shows the fence at the side of the screen instead
    // of empty space beyond a boundary that's supposed to feel solid.
    const boundX = Math.max(0, WORLD.halfSize - worldW / 2);
    const boundY = Math.max(0, WORLD.halfSize - worldH / 2);
    const camX = clamp(game.player.x, -boundX, boundX);
    const camY = clamp(game.player.y, -boundY, boundY);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(ctx, camX * scale, camY * scale);

    const shakeX = game.shake ? (Math.random() - 0.5) * game.shake : 0;
    const shakeY = game.shake ? (Math.random() - 0.5) * game.shake : 0;

    ctx.save();
    ctx.translate(this.cssW / 2 + shakeX, this.cssH / 2 + shakeY);
    ctx.scale(scale, scale);
    ctx.translate(-camX, -camY);

    this.drawFence(ctx);
    this.drawObstacles(ctx);
    this.drawMagnetRing(ctx, game);
    this.drawAura(ctx, game, time);
    this.drawRangeCircle(ctx, game, time);
    this.drawParticles(ctx, game);
    this.drawPickups(ctx, game, time);
    this.drawEnemies(ctx, game);
    this.drawBullets(ctx, game);
    this.drawFireballs(ctx, game);
    this.drawLaserBeam(ctx, game);
    this.drawPlayer(ctx, game, time);
    this.drawFloats(ctx, game);

    ctx.restore();

    this.drawOffscreenMarkers(ctx, game, camX, camY);
    if (joystick.active) this.drawJoystick(ctx, joystick);
  }

  /** The outer boundary. One stroke call — cheap enough to shadow-blur even
   *  though it draws every frame, unlike the per-entity draws below it. */
  private drawFence(ctx: CanvasRenderingContext2D): void {
    const h = WORLD.halfSize;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 47, 109, 0.65)';
    ctx.lineWidth = WORLD.fenceWidth;
    ctx.shadowColor = 'rgba(255, 47, 109, 0.55)';
    ctx.shadowBlur = 30;
    ctx.strokeRect(-h, -h, h * 2, h * 2);
    ctx.restore();
  }

  private drawObstacles(ctx: CanvasRenderingContext2D): void {
    for (const o of OBSTACLES) {
      const g = ctx.createLinearGradient(0, o.y - o.halfH, 0, o.y + o.halfH);
      g.addColorStop(0, '#3c4762');
      g.addColorStop(1, '#20263a');
      ctx.fillStyle = g;
      ctx.strokeStyle = 'rgba(150, 168, 210, 0.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.rect(o.x - o.halfW, o.y - o.halfH, o.halfW * 2, o.halfH * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawBackground(ctx: CanvasRenderingContext2D, camPxX: number, camPxY: number): void {
    const g = ctx.createRadialGradient(
      this.cssW / 2, this.cssH / 2, 0,
      this.cssW / 2, this.cssH / 2, Math.max(this.cssW, this.cssH) * 0.75,
    );
    g.addColorStop(0, '#151b2c');
    g.addColorStop(1, '#07090f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const pattern = this.ensureGrid();
    if (!pattern) return;
    // Scroll the tiled grid by the camera, wrapped into one tile. JS keeps the
    // sign of the operand, hence the double modulo.
    const ox = (((-camPxX % GRID_TILE) + GRID_TILE) % GRID_TILE) - GRID_TILE;
    const oy = (((-camPxY % GRID_TILE) + GRID_TILE) % GRID_TILE) - GRID_TILE;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, this.cssW + GRID_TILE * 2, this.cssH + GRID_TILE * 2);
    ctx.restore();
  }

  /**
   * The magnet radius, drawn much fainter than the firing circle. Two rings of
   * equal weight would read as one confusing double boundary; this one only needs
   * to answer "did that upgrade do anything".
   */
  private drawMagnetRing(ctx: CanvasRenderingContext2D, game: Game): void {
    const r = game.stats.magnet;
    ctx.save();
    ctx.translate(game.player.x, game.player.y);
    ctx.strokeStyle = 'rgba(192, 123, 255, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 9]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The Hellfire Aura's field — a permanent glow rather than a one-shot effect,
   * so it needs to read as "always on" even at a glance. Drawn under the range
   * circle since it's a smaller radius that would otherwise get lost behind it.
   */
  private drawAura(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    if (!game.equipment.aura) return;
    const pulse = 0.9 + Math.sin(time * 0.008) * 0.1;
    ctx.save();
    ctx.translate(game.player.x, game.player.y);
    ctx.globalCompositeOperation = 'lighter';
    const fill = ctx.createRadialGradient(0, 0, AURA.radius * 0.25, 0, 0, AURA.radius * pulse);
    fill.addColorStop(0, 'rgba(255, 47, 109, 0.28)');
    fill.addColorStop(1, 'rgba(255, 47, 109, 0)');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(0, 0, AURA.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 100, 140, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, AURA.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Fire Cannon shells — a glowing lob whose apparent height comes from a
   *  sine over its flight progress, since the underlying sim only tracks a
   *  straight lerp between launch and impact. */
  private drawFireballs(ctx: CanvasRenderingContext2D, game: Game): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const fb of game.fireballs.items) {
      if (!fb.active) continue;
      const p = Math.min(1, fb.t / fb.duration);
      const arc = Math.sin(p * Math.PI) * 46;
      const gx = fb.x;
      const gy = fb.y - arc;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 15);
      g.addColorStop(0, 'rgba(255, 224, 170, 0.95)');
      g.addColorStop(0.5, 'rgba(255, 143, 77, 0.6)');
      g.addColorStop(1, 'rgba(255, 90, 40, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(gx, gy, 15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The laser's piercing beam, drawn only while its short visual life is
   *  running — the hit-test that damages bots along it already happened the
   *  instant it fired, so this is purely the flash that sells it. */
  private drawLaserBeam(ctx: CanvasRenderingContext2D, game: Game): void {
    const beam = game.laserBeam;
    if (!beam.active || beam.life <= 0) return;
    const alpha = Math.max(0, beam.life / beam.maxLife);
    const endX = beam.originX + beam.dirX * beam.length;
    const endY = beam.originY + beam.dirY * beam.length;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(90, 209, 255, 0.85)';
    ctx.shadowBlur = 20;
    ctx.strokeStyle = `rgba(90, 209, 255, ${alpha * 0.7})`;
    ctx.lineWidth = LASER.beamWidth;
    ctx.beginPath();
    ctx.moveTo(beam.originX, beam.originY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(240, 253, 255, ${alpha})`;
    ctx.lineWidth = LASER.beamWidth * 0.32;
    ctx.beginPath();
    ctx.moveTo(beam.originX, beam.originY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Boss-dropped gear worn on the player square: the laser and fire cannon
   * read as "hands" attached to opposite sides (mirroring how the multi-shot
   * upgrade's extra hands are implied, since neither has a sprite of its
   * own), the aura as a thin outline on the body itself.
   */
  private drawGear(ctx: CanvasRenderingContext2D, game: Game, s: number): void {
    const eq = game.equipment;
    if (eq.laser) {
      ctx.save();
      ctx.fillStyle = EQUIPMENT.laser.accent;
      ctx.shadowColor = EQUIPMENT.laser.accent;
      ctx.shadowBlur = 8;
      ctx.fillRect(s * 0.65, -s * 0.2, s * 0.55, s * 0.4);
      ctx.restore();
    }
    if (eq.fireCannon) {
      ctx.save();
      ctx.fillStyle = EQUIPMENT.fireCannon.accent;
      ctx.shadowColor = EQUIPMENT.fireCannon.accent;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(-s * 0.95, 0, s * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (eq.aura) {
      ctx.save();
      ctx.strokeStyle = EQUIPMENT.aura.accent;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
      ctx.strokeRect(-s * 1.2, -s * 1.2, s * 2.4, s * 2.4);
      ctx.restore();
    }
  }

  /** Gold orbs are discs, XP orbs are diamonds — shape reads faster than hue. */
  private drawPickups(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    const r = PICKUP.radius;
    const pulse = 0.85 + Math.sin(time * 0.006) * 0.15;

    ctx.save();
    ctx.fillStyle = PICKUP.goldColor;
    for (const p of game.pickups.items) {
      if (!p.active || p.kind !== 'gold') continue;
      // Blink out over the last two seconds so nothing vanishes without warning.
      ctx.globalAlpha = p.life < 2 ? 0.35 + Math.abs(Math.sin(p.life * 9)) * 0.65 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = PICKUP.xpColor;
    for (const p of game.pickups.items) {
      if (!p.active || p.kind !== 'xp') continue;
      ctx.globalAlpha = p.life < 2 ? 0.35 + Math.abs(Math.sin(p.life * 9)) * 0.65 : 1;
      const d = r * pulse;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - d);
      ctx.lineTo(p.x + d, p.y);
      ctx.lineTo(p.x, p.y + d);
      ctx.lineTo(p.x - d, p.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawRangeCircle(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    const r = game.stats.range;
    const pulse = game.rangePulse;
    const { x, y } = game.player;

    ctx.save();
    ctx.translate(x, y);
    const fill = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r);
    fill.addColorStop(0, 'rgba(90, 209, 255, 0)');
    fill.addColorStop(1, `rgba(90, 209, 255, ${0.07 + pulse * 0.12})`);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(120, 224, 255, ${0.5 + pulse * 0.4})`;
    ctx.lineWidth = 2 + pulse * 3;
    ctx.setLineDash([14, 12]);
    ctx.lineDashOffset = -(time * 0.02) % 26;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    const s = PLAYER.halfSize;
    const hurt = game.hp / game.maxHp < 0.34;
    ctx.save();
    ctx.translate(game.player.x, game.player.y);
    // Bank into the direction of travel — a static square reads as a UI element,
    // a tilted one reads as something being driven.
    const bank = Math.max(-1, Math.min(1, game.velocity.x / PLAYER.moveSpeed));
    ctx.rotate(Math.sin(time * 0.0009) * 0.1 + bank * 0.22);
    ctx.shadowColor = hurt ? 'rgba(255, 70, 100, 0.9)' : 'rgba(120, 224, 255, 0.9)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = hurt ? '#ff6b81' : '#eaf6ff';
    ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(10, 14, 24, 0.85)';
    ctx.lineWidth = 3;
    ctx.strokeRect(-s * 0.55, -s * 0.55, s * 1.1, s * 1.1);
    this.drawGear(ctx, game, s);
    ctx.restore();
  }

  private drawEnemies(ctx: CanvasRenderingContext2D, game: Game): void {
    for (const e of game.enemies.items) {
      if (!e.active) continue;

      ctx.fillStyle = e.flash > 0.05 ? '#ffffff' : e.color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fill();

      if (e.isBoss) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 8, 0, Math.PI * 2);
        ctx.stroke();
        // Health arc on the body, so the fight reads without looking away.
        ctx.strokeStyle = '#ffd23a';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 16, -Math.PI / 2, -Math.PI / 2 + (e.hp / e.maxHp) * Math.PI * 2);
        ctx.stroke();
      } else if (e.kind === 'tank' && e.hp < e.maxHp) {
        // Only chunky bots survive long enough for a health ring to matter.
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 4, -Math.PI / 2, -Math.PI / 2 + (e.hp / e.maxHp) * Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawBullets(ctx: CanvasRenderingContext2D, game: Game): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#bff3ff';
    for (const b of game.bullets.items) {
      if (!b.active) continue;
      ctx.beginPath();
      ctx.arc(b.x, b.y, PLAYER.bulletRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, game: Game): void {
    for (const p of game.particles.items) {
      if (!p.active) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawFloats(ctx: CanvasRenderingContext2D, game: Game): void {
    ctx.save();
    ctx.textAlign = 'center';
    let lastSize = -1;
    for (const f of game.floats.items) {
      if (!f.active) continue;
      // Damage numbers and reward text use different sizes; only touch the font
      // (a measurable cost on some canvas backends) when the size actually changes.
      if (f.size !== lastSize) {
        ctx.font = `700 ${f.size}px system-ui, -apple-system, sans-serif`;
        lastSize = f.size;
      }
      ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      if (f.crit) {
        // A vector bolt rather than an emoji glyph: an emoji lightning bolt
        // carries its own color and ignores fillStyle, which would defeat the
        // point of a *red* critical marker.
        const half = ctx.measureText(f.text).width / 2;
        const iconSize = f.size * 0.6;
        this.drawCritBolt(ctx, f.x - half - iconSize * 0.7, f.y - f.size * 0.32, iconSize);
      }
    }
    ctx.restore();
  }

  private drawCritBolt(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 20, size / 20);
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath();
    ctx.moveTo(2, -10);
    ctx.lineTo(-6, 2);
    ctx.lineTo(-1, 2);
    ctx.lineTo(-3, 10);
    ctx.lineTo(7, -2);
    ctx.lineTo(1, -2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * An arrow pinned to the screen edge while the boss is off-camera. Now that the
   * player can run away from the fight, losing track of the one thing that has to
   * die is a real failure state.
   */
  private drawOffscreenMarkers(ctx: CanvasRenderingContext2D, game: Game, camX: number, camY: number): void {
    const boss = game.boss;
    if (!boss) return;
    const { scale } = game.view;
    const dx = (boss.x - camX) * scale;
    const dy = (boss.y - camY) * scale;
    const halfW = this.cssW / 2 - 34;
    const halfH = this.cssH / 2 - 34;
    if (Math.abs(dx) < halfW && Math.abs(dy) < halfH) return;

    const t = Math.min(halfW / (Math.abs(dx) || 1), halfH / (Math.abs(dy) || 1));
    const mx = this.cssW / 2 + dx * t;
    const my = this.cssH / 2 + dy * t;

    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = '#ff2f6d';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-10, 9);
    ctx.lineTo(-10, -9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawJoystick(ctx: CanvasRenderingContext2D, j: JoystickView): void {
    ctx.save();
    ctx.globalAlpha = 0.46;
    ctx.strokeStyle = 'rgba(180, 220, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(j.baseX, j.baseY, JOYSTICK.baseRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(120, 224, 255, 0.1)';
    ctx.fill();

    ctx.globalAlpha = 0.68;
    ctx.fillStyle = 'rgba(190, 235, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(j.knobX, j.knobY, JOYSTICK.knobRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
