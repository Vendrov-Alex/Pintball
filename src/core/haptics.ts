import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNative } from './platform';

let enabled = true;

export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

function webVibrate(pattern: number | number[]): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}

export function tap(): void {
  if (!enabled) return;
  if (isNative()) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  else webVibrate(8);
}

export function hit(): void {
  if (!enabled) return;
  if (isNative()) void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
  else webVibrate(18);
}

export function levelUp(): void {
  if (!enabled) return;
  if (isNative()) void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  else webVibrate([12, 40, 12]);
}

export function death(): void {
  if (!enabled) return;
  if (isNative()) void Haptics.notification({ type: NotificationType.Error }).catch(() => {});
  else webVibrate([30, 60, 30]);
}
