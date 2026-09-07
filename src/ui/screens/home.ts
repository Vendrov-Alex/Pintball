import { MAX_LEVEL, RUN_DURATION, STAGE_IDS, type StageId } from '../../game/config';
import { getProfile, isStageUnlocked } from '../../meta/profile';
import { formatTime, onTap, qs } from '../dom';

const STAGE_INFO: Record<StageId, { name: string; icon: string; blurb: string }> = {
  1: { name: 'Stage 1', icon: '●', blurb: 'The wave-survival run you know.' },
  2: { name: 'Stage 2', icon: '▲', blurb: 'Double-HP triangles, and a shooter that keeps you moving.' },
};

export class HomeScreen {
  readonly root: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly stageList: HTMLElement;

  constructor(private readonly onBattle: (stage: StageId) => void) {
    this.root = document.createElement('section');
    this.root.className = 'screen screen--home';
    this.root.innerHTML = `
      <div class="screen__body">
        <header class="brand">
          <div class="brand__mark" aria-hidden="true"><span></span></div>
          <h1 class="brand__title">Roblaksim<span>Survivor</span></h1>
          <p class="brand__tag">${Math.round(RUN_DURATION / 60)} minutes. Endless waves. One boss.</p>
        </header>

        <div class="stage-list"></div>

        <dl class="stat-grid"></dl>

        <p class="swipe-hint"><span aria-hidden="true">‹</span> Swipe for Upgrades, Gear &amp; Shop <span aria-hidden="true">›</span></p>
      </div>`;

    this.stats = qs(this.root, '.stat-grid');
    this.stageList = qs(this.root, '.stage-list');
    this.refresh();
  }

  refresh(): void {
    this.renderStages();

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

  private renderStages(): void {
    this.stageList.innerHTML = STAGE_IDS.map((id) => {
      const info = STAGE_INFO[id];
      const unlocked = isStageUnlocked(id);
      return `
        <button class="stage-card${unlocked ? '' : ' is-locked'}" type="button" data-stage="${id}"${unlocked ? '' : ' disabled'}>
          <span class="stage-card__icon" aria-hidden="true">${info.icon}</span>
          <span class="stage-card__main">
            <span class="stage-card__title">
              <strong>${info.name}</strong>
              <span class="stage-card__status">${unlocked ? 'PLAY' : 'LOCKED'}</span>
            </span>
            <span class="stage-card__desc">${unlocked ? info.blurb : `Beat Stage ${id - 1} to unlock`}</span>
          </span>
        </button>`;
    }).join('');

    this.stageList.querySelectorAll<HTMLButtonElement>('.stage-card:not(.is-locked)').forEach((btn) => {
      onTap(btn, () => this.onBattle(Number(btn.dataset.stage) as StageId));
    });
  }
}
