/**
 * Generative background music.
 *
 * There is no audio file to loop: a look-ahead scheduler (the standard WebAudio
 * pattern for sample-accurate timing — setTimeout/setInterval alone drift by
 * tens of milliseconds and would make the beat audibly wobble) fires short synth
 * voices on a 16th-note grid, reading from a four-chord progression that repeats
 * indefinitely. Because it is generated live rather than played back, there is no
 * loop seam to hide and no fixed length to author.
 *
 * Three phases share the same progression and instrumentation but differ in
 * tempo and density: `menu` is a sparse, slow pad; `battle` adds a bass pulse and
 * a plucked arpeggio; `boss` speeds up, adds hats and a second detuned arp voice
 * for urgency. Switching phases changes what the next scheduled steps play —
 * there is nothing to cross-fade or splice.
 */

import { ensureEngine, musicBus, playTone, playNoise } from './audioEngine';

type Phase = 'menu' | 'battle' | 'boss';

interface Chord {
  /** Low pad voicing, held for the whole bar. */
  pad: [number, number, number];
  /** Sub-bass root, one octave below the pad root. */
  bass: number;
  /** Arpeggio voicing, one octave above the pad. */
  arp: [number, number, number];
}

// A minor -> F major -> C major -> G major: a common, unresolved-feeling loop
// (i - VI - III - VII) that never quite lands on home, which suits a run that
// does not end until the clock or the boss does.
const PROGRESSION: readonly Chord[] = [
  { pad: [110.0, 130.81, 164.81], bass: 55.0, arp: [220.0, 261.63, 329.63] }, // Am
  { pad: [87.31, 110.0, 130.81], bass: 43.65, arp: [174.61, 220.0, 261.63] }, // F
  { pad: [130.81, 164.81, 196.0], bass: 65.41, arp: [261.63, 329.63, 392.0] }, // C
  { pad: [98.0, 123.47, 146.83], bass: 49.0, arp: [196.0, 246.94, 293.66] }, // G
];

const STEPS_PER_BAR = 16;
const SECONDS_PER_STEP: Record<Phase, number> = {
  menu: 0.24,
  battle: 0.165,
  boss: 0.115,
};
const PHASE_VOLUME: Record<Phase, number> = {
  menu: 0.4,
  battle: 0.55,
  boss: 0.7,
};

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;

let phase: Phase = 'menu';
let timer: number | null = null;
let nextStepTime = 0;
let step = 0;

function playPad(chord: Chord, time: number, holdSeconds: number): void {
  const bus = musicBus();
  if (!bus) return;
  const gain = phase === 'menu' ? 0.05 : 0.04;
  for (const freq of chord.pad) {
    playTone({ freq, duration: holdSeconds * 0.98, type: 'triangle', gain, attack: 0.6, time, destination: bus, reverb: 0.3 });
    playTone({ freq, duration: holdSeconds * 0.98, type: 'sine', gain: gain * 0.7, detune: 6, attack: 0.6, time, destination: bus });
  }
}

function playBass(freq: number, time: number, soft: boolean): void {
  const bus = musicBus();
  if (!bus) return;
  playTone({
    freq,
    duration: soft ? 0.5 : 0.32,
    type: 'sine',
    gain: soft ? 0.09 : 0.14,
    attack: 0.02,
    time,
    destination: bus,
  });
}

function playArp(freq: number, time: number, bright: boolean): void {
  const bus = musicBus();
  if (!bus) return;
  playTone({ freq, duration: 0.15, type: 'triangle', gain: bright ? 0.06 : 0.045, time, destination: bus, reverb: 0.15 });
  if (bright) playTone({ freq, duration: 0.15, type: 'triangle', gain: 0.03, detune: 12, time: time + 0.008, destination: bus });
}

function playHat(time: number, accent: boolean): void {
  const bus = musicBus();
  if (!bus) return;
  playNoise({
    duration: 0.045,
    gain: accent ? 0.045 : 0.03,
    filterType: 'highpass',
    filterFreq: 6000,
    time,
    destination: bus,
  });
}

/** Decides what, if anything, plays on this 16th-note step. */
function scheduleStep(atStep: number, time: number): void {
  const barStep = atStep % STEPS_PER_BAR;
  const chord = PROGRESSION[Math.floor(atStep / STEPS_PER_BAR) % PROGRESSION.length];

  if (barStep === 0) playPad(chord, time, STEPS_PER_BAR * SECONDS_PER_STEP[phase]);

  if (phase === 'menu') {
    if (barStep === 0) playBass(chord.bass, time, true);
    return;
  }

  if (barStep === 0 || barStep === 8) playBass(chord.bass, time, false);

  if (phase === 'battle' && barStep % 2 === 0) {
    playArp(chord.arp[(barStep / 2) % 3], time, false);
  }
  if (phase === 'boss') {
    playArp(chord.arp[barStep % 3], time, true);
    if (barStep % 2 === 1) playHat(time, barStep % 4 === 3);
  } else if (phase === 'battle' && barStep % 4 === 2) {
    playHat(time, false);
  }
}

function tick(): void {
  const ac = ensureEngine();
  if (!ac) return;
  // Muting (ensureEngine returns null while disabled) or a backgrounded tab
  // freezes nextStepTime while real time keeps passing. Catching up step by step
  // would fire a burst of queued notes all at once; resyncing to "now" instead
  // just picks the beat back up cleanly.
  if (nextStepTime < ac.currentTime - SCHEDULE_AHEAD) nextStepTime = ac.currentTime + 0.05;
  while (nextStepTime < ac.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(step, nextStepTime);
    nextStepTime += SECONDS_PER_STEP[phase];
    step += 1;
  }
}

function start(): void {
  if (timer !== null) return;
  const ac = ensureEngine();
  if (!ac) return;
  nextStepTime = ac.currentTime + 0.05;
  step = 0;
  timer = window.setInterval(tick, LOOKAHEAD_MS);
}

function setPhase(next: Phase): void {
  phase = next;
  start();
  const bus = musicBus();
  const ac = ensureEngine();
  if (bus && ac) {
    // A slow ramp so the volume shift between phases is felt, not a jump cut.
    bus.gain.cancelScheduledValues(ac.currentTime);
    bus.gain.setValueAtTime(bus.gain.value, ac.currentTime);
    bus.gain.linearRampToValueAtTime(PHASE_VOLUME[next], ac.currentTime + 1.4);
  }
}

export const music = {
  enterMenu(): void {
    setPhase('menu');
  },
  enterBattle(): void {
    setPhase('battle');
  },
  enterBoss(): void {
    setPhase('boss');
  },
};
