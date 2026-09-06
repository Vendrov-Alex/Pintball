# AdMob setup

The Shop screen is the game's only monetisation: three gold packs, each unlocked
by a rewarded video. There are no purchases and no interstitials.

## How it behaves today

`src/core/ads.ts` ships pointing at **Google's official test ad units** with
`USE_TEST_ADS = true`. That is deliberate — serving live ads to a test device is
the fastest way to get an AdMob account suspended for invalid traffic.

Anywhere the real SDK is unavailable (a browser, a simulator without Play
Services, an empty ad inventory) the service falls back to a clearly labelled
five-second simulated ad so the economy stays testable without a device.

## Going live

1. Create an AdMob account and register the app twice — once for Android, once
   for iOS. Each gives you an **application ID** (`ca-app-pub-…~…`).
2. Create one **rewarded** ad unit per platform. Each gives an **ad unit ID**
   (`ca-app-pub-…/…`).
3. Put the ad unit IDs into `AD_UNITS` in `src/game/config.ts`.
4. Set `USE_TEST_ADS = false` in `src/core/ads.ts`.
5. Put the *application* IDs into the native projects:
   - Android: `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" …>`
     in `AndroidManifest.xml`
   - iOS: `GADApplicationIdentifier` in `Info.plist`
6. Register your own devices as test devices in the AdMob console so your own
   testing never counts as real impressions.

## Consent and tracking

`ensureInit()` already handles both regimes:

- **iOS App Tracking Transparency** — the ATT prompt is requested once, before
  the first ad. Declining is fine: ads become non-personalised, the game is
  unaffected, and the reward still pays out. `NSUserTrackingUsageDescription`
  must exist in `Info.plist` or iOS silently denies the request.
- **GDPR / UMP** — a consent form is requested and shown when the user is in a
  region that requires one. Outside those regions it resolves immediately with
  no UI.

Both are wrapped in try/catch: a consent failure degrades to non-personalised ads
rather than blocking the shop.

## The rule that matters

**Gold is credited only when the reward callback fires**, and the daily claim
counter is only decremented at the same moment. A user who backs out of an ad
loses nothing and burns no daily slot. Getting this backwards — crediting on
dismissal, or decrementing on ad request — is both a policy problem and a bug
report generator.

## Daily limits

`GOLD_PACKS` in `src/game/config.ts` caps claims per pack per calendar day
(10 / 5 / 2 at 250 / 900 / 3000 gold). That is up to 13,000 gold a day for
seventeen videos, against roughly 340 gold from a new player's first run. If ads
start out-earning play by too much, these are the numbers to pull down — not the
run rewards.
