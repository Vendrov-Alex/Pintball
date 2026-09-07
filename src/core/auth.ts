/**
 * Optional account sign-in: Google, Apple, Facebook.
 *
 * Guest play is the default and stays fully functional forever — nothing here
 * is required to play. Signing in only exists to carry gold and upgrades across
 * devices (see meta/cloudSync.ts for how that sync actually works).
 *
 * `@capacitor-firebase/authentication` ships both a native implementation
 * (real Google/Apple/Facebook SDKs on iOS/Android) and a web one (Firebase JS
 * SDK popups) behind the exact same call — the same pattern core/ads.ts already
 * uses for AdMob, and for the same reason: one code path that works correctly
 * whether this is the installed app, an installed PWA, or the plain browser tab
 * a shared Artifact link opens in.
 *
 * Both the plugin and the Firebase SDK itself are dynamically imported, not
 * imported at the top of this module: most players will never open the account
 * screen, and there is no reason to make everyone's first paint wait on an SDK
 * they may never touch. See docs/AUTH_SETUP.md for what has to happen in the
 * Firebase/Google/Apple/Facebook consoles before any of this can sign anyone in.
 */

import { FIREBASE_CONFIG, isFirebaseConfigured } from './firebaseConfig';

export interface AccountUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoUrl: string | null;
}

type FirebaseAuthModule = typeof import('@capacitor-firebase/authentication');

let plugin: FirebaseAuthModule['FirebaseAuthentication'] | null = null;
let initPromise: Promise<boolean> | null = null;
let currentUser: AccountUser | null = null;
const listeners = new Set<(user: AccountUser | null) => void>();

function toAccountUser(u: { uid: string; displayName: string | null; email: string | null; photoUrl: string | null } | null): AccountUser | null {
  if (!u) return null;
  return { uid: u.uid, displayName: u.displayName, email: u.email, photoUrl: u.photoUrl };
}

function setUser(u: AccountUser | null): void {
  currentUser = u;
  for (const fn of listeners) fn(currentUser);
}

/**
 * Boots the Firebase app (needed by the plugin's web fallback; the native
 * implementations read their own config files instead) and the auth plugin,
 * exactly once. Returns false — never throws — when Firebase isn't configured
 * yet, so every public function below can stay a harmless no-op until it is.
 */
async function ensureAuth(): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  if (!initPromise) {
    initPromise = (async () => {
      const [{ initializeApp, getApps }, authMod] = await Promise.all([
        import('firebase/app'),
        import('@capacitor-firebase/authentication'),
      ]);
      if (getApps().length === 0) initializeApp(FIREBASE_CONFIG);
      plugin = authMod.FirebaseAuthentication;

      const { user } = await plugin.getCurrentUser();
      setUser(toAccountUser(user));

      await plugin.addListener('authStateChange', (change) => {
        setUser(toAccountUser(change.user));
      });
      return true;
    })().catch((err) => {
      console.error('Firebase Authentication failed to initialise', err);
      initPromise = null;
      plugin = null;
      return false;
    });
  }
  return initPromise;
}

/** Warms up the SDK during app boot, mirroring core/ads.ts's preloadAds(). */
export function preloadAuth(): void {
  if (isFirebaseConfigured()) void ensureAuth();
}

export function isAccountFeatureAvailable(): boolean {
  return isFirebaseConfigured();
}

export function getAccountUser(): AccountUser | null {
  return currentUser;
}

export function onAccountChange(fn: (user: AccountUser | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type SignInOutcome = 'signed-in' | 'cancelled' | 'unavailable' | 'error';

async function signIn(run: (p: NonNullable<typeof plugin>) => Promise<{ user: unknown }>): Promise<SignInOutcome> {
  const ready = await ensureAuth();
  if (!ready || !plugin) return 'unavailable';
  try {
    const { user } = await run(plugin);
    if (!user) return 'cancelled';
    return 'signed-in';
  } catch (err) {
    // The plugin throws on a user-cancelled popup/sheet too; treat anything
    // that reads like "the user backed out" as a cancel, not a hard error, so
    // the account modal doesn't show a scary message for a normal dismissal.
    const message = err instanceof Error ? err.message.toLowerCase() : '';
    if (message.includes('cancel') || message.includes('popup-closed') || message.includes('dismiss')) return 'cancelled';
    console.error('Sign-in failed', err);
    return 'error';
  }
}

export function signInWithGoogle(): Promise<SignInOutcome> {
  return signIn((p) => p.signInWithGoogle());
}

export function signInWithApple(): Promise<SignInOutcome> {
  // Apple requires these scopes to be requested explicitly — unlike Google,
  // name and email are not returned by default.
  return signIn((p) => p.signInWithApple({ scopes: ['email', 'name'] }));
}

export function signInWithFacebook(): Promise<SignInOutcome> {
  return signIn((p) => p.signInWithFacebook());
}

export async function signOutUser(): Promise<void> {
  if (!plugin) return;
  try {
    await plugin.signOut();
  } catch (err) {
    console.error('Sign-out failed', err);
  }
  setUser(null);
}
