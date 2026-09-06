import { AD_UNITS } from '../game/config';
import { isNative, platform } from './platform';

/**
 * Rewarded-video ads.
 *
 * On device this drives Google AdMob through @capacitor-community/admob. Anywhere
 * the real SDK is unavailable (browser dev, simulator without Play Services, a
 * failed fill) the service falls back to a clearly-labelled simulated ad so the
 * economy stays testable. The caller only ever learns "was the reward earned".
 */

type AdMobModule = typeof import('@capacitor-community/admob');

let admob: AdMobModule | null = null;
let initPromise: Promise<void> | null = null;
let initialised = false;

/** Set to true to exercise the real SDK against Google's test ad units. */
export const USE_TEST_ADS = true;

function adUnitId(): string {
  return platform() === 'ios' ? AD_UNITS.ios : AD_UNITS.android;
}

async function ensureInit(): Promise<boolean> {
  if (!isNative()) return false;
  if (initialised) return true;
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await import('@capacitor-community/admob');
      admob = mod;
      await mod.AdMob.initialize({ initializeForTesting: USE_TEST_ADS });
      // iOS 14+ requires an explicit App Tracking Transparency prompt before
      // personalised ads. Declining is fine — ads simply become non-personalised.
      if (platform() === 'ios') {
        try {
          const status = await mod.AdMob.trackingAuthorizationStatus();
          if (status.status === 'notDetermined') await mod.AdMob.requestTrackingAuthorization();
        } catch {
          /* ATT is unavailable on older iOS versions. */
        }
      }
      // GDPR/UMP consent. Non-EEA users resolve immediately with no form.
      try {
        const info = await mod.AdMob.requestConsentInfo();
        if (info.isConsentFormAvailable && info.status === 'REQUIRED') {
          await mod.AdMob.showConsentForm();
        }
      } catch {
        /* Consent gathering is best-effort; ads fall back to non-personalised. */
      }
      initialised = true;
    })().catch(() => {
      admob = null;
      initialised = false;
      initPromise = null;
    });
  }
  await initPromise;
  return initialised;
}

/** Warms up the SDK during app boot so the first ad opens without a stall. */
export function preloadAds(): void {
  void ensureInit();
}

export type AdResult = 'rewarded' | 'dismissed' | 'unavailable';

export async function showRewardedAd(): Promise<AdResult> {
  const ready = await ensureInit();
  if (ready && admob) {
    try {
      await admob.AdMob.prepareRewardVideoAd({ adId: adUnitId(), isTesting: USE_TEST_ADS });
      const reward = await admob.AdMob.showRewardVideoAd();
      return reward && reward.amount > 0 ? 'rewarded' : 'dismissed';
    } catch {
      // No fill, no network, or the user backed out before the reward.
      return simulateAd();
    }
  }
  return simulateAd();
}

/** Dev-only stand-in: a five second, non-skippable overlay. */
function simulateAd(): Promise<AdResult> {
  return new Promise((resolve) => {
    const seconds = 5;
    const overlay = document.createElement('div');
    overlay.className = 'ad-sim';
    overlay.innerHTML = `
      <div class="ad-sim__panel">
        <div class="ad-sim__tag">Simulated ad</div>
        <div class="ad-sim__art"></div>
        <div class="ad-sim__count">${seconds}</div>
        <p class="ad-sim__note">Real AdMob video plays here on device.</p>
        <button class="ad-sim__close" type="button" disabled>Skip</button>
      </div>`;
    document.body.appendChild(overlay);

    const count = overlay.querySelector<HTMLElement>('.ad-sim__count')!;
    const close = overlay.querySelector<HTMLButtonElement>('.ad-sim__close')!;
    let left = seconds;

    const timer = window.setInterval(() => {
      left -= 1;
      count.textContent = String(Math.max(0, left));
      if (left <= 0) {
        window.clearInterval(timer);
        close.disabled = false;
        close.textContent = 'Claim reward';
      }
    }, 1000);

    close.addEventListener('click', () => {
      window.clearInterval(timer);
      overlay.remove();
      resolve('rewarded');
    });
  });
}
