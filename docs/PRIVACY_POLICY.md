# Privacy Policy — Pintball Survivor

**Last updated:** replace with the date you publish this.
**Contact:** replace with the support email you enter in the store listings.

This policy covers the mobile game *Pintball Survivor* on the App Store and
Google Play.

> Publish this file at a public URL and paste that URL into both store consoles.
> Replace every "replace with" placeholder first — both stores reject policies
> with an unreachable link or an obvious template left unfinished.
> The step-by-step is in **Hosting checklist** at the bottom of this file.

## What the game stores

Your progress — gold, permanent upgrades, personal records, and your sound and
vibration settings — is stored **only on your device**, using the operating
system's standard app storage (UserDefaults on iOS, SharedPreferences on
Android).

We do not operate a server. There is no account, no login, and no way for us to
see your progress. Uninstalling the app permanently deletes all of it.

## Advertising

The game shows rewarded video ads, which you choose to watch in exchange for
in-game gold. Ads are delivered by **Google AdMob**. To serve them, AdMob may
collect and process:

- your device's advertising identifier
- general device and app information (model, operating system version, app version)
- coarse location derived from your IP address
- interactions with the ads themselves

This data is collected by Google, not by us, and is governed by Google's privacy
policy: https://policies.google.com/privacy and
https://support.google.com/admob/answer/6128543.

**On iOS**, you are asked once whether the app may track you across other
companies' apps and websites. Declining changes nothing about the game: ads
become non-personalised, and every reward still pays out in full.

**In the EEA, UK and Switzerland**, a consent form appears before the first ad,
provided by Google's User Messaging Platform. Your choice there controls whether
ads are personalised.

## What we do not do

- We do not collect your name, email address, phone number or contacts.
- We do not track your precise location.
- We do not sell your data.
- We do not use analytics or crash-reporting services.
- We do not knowingly collect information from children under 13. The game is not
  directed at children. If you believe a child has provided personal information,
  contact us at the address above and we will act on it.

## Your choices

- **Reset your advertising ID** — iOS: Settings → Privacy & Security → Tracking.
  Android: Settings → Google → Ads.
- **Turn off personalised ads** — decline the tracking prompt on iOS, or withdraw
  consent in the form shown on first launch in the EEA.
- **Delete everything** — uninstall the app. All local data goes with it.

## Changes

If this policy changes materially, the updated version will be published at this
URL with a new "last updated" date, and the change will be noted in the app's
store release notes.


---

## Hosting checklist

Work through this once. It takes about fifteen minutes and it is the single most
common reason a first submission is rejected.

**Fill in the document**

- [ ] Replace `Last updated` with the date you publish
- [ ] Replace `Contact` with a real, monitored email address — it must be the same
      one you enter as the developer contact in both consoles
- [ ] Decide the child-directed question. If you will tick "designed for children"
      in Play's target-audience section, the policy needs a COPPA paragraph and
      AdMob must be configured for child-directed treatment. If not, leave the
      paragraph as written.
- [ ] Delete this checklist section before publishing the page

**Put it on the internet**

Any of these is acceptable to both stores; pick whichever you already have.

- [ ] GitHub Pages — push the file as `index.md` to a `gh-pages` branch or a
      `/docs` folder, enable Pages in the repository settings. Free, and the URL
      is stable.
- [ ] A page on your own site, e.g. `https://roblaksim.com/pintball/privacy`
- [ ] A published Notion page, a Google Site, or a GitHub Gist rendered through
      a static host

**Verify it before you paste it anywhere**

- [ ] Opens in a private/incognito window with no login and no cookie wall
- [ ] Loads over `https://`, not `http://`
- [ ] Reachable from a phone on mobile data, not just your home network
- [ ] The URL is permanent — not a preview, draft or share link that expires
- [ ] The page shows the policy itself, not a download or a redirect chain

**Paste it into both consoles**

- [ ] Google Play Console → your app → **Policy → App content → Privacy policy**
- [ ] Google Play Console → **App content → Data safety** — declare *Device or
      other IDs*, collected, shared, purpose "Advertising or marketing"
- [ ] Google Play Console → **App content → Ads** — yes, the app contains ads
- [ ] App Store Connect → your app → **App Privacy → Privacy Policy URL**
- [ ] App Store Connect → **App Privacy → Data Types** — Device ID and Advertising
      Data, both used for Third-Party Advertising, Device ID also marked as used
      for tracking
- [ ] Also add the URL to the app's store listing description or support page —
      Apple checks that a policy is reachable from inside the listing

**Keep it true**

- [ ] If you ever add analytics, crash reporting, accounts, cloud saves or a
      second ad network, update this document and both consoles' declarations in
      the same release. A declaration that does not match the SDKs in the binary
      is what gets an app pulled, not the data itself.
