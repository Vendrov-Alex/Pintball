import { allEquipmentViews, type EquipmentView } from '../../meta/equipment';

export class GearScreen {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;

  constructor() {
    this.root = document.createElement('section');
    this.root.className = 'screen screen--gear';
    this.root.innerHTML = `
      <div class="screen__body">
        <header class="screen__head">
          <h2>Gear</h2>
          <p>Rare equipment drops from every boss you defeat — a different piece each time.</p>
        </header>
        <div class="gear-list"></div>
        <p class="screen__foot">Once earned, gear is worn on every run. There's nothing to buy here.</p>
      </div>`;
    this.list = this.root.querySelector('.gear-list') as HTMLElement;
    this.refresh();
  }

  refresh(): void {
    this.list.innerHTML = allEquipmentViews().map((v) => this.cardHtml(v)).join('');
  }

  private cardHtml(v: EquipmentView): string {
    return `
      <article class="gear-card${v.owned ? '' : ' is-locked'}" style="--accent:${v.accent}">
        <div class="gear-card__icon" aria-hidden="true">${v.owned ? v.icon : '?'}</div>
        <div class="gear-card__main">
          <div class="gear-card__title">
            <h3>${v.owned ? v.name : '???'}</h3>
            <span class="gear-card__status">${v.owned ? 'Equipped' : 'Locked'}</span>
          </div>
          <p class="gear-card__desc">${v.owned ? v.description : 'Defeat a boss for a chance to unlock this piece.'}</p>
        </div>
      </article>`;
  }
}
