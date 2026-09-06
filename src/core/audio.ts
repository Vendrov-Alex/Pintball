/**
 * Procedural sound effects.
 *
 * No audio files ship with the game: every sound is synthesised with WebAudio,
 * which keeps the bundle tiny and avoids per-store asset licensing questions.
 * iOS/Android WebViews start the AudioContext suspended, so it is resumed on the
 * first user gesture.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
/** Shots are throttled so a maxed fire rate does not turn into a buzzsaw. */
let lastShot = 0;

function ensure(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

export function unlockAudio(): void {
  ensure();
}

export function setAudioEnabled(value: boolean): void {
  enabled = value;
  if (master) master.gain.value = value ? 0.28 : 0;
}

function blip(
  freq: number,
  duration: number,
  type: OscillatorType,
  gain: number,
  sweepTo?: number,
): void {
  const ac = ensure();
  if (!ac || !master) return;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  const t = ac.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + duration);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(env);
  env.connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function noise(duration: number, gain: number, freq: number): void {
  const ac = ensure();
  if (!ac || !master) return;
  const frames = Math.floor(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  const env = ac.createGain();
  env.gain.value = gain;
  src.connect(filter);
  filter.connect(env);
  env.connect(master);
  src.start();
}

export const sfx = {
  shoot(): void {
    const now = performance.now();
    if (now - lastShot < 55) return;
    lastShot = now;
    blip(680, 0.06, 'square', 0.06, 320);
  },
  kill(): void {
    noise(0.12, 0.16, 1600);
  },
  hurt(): void {
    blip(180, 0.18, 'sawtooth', 0.16, 70);
  },
  levelUp(): void {
    blip(520, 0.1, 'triangle', 0.14);
    window.setTimeout(() => blip(780, 0.14, 'triangle', 0.14), 90);
    window.setTimeout(() => blip(1040, 0.2, 'triangle', 0.12), 190);
  },
  boss(): void {
    blip(90, 0.9, 'sawtooth', 0.2, 45);
    noise(0.7, 0.12, 400);
  },
  win(): void {
    [440, 660, 880, 1320].forEach((f, i) => window.setTimeout(() => blip(f, 0.24, 'triangle', 0.13), i * 110));
  },
  lose(): void {
    [330, 260, 200, 140].forEach((f, i) => window.setTimeout(() => blip(f, 0.3, 'sawtooth', 0.13), i * 130));
  },
  ui(): void {
    blip(880, 0.05, 'sine', 0.09);
  },
  purchase(): void {
    blip(660, 0.08, 'sine', 0.11);
    window.setTimeout(() => blip(990, 0.14, 'sine', 0.1), 70);
  },
};
