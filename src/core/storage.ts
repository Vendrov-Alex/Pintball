import { Preferences } from '@capacitor/preferences';
import { isNative } from './platform';

/**
 * Persistence with a synchronous in-memory mirror.
 *
 * The game loop must never await storage, so the profile is kept in memory and
 * flushed asynchronously. On native we use Capacitor Preferences (SharedPreferences /
 * UserDefaults, which survive app updates); on the web, localStorage.
 */

export async function load(key: string): Promise<string | null> {
  try {
    if (isNative()) {
      const { value } = await Preferences.get({ key });
      return value ?? null;
    }
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function save(key: string, value: string): Promise<void> {
  try {
    if (isNative()) {
      await Preferences.set({ key, value });
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    /* Storage can be unavailable (private mode, full disk). Never break the game. */
  }
}
