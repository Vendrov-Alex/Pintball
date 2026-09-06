# Shipping to the App Store and Google Play

Everything here is required for a first submission of a free, ad-supported game
with no accounts, no purchases and no analytics. Work top to bottom.

---

## 1. Identity

| Field | Value | Where |
|---|---|---|
| Bundle ID / Application ID | `com.vendrov.pintball` | `capacitor.config.ts` |
| Display name | Pintball Survivor | `capacitor.config.ts` |
| Version name | `1.0.0` | `package.json` |
| Version code / build | `1` | Native project, bumped every upload |

Change the bundle ID **before** the first upload. It is permanent on both stores.

## 2. Generate native projects

```bash
npm install
npm run assets:icon    # writes resources/*.png and public/icons/*.png from code
npx @capacitor/assets generate \
  --iconBackgroundColor "#07090f" \
  --splashBackgroundColor "#07090f"

npx cap add ios
npx cap add android
npm run cap:sync
```

`android/` and `ios/` are git-ignored by default. Commit them once you start
customising native code (signing config, ad IDs, permissions).

## 3. Android (Google Play)

**Manifest** — `android/app/src/main/AndroidManifest.xml`:

- Lock orientation on the main activity: `android:screenOrientation="portrait"`.
- Add the AdMob app ID (see `docs/ADMOB.md`) inside `<application>`:
  ```xml
  <meta-data
      android:name="com.google.android.gms.ads.APPLICATION_ID"
      android:value="ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY"/>
  ```
- The ads SDK adds `com.google.android.gms.permission.AD_ID` itself. You must
  declare it in the Play Console Data Safety form (see §5).
- Remove any permission you do not use. This game needs none beyond internet,
  which Capacitor already declares.

**Gradle** — `android/app/build.gradle`:

- `minSdkVersion 23` or higher, `targetSdkVersion` at Play's current requirement
  (34 at time of writing; Play enforces the previous year's API level).
- Enable `minifyEnabled true` and `shrinkResources true` for release.

**Build and sign**:

```bash
npm run cap:sync
cd android && ./gradlew bundleRelease     # produces an .aab, required by Play
```

Create an upload key once (`keytool -genkey -v -keystore upload.jks -alias upload
-keyalg RSA -keysize 2048 -validity 10000`), store it outside the repo, and
register `signingConfigs` in `app/build.gradle`. Never commit the keystore.

**Play Console listing**:

- Short description (80 chars max), full description (4000 max).
- Feature graphic 1024x500 PNG/JPG.
- At least 2 phone screenshots, 16:9 or 9:16, min 320px on the short side. Use
  `npm run qa:shots` and crop.
- Content rating questionnaire: no violence against real people, no gambling, no
  user-generated content. Expect PEGI 3 / ESRB Everyone.
- Target audience: **not** designed for children under 13 unless you also comply
  with the Families policy — if you tick children, AdMob must be configured for
  child-directed treatment and the age-appropriate ad content rating.
- Ads declaration: **yes, this app contains ads**.

## 4. iOS (App Store)

**Xcode project** (`ios/App/App.xcodeproj`):

- Deployment target iOS 14 or higher (App Tracking Transparency needs 14).
- Device orientation: Portrait only, iPhone + iPad.
- Signing: your team, automatic signing, a distribution certificate.
- `Info.plist` additions:
  ```xml
  <key>GADApplicationIdentifier</key>
  <string>ca-app-pub-XXXXXXXXXXXXXXXX~ZZZZZZZZZZ</string>
  <key>NSUserTrackingUsageDescription</key>
  <string>Allow tracking so the ads you watch for gold stay relevant. Declining
  does not affect the game or your rewards.</string>
  <key>SKAdNetworkItems</key>
  <!-- paste Google's current SKAdNetwork identifier list -->
  ```
- `UIRequiresFullScreen` true, and keep `UIViewControllerBasedStatusBarAppearance`
  consistent with the StatusBar plugin config.

**Archive and upload**:

```bash
npm run cap:sync
open ios/App/App.xcworkspace      # Product > Archive > Distribute App
```

**App Store Connect listing**:

- Screenshots for 6.7" (1290x2796) and 6.5" (1242x2688) iPhone, plus 12.9" iPad
  (2048x2732) if you ship iPad.
- Age rating: expect 4+. Answer "Infrequent/Mild Cartoon or Fantasy Violence" —
  abstract shapes still count as combat.
- App Privacy: see §5.
- Export compliance: the app uses only standard HTTPS, so the usual answer is
  "no non-exempt encryption".

## 5. Privacy declarations

Both stores ask the same question in different words: what leaves the device?

This game stores the player profile **on the device only** (Capacitor Preferences
→ UserDefaults / SharedPreferences). It has no backend, no accounts, no analytics.
The only third party is Google AdMob.

**Apple — App Privacy**, declare for the AdMob SDK:
- *Identifiers → Device ID*: collected, **used for Third-Party Advertising**,
  linked to the user, **used for tracking** (this is what triggers the ATT prompt).
- *Usage Data → Advertising Data*: collected, used for Third-Party Advertising.
- Nothing else. Do not declare data the game itself does not collect.

**Google — Data Safety**:
- Data types: *Device or other IDs*, collected, shared with third parties,
  purpose "Advertising or marketing".
- Data is **not** encrypted in transit by you — but AdMob's traffic is; answer
  honestly about your own traffic (there is none).
- No data deletion request mechanism is required since no account exists; state
  that uninstalling removes all local data.

Host `docs/PRIVACY_POLICY.md` at a public URL and paste that URL into both
consoles. Both stores reject submissions with an unreachable policy link.

## 6. Pre-submission checklist

- [ ] Bundle ID changed from the placeholder and reserved in both consoles
- [ ] Real AdMob app IDs and ad unit IDs in place, `USE_TEST_ADS` set to `false`
      in `src/core/ads.ts`
- [ ] Tested a rewarded ad end to end on a physical device of each platform
- [ ] Gold is credited only after the reward callback, never on ad dismissal
      (already handled in `src/ui/screens/shop.ts` — verify it stayed that way)
- [ ] Portrait lock verified on a tablet, not just a phone
- [ ] Safe areas verified on a notched iPhone and a gesture-navigation Android
- [ ] Android hardware back button exits the run, then the screen, then the app
- [ ] Backgrounding mid-run and returning does not fast-forward the simulation
- [ ] Profile survives an app update (change the version, reinstall over the top)
- [ ] `npm run build` is clean and `npm run qa` reports no console errors
- [ ] Privacy policy URL live and reachable without a login
- [ ] Screenshots contain no placeholder text and no debug overlay

## 7. After launch

`BOSS.extraHpFactor`, the `WAVES` table and `META_UPGRADES` costs are the three
levers that decide retention and session length. They are plain numbers in
`src/game/config.ts`; re-run `npm run qa` after any change and compare the ladder
against the shape documented in the README before shipping an update.
