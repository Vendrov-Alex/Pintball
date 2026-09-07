/**
 * Firebase project credentials.
 *
 * Every value below is a placeholder. None of it is a secret — a Firebase web
 * config is a public identifier, safe to ship in a client bundle (the API key
 * only names which project to talk to; Firestore/Auth access is controlled by
 * the security rules and provider configuration in the Firebase console, not by
 * hiding this object) — but it has to be real before sign-in or cloud save can
 * work at all. Until it is, `isFirebaseConfigured()` returns false and the
 * account feature stays fully, silently disabled: no broken button, no failed
 * network calls, the game plays exactly as it does today.
 *
 * See docs/AUTH_SETUP.md for the exact steps to get real values here.
 */
export const FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

export function isFirebaseConfigured(): boolean {
  return FIREBASE_CONFIG.apiKey.length > 0 && FIREBASE_CONFIG.projectId.length > 0;
}
