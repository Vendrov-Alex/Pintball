# Audio

Every sound in this game — the background score included — is synthesised at
runtime with the WebAudio API. No audio files ship with the game.

## Why there are no recorded samples

This was a deliberate choice, made after checking whether real recordings were
actually reachable, not a default. Two paths were checked:

1. **Downloading from a CC0/CC-BY asset library** (Kenney.nl, Freesound,
   OpenGameArt) or a royalty-free music source. Blocked: this project's network
   egress policy denies every third-party domain outside a small package-registry
   allowlist (npm, PyPI, crates.io, …). There is no way to fetch a file from any
   of those sites from inside this environment.
2. **An npm package that bundles real audio assets.** Checked the registry
   directly — nothing exists in that shape. npm is a code registry; the handful
   of sound-related packages found (`sfxr`, `jsfxr`, `zzfx`, `tone`) are all
   synthesis libraries, the same category of thing this file already is.

Neither path produces a legally clean, actually-reachable recording. Shipping
something anyway — an unlicensed file pulled from who-knows-where — is the one
option that was never on the table.

## What's here instead

`src/core/audioEngine.ts` is the shared mix bus: a single AudioContext, separate
music and SFX gain buses, a convolver fed by a procedurally generated reverb
impulse (exponentially decaying stereo noise — this alone is most of the
difference between "raw synth beep" and "sound that exists in a space"), and a
soft-saturation + compressor stage on the master bus for glue and warmth.

`src/core/audio.ts` layers 2-4 of those primitive voices per effect — a
transient click, a tonal body, a low-end thump, an optional reverb send — the
way a sound designer stacks layers under a single recorded sample, rather than
playing one bare oscillator per event.

`src/core/music.ts` is a generative score, not a looped file: a look-ahead
scheduler (the standard WebAudio timing pattern — `setTimeout`/`setInterval`
alone drift by tens of milliseconds and the beat would audibly wobble) fires
short synth voices on a 16th-note grid against a four-chord progression
(Am–F–C–G) that repeats indefinitely. Three phases — `menu`, `battle`, `boss` —
share the progression and instrumentation but differ in tempo and layer density,
and switching phases just changes what the next scheduled step plays; there is
no file to cross-fade or splice, and no loop seam to hide.

## If real recordings become available later

Nothing above should be read as "this is good enough forever" — it's what could
be built honestly with the access this environment actually has. If that access
changes (an allowlisted CDN, licensed assets supplied directly as files, an
admin exception for a specific CC0 host), swapping a given voice from
synthesised to sampled means:

- Add the file under `public/audio/` (or an `AudioBuffer` fetched and decoded
  once at startup).
- Replace the matching `playTone`/`playNoise` call in `audio.ts` or `music.ts`
  with an `AudioBufferSourceNode` routed into the same `sfxGain`/`musicGain` bus
  — the mix chain (reverb send, saturation, compressor) stays the same either
  way, so a real recording gets the same glue as everything around it.
- Watch the single-file web build's size: `npm run build:web` inlines every
  asset into one HTML file, and the Artifact host caps that at 16MB. A minute of
  compressed loop audio is a few hundred KB and is fine; several minutes of
  uncompressed WAV is not.
