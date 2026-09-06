import { PLAYER } from './config';
import type { Game } from './engine';

/**
 * Canvas renderer.
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
    const size = 48;
    const tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
    const tctx = tile.getContext('2d');
    if (!tctx) return null;
    tctx.strokeStyle = 'rgba(120, 150, 220, 0.075)';
    tctx.lineWidth = 1;
    tctx.beginPath();
    tctx.moveTo(0.5, 0);
    tctx.lineTo(0.5, size);
    tctx.moveTo(0, 0.5);
    tctx.lineTo(size, 0.5);
    tctx.stroke();
    this.gridPattern = this.ctx.createPattern(tile, 'repeat');
    return this.gridPattern;
  }

  render(game: Game, time: number): void {
    const ctx = this.ctx;
    const { scale } = game.view;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(ctx);

    const shakeX = game.shake ? (Math.random() - 0.5) * game.shake : 0;
    const shakeY = game.shake ? (Math.random() - 0.5) * game.shake : 0;

    ctx.save();
    ctx.translate(this.cssW / 2 + shakeX, this.cssH / 2 + shakeY);
    ctx.scale(scale, scale);

    this.drawRangeCircle(ctx, game, time);
    this.drawParticles(ctx, game);
    this.drawEnemies(ctx, game);
    this.drawBullets(ctx, game);
    this.drawPlayer(ctx, game, time);
    this.drawFloats(ctx, game);

    ctx.restore();
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createRadialGradient(
      this.cssW / 2, this.cssH / 2, 0,
      this.cssW / 2, this.cssH / 2, Math.max(this.cssW, this.cssH) * 0.75,
    );
    g.addColorStop(0, '#151b2c');
    g.addColorStop(1, '#07090f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const pattern = this.ensureGrid();
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
  }

  private drawRangeCircle(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    const r = game.stats.range;
    const pulse = game.rangePulse;

    ctx.save();
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
    ctx.rotate(Math.sin(time * 0.0009) * 0.14);
    ctx.shadowColor = hurt ? 'rgba(255, 70, 100, 0.9)' : 'rgba(120, 224, 255, 0.9)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = hurt ? '#ff6b81' : '#eaf6ff';
    ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(10, 14, 24, 0.85)';
    ctx.lineWidth = 3;
    ctx.strokeRect(-s * 0.55, -s * 0.55, s * 1.1, s * 1.1);
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
    ctx.font = '700 26px system-ui, -apple-system, sans-serif';
    for (const f of game.floats.items) {
      if (!f.active) continue;
      ctx.globalAlpha = Math.min(1, f.life);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }
}
