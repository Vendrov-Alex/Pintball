import { MAX_LEVEL, RUN_DURATION } from '../../game/config';
import { getProfile } from '../../meta/profile';
import { formatTime, onTap, qs } from '../dom';

export class HomeScreen {
  readonly root: HTMLElement;
  private readonly stats: HTMLElement;

  constructor(onBattle: () => void) {
    this.root = document.createElement('section');
    this.root.className = 'screen screen--home';
    this.root.innerHTML = `
      <div class="screen__body">
        <header class="brand">
          <div class="brand__mark" aria-hidden="true"><span></span></div>
          <h1 class="brand__title">Roblaksim<span>Survivor</span></h1>
          <p class="brand__tag">${Math.round(RUN_DURATION / 60)} minutes. Endless waves. One boss.</p>
        </header>

        <button class="battle-btn" type="button">
          <span class="battle-btn__label">Battle</span>
          <span class="battle-btn__sub">Tap to deploy</span>
        </button>

        <dl class="stat-grid"></dl>

        <p class="swipe-hint"><span aria-hidden="true">‹</span> Swipe for Upgrades &amp; Shop <span aria-hidden="true">›</span></p>
      </div>`;

    this.stats = qs(this.root, '.stat-grid');
    onTap(qs(this.root, '.battle-btn'), onBattle);
    this.refresh();
  }

  refresh(): void {
    const s = getProfile().stats;
    const rows: [string, string][] = [
      ['Runs', String(s.runs)],
      ['Bosses down', String(s.wins)],
      ['Best level', `${s.bestLevel} / ${MAX_LEVEL}`],
      ['Best kills', String(s.bestKills)],
      ['Longest run', formatTime(s.bestSurvivedSeconds)],
      ['Gold earned', s.totalGoldEarned.toLocaleString('en-US')],
    ];
    this.stats.innerHTML = rows
      .map(([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${v}</dd></div>`)
      .join('');
  }
}
