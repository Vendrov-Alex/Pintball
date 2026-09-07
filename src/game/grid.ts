import type { Enemy } from './types';

/**
 * Uniform spatial hash, rebuilt once per frame.
 *
 * Bullet hit tests and bot-to-bot separation are both "what is near this point"
 * queries. Brute force is O(n^2) and at 250+ bots that is ~60k distance checks a
 * frame; the grid keeps it near-linear.
 *
 * The playable square (WORLD.halfSize in config.ts) is large enough, and the
 * player moves through enough of it, that cells are addressed by a
 * multiplicative hash rather than a packed coordinate — no fixed-size array to
 * outgrow. Two distant cells can share a bucket; that only costs a few extra
 * distance checks, because every caller verifies the real distance anyway.
 */
export class SpatialGrid {
  private readonly cells = new Map<number, Enemy[]>();
  private readonly cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): number {
    return ((cx * 92837111) ^ (cy * 689287499)) | 0;
  }

  rebuild(enemies: readonly Enemy[]): void {
    for (const bucket of this.cells.values()) bucket.length = 0;
    for (const e of enemies) {
      if (!e.active) continue;
      const k = this.key(Math.floor(e.x / this.cellSize), Math.floor(e.y / this.cellSize));
      let bucket = this.cells.get(k);
      if (!bucket) {
        bucket = [];
        this.cells.set(k, bucket);
      }
      bucket.push(e);
    }
  }

  /** Calls `fn` for every bot in the cells overlapping the given circle. */
  query(x: number, y: number, radius: number, fn: (e: Enemy) => void): void {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const e of bucket) if (e.active) fn(e);
      }
    }
  }

  clear(): void {
    this.cells.clear();
  }
}
