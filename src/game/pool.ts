/**
 * Fixed-capacity object pool.
 *
 * Hundreds of bots, bullets and particles are created and destroyed every second;
 * allocating them would hand the garbage collector a steady job and produce visible
 * hitches on mid-range Android. Everything is pre-allocated once and reused.
 */
export class Pool<T extends { active: boolean }> {
  readonly items: T[];

  constructor(capacity: number, factory: () => T) {
    this.items = new Array<T>(capacity);
    for (let i = 0; i < capacity; i++) this.items[i] = factory();
  }

  /** Returns an inactive slot, or null when the pool is saturated. */
  obtain(): T | null {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      if (!items[i].active) {
        items[i].active = true;
        return items[i];
      }
    }
    return null;
  }

  clear(): void {
    for (const item of this.items) item.active = false;
  }

  countActive(): number {
    let n = 0;
    for (const item of this.items) if (item.active) n++;
    return n;
  }
}
