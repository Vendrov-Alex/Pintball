/**
 * Shared WebAudio plumbing: the audio context, the mix bus, and the primitive
 * voices that both src/core/audio.ts (one-shot SFX) and src/core/music.ts
 * (the generative score) are built from.
 *
 * Everything here is synthesised — no audio files ship with the game — but the
 * signal chain is the same shape a real game's mix bus would use: separate
 * music/SFX sends into a shared reverb, a soft-saturation stage for warmth, and
 * a bus compressor for glue, so the result reads as produced rather than as a
 * handful of raw oscillators. This is what "upgrade the synthesis" means in
 * practice — there is no recorded audio in this build; see docs/AUDIO.md for
 * why, and for the path to real recordings if that changes later.
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let reverbSend: GainNode | null = null;
let enabled = true;

const noiseCache = new Map<number, AudioBuffer>();

function buildDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  // Standard WebAudio waveshaper formula: a smooth soft-clip whose knee sharpens
  // as `amount` grows. Used lightly (as a parallel blend, not full-wet) for a
  // touch of harmonic warmth, and harder for the boss's growl layer.
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

function buildReverbImpulse(ac: AudioContext): AudioBuffer {
  // A synthesised room: exponentially decaying noise, independent per channel
  // for stereo width. This one buffer is what turns dry oscillator blips into
  // something that sounds like it exists in a space.
  const duration = 1.6;
  const length = Math.floor(ac.sampleRate * duration);
  const buffer = ac.createBuffer(2, length, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6);
    }
  }
  return buffer;
}

function noiseBuffer(ac: AudioContext, duration: number): AudioBuffer {
  const key = Math.round(duration * 1000);
  const cached = noiseCache.get(key);
  if (cached) return cached;
  const frames = Math.floor(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(key, buffer);
  return buffer;
}

/** Builds the context and mix bus once, on the first sound of any kind. */
export function ensureEngine(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();

    // Bus: [music, sfx, reverb-return] -> saturation blend -> compressor -> master.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.16;

    const dry = ctx.createGain();
    dry.gain.value = 0.82;
    const shaped = ctx.createWaveShaper();
    shaped.curve = buildDistortionCurve(6);
    const shapedGain = ctx.createGain();
    shapedGain.gain.value = 0.18;

    const bus = ctx.createGain();
    bus.connect(dry);
    bus.connect(shaped);
    shaped.connect(shapedGain);
    dry.connect(compressor);
    shapedGain.connect(compressor);

    masterGain = ctx.createGain();
    masterGain.gain.value = enabled ? 1 : 0;
    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.gain.value = 0.5;
    musicGain.connect(bus);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.85;
    sfxGain.connect(bus);

    const convolver = ctx.createConvolver();
    convolver.buffer = buildReverbImpulse(ctx);
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 1;
    reverbSend.connect(convolver);
    convolver.connect(bus);
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

export function setEngineEnabled(value: boolean): void {
  enabled = value;
  if (masterGain) masterGain.gain.value = value ? 1 : 0;
  if (value) ensureEngine();
}

export function musicBus(): GainNode | null {
  return musicGain;
}

// ---------------------------------------------------------------- primitives

export interface ToneOptions {
  freq: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  /** Exponential pitch sweep target, if the voice should glide. */
  sweepTo?: number;
  /** Detune in cents, for a second unison voice layered slightly off. */
  detune?: number;
  /** -1 (left) to 1 (right). */
  pan?: number;
  /** Seconds from now before the voice starts. Ignored if `time` is set. */
  delay?: number;
  /**
   * Absolute AudioContext time to start at, for the look-ahead music scheduler.
   * `delay` is relative to whenever this call happens to run on the JS thread,
   * which is exactly the jitter a look-ahead scheduler exists to avoid — it
   * computes real future times up front instead.
   */
  time?: number;
  /** Attack time; defaults to a fast 8ms click-free ramp. */
  attack?: number;
  /** 0..1 amount sent to the shared reverb, in addition to the dry signal. */
  reverb?: number;
  destination?: AudioNode;
}

/** A single oscillator voice with a short attack and an exponential decay. */
export function playTone(opts: ToneOptions): void {
  const ac = ensureEngine();
  if (!ac || !sfxGain) return;
  const t = opts.time ?? ac.currentTime + (opts.delay ?? 0);
  const attack = opts.attack ?? 0.008;

  const osc = ac.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freq, t);
  if (opts.sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), t + opts.duration);
  if (opts.detune !== undefined) osc.detune.value = opts.detune;

  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.001, opts.gain), t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);

  const pan = ac.createStereoPanner();
  pan.pan.value = opts.pan ?? 0;

  osc.connect(env);
  env.connect(pan);
  pan.connect(opts.destination ?? sfxGain);
  if (opts.reverb && reverbSend) {
    const send = ac.createGain();
    send.gain.value = opts.reverb;
    env.connect(send);
    send.connect(reverbSend);
  }

  osc.start(t);
  osc.stop(t + opts.duration + 0.05);
}

export interface NoiseOptions {
  duration: number;
  gain: number;
  filterType?: BiquadFilterType;
  filterFreq?: number;
  /** Sweeps the filter cutoff over the voice's life, for a "whoosh" shape. */
  filterFreqEnd?: number;
  q?: number;
  pan?: number;
  delay?: number;
  /** Absolute AudioContext time to start at; see ToneOptions.time. */
  time?: number;
  attack?: number;
  reverb?: number;
  destination?: AudioNode;
}

/** A filtered burst of noise — the basis of every impact, hit and hat in the mix. */
export function playNoise(opts: NoiseOptions): void {
  const ac = ensureEngine();
  if (!ac || !sfxGain) return;
  const t = opts.time ?? ac.currentTime + (opts.delay ?? 0);
  const attack = opts.attack ?? 0.003;

  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, opts.duration + 0.05);

  const filter = ac.createBiquadFilter();
  filter.type = opts.filterType ?? 'lowpass';
  filter.frequency.setValueAtTime(opts.filterFreq ?? 2000, t);
  if (opts.filterFreqEnd !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.filterFreqEnd), t + opts.duration);
  }
  if (opts.q !== undefined) filter.Q.value = opts.q;

  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.001, opts.gain), t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);

  const pan = ac.createStereoPanner();
  pan.pan.value = opts.pan ?? 0;

  src.connect(filter);
  filter.connect(env);
  env.connect(pan);
  pan.connect(opts.destination ?? sfxGain);
  if (opts.reverb && reverbSend) {
    const send = ac.createGain();
    send.gain.value = opts.reverb;
    env.connect(send);
    send.connect(reverbSend);
  }

  src.start(t);
  src.stop(t + opts.duration + 0.05);
}
