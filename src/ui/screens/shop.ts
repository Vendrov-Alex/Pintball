import { showRewardedAd } from '../../core/ads';
import { sfx } from '../../core/audio';
import * as haptics from '../../core/haptics';
import { GOLD_PACKS, type GoldPack } from '../../game/config';
import { addGold, adClaimsLeft, recordAdClaim } from '../../meta/profile';
import { formatGold, onTap } from '../dom';

export class ShopScreen {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private busy = false;

  constructor(private readonly onPurchase: () => void) {
    this.root = document.createElement('section');
    this.root.className = 'screen screen--shop';
    this.root.innerHTML = `
      <div class="screen__body">
        <header class="screen__head">
          <h2>Gold Shop</h2>
          <p>Watch a short video, take the gold. No purchase, ever.</p>
        </header>
        <div class="pack-list"></div>
        <p class="screen__foot">Daily limits reset at midnight, local time.</p>
      </div>`;
    this.list = this.root.querySelector('.pack-list') as HTMLElement;
    this.refresh();
  }

  refresh(): void {
    this.list.innerHTML = GOLD_PACKS.map((p) => this.cardHtml(p)).join('');
    this.list.querySelectorAll<HTMLButtonElement>('.pack__cta').forEach((btn) => {
      onTap(btn, () => void this.claim(btn.dataset.id as string));
    });
  }

  private cardHtml(pack: GoldPack): string {
    const left = adClaimsLeft(pack.id, pack.dailyLimit);
    const soldOut = left === 0;
    return `
      <article class="pack" style="--accent:${pack.accent}">
        <div class="pack__amount">
          <span class="coin coin--lg" aria-hidden="true"></span>
          <strong>${formatGold(pack.gold)}</strong>
        </div>
        <div class="pack__meta">
          <h3>${pack.title}</h3>
          <p>${pack.subtitle}</p>
          <span class="pack__left">${soldOut ? 'Back tomorrow' : `${left} of ${pack.dailyLimit} left today`}</span>
        </div>
        <button class="pack__cta" type="button" data-id="${pack.id}"${soldOut ? ' disabled' : ''}>
          ${soldOut ? 'Done' : '<span aria-hidden="true">▶</span> Watch'}
        </button>
      </article>`;
  }

  private async claim(packId: string): Promise<void> {
    if (this.busy) return;
    const pack = GOLD_PACKS.find((p) => p.id === packId);
    if (!pack || adClaimsLeft(pack.id, pack.dailyLimit) === 0) return;

    this.busy = true;
    this.setPending(packId, true);
    try {
      const result = await showRewardedAd();
      if (result === 'rewarded') {
        // The claim is only recorded once the reward actually lands, so a failed
        // or abandoned ad never burns one of the player's daily slots.
        recordAdClaim(pack.id);
        addGold(pack.gold);
        sfx.purchase();
        haptics.levelUp();
        this.onPurchase();
      } else {
        sfx.hurt();
      }
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  private setPending(packId: string, pending: boolean): void {
    const btn = this.list.querySelector<HTMLButtonElement>(`.pack__cta[data-id="${packId}"]`);
    if (!btn) return;
    btn.disabled = pending;
    btn.textContent = pending ? 'Loading…' : 'Watch';
  }
}
