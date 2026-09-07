# Roblaksim Survivor

A three-minute wave-survival game for iOS and Android, in the Survivor.io mould.
You are a square. You move with a floating thumbstick across a large, walled
map — with obstacles to duck behind — while a horde chases you down. Your gun
fires by itself at anything inside your firing circle it has a clear shot at.
Survive the clock, then kill what arrives at the end of it.

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

## The four screens

Swipe left/right, or tap the dots at the bottom.

| # | Screen  | What it does |
|---|---------|--------------|
| 1 | **Battle**  | Stage cards (Stage 2 locked until Stage 1 is cleared once) and your lifetime records. |
| 2 | **Upgrade** | Permanent, gold-bought upgrades: Attack, Attack Speed, Range, Health, Magnet, Speed. (More Hands is in-run only — see the level-up table below.) |
| 3 | **Gear**    | The three boss-dropped equipment pieces — locked/unlocked gallery, nothing to buy. See below. |
| 4 | **Shop**    | Gold packs unlocked by watching a rewarded video ad. |

## Optional account sign-in

Guest play is the default and needs nothing — every feature above works with
zero setup. A small account icon in the top bar (only present once a real
Firebase project is wired in — see below) lets a player sign in with Google,
Apple or Facebook to carry gold and upgrades to a second device. It's genuinely
optional: declining, or never opening it, changes nothing about the game.

The client side of this — `src/core/auth.ts`, `src/meta/cloudSync.ts`,
`src/ui/accountModal.ts` — is fully built and currently switched off, because
`src/core/firebaseConfig.ts` has no real Firebase project behind it yet.
**[`docs/AUTH_SETUP.md`](docs/AUTH_SETUP.md)** is the checklist for creating one
and turning the feature on; none of those steps can happen from a coding
session; they need your own Google/Apple/Facebook developer accounts.

Both Firebase's Auth SDK and the native sign-in plugin are dynamically
imported, not loaded up front — most players never open the account screen,
and the app's initial JS payload doesn't grow to carry an SDK most of them
will never touch. Confirmed with a network trace, not just by reading the code:
zero Firebase requests fire on a normal page load. The one-file share-link
build (`npm run build:web`) excludes the feature entirely rather than paying to
inline it — see the header comment in `src/core/auth.artifact-stub.ts`.

## How a run works

- **3:00 on the clock**, split into nine 20-second waves that get denser and meaner.
- **You move.** Touch anywhere and a floating joystick appears under your thumb;
  drag past its edge and the base follows, so a long swipe never runs out of
  stick. WASD and the arrow keys work for desktop testing. The camera follows
  you — the scrolling grid is the cue that the square is moving through the
  world, not the other way round.
- **The map is a real, finite square with a fence around it** (`WORLD.halfSize`
  in `src/game/config.ts`), not an infinite plane — you, every bot, and the boss
  all physically stop at it. The camera stops at it too: standing at the wall
  shows the wall at the edge of the screen instead of empty space beyond it.
- **A handful of hand-placed walls** (`OBSTACLES` in the same file) block
  movement for the square and every bot alike, and block bullets and the
  turret's own line of sight — a bot on the far side of one is a bot your gun
  genuinely cannot see, not just one that has to walk the long way round. That
  makes a wall real cover, not a speed bump: duck behind one when a wave is
  thick and bots pile up on the other side while you catch your breath.
- The gun aims itself at the nearest bot it has a clear shot at. A dashed circle
  marks how far it can reach; a miss keeps flying past that circle at full
  speed until it leaves the map or hits a wall, rather than vanishing at the
  edge of the turret's own reach.
- **Outrunning the wave is not a strategy.** Most bots spawn in the hemisphere you
  are heading toward, runners are faster than you late in a run, bots you have
  genuinely left behind are recycled to spawn where you actually are — and now
  there's only so much map to run into before the fence ends the conversation.
- **HP bar** drains every time a bot touches you. Bots bounce off after landing a
  hit, so they cannot park on top of you — and that's the only thing contact does:
  touching the square costs you HP, never the bot HP. Bots only take damage from
  your bullets.
- Every hit shows a **damage number** — white on a bot, red and larger on
  you — sized and timed (`spawnFloat` in `src/game/engine.ts`) to stay on
  screen long enough to actually read mid-fight, not just flash past. Any hit
  on a bot has a flat chance (`CRIT` in `src/game/config.ts`, 15% for 1.6×
  damage) to land as a **critical hit**: bigger, red instead of white, with a
  red lightning bolt drawn next to the number — a real damage bonus, not just
  a paint job, so it's worth noticing when it lands.
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
- **Picking a card doesn't resume the fight on its own.** The pick applies
  instantly (the HUD updates right away) but the sim stays frozen — a "Tap to
  continue" hint replaces the countdown — until the player actually touches
  the screen again (`Game.resume()`, called from the first pointerdown or
  keypress after a pick). Auto-resuming the instant a card closed meant
  getting hit by something you had no chance to see coming; this is the beat
  that lets you look at the field you're about to dive back into.
- At 3:00 the **boss** arrives: x10 HP, contact damage and gold of a regular bot.
  An arrow pins it to the screen edge whenever it is off camera. It starts slower
  than you and **enrages** after thirty seconds, accelerating until it is
  unambiguously faster — a boss you can kite forever is not a fight, it is a
  stalemate. Kill it to win.
- **Killing the boss doesn't end the run on the spot.** A 5-second victory
  sequence (`VICTORY` in `src/game/config.ts`) takes over: every gold orb still
  on the map — anything the magnet never reached — gets vacuumed straight to
  the square at a flat high speed (`VICTORY.pullSpeed`), each pickup landing
  with a throttled coin ping and a pulse on the gold counter, casino-style. A
  "BOSS DOWN!" banner covers the old countdown while it plays. Quitting mid-
  sequence (`Game.skipVictory()`) still banks whatever was collected and still
  counts as a win — it does not silently convert into a loss.
- Win or lose, you keep **all the gold** from every bot you killed. Spend it on the
  Upgrade screen; those upgrades carry into every future run.
- **Beating the boss also drops one piece of gear** — see below.

Movement, joystick feel and spawn pressure are `PLAYER.moveSpeed`, `JOYSTICK` and
`SPAWN_LEAD_BIAS` in `src/game/config.ts`.

## Boss-dropped gear

A third progression axis alongside gold-bought permanent upgrades and in-run
level-up picks: three passive weapons, each visually worn on the square, that
stay active on every future run once unlocked. `EQUIPMENT`, `LASER`,
`FIRE_CANNON` and `AURA` in `src/game/config.ts` hold every tunable number;
`src/meta/equipment.ts` holds the drop logic.

| Gear | Worn as | Fires | Effect |
|---|---|---|---|
| **Piercing Laser** | A hand | Every 3s (`LASER.cooldown`) | A beam at the nearest bot that damages it and everything else it passes through on the way to the map edge or a wall — the one attack that punishes bots for lining up. |
| **Fire Cannon** | A hand | Every 7s (`FIRE_CANNON.cooldown`) | Lobs an exploding fireball at whatever bot is closest to the edge of your firing circle — a lane the main gun and the laser both leave uncovered, since they both target the nearest bot. |
| **Hellfire Aura** | The body | Continuously, ticking every 0.4s (`AURA.tickInterval`) | Damages anything inside a fixed radius around the square, boss included. Always on — there is no cooldown to time. |

All three stack with the regular gun and with each other; none of them
replace it. Every boss kill drops whichever piece you don't already own,
picked at random, so it's never the same one twice in a row — once all three
are owned, a kill pays a flat gold bonus (`ALL_OWNED_BONUS_GOLD` in
`src/meta/equipment.ts`) instead so a kill never stops feeling like a reward.
Ownership is permanent and applies to every run from then on; there's no
loadout to manage and nothing to buy on the Gear screen.

Deliberately not run through the balance harness the way the level-up lines
and meta upgrades are: gear only turns on once owned (`Game.equipment`
defaults to all-`false`, and the harness's autopilot never plays a run long
enough to farm three boss kills from a fresh profile), so it cannot move the
harness's win-rate ladder. It is postgame power by design, not a lever tuned
against the core difficulty curve.

## Stage 2

A second, harder version of the same 3-minute-run-plus-boss structure, not a
new game mode: unlocked once Stage 1's boss goes down (`Profile.highestStageCleared`
in `src/meta/profile.ts`), picked from a stage card on the Battle screen. A
locked card shows a `Beat Stage 1 to unlock` line instead of a play state.

- **Every bot is drawn as a triangle instead of a circle** (`Enemy.shape`,
  set once at spawn from `Game.stage`), boss included — the boss's triangle
  is additionally drawn oversized versus its actual hit-radius
  (`STAGE2_BOSS_VISUAL_BONUS`), a purely visual "big triangle boss" that
  never touches the HP math or the hitbox.
- **Every bot's HP is doubled** (`STAGE_HP_MULTIPLIER` in `src/game/config.ts`).
  Nothing else about a kind shared with Stage 1 changes — same speed, same
  contact damage, same gold — only HP, so a Stage 2 grunt takes twice the
  bullets a Stage 1 grunt does for the same reward. That's the one variable
  this stage turns, deliberately, rather than compounding several at once.
- **A new kind, the shooter** (`ENEMY_KINDS.shooter`, magenta), mixed into
  `WAVES_STAGE2` alongside the Stage 1 kinds at the same per-wave spawn
  rate as `WAVES` — Stage 2 is harder from HP and a new threat, not from a
  faster wave. A shooter holds a preferred distance instead of closing to
  contact range (`SHOOTER.standoffRange`), strafing when it's already
  there, and fires a bolt at the player on a cooldown that doubles as a
  visible wind-up ring (`SHOOTER.telegraph`) — the fair-warning beat that
  makes "forces you to keep moving" a real pressure instead of an
  unavoidable chip-damage tax. Its own HP is deliberately low: reaching and
  killing it fast is always the right answer, so it never becomes a damage
  sponge that also outranges you.

Clearing Stage 2's boss shows an "unlocked" line on the result screen the
same way a boss-drop does, and updates the Battle screen's stage cards the
next time they're rendered. Winning Stage 1 again after Stage 2 is already
unlocked doesn't re-show that message — `recordStageClear` only fires once,
the first time a stage's boss actually goes down.

Measured on the harness rather than assumed: at the same meta-upgrade tier
that beats Stage 1 75% of the time, Stage 2 wins about 25% — a real step up,
not a wall (`node scripts/simulate.mjs --sweep --stage 2`). A fully maxed
build still clears it every time, same as Stage 1.

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
- **The map (`WORLD.halfSize`) is 2500, not the first number tried.** At 2000 an
  invested build that used to beat the boss outright dropped to a 60% win rate
  on the harness — obstacles plus a tighter fence made it easy to get boxed in.
  2500 is the smallest size that gave the original ladder back while keeping the
  fence genuinely reachable within a run.

## The balance harness

`npm run qa` boots the real app in headless Chromium, then drives the engine
directly at thousands of frames a second to play out complete runs at four points
on the progression ladder. It reports win rate, survival time, kills, level and
gold for each, and fails if the app logged any console error.

```
runs per row: 6
meta         win%   time   kills  lvl   gold  onscreen  orbs
fresh         0%    88.3  147.7   8.3  336.5    83.8   5.3
third         0%   166.6  612.2  14.5  1873.8   117.7   1.3
two-third   100%   204.6  927.2  15.0  3614.5    19.2   3.0
maxed       100%   206.0  936.0  15.0  3691.3    15.2   6.3
```

The pilot in the harness is a competent kiter: it flees the local crowd weighted
by inverse square distance, with a tangential component so it strafes around
pressure instead of sprinting into the bots spawning ahead of it, and steers
around obstacles and the fence the same way — added the same afternoon as the
map itself, once a pilot blind to geometry made a wall-and-obstacle patch look
like a much bigger difficulty spike than it actually was. Measuring balance
against a stationary dummy would be meaningless now that movement is the core
of the game — the first version of the pilot survived 181 seconds with 137
kills, which is what exposed that kiting needed a counter at all. Since loot has
to be collected, the pilot also dives for orbs when the crowd around it thins,
and it picks from the same three random cards the real UI renders. Since Stage
2's shooter, it also steers away from incoming bolts weighted by inverse
distance — the same reasoning as the wall-avoidance patch: a pilot blind to
projectiles would measure Stage 2 as harder than it actually plays, not
because the pilot is realistic, but because standing in fire that any sighted
player would step out of isn't the thing worth measuring.

That shape is the design target: a new player never sees the boss, a partly
upgraded player reaches it and loses, and an invested player wins. `npm run
qa:shots` additionally screenshots every screen into `screenshots/`.
`node scripts/simulate.mjs --sweep --stage 2` runs the same ladder against
Stage 2's wave table instead of Stage 1's.

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
  core/
    storage.ts, audio.ts, music.ts, haptics.ts, ads.ts, platform.ts
    auth.ts             optional Google/Apple/Facebook sign-in (off until configured)
    firebaseConfig.ts   ← the one file that turns account sign-in on
    auth.artifact-stub.ts   no-op stand-in aliased in for the share-link build
  game/
    config.ts          ← every tunable number
    engine.ts          simulation: spawning, targeting, collisions, levelling
    renderer.ts        canvas drawing
    upgrades.ts        level-up card generation
    pool.ts, grid.ts   object pools and the spatial hash
  meta/
    profile.ts          persistent profile, permanent upgrade maths
    equipment.ts         boss-drop roll/unlock logic for the three gear pieces
    cloudSync.ts         Firestore reconciliation for signed-in accounts
  ui/                  swipe pager, four screens, battle HUD and modals
scripts/
  simulate.mjs         headless QA + balance harness
  build-artifact.mjs   collapses the build into one hostable HTML file
  check-web-build.mjs  smoke test for that file, under a hostile host
  generate-icons.mjs   dependency-free PNG generator for icons and splashes
```

Performance notes, because this has to hold 60 fps on a mid-range Android with 300
bots on screen: entities are pre-allocated in fixed pools and never garbage
collected mid-run, near-neighbour queries go through a uniform spatial hash keyed
by a multiplicative hash rather than an O(n²) scan, obstacle and fence collision
is a dozen-rectangle check against a hand-placed list rather than anything that
needs its own spatial structure, the device pixel ratio is capped at 2, canvas
shadow blur is restricted to a handful of large static elements, and the HUD
only touches the DOM when a displayed value actually changes.
