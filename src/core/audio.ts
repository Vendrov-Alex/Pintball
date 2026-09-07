/**
 * One-shot sound effects, built on the shared engine in audioEngine.ts.
 *
 * Every effect layers 2-4 primitive voices — a transient click, a tonal body, a
 * low-end thump, an optional reverb tail — the same way a sound designer stacks
 * layers under a single recorded sample. A single sine blip reads as a UI beep;
 * three layers with slightly different timing reads as an impact.
 */

import { ensureEngine, playNoise, playTone, setEngineEnabled } from './audioEngine';

let lastShot = 0;
let lastCoin = 0;
let uiVariance = 0;

export function unlockAudio(): void {
  ensureEngine();
}

export function setAudioEnabled(value: boolean): void {
  setEngineEnabled(value);
}

export const sfx = {
  shoot(): void {
    // Throttled: a maxed fire rate would otherwise retrigger faster than the
    // ear can separate the layers, which reads as distortion, not rate of fire.
    const now = performance.now();
    if (now - lastShot < 50) return;
    lastShot = now;
    // Transient click + a short downward-pitched body + a sub thump underneath.
    playNoise({ duration: 0.02, gain: 0.1, filterType: 'highpass', filterFreq: 4000 });
    playTone({ freq: 720, sweepTo: 260, duration: 0.055, type: 'square', gain: 0.075 });
    playTone({ freq: 160, sweepTo: 70, duration: 0.05, type: 'sine', gain: 0.05 });
  },

  kill(): void {
    // Bright metallic ping (two close, slightly detuned tones beating against
    // each other) over a short noise crack, with a touch of reverb so the kill
    // feels like it happened in the space rather than in your ear.
    playNoise({ duration: 0.09, gain: 0.14, filterType: 'bandpass', filterFreq: 2600, q: 1.2, reverb: 0.12 });
    playTone({ freq: 980, duration: 0.11, type: 'triangle', gain: 0.09, reverb: 0.15 });
    playTone({ freq: 980, duration: 0.11, type: 'triangle', gain: 0.07, detune: 14, delay: 0.006 });
  },

  hurt(): void {
    // A falling sawtooth body plus a sub-bass dip underneath for weight — the
    // low end is what makes an impact felt rather than just heard.
    playTone({ freq: 210, sweepTo: 60, duration: 0.19, type: 'sawtooth', gain: 0.13 });
    playTone({ freq: 90, sweepTo: 35, duration: 0.16, type: 'sine', gain: 0.11 });
    playNoise({ duration: 0.07, gain: 0.06, filterType: 'lowpass', filterFreq: 1200, filterFreqEnd: 300 });
  },

  levelUp(): void {
    // A three-note arpeggio, each note itself two detuned oscillators for a
    // chorused, "produced" shimmer, plus a bright top partial on the last note.
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const delay = i * 0.09;
      playTone({ freq, duration: 0.22, type: 'triangle', gain: 0.1, delay, pan: -0.15 + i * 0.15, reverb: 0.18 });
      playTone({ freq, duration: 0.22, type: 'triangle', gain: 0.07, detune: 10, delay: delay + 0.01, pan: -0.15 + i * 0.15 });
    });
    playTone({ freq: 1567.98, duration: 0.3, type: 'sine', gain: 0.05, delay: 0.24, reverb: 0.25 });
  },

  boss(): void {
    // Sub rumble, a distorted mid growl (through the shared saturation stage via
    // a hot gain into the normal chain), and a big reverberant impact hit.
    playTone({ freq: 55, sweepTo: 38, duration: 1.1, type: 'sine', gain: 0.22 });
    playTone({ freq: 130, sweepTo: 85, duration: 0.9, type: 'sawtooth', gain: 0.16, detune: -8 });
    playTone({ freq: 130, sweepTo: 85, duration: 0.9, type: 'sawtooth', gain: 0.16, detune: 9 });
    playNoise({ duration: 0.8, gain: 0.16, filterType: 'lowpass', filterFreq: 900, filterFreqEnd: 200, reverb: 0.4 });
  },

  win(): void {
    // Ascending major triad plus octave, each note double-tracked, generous
    // reverb tail — the closest this engine gets to a brass fanfare.
    const notes = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5
    notes.forEach((freq, i) => {
      const delay = i * 0.1;
      playTone({ freq, duration: 0.3, type: 'sawtooth', gain: 0.08, delay, reverb: 0.3 });
      playTone({ freq, duration: 0.3, type: 'square', gain: 0.05, delay: delay + 0.015, detune: -6 });
    });
  },

  lose(): void {
    // Descending minor line with a lowpass sweep closing over it, like a light
    // going out.
    const notes = [392, 349.23, 293.66, 220]; // G4, F4, D4, A3
    notes.forEach((freq, i) => {
      playTone({ freq, sweepTo: freq * 0.75, duration: 0.32, type: 'sawtooth', gain: 0.1, delay: i * 0.13, reverb: 0.2 });
    });
    playNoise({ duration: 0.6, gain: 0.05, filterType: 'lowpass', filterFreq: 800, filterFreqEnd: 150, delay: 0.1 });
  },

  ui(): void {
    // Tiny pitch jitter so a burst of taps doesn't sound like a machine-gun of
    // identical samples.
    uiVariance = (uiVariance + 1) % 5;
    const wobble = 1 + (uiVariance - 2) * 0.015;
    playTone({ freq: 1046.5 * wobble, duration: 0.045, type: 'sine', gain: 0.075 });
    playTone({ freq: 1568 * wobble, duration: 0.035, type: 'sine', gain: 0.03, delay: 0.008 });
  },

  purchase(): void {
    // A coin: two quick ascending tones plus a high sparkle.
    playTone({ freq: 784, duration: 0.09, type: 'square', gain: 0.09 });
    playTone({ freq: 1174.66, duration: 0.14, type: 'square', gain: 0.09, delay: 0.07 });
    playTone({ freq: 2349.32, duration: 0.18, type: 'sine', gain: 0.04, delay: 0.09, reverb: 0.2 });
  },

  coin(): void {
    // The post-boss vacuum can land a dozen orbs a second — purchase() at that
    // rate would be a wall of noise. A short, heavily throttled ping with a
    // little pitch variance reads as "counting" instead of "stuck repeating."
    const now = performance.now();
    if (now - lastCoin < 45) return;
    lastCoin = now;
    playTone({ freq: 1500 + Math.random() * 500, duration: 0.05, type: 'sine', gain: 0.05 });
  },
};
