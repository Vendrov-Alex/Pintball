/**
 * The optional "save your progress" modal: sign in with Google/Apple/Facebook,
 * or see the signed-in account and sign out. Never shown at all unless
 * core/auth.ts reports the feature is actually configured — see its own header
 * comment for why a half-wired sign-in button is worse than no button.
 */

import * as haptics from '../core/haptics';
import { sfx } from '../core/audio';
import {
  getAccountUser,
  onAccountChange,
  signInWithApple,
  signInWithFacebook,
  signInWithGoogle,
  signOutUser,
  type AccountUser,
  type SignInOutcome,
} from '../core/auth';
import { onTap, qs } from './dom';

type Provider = 'google' | 'apple' | 'facebook';

const PROVIDER_LABEL: Record<Provider, string> = {
  google: 'Google',
  apple: 'Apple',
  facebook: 'Facebook',
};

export class AccountModal {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private busy = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'modal modal--account';
    this.root.hidden = true;
    this.root.innerHTML = '<div class="modal__card"></div>';
    this.card = qs(this.root, '.modal__card');

    // Tapping the dimmed backdrop closes it, same as a dedicated close button
    // would — nothing here is a decision serious enough to need a confirm step.
    onTap(this.root, (ev) => {
      if (ev.target === this.root) this.close();
    });

    onAccountChange(() => {
      if (!this.root.hidden) this.render();
    });
  }

  open(): void {
    this.busy = false;
    this.render();
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  private render(): void {
    const user = getAccountUser();
    this.card.innerHTML = user ? this.signedInHtml(user) : this.signedOutHtml();

    if (user) {
      const btn = this.card.querySelector<HTMLButtonElement>('[data-action="sign-out"]');
      if (btn) onTap(btn, () => void this.handleSignOut());
    } else {
      this.card.querySelectorAll<HTMLButtonElement>('[data-provider]').forEach((btn) => {
        onTap(btn, () => void this.handleSignIn(btn.dataset.provider as Provider));
      });
    }
    const dismiss = this.card.querySelector<HTMLButtonElement>('[data-action="close"]');
    if (dismiss) onTap(dismiss, () => this.close());
  }

  private signedOutHtml(): string {
    const providers: Provider[] = ['google', 'apple', 'facebook'];
    return `
      <p class="modal__eyebrow">Account</p>
      <h2 class="modal__title">Save your progress</h2>
      <p class="account__note">
        Sign in to keep your gold and upgrades if you switch phones. Playing as a
        guest is completely fine — your progress just stays on this device.
      </p>
      <div class="account__providers">
        ${providers
          .map(
            (p) => `
          <button class="account__provider" type="button" data-provider="${p}" ${this.busy ? 'disabled' : ''}>
            <span class="account__provider-icon account__provider-icon--${p}" aria-hidden="true"></span>
            Continue with ${PROVIDER_LABEL[p]}
          </button>`,
          )
          .join('')}
      </div>
      <p class="account__status" data-status></p>
      <button class="btn btn--ghost account__later" type="button" data-action="close">Maybe later</button>
    `;
  }

  private signedInHtml(user: AccountUser): string {
    const initial = (user.displayName ?? user.email ?? '?').trim().charAt(0).toUpperCase();
    return `
      <p class="modal__eyebrow">Account</p>
      <h2 class="modal__title">You're signed in</h2>
      <div class="account__profile">
        ${
          user.photoUrl
            ? `<img class="account__avatar" src="${user.photoUrl}" alt="" referrerpolicy="no-referrer" />`
            : `<span class="account__avatar account__avatar--fallback">${initial}</span>`
        }
        <div class="account__identity">
          <strong>${user.displayName ?? 'Player'}</strong>
          ${user.email ? `<span>${user.email}</span>` : ''}
        </div>
      </div>
      <p class="account__note">Your gold and upgrades sync automatically across every
        device you sign in on.</p>
      <div class="result__actions">
        <button class="btn btn--ghost" type="button" data-action="close">Close</button>
        <button class="btn btn--primary" type="button" data-action="sign-out">Sign out</button>
      </div>
    `;
  }

  private setStatus(text: string): void {
    const el = this.card.querySelector<HTMLElement>('[data-status]');
    if (el) el.textContent = text;
  }

  private async handleSignIn(provider: Provider): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    this.setStatus(`Opening ${PROVIDER_LABEL[provider]}…`);

    const run: Record<Provider, () => Promise<SignInOutcome>> = {
      google: signInWithGoogle,
      apple: signInWithApple,
      facebook: signInWithFacebook,
    };
    const outcome = await run[provider]();
    this.busy = false;

    if (outcome === 'signed-in') {
      sfx.purchase();
      haptics.levelUp();
      this.render();
      return;
    }
    if (outcome === 'cancelled') {
      this.render();
      return;
    }
    // 'unavailable' shouldn't be reachable — the button only exists when the
    // feature is configured — but 'error' (network, misconfigured provider) is
    // real and needs to say something rather than fail silently.
    this.render();
    this.setStatus(
      outcome === 'unavailable' ? 'Sign-in is not set up yet.' : "Couldn't sign in — check your connection and try again.",
    );
  }

  private async handleSignOut(): Promise<void> {
    sfx.ui();
    haptics.tap();
    await signOutUser();
    this.render();
  }
}
