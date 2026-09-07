/**
 * Headless QA + balance harness.
 *
 * Boots the real app in Chromium, screenshots every screen, then drives the game
 * engine directly at thousands of frames per second to play out full runs. This is
 * how the difficulty curve is checked: guessing at spawn rates and XP thresholds
 * from a config file is how mobile games ship unwinnable.
 *
 *   node scripts/simulate.mjs [--runs 5] [--shots] [--meta 0,0,0]
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const RUNS = Number(flag('runs', 5));
const SHOTS = args.includes('--shots');
const SWEEP = args.includes('--sweep');
const STAGE = Number(flag('stage', 1));
const SHOT_DIR = flag('shot-dir', 'screenshots');
const PORT = Number(flag('port', 5199));
/** Permanent upgrade levels: damage,fireRate,range,maxHp,magnet,moveSpeed */
const META = String(flag('meta', '0,0,0,0,0,0')).split(',').map(Number);
/** Must mirror META_UPGRADES steps in src/game/config.ts. */
const META_STEPS = { damage: 0.06, fireRate: 0.05, range: 0.04, maxHp: 0.05, magnet: 0.05, moveSpeed: 0.02 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Boots vite and resolves with { proc, url }. The port is read back from the
 *  server's own output so a leftover process never blocks a QA run. */
async function startServer() {
  // detached + a negative kill later: `npx` spawns vite as a grandchild, and
  // killing only the shell leaves the dev server holding the port.
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let buffer = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vite did not start in time:\n${buffer}`)), 30000);
    proc.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      const match = buffer.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}/`);
      }
    });
    proc.stderr.on('data', (c) => process.stderr.write(c));
  });
  await sleep(400);
  return { proc, url };
}

const simulateRun = async (page, meta, stage) =>
  page.evaluate(
    ({ meta, metaSteps, stage }) => {
      const battle = window.__battle;
      const game = window.__game;
      if (!battle || !game) throw new Error('debug handles missing');

      // Take the render loop out of the picture and step the simulation by hand.
      battle.active = false;

      const ids = ['damage', 'fireRate', 'range', 'maxHp', 'magnet', 'moveSpeed'];
      const metaMul = {};
      ids.forEach((id, i) => {
        metaMul[id] = 1 + (meta[i] || 0) * metaSteps[id];
      });
      const equipment = { laser: false, fireCannon: false, aura: false };
      game.start(metaMul, equipment, stage);

      const dt = 1 / 60;
      const picked = [];
      let steps = 0;
      const maxSteps = 60 * 400;
      // Autopilot heading, kept between frames so the pilot commits to a direction
      // instead of jittering when the crowd is balanced around it.
      let hx = 0;
      let hy = 1;

      /**
       * Stands in for a competent player: run from the local crowd, weighted by
       * inverse square distance, with a tangential component so it circles the
       * swarm rather than sprinting head-first into the bots that spawn ahead of
       * it. Measuring balance against a stationary dummy would be meaningless now
       * that movement is the core of the game.
       */
      const steer = () => {
        const px = game.player.x;
        const py = game.player.y;

        let ax = 0;
        let ay = 0;
        let near = 0;
        for (const e of game.enemies.items) {
          if (!e.active) continue;
          const dx = px - e.x;
          const dy = py - e.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > 340 * 340 || d2 < 1) continue;
          if (d2 < 190 * 190) near += 1;
          const w = (e.isBoss ? 6 : 1) / d2;
          ax += dx * w;
          ay += dy * w;
        }

        // Loot pull. Nothing is banked until it is walked over, so a pilot that
        // only flees would measure an economy no real player experiences.
        let lx = 0;
        let ly = 0;
        for (const p of game.pickups.items) {
          if (!p.active) continue;
          const dx = p.x - px;
          const dy = p.y - py;
          const d = Math.hypot(dx, dy);
          if (d > 460 || d < 1) continue;
          lx += dx / d;
          ly += dy / d;
        }

        const al = Math.hypot(ax, ay);
        const ll = Math.hypot(lx, ly);
        if (al > 1e-6) {
          ax /= al;
          ay /= al;
        }
        if (ll > 1e-6) {
          lx /= ll;
          ly /= ll;
        }

        // Wall/obstacle avoidance. Without this the pilot has no idea geometry
        // exists and measures a pessimistic "walks straight into things" lower
        // bound rather than anything close to how a sighted player moves —
        // exactly the gap that made the first pass after adding obstacles read
        // as a much harder game than it actually is. Repels only within a
        // margin of the pilot's own body, at a strength that dominates the
        // crowd/loot pull whenever it's active at all, so it never actually
        // touches a wall while still leaving normal steering alone at range.
        let wx = 0;
        let wy = 0;
        const margin = 90;
        for (const o of window.__OBSTACLES || []) {
          const cx = Math.max(o.x - o.halfW, Math.min(px, o.x + o.halfW));
          const cy = Math.max(o.y - o.halfH, Math.min(py, o.y + o.halfH));
          const dx = px - cx;
          const dy = py - cy;
          const d = Math.hypot(dx, dy);
          if (d < margin && d > 1e-6) {
            const w = (margin - d) / margin;
            wx += (dx / d) * w;
            wy += (dy / d) * w;
          }
        }
        const world = window.__WORLD;
        if (world) {
          const edge = world.halfSize - margin;
          if (px > edge) wx -= (px - edge) / margin;
          if (px < -edge) wx += (-edge - px) / margin;
          if (py > edge) wy -= (py - edge) / margin;
          if (py < -edge) wy += (-edge - py) / margin;
        }

        // Stage 2's shooter bolts: push away from any bolt close enough to
        // matter, weighted by inverse distance so an about-to-hit shot
        // dominates a merely-nearby one. Without this the pilot stands in
        // incoming fire exactly like a sighted player never would, which
        // would measure stage 2 as far harder than it actually plays.
        let bx = 0;
        let by = 0;
        for (const b of game.enemyBolts.items) {
          if (!b.active) continue;
          const dx = px - b.x;
          const dy = py - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > 220 * 220 || d2 < 1) continue;
          const d = Math.sqrt(d2);
          bx += dx / d / d;
          by += dy / d / d;
        }
        const bl = Math.hypot(bx, by);
        if (bl > 1e-6) {
          bx /= bl;
          by /= bl;
        }

        // Crowded: get out. Clear: go collect. 40% tangential either way, so the
        // pilot strafes around pressure instead of sprinting into the bots that
        // spawn ahead of it.
        const lootWeight = near >= 9 ? 0.35 : 0.95;
        let dx = ax + lx * lootWeight - ay * 0.4 + wx * 3 + bx * 2;
        let dy = ay + ly * lootWeight + ax * 0.4 + wy * 3 + by * 2;
        const dl = Math.hypot(dx, dy);
        if (dl > 1e-6) {
          hx = dx / dl;
          hy = dy / dl;
        }
        game.setMove(hx, hy);
      };

      while (game.phase !== 'ended' && steps < maxSteps) {
        if (game.phase === 'levelup') {
          // Balanced player: always top up whichever line is furthest behind.
          // Read the three cards the real UI just rendered, so the pilot is
          // constrained to the same random offer a player would see.
          const offered = [...document.querySelectorAll('.modal--levelup .choice')].map(
            (el) => el.dataset.id,
          );
          const next = offered.length
            ? offered.reduce((a, b) => (game.picks[a] <= game.picks[b] ? a : b))
            : 'damage';
          picked.push(next);
          game.applyChoice(next);
          continue;
        }
        if (steps % 6 === 0) steer();
        game.update(dt);
        steps += 1;
      }

      return {
        ended: game.phase === 'ended',
        won: game.bossKilled,
        kills: game.kills,
        level: game.level,
        gold: Math.floor(game.gold),
        seconds: Math.round(game.elapsed * 10) / 10,
        hp: Math.round(game.hp),
        picks: { ...game.picks },
        pickOrder: picked.length,
        orbs: game.pickups.countActive(),
        liveEnemies: game.enemies.countActive(),
      };
    },
    { meta, metaSteps: META_STEPS, stage },
  );

async function main() {
  const { proc: server, url } = await startServer();
  // PLAYWRIGHT_BROWSERS_PATH usually resolves this; CHROMIUM_PATH is the escape
  // hatch when the pinned revision differs from the one on the machine.
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.stage-card[data-stage="1"]', { timeout: 10000 });

  if (SHOTS) {
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/01-home.png` });
    // Dots: 0 Battle, 1 Upgrade, 2 Gear, 3 Shop.
    await page.evaluate(() => document.querySelectorAll('.dot')[1].click());
    await sleep(450);
    await page.screenshot({ path: `${SHOT_DIR}/02-upgrades.png` });
    await page.evaluate(() => document.querySelectorAll('.dot')[2].click());
    await sleep(450);
    await page.screenshot({ path: `${SHOT_DIR}/03-gear.png` });
    await page.evaluate(() => document.querySelectorAll('.dot')[3].click());
    await sleep(450);
    await page.screenshot({ path: `${SHOT_DIR}/04-shop.png` });
    await page.evaluate(() => document.querySelectorAll('.dot')[0].click());
    await sleep(450);
  }

  await page.click('.stage-card[data-stage="1"]');
  await page.waitForSelector('.battle:not([hidden])');
  await sleep(1200);

  if (SHOTS) {
    // Let the fight develop before capturing: an empty field proves nothing.
    await page.evaluate(() => {
      const g = window.__game;
      for (let i = 0; i < 60 * 25; i++) {
        if (g.phase === 'levelup') g.applyChoice('fireRate');
        else if (g.phase === 'running') g.update(1 / 60);
        else break;
      }
      // The harness bypasses the UI, so the card the engine opened is still in
      // the DOM. Close it by hand for a clean capture of the playfield.
      document.querySelector('.modal--levelup').hidden = true;
    });
    await sleep(200);
    await page.screenshot({ path: `${SHOT_DIR}/05-battle.png` });
    // Force a level-up card so the choice UI can be inspected.
    await page.evaluate(() => {
      const g = window.__game;
      for (let i = 0; i < 60 * 30 && g.phase === 'running'; i++) g.update(1 / 60);
    });
    await sleep(300);
    await page.screenshot({ path: `${SHOT_DIR}/06-levelup.png` });
  }

  // The progression ladder: an untouched account, then a third, two thirds and a
  // fully maxed set of permanent upgrades.
  const ladder = SWEEP
    ? [
        ['fresh    ', [0, 0, 0, 0, 0, 0]],
        ['third    ', [10, 8, 7, 8, 7, 4]],
        ['two-third', [20, 16, 13, 16, 13, 8]],
        ['maxed    ', [30, 25, 20, 25, 20, 12]],
      ]
    : [['custom   ', META]];

  console.log(`\nstage ${STAGE} — runs per row: ${RUNS}`);
  console.log('meta         win%   time   kills  lvl   gold  onscreen  orbs');
  for (const [label, meta] of ladder) {
    const results = [];
    for (let i = 0; i < RUNS; i++) results.push(await simulateRun(page, meta, STAGE));
    const avg = (fn) => (results.reduce((s, r) => s + fn(r), 0) / results.length).toFixed(1);
    const winPct = ((results.filter((r) => r.won).length / RUNS) * 100).toFixed(0);
    console.log(
      `${label}  ${winPct.padStart(4)}%  ${avg((r) => r.seconds).padStart(6)}  ` +
        `${avg((r) => r.kills).padStart(5)}  ${avg((r) => r.level).padStart(4)}  ` +
        `${avg((r) => r.gold).padStart(5)}  ${avg((r) => r.liveEnemies).padStart(6)}  ` +
        `${avg((r) => r.orbs).padStart(4)}`,
    );
    if (results.some((r) => !r.ended)) console.log(`  ! ${label}: a run hit the step ceiling without ending`);
  }
  if (problems.length) {
    console.log('\nRuntime problems:');
    for (const p of problems) console.log(`  - ${p}`);
  } else {
    console.log('\nNo console errors.');
  }

  await browser.close();
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch {
    server.kill('SIGKILL');
  }
  process.exit(problems.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
