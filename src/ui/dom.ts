export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export function qs<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

export function formatGold(value: number): string {
  const n = Math.floor(value);
  if (n < 10000) return n.toLocaleString('en-US');
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Taps, not clicks.
 *
 * `click` in a WebView fires up to 300ms after the finger lifts on some Android
 * builds, which makes every menu feel broken. Listening to pointerup and guarding
 * against drags keeps the UI as responsive as the game.
 */
export function onTap(node: HTMLElement, handler: (ev: PointerEvent) => void): void {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  node.addEventListener('pointerdown', (ev) => {
    tracking = true;
    startX = ev.clientX;
    startY = ev.clientY;
  });

  node.addEventListener('pointerup', (ev) => {
    if (!tracking) return;
    tracking = false;
    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 14) return;
    if (node instanceof HTMLButtonElement && node.disabled) return;
    handler(ev);
  });

  node.addEventListener('pointercancel', () => {
    tracking = false;
  });
}
