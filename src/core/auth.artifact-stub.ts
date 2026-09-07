/**
 * Stand-in for core/auth.ts used ONLY by the single-file share-link build
 * (vite.artifact.config.ts aliases this in). A runtime `if (isFirebaseConfigured())`
 * guard can't stop Rollup from inlining a reachable `import()` under
 * `inlineDynamicImports: true` — the containing function is still called, so the
 * import is still statically reachable, guard or no guard. This file swaps out
 * at module-resolution time instead, before Rollup ever reads the real
 * Firebase-importing source, which is the one point in the pipeline where
 * "don't include this" is actually guaranteed rather than hoped for. Confirmed
 * empirically: without this alias the artifact build was 749KB; with it, back
 * to the pre-auth-feature ~84KB.
 *
 * Every export here matches core/auth.ts's real signatures. Keep them in sync.
 */

export interface AccountUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoUrl: string | null;
}

export type SignInOutcome = 'signed-in' | 'cancelled' | 'unavailable' | 'error';

export function preloadAuth(): void {}

export function isAccountFeatureAvailable(): boolean {
  return false;
}

export function getAccountUser(): AccountUser | null {
  return null;
}

export function onAccountChange(_fn: (user: AccountUser | null) => void): () => void {
  return () => {};
}

async function unavailable(): Promise<SignInOutcome> {
  return 'unavailable';
}

export const signInWithGoogle = unavailable;
export const signInWithApple = unavailable;
export const signInWithFacebook = unavailable;

export async function signOutUser(): Promise<void> {}
