/**
 * Optional cloud save.
 *
 * Signing in (core/auth.ts) only proves who you are — this module is what
 * actually moves the profile to and from Firestore. Reconciliation is
 * last-write-wins on the whole document, compared by Profile.updatedAt, not a
 * field-by-field merge: gold is spendable, not just earnable, so "take the
 * higher number" per field would silently undo a purchase made on the other
 * device the moment an older cloud copy synced back in. Whichever device
 * played most recently simply wins outright. See Profile.updatedAt's own
 * comment in meta/profile.ts for the full reasoning.
 *
 * Firestore's SDK, like the auth plugin, is dynamically imported — most
 * players never sign in, and the SDK has no reason to be in anyone else's
 * initial bundle.
 */

import { isFirebaseConfigured } from '../core/firebaseConfig';
import { onAccountChange, type AccountUser } from '../core/auth';
import { flushProfile, getProfile, onProfileChange, replaceProfile, type Profile } from './profile';

type FirestoreModule = typeof import('firebase/firestore');
type Firestore = import('firebase/firestore').Firestore;

let firestoreMod: FirestoreModule | null = null;
let db: Firestore | null = null;
let unsubscribeProfile: (() => void) | null = null;
let pushTimer: number | null = null;
/** uid of the account currently syncing, or null while signed out. Lets
 *  flushCloudSync() force a pending push without needing the caller to
 *  track which account is active. */
let syncingUid: string | null = null;
/** Set while reconciliation is writing the cloud copy back into the local
 *  profile, so that write doesn't immediately bounce back up to the cloud. */
let applyingRemote = false;

async function ensureFirestore(): Promise<Firestore | null> {
  if (!isFirebaseConfigured()) return null;
  if (!db) {
    const [{ getApp }, fsMod] = await Promise.all([import('firebase/app'), import('firebase/firestore')]);
    firestoreMod = fsMod;
    db = fsMod.getFirestore(getApp());
  }
  return db;
}

function docPath(uid: string): [string, string] {
  return ['users', uid];
}

/**
 * Runs once per sign-in: fetches the cloud copy, keeps whichever of the two is
 * newer, and pushes that result to whichever side didn't have it.
 */
async function reconcile(uid: string): Promise<void> {
  const database = await ensureFirestore();
  if (!database || !firestoreMod) return;

  const ref = firestoreMod.doc(database, ...docPath(uid));
  const snap = await firestoreMod.getDoc(ref);
  const local = getProfile();
  const cloud = snap.exists() ? (snap.data() as Profile) : null;

  if (cloud && cloud.updatedAt > local.updatedAt) {
    applyingRemote = true;
    replaceProfile(cloud);
    applyingRemote = false;
  } else {
    // Local is newer (or this device is the first to ever sign in to this
    // account) — push it up. setDoc rather than update: a fresh account has no
    // document yet, and this profile is the whole state either way.
    await firestoreMod.setDoc(ref, JSON.parse(JSON.stringify(local)));
  }
}

/** Debounced push: local writes are frequent, cloud writes cost quota. */
function schedulePush(uid: string): void {
  if (applyingRemote) return;
  if (pushTimer !== null) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    void pushNow(uid);
  }, 4000);
}

async function pushNow(uid: string): Promise<void> {
  const database = await ensureFirestore();
  if (!database || !firestoreMod) return;
  const ref = firestoreMod.doc(database, ...docPath(uid));
  try {
    await firestoreMod.setDoc(ref, JSON.parse(JSON.stringify(getProfile())));
  } catch (err) {
    console.error('Cloud save failed', err);
  }
}

function startSyncing(uid: string): void {
  stopSyncing();
  syncingUid = uid;
  void reconcile(uid).catch((err) => console.error('Cloud save reconciliation failed', err));
  unsubscribeProfile = onProfileChange(() => schedulePush(uid));
}

function stopSyncing(): void {
  syncingUid = null;
  unsubscribeProfile?.();
  unsubscribeProfile = null;
  if (pushTimer !== null) {
    window.clearTimeout(pushTimer);
    pushTimer = null;
  }
}

/** Call once at boot. A no-op for as long as Firebase isn't configured. */
export function initCloudSync(): void {
  if (!isFirebaseConfigured()) return;
  onAccountChange((user: AccountUser | null) => {
    if (user) startSyncing(user.uid);
    else stopSyncing();
  });
}

/**
 * Forces an immediate push instead of waiting out the debounce — used the same
 * way flushProfile() is used locally, at points where the app might be about
 * to be backgrounded or closed (see main.ts's appStateChange handler).
 */
export async function flushCloudSync(): Promise<void> {
  await flushProfile();
  if (pushTimer !== null) {
    window.clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (syncingUid) await pushNow(syncingUid);
}
