import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

import { preloadAds } from './core/ads';
import { isAccountFeatureAvailable, onAccountChange, preloadAuth } from './core/auth';
import { setAudioEnabled, sfx, unlockAudio } from './core/audio';
import { music } from './core/music';
import * as haptics from './core/haptics';
import { isNative } from './core/platform';
import { getProfile, initProfile, onProfileChange, setSetting } from './meta/profile';
import { flushCloudSync, initCloudSync } from './meta/cloudSync';
import { AccountModal } from './ui/accountModal';
import { Battle } from './ui/battle';
import { formatGold, onTap, qs } from './ui/dom';
import { Pager } from './ui/pager';
import { GearScreen } from './ui/screens/gear';
import { HomeScreen } from './ui/screens/home';
import { ShopScreen } from './ui/screens/shop';
import { UpgradesScreen } from './ui/screens/upgrades';

import './styles.css';

/**
 * The single-file build is embedded in a page whose <head> belongs to the host,
 * so it cannot ship its own viewport meta. Without one a mobile browser lays the
 * page out at 980px and scales it down, which leaves every touch coordinate
 * offset from what is drawn. Inserting it at runtime makes the bundle portable to
 * any host; where the host already declares one, this is a no-op.
 */
function ensureViewportMeta(): void {
  if (document.querySelector('meta[name="viewport"]')) return;
  const meta = document.createElement('meta');
  meta.name = 'viewport';
  meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  document.head.appendChild(meta);
}

async function boot(): Promise<void> {
  ensureViewportMeta();
  const profile = await initProfile();
  setAudioEnabled(profile.settings.sound);
  haptics.setHapticsEnabled(profile.settings.haptics);

  const app = qs<HTMLElement>(document, '#app');
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="wallet">
          <span class="coin" aria-hidden="true"></span>
          <span class="wallet__value">0</span>
        </div>
        <div class="topbar__tools">
          ${isAccountFeatureAvailable() ? '<button class="icon-btn" type="button" data-account aria-label="Account">☺</button>' : ''}
          <button class="icon-btn" type="button" data-toggle="sound" aria-label="Toggle sound">♪</button>
          <button class="icon-btn" type="button" data-toggle="haptics" aria-label="Toggle vibration">≋</button>
        </div>
      </header>
      <div class="pager">
        <div class="pager__track"></div>
      </div>
      <nav class="pager__dots" aria-label="Screens"></nav>
    </div>`;

  const wallet = qs<HTMLElement>(app, '.wallet__value');
  const track = qs<HTMLElement>(app, '.pager__track');

  const home = new HomeScreen(() => startBattle());
  const upgrades = new UpgradesScreen(() => refreshAll());
  const gear = new GearScreen();
  const shop = new ShopScreen(() => refreshAll());
  track.append(home.root, upgrades.root, gear.root, shop.root);

  const pager = new Pager(qs<HTMLElement>(app, '.shell'), ['Battle', 'Upgrade', 'Gear', 'Shop']);
  pager.setOnChange(() => {
    sfx.ui();
    refreshAll();
  });

  const battle = new Battle(() => {
    pager.setLocked(false);
    refreshAll();
    void flushCloudSync();
  });
  document.body.appendChild(battle.root);

  // The account button only exists in the DOM when a Firebase project is
  // actually configured (see core/firebaseConfig.ts) — nothing to wire up
  // otherwise.
  const accountBtn = app.querySelector<HTMLButtonElement>('[data-account]');
  if (accountBtn) {
    const accountModal = new AccountModal();
    document.body.appendChild(accountModal.root);
    onTap(accountBtn, () => {
      sfx.ui();
      accountModal.open();
    });
    onAccountChange((user) => accountBtn.classList.toggle('is-signed-in', user !== null));
  }
  initCloudSync();

  function startBattle(): void {
    unlockAudio();
    sfx.ui();
    haptics.tap();
    pager.setLocked(true);
    battle.start();
  }

  // The score starts on first interaction (autoplay policy) and stays in the
  // menu phase until a run begins; battle.ts switches it to battle/boss and
  // back to menu when the run ends.
  music.enterMenu();

  function refreshAll(): void {
    wallet.textContent = formatGold(getProfile().gold);
    home.refresh();
    upgrades.refresh();
    gear.refresh();
    shop.refresh();
  }

  onProfileChange((p) => {
    wallet.textContent = formatGold(p.gold);
  });

  // Settings toggles
  app.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
    const key = btn.dataset.toggle as 'sound' | 'haptics';
    const paint = (): void => {
      btn.classList.toggle('is-off', !getProfile().settings[key]);
    };
    paint();
    onTap(btn, () => {
      const next = !getProfile().settings[key];
      setSetting(key, next);
      if (key === 'sound') setAudioEnabled(next);
      else haptics.setHapticsEnabled(next);
      paint();
      sfx.ui();
    });
  });

  refreshAll();

  // ---------------------------------------------------------------- platform

  if (isNative()) {
    void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    void SplashScreen.hide().catch(() => {});

    // Android hardware back: unwind one level at a time, never kill the app
    // straight out of a run — that would silently discard the run's gold.
    void App.addListener('backButton', () => {
      if (battle.isActive) battle.requestQuit();
      else if (pager.current !== 0) pager.goTo(0);
      else void App.exitApp();
    });

    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) void flushCloudSync();
    });
  }

  preloadAds();
  preloadAuth();
  document.body.classList.add('is-ready');
}

void boot();
