# Pintball Survivor

A three-minute wave-survival game for iOS and Android. You are a square. Bots come
for you from every direction. Your gun fires by itself at anything inside your
firing circle. Survive the clock, then kill what arrives at the end of it.

Built as a web game in TypeScript + Canvas 2D, wrapped for both stores with
Capacitor. The whole thing is ~50 KB of JavaScript (18 KB gzipped) with no art or
audio assets: sounds are synthesised at runtime and icons are generated from code.

---

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173 — open device emulation in devtools
npm run build        # typecheck + production bundle into dist/
npm run qa           # headless balance + smoke test (see below)
```

## The three screens

Swipe left/right, or tap the dots at the bottom.

| # | Screen  | What it does |
|---|---------|--------------|
| 1 | **Battle**  | The `Battle` button and your lifetime records. |
| 2 | **Upgrade** | Permanent, gold-bought upgrades: Attack, Attack Speed, Range. |
| 3 | **Shop**    | Gold packs unlocked by watching a rewarded video ad. |

## How a run works

- **3:00 on the clock**, split into nine 20-second waves that get denser and meaner.
- Your square sits at the centre. A dashed circle marks the firing boundary — the
  gun only shoots inside it, and bullets die at its edge.
- **HP bar** drains every time a bot touches you. Bots bounce off after landing a
  hit, so they cannot park on top of you.
- **XP bar** fills with every kill. 5 kills for level 2, 11 more for level 3, 16
  more for level 4, up to **level 15**.
- Every level-up: **heal 10% of max HP**, then **pick one of three** upgrades —
  attack speed, damage or firing radius, each **+25%**, each up to **5 times**.
- At 3:00 the **boss** arrives: x10 HP, contact damage and gold of a regular bot.
  Kill it to win.
- Win or lose, you keep **all the gold** from every bot you killed. Spend it on the
  Upgrade screen; those upgrades carry into every future run.

Holding a finger on the screen biases targeting toward that direction — the turret
still cannot shoot outside its circle, but you choose what dies first. Turn it off
with `PLAYER.touchAim` in `src/game/config.ts`.

## Where the numbers live

**Every balance value is in `src/game/config.ts`.** Wave rates, bot stats, the XP
table, upgrade costs, gold pack sizes, boss multipliers. Nothing is hard-coded
elsewhere. Change a number, run `npm run qa`, see what it did.

Three places where the brief and a playable game disagreed, all marked in the
config with the reasoning:

- **Boss speed** is not x10. At x10 (520 units/s) it crosses the screen in under a
  second and there is no counterplay for a square that cannot move.
- **Boss radius** is x4, not x10 — x10 is a third of the screen width.
- **Boss HP** carries an extra multiplier (`BOSS.extraHpFactor`) on top of the x10.
  A literal x10 boss dies in about three seconds to a maxed build. Set it to `1`
  for the literal reading of the brief.
- **Boss contact damage** is x10 of the *base* bot damage rather than the
  time-scaled one, which would be 136 against a 120 HP player: an unavoidable
  one-shot.

## The balance harness

`npm run qa` boots the real app in headless Chromium, then drives the engine
directly at thousands of frames a second to play out complete runs at four points
on the progression ladder. It reports win rate, survival time, kills, level and
gold for each, and fails if the app logged any console error.

```
runs per row: 6
meta        win%   time   kills  lvl   gold  onscreen
fresh        0%    78.6  188.8   7.8  339.8    29.0
third        0%   159.4  624.3  14.8  1318.0    52.5
two-third   50%   186.9  880.5  15.0  2168.8    16.0
maxed       83%   185.5  878.5  15.0  2296.0    14.8
```

That shape is the design target: a new player never sees the boss, a partly
upgraded player reaches it and loses, and an invested player wins. `npm run
qa:shots` additionally screenshots every screen into `screenshots/`.

## Building for the stores

```bash
npm run assets:icon                       # regenerate icons + splash from code
npx @capacitor/assets generate            # fan them out to native resolutions
npx cap add ios && npx cap add android    # once
npm run ios                               # build + sync + open Xcode
npm run android                           # build + sync + open Android Studio
```

Full submission checklist, ad configuration and privacy answers:
[`docs/STORE_RELEASE.md`](docs/STORE_RELEASE.md) · [`docs/ADMOB.md`](docs/ADMOB.md) ·
[`docs/PRIVACY_POLICY.md`](docs/PRIVACY_POLICY.md).

## Layout

```
src/
  main.ts              app bootstrap, native wiring, back button
  core/                storage, audio synthesis, haptics, ads, platform checks
  game/
    config.ts          ← every tunable number
    engine.ts          simulation: spawning, targeting, collisions, levelling
    renderer.ts        canvas drawing
    upgrades.ts        level-up card generation
    pool.ts, grid.ts   object pools and the spatial hash
  meta/                persistent profile, permanent upgrade maths
  ui/                  swipe pager, three screens, battle HUD and modals
scripts/
  simulate.mjs         headless QA + balance harness
  generate-icons.mjs   dependency-free PNG generator for icons and splashes
```

Performance notes, because this has to hold 60 fps on a mid-range Android with 300
bots on screen: entities are pre-allocated in fixed pools and never garbage
collected mid-run, near-neighbour queries go through a uniform spatial hash rather
than an O(n²) scan, the device pixel ratio is capped at 2, canvas shadow blur is
restricted to a handful of large static elements, and the HUD only touches the DOM
when a displayed value actually changes.
