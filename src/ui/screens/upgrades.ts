import { sfx } from '../../core/audio';
import * as haptics from '../../core/haptics';
import { allUpgradeViews, buyUpgrade, type MetaUpgradeView } from '../../meta/metaUpgrades';
import type { MetaUpgradeId } from '../../game/config';
import { formatGold, onTap } from '../dom';

export class UpgradesScreen {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;

  constructor(private readonly onPurchase: () => void) {
    this.root = document.createElement('section');
    this.root.className = 'screen screen--upgrades';
    this.root.innerHTML = `
      <div class="screen__body">
        <header class="screen__head">
          <h2>Upgrade</h2>
          <p>Permanent boosts. They apply to every run, forever.</p>
        </header>
        <div class="upgrade-list"></div>
        <p class="screen__foot">Gold is earned from every bot you kill — win or lose.</p>
      </div>`;
    this.list = this.root.querySelector('.upgrade-list') as HTMLElement;
    this.refresh();
  }

  refresh(): void {
    const views = allUpgradeViews();
    this.list.innerHTML = views.map((v) => this.cardHtml(v)).join('');
    this.list.querySelectorAll<HTMLButtonElement>('.upgrade__buy').forEach((btn) => {
      onTap(btn, () => this.buy(btn.dataset.id as MetaUpgradeId));
    });
  }

  private buy(id: MetaUpgradeId): void {
    if (buyUpgrade(id)) {
      sfx.purchase();
      haptics.tap();
      this.refresh();
      this.onPurchase();
    } else {
      sfx.hurt();
    }
  }

  private cardHtml(v: MetaUpgradeView): string {
    const pips = Array.from({ length: v.maxLevel }, (_, i) => `<i class="${i < v.level ? 'on' : ''}"></i>`).join('');
    const maxed = v.cost === null;
    const action = maxed
      ? '<span class="upgrade__maxed">MAX</span>'
      : `<button class="upgrade__buy${v.affordable ? '' : ' is-poor'}" type="button" data-id="${v.id}"${v.affordable ? '' : ' disabled'}>
           <span class="coin" aria-hidden="true"></span>${formatGold(v.cost as number)}
         </button>`;

    return `
      <article class="upgrade" data-upgrade="${v.id}">
        <div class="upgrade__icon" aria-hidden="true">${v.icon}</div>
        <div class="upgrade__main">
          <div class="upgrade__title">
            <h3>${v.name}</h3>
            <span class="upgrade__level">Lv ${v.level}<em>/${v.maxLevel}</em></span>
          </div>
          <p class="upgrade__desc">${v.description}</p>
          <div class="upgrade__pips">${pips}</div>
          <p class="upgrade__delta">
            <strong>+${Math.round(v.bonus * 100)}%</strong>
            ${v.nextBonus !== null ? `<span class="arrow" aria-hidden="true">→</span><em>+${Math.round(v.nextBonus * 100)}%</em>` : ''}
          </p>
        </div>
        <div class="upgrade__action">${action}</div>
      </article>`;
  }
}
