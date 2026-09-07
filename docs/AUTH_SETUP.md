# Account sign-in and cloud save — setup

Sign-in with Google, Apple or Facebook is fully built and wired into the app —
`src/core/auth.ts`, `src/meta/cloudSync.ts`, `src/ui/accountModal.ts`. It is
switched off right now because `src/core/firebaseConfig.ts` has no real project
behind it yet: `isFirebaseConfigured()` returns false, the account button never
renders, and nothing tries to reach a server. That single file is the only
thing standing between what's already written and a working sign-in.

None of the steps below can be done from inside a coding session — they all
happen in consoles that need *your* accounts (Google, Apple, Meta) and, for two
of the three providers, real money-or-membership gates (an Apple Developer
Program membership, a Facebook Developer app). This document is the checklist
for doing them once, and the exact shape of what to send back so the client
side can be switched on.

## What "signed in" actually does

Playing as a guest is the default and stays fully supported forever — nothing
below is required to play. Signing in only adds one thing: your gold and
upgrades follow you if you install the game on a second device or reinstall it.
Reconciliation is **last-write-wins on the whole profile**, not a field-by-field
merge — see the comment on `Profile.updatedAt` in `src/meta/profile.ts` for why
merging would be a real bug (it would silently "un-spend" gold spent on the
other device). In practice: whichever device you played on most recently is the
one whose progress survives a sync.

## 1. Create the Firebase project

1. Go to the Firebase console and create a new project. (You'll need a Google
   account — the same one is fine for this and for the "Sign in with Google"
   provider below, they're unrelated uses of the same login.)
2. Google Analytics is optional; skip it unless you want it for something else.
3. Note the **Project ID** — you'll see it again in the config object at the end.

## 2. Register the apps

Firebase needs one "app" registration per platform. Do all three, even if you
only ship one platform first — it costs nothing and the config for each is
independent.

- **Web app**: Project settings → Add app → Web (`</>`). Give it any nickname.
  You do *not* need Firebase Hosting. This is what produces the config object
  in step 5 — it's also what the plain browser build (`npm run build`, and any
  real PWA deploy of it) uses for sign-in, since that runs the Firebase Web SDK
  directly rather than a native plugin. (The single-file share-link build,
  `npm run build:web`, deliberately excludes the whole feature to stay
  lightweight — see the comment at the top of
  `src/core/auth.artifact-stub.ts` — so it never needs this.)
- **Android app**: Add app → Android. Package name **must** exactly match
  `capacitor.config.ts`'s `appId` (currently `com.survivor.roblaksim`). Download
  `google-services.json` and put it at `android/app/google-services.json` once
  you've run `npx cap add android`.
- **iOS app**: Add app → iOS. Bundle ID **must** exactly match the same `appId`.
  Download `GoogleService-Info.plist` and put it at
  `ios/App/App/GoogleService-Info.plist` once you've run `npx cap add ios`, then
  add the file to the Xcode project (drag it into the `App` target in Xcode —
  just having it in the folder isn't enough, Xcode needs to reference it).

## 3. Turn on the sign-in providers

Firebase console → **Authentication → Sign-in method**. Enable all three:

### Google
Click enable, pick a support email, save. That's the whole thing — Google is
by far the least setup of the three.

### Apple
Requires an active **Apple Developer Program membership** ($99/year).
1. developer.apple.com → Certificates, IDs & Profiles → Identifiers → **+** →
   Services IDs. Create one (e.g. `com.survivor.roblaksim.signin`). This is
   different from your app's own Bundle ID.
2. Configure that Services ID for "Sign in with Apple," and add a **Return
   URL**: `https://<your-project-id>.firebaseapp.com/__/auth/handler` — the
   exact domain is on the Apple provider screen in the Firebase console, copy
   it from there rather than retyping it.
3. Keys → **+** → enable "Sign in with Apple," generate and download the `.p8`
   key file. **You only get to download this once** — if you lose it you have
   to generate a new one and redo this step.
4. Back in the Firebase console's Apple provider screen, fill in: Services ID,
   Apple Team ID (top-right of the Apple Developer site), Key ID (shown when
   you created the key), and the contents of the `.p8` file.
5. **This is also required for the native iOS app to work**, separately from
   the web flow above: in Xcode, select the App target → Signing & Capabilities
   → **+ Capability** → "Sign in with Apple."
6. If the iOS app ever offers Google or Facebook sign-in (it already will,
   since all three buttons show on every platform in this build), Apple's App
   Store Guideline 4.8 requires Sign in with Apple to be offered too, on equal
   footing — already satisfied here, nothing extra needed once this section is
   done.

### Facebook
1. developers.facebook.com → My Apps → Create App → type "Consumer" (or
   "None"/"Other" depending on the current Meta console wording — pick
   whichever isn't Business-specific).
2. Add the **Facebook Login** product.
3. Settings → Basic: note the **App ID** and **App Secret**.
4. Facebook Login → Settings → **Valid OAuth Redirect URIs**: add
   `https://<your-project-id>.firebaseapp.com/__/auth/handler` (same domain
   pattern as Apple's, again copy the exact value Firebase shows you).
5. Firebase console's Facebook provider screen: paste the App ID and App
   Secret, save.
6. While the app is in "Development" mode in the Facebook console, sign-in only
   works for accounts you've added as testers (App roles → Roles → Testers).
   Going to "Live" mode for the public needs Meta's App Review for the
   `public_profile`/`email` permissions — budget a few days for that before a
   real launch; it doesn't block your own testing.

## 4. Firestore

Firebase console → **Firestore Database** → Create database → **production
mode** (not test mode — test mode's rules expire after 30 days and then lock
everyone out, including you).

Then go to the **Rules** tab and replace the default with exactly this:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

This is the whole security model: a signed-in user can only ever read or write
their own document (`users/{their own uid}`), never anyone else's. Without this
exact rule — if you leave Firestore in test mode, or write anything looser —
any signed-in user could read or overwrite any other user's saved progress.

## 5. Send back the web config

Firebase console → Project settings → scroll to "Your apps" → the Web app from
step 2 → the config it shows looks like:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};
```

Paste that whole object back. **None of it is secret** — a Firebase web config
is a public identifier your own app ships in its client bundle regardless; the
`.p8` Apple key and the Facebook App Secret from step 3 are the only genuinely
sensitive values in this whole setup, and those live only in the Firebase
console, never in this repository.

Once I have it, filling in `src/core/firebaseConfig.ts` and turning the feature
on is a one-line change.

## Cost

Firebase Authentication is free, unlimited, for every provider used here.
Firestore's free tier is 50,000 reads and 20,000 writes a day — a save that
happens once on sign-in and again every few seconds while gold changes, for
however many people are actually playing this game, is nowhere near that
ceiling at hobby scale. If it's ever exceeded, the fix is enabling the pay-as-
you-go Blaze plan, which is still effectively free at this usage level (Google
bills only the overage past the same free quota) — not a redesign.
