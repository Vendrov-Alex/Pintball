# Pintball Survivor

A three-minute wave-survival game for iOS and Android, in the Survivor.io mould.
You are a square. You move with a floating thumbstick across an open, unbounded
map while a horde chases you down. Your gun fires by itself at anything inside
your firing circle. Survive the clock, then kill what arrives at the end of it.

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
- **You move.** Touch anywhere and a floating joystick appears under your thumb;
  drag past its edge and the base follows, so a long swipe never runs out of
  stick. WASD and the arrow keys work for desktop testing. The map is unbounded
  and the camera is locked to you — the scrolling grid is the only thing that
  tells you the square is moving rather than the world.
- The gun aims itself at the nearest bot. A dashed circle marks its boundary; the
  gun only shoots inside it, and bullets carry a travel budget equal to the radius
  so running away never deletes your own shots.
- **Outrunning the wave is not a strategy.** Most bots spawn in the hemisphere you
  are heading toward, runners are faster than you late in a run, and bots you have
  genuinely left behind are recycled to spawn where you actually are.
- **HP bar** drains every time a bot touches you. Bots bounce off after landing a
  hit, so they cannot park on top of you.
- **XP bar** fills with every kill. 5 kills for level 2, 11 more for level 3, 16
  more for level 4, up to **level 15**.
- Every level-up: **heal 10% of max HP**, then **pick one of three** upgrades —
  attack speed, damage or firing radius, each **+25%**, each up to **5 times**.
- At 3:00 the **boss** arrives: x10 HP, contact damage and gold of a regular bot.
  An arrow pins it to the screen edge whenever it is off camera. It starts slower
  than you and **enrages** after thirty seconds, accelerating until it is
  unambiguously faster — a boss you can kite forever is not a fight, it is a
  stalemate. Kill it to win.
- Win or lose, you keep **all the gold** from every bot you killed. Spend it on the
  Upgrade screen; those upgrades carry into every future run.

Movement, joystick feel and spawn pressure are `PLAYER.moveSpeed`, `JOYSTICK` and
`SPAWN_LEAD_BIAS` in `src/game/config.ts`.

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
fresh        0%   107.5  145.5   7.5  242.0   166.0
third       17%   186.2  734.7  15.0  1555.0   137.5
two-third  100%   193.8  877.2  15.0  2197.2    30.2
maxed      100%   191.5  888.5  15.0  2241.5    19.3
```

The pilot in the harness is a competent kiter: it flees the local crowd weighted
by inverse square distance, with a tangential component so it strafes around
pressure instead of sprinting into the bots spawning ahead of it. Measuring
balance against a stationary dummy would be meaningless now that movement is the
core of the game — the first version of the pilot survived 181 seconds with 137
kills, which is what exposed that kiting needed a counter at all.

That shape is the design target: a new player never sees the boss, a partly
upgraded player reaches it and loses, and an invested player wins. `npm run
qa:shots` additionally screenshots every screen into `screenshots/`.

## Building for the stores

```bash
npm run build:web                         # one self-contained .html you can host
npm run qa:web                            # boot that file and smoke-test it
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
  build-artifact.mjs   collapses the build into one hostable HTML file
  check-web-build.mjs  smoke test for that file, under a hostile host
  generate-icons.mjs   dependency-free PNG generator for icons and splashes
```

Performance notes, because this has to hold 60 fps on a mid-range Android with 300
bots on screen: entities are pre-allocated in fixed pools and never garbage
collected mid-run, near-neighbour queries go through a uniform spatial hash keyed
by a multiplicative hash so the world can be unbounded, rather than an O(n²) scan, the device pixel ratio is capped at 2, canvas shadow blur is
restricted to a handful of large static elements, and the HUD only touches the DOM
when a displayed value actually changes.
