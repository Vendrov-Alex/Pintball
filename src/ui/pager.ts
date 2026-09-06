import { qs } from './dom';

/**
 * Horizontal swipe pager for the three app screens.
 *
 * Written against Pointer Events rather than a scroll container so that a
 * horizontal drag can be distinguished from a vertical scroll inside a screen:
 * the gesture is only claimed once the movement is unambiguously horizontal,
 * which keeps long upgrade lists scrollable.
 */
export class Pager {
  readonly root: HTMLElement;
  private readonly track: HTMLElement;
  private readonly dots: HTMLElement[];
  private index = 0;
  private width = 1;

  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastTime = 0;
  private velocity = 0;
  private axis: 'none' | 'x' | 'y' = 'none';
  private dragging = false;

  private locked = false;
  private onChange?: (index: number) => void;

  constructor(root: HTMLElement, labels: string[]) {
    this.root = root;
    this.track = qs(root, '.pager__track');

    const nav = qs(root, '.pager__dots');
    this.dots = labels.map((label, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'dot';
      dot.setAttribute('aria-label', label);
      dot.addEventListener('click', () => this.goTo(i));
      nav.appendChild(dot);
      return dot;
    });

    this.measure();
    window.addEventListener('resize', () => this.measure());
    this.bindGestures();
    this.apply(false);
  }

  setOnChange(fn: (index: number) => void): void {
    this.onChange = fn;
  }

  /** Disables swiping while the battle is on screen. */
  setLocked(locked: boolean): void {
    this.locked = locked;
  }

  get current(): number {
    return this.index;
  }

  private measure(): void {
    this.width = this.root.clientWidth || 1;
    this.apply(false);
  }

  goTo(index: number, animate = true): void {
    const next = Math.max(0, Math.min(this.dots.length - 1, index));
    const changed = next !== this.index;
    this.index = next;
    this.apply(animate);
    if (changed) this.onChange?.(next);
  }

  private apply(animate: boolean, dragOffset = 0): void {
    this.track.style.transition = animate ? 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
    this.track.style.transform = `translate3d(${-this.index * this.width + dragOffset}px, 0, 0)`;
    this.dots.forEach((dot, i) => dot.classList.toggle('is-active', i === this.index));
  }

  private bindGestures(): void {
    this.root.addEventListener('pointerdown', (ev) => {
      if (this.locked || this.pointerId !== null) return;
      this.pointerId = ev.pointerId;
      this.startX = this.lastX = ev.clientX;
      this.startY = ev.clientY;
      this.lastTime = performance.now();
      this.velocity = 0;
      this.axis = 'none';
      this.dragging = false;
    });

    this.root.addEventListener('pointermove', (ev) => {
      if (this.pointerId !== ev.pointerId || this.locked) return;
      const dx = ev.clientX - this.startX;
      const dy = ev.clientY - this.startY;

      if (this.axis === 'none') {
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) {
          this.axis = 'x';
          this.dragging = true;
          this.root.setPointerCapture(ev.pointerId);
        } else if (Math.abs(dy) > 12) {
          this.axis = 'y';
        }
        if (this.axis !== 'x') return;
      }
      if (this.axis !== 'x') return;

      const now = performance.now();
      const dt = now - this.lastTime;
      if (dt > 0) this.velocity = (ev.clientX - this.lastX) / dt;
      this.lastX = ev.clientX;
      this.lastTime = now;

      // Rubber-band at the two ends instead of sliding into empty space.
      const atEdge = (this.index === 0 && dx > 0) || (this.index === this.dots.length - 1 && dx < 0);
      this.apply(false, atEdge ? dx * 0.32 : dx);
    });

    const finish = (ev: PointerEvent): void => {
      if (this.pointerId !== ev.pointerId) return;
      this.pointerId = null;
      if (!this.dragging) {
        this.axis = 'none';
        return;
      }
      this.dragging = false;
      this.axis = 'none';

      const dx = ev.clientX - this.startX;
      const flicked = Math.abs(this.velocity) > 0.45;
      const dragged = Math.abs(dx) > this.width * 0.22;
      if (flicked || dragged) this.goTo(this.index + (dx < 0 ? 1 : -1));
      else this.apply(true);
    };

    this.root.addEventListener('pointerup', finish);
    this.root.addEventListener('pointercancel', (ev) => {
      if (this.pointerId !== ev.pointerId) return;
      this.pointerId = null;
      this.dragging = false;
      this.axis = 'none';
      this.apply(true);
    });
  }
}
