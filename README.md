# Roblaksim Survivor

A three-minute wave-survival game for iOS and Android, in the Survivor.io mould.
You are a square. You move with a floating thumbstick across an open, unbounded
map while a horde chases you down. Your gun fires by itself at anything inside
your firing circle. Survive the clock, then kill what arrives at the end of it.

Built as a web game in TypeScript + Canvas 2D, wrapped for both stores with
Capacitor. The whole thing is ~63 KB of JavaScript (22 KB gzipped) with no art or
audio assets: every sound, including the background score, is synthesised at
runtime (see docs/AUDIO.md for why, and what it would take to swap in real
recordings), and icons are generated from code.

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
| 2 | **Upgrade** | Permanent, gold-bought upgrades: Attack, Attack Speed, Range, Health, Magnet, Speed. (More Hands is in-run only — see the level-up table below.) |
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
  hit, so they cannot park on top of you — and that's the only thing contact does:
  touching the square costs you HP, never the bot HP. Bots only take damage from
  your bullets.
- Every hit shows a **damage number** — small and white on a bot, red and
  larger on you — so a hit that didn't do what you expected (a falloff shot from
  an extra hand, an unusually tanky bot) is visible, not just felt.
- **Every bot drops two orbs where it dies** — gold and XP. Neither counts until
  you walk over it. Your magnet radius vacuums up anything close, orbs live for
  eighteen seconds, and everything you leave behind is gone. This is what makes
  running away expensive: you keep your health and lose the run's economy.
- **XP bar** fills from collected XP, not from kills. 5 XP for level 2, 11 more
  for level 3, 16 more for level 4, up to **level 15**. Late bots carry richer
  orbs, so the curve keeps pace with the table.
- Every level-up: **heal 10% of max HP**, then **pick one of three** cards, drawn
  at random from the seven lines you have not maxed out. A maxed line stops being
  offered:

  | Line | Effect | Per pick | Picks |
  |---|---|---|---|
  | Rapid Fire | Attack speed | +25% | 5 |
  | Heavy Rounds | Shot damage | +25% | 5 |
  | Wide Scope | Firing radius | +25% | 5 |
  | Magnet | Pickup radius | +25% | 5 |
  | Reinforce | Max health, granted as healing | +25% | 5 |
  | Sprint | Movement speed | +10% | 5 |
  | More Hands | +1 simultaneous firing direction, each aimed at its own bot | see below | 3 |

  More Hands doesn't fit the "+X% to one stat" shape the rest of the table uses:
  the first hand always fires at full damage, and every hand past that fires at
  `PLAYER.extraHandDamageShare` (32%) of it. A second full-damage gun looked like
  a plain multiplier stat but wasn't — it roughly doubles total output the instant
  two bots are in range, which is most of the game past wave two. Measured on the
  balance harness, that took a meta-progression tier that used to win 17% of the
  time to 100% off a single pick. The reduced share and the 3-pick cap (four
  directions at most) bring the ladder back to its original shape while keeping
  the line clearly worth taking against a crowd, which is the point of it.
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
- **Sprint is +10% per pick, not +25%.** Five picks at +25% is 3.05x, or 464 vu/s
  against a 209 vu/s runner — nothing could ever reach you, and a run you cannot
  lose is a run with no reason to upgrade. The permanent Speed track is short and
  cheap-stepped for the same reason.

## The balance harness

`npm run qa` boots the real app in headless Chromium, then drives the engine
directly at thousands of frames a second to play out complete runs at four points
on the progression ladder. It reports win rate, survival time, kills, level and
gold for each, and fails if the app logged any console error.

```
runs per row: 6
meta         win%   time   kills  lvl   gold  onscreen  orbs
fresh         0%    87.2  126.3   7.7   293.3    98.5   0.0
third        17%   193.8  760.8  15.0  2462.7   129.7   2.3
two-third   100%   213.3  948.5  15.0  3699.0    25.8   5.3
maxed       100%   195.5  907.8  15.0  3546.0    13.8   8.3
```

The pilot in the harness is a competent kiter: it flees the local crowd weighted
by inverse square distance, with a tangential component so it strafes around
pressure instead of sprinting into the bots spawning ahead of it. Measuring
balance against a stationary dummy would be meaningless now that movement is the
core of the game — the first version of the pilot survived 181 seconds with 137
kills, which is what exposed that kiting needed a counter at all. Since loot has
to be collected, the pilot also dives for orbs when the crowd around it thins,
and it picks from the same three random cards the real UI renders.

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
