import { sfx, unlockAudio } from '../core/audio';
import { music } from '../core/music';
import * as haptics from '../core/haptics';
import { EQUIPMENT, JOYSTICK, MAX_LEVEL, OBSTACLES, RUN_DURATION, WAVES, WAVE_SECONDS, WORLD } from '../game/config';
import { Game } from '../game/engine';
import { Renderer, type JoystickView } from '../game/renderer';
import type { RunResult } from '../game/types';
import type { UpgradeChoice } from '../game/upgrades';
import { applyBossDrop, ownedEquipmentMap, rollBossDrop } from '../meta/equipment';
import { allMetaMultipliers } from '../meta/metaUpgrades';
import { addGold, getProfile, recordRun } from '../meta/profile';
import { formatGold, formatTime, onTap, qs } from './dom';

const FIXED_DT = 1 / 60;
/** Never simulate more than this many steps in one frame (tab-switch guard). */
const MAX_STEPS = 5;

export class Battle {
  readonly root: HTMLElement;

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;
  private readonly game: Game;

  private readonly hudTimer: HTMLElement;
  private readonly hudWave: HTMLElement;
  private readonly hudGold: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly levelBadge: HTMLElement;
  private readonly bossBar: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly levelModal: HTMLElement;
  private readonly choiceHost: HTMLElement;
  private readonly resultModal: HTMLElement;

  private raf = 0;
  private lastFrame = 0;
  private accumulator = 0;
  private active = false;
  private lastWave = -1;
  private stickPointer: number | null = null;
  private stick: JoystickView = { active: false, baseX: 0, baseY: 0, knobX: 0, knobY: 0 };
  private hudCache = { hp: -1, maxHp: -1, xp: -1, level: -1, gold: -1, time: -1, wave: -1 };

  constructor(private readonly onExit: (result: RunResult | null) => void) {
    this.root = document.createElement('div');
    this.root.className = 'battle';
    this.root.hidden = true;
    this.root.innerHTML = `
      <canvas class="battle__canvas"></canvas>

      <div class="hud">
        <div class="hud__top">
          <button class="hud__quit" type="button" aria-label="Leave battle">✕</button>
          <div class="hud__timer"><span class="hud__timer-value">3:00</span></div>
          <div class="hud__chips">
            <span class="chip chip--wave">Wave 1</span>
            <span class="chip chip--gold"><span class="coin" aria-hidden="true"></span><span class="chip__value">0</span></span>
          </div>
        </div>

        <div class="hud__bars">
          <div class="bar bar--hp">
            <div class="bar__fill"></div>
            <span class="bar__label">120 / 120</span>
          </div>
          <div class="bar bar--xp">
            <div class="bar__fill"></div>
            <span class="bar__level">Lv 1</span>
          </div>
        </div>

        <div class="hud__boss" hidden>
          <span class="hud__boss-name">BOSS</span>
          <div class="bar bar--boss"><div class="bar__fill"></div></div>
        </div>

        <div class="banner" aria-live="polite"></div>
      </div>

      <div class="modal modal--levelup" hidden>
        <div class="modal__card">
          <p class="modal__eyebrow">Level up</p>
          <h2 class="modal__title">Choose one</h2>
          <div class="choices"></div>
        </div>
      </div>

      <div class="modal modal--result" hidden>
        <div class="modal__card"></div>
      </div>`;

    this.canvas = qs(this.root, '.battle__canvas');
    this.renderer = new Renderer(this.canvas);
    this.game = new Game({
      onLevelUp: (choices, level) => this.showLevelUp(choices, level),
      onBossSpawn: () => this.onBossSpawn(),
      onVictoryStart: () => this.onVictoryStart(),
      onEnd: (result) => this.finish(result),
      onKill: () => sfx.kill(),
      onPlayerHit: () => {
        sfx.hurt();
        haptics.hit();
      },
      onShoot: () => sfx.shoot(),
      onCoinCollect: () => sfx.coin(),
    });

    this.hudTimer = qs(this.root, '.hud__timer-value');
    this.hudWave = qs(this.root, '.chip--wave');
    this.hudGold = qs(this.root, '.chip--gold .chip__value');
    this.hpFill = qs(this.root, '.bar--hp .bar__fill');
    this.hpText = qs(this.root, '.bar--hp .bar__label');
    this.xpFill = qs(this.root, '.bar--xp .bar__fill');
    this.levelBadge = qs(this.root, '.bar--xp .bar__level');
    this.bossBar = qs(this.root, '.hud__boss');
    this.bossFill = qs(this.root, '.bar--boss .bar__fill');
    this.banner = qs(this.root, '.banner');
    this.levelModal = qs(this.root, '.modal--levelup');
    this.choiceHost = qs(this.root, '.choices');
    this.resultModal = qs(this.root, '.modal--result');

    onTap(qs(this.root, '.hud__quit'), () => this.quit());

    // Dev-only handle used by the balance harness in scripts/simulate.mjs.
    // Vite strips this branch entirely from production builds.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__battle = this;
      (window as unknown as Record<string, unknown>).__game = this.game;
      // Read by scripts/simulate.mjs's autopilot so it can steer around walls
      // and obstacles instead of measuring a pilot blind to geometry it can't see.
      (window as unknown as Record<string, unknown>).__OBSTACLES = OBSTACLES;
      (window as unknown as Record<string, unknown>).__WORLD = WORLD;
    }
    this.bindMovement();
    window.addEventListener('resize', () => this.layout());
    document.addEventListener('visibilitychange', () => {
      // Backgrounding must not fast-forward the simulation when we come back.
      if (document.hidden) this.accumulator = 0;
      this.lastFrame = performance.now();
    });
  }

  // ------------------------------------------------------------------- start

  start(): void {
    unlockAudio();
    music.enterBattle();
    this.active = true;
    this.root.hidden = false;
    this.resultModal.hidden = true;
    this.levelModal.hidden = true;
    this.bossBar.hidden = true;
    this.lastWave = -1;
    this.stickPointer = null;
    this.stick.active = false;
    this.hudCache = { hp: -1, maxHp: -1, xp: -1, level: -1, gold: -1, time: -1, wave: -1 };

    this.layout();
    this.game.start(allMetaMultipliers(), ownedEquipmentMap());

    this.showBanner('Wave 1', 'banner--wave');
    this.lastFrame = performance.now();
    this.accumulator = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  private layout(): void {
    if (!this.active) return;
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    this.renderer.resize(w, h);
    this.game.resize(w, h);
  }

  // ------------------------------------------------------------------- input

  /**
   * Floating virtual joystick, the Survivor.io convention: the stick is created
   * wherever the thumb lands rather than pinned to a corner, so the control never
   * fights the player's grip and both hands work equally well.
   */
  private bindMovement(): void {
    const local = (ev: PointerEvent): { x: number; y: number } => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    };

    this.canvas.addEventListener('pointerdown', (ev) => {
      if (this.stickPointer !== null) return;
      this.stickPointer = ev.pointerId;
      this.canvas.setPointerCapture(ev.pointerId);
      const p = local(ev);
      this.stick = { active: true, baseX: p.x, baseY: p.y, knobX: p.x, knobY: p.y };
    });

    this.canvas.addEventListener('pointermove', (ev) => {
      if (this.stickPointer !== ev.pointerId) return;
      const p = local(ev);
      let dx = p.x - this.stick.baseX;
      let dy = p.y - this.stick.baseY;
      const dist = Math.hypot(dx, dy);

      if (dist > JOYSTICK.maxTravel) {
        // Drag past the edge and the base follows the thumb, so a long swipe never
        // runs out of stick.
        const excess = dist - JOYSTICK.maxTravel;
        this.stick.baseX += (dx / dist) * excess;
        this.stick.baseY += (dy / dist) * excess;
        dx = (dx / dist) * JOYSTICK.maxTravel;
        dy = (dy / dist) * JOYSTICK.maxTravel;
      }

      this.stick.knobX = this.stick.baseX + dx;
      this.stick.knobY = this.stick.baseY + dy;

      if (Math.hypot(dx, dy) < JOYSTICK.deadZone) this.game.stopMove();
      else this.game.setMove(dx / JOYSTICK.maxTravel, dy / JOYSTICK.maxTravel);
    });

    const release = (ev: PointerEvent): void => {
      if (this.stickPointer !== ev.pointerId) return;
      this.stickPointer = null;
      this.stick.active = false;
      this.game.stopMove();
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);

    // Belt and suspenders against mobile pull-to-refresh / rubber-band scroll
    // while dragging the stick. `touch-action: none` on the canvas is supposed
    // to be enough on its own, but browsers are inconsistent about honouring it
    // — especially inside an iframe, which is exactly how the game is served
    // from an Artifact preview link — so drags could leak into the page's own
    // scroll and pull the browser chrome down mid-gesture. An explicit
    // non-passive touchmove listener is the standard, reliable fix for this
    // bug class; it must be `{ passive: false }` or preventDefault() is a
    // silent no-op. Scoped to an active drag only, so it never touches the
    // Upgrade/Shop screens' own scrolling.
    document.addEventListener(
      'touchmove',
      (ev) => {
        if (this.stickPointer !== null) ev.preventDefault();
      },
      { passive: false },
    );

    // Desktop testing. Harmless on device, and it makes `npm run dev` usable.
    const keys = new Set<string>();
    const applyKeys = (): void => {
      const x = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      const y = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
      if (x === 0 && y === 0) this.game.stopMove();
      else this.game.setMove(x, y);
    };
    window.addEventListener('keydown', (ev) => {
      if (!this.active) return;
      keys.add(ev.key.toLowerCase());
      applyKeys();
    });
    window.addEventListener('keyup', (ev) => {
      keys.delete(ev.key.toLowerCase());
      applyKeys();
    });
  }

  // -------------------------------------------------------------------- loop

  private readonly frame = (now: number): void => {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this.frame);

    const elapsed = Math.min((now - this.lastFrame) / 1000, 0.25);
    this.lastFrame = now;
    this.accumulator += elapsed;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
      this.game.update(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;

    this.renderer.render(this.game, now, this.stick);
    this.updateHud();
  };

  // --------------------------------------------------------------------- hud

  private updateHud(): void {
    const g = this.game;
    const cache = this.hudCache;

    const hpRatio = Math.max(0, g.hp / g.maxHp);
    // The bar's denominator changes when Reinforce is picked, so the label has to
    // track max HP as well as the ratio.
    if (Math.abs(hpRatio - cache.hp) > 0.001 || g.maxHp !== cache.maxHp) {
      cache.hp = hpRatio;
      cache.maxHp = g.maxHp;
      this.hpFill.style.transform = `scaleX(${hpRatio})`;
      this.hpText.textContent = `${Math.ceil(g.hp)} / ${Math.round(g.maxHp)}`;
      this.hpFill.classList.toggle('is-critical', hpRatio < 0.34);
    }

    const xpRatio = g.xpProgress();
    if (Math.abs(xpRatio - cache.xp) > 0.001) {
      cache.xp = xpRatio;
      this.xpFill.style.transform = `scaleX(${xpRatio})`;
    }

    if (g.level !== cache.level) {
      cache.level = g.level;
      this.levelBadge.textContent = g.level >= MAX_LEVEL ? 'MAX' : `Lv ${g.level}`;
    }

    const gold = Math.floor(g.gold);
    if (gold !== cache.gold) {
      cache.gold = gold;
      this.hudGold.textContent = formatGold(gold);
    }

    const remaining = Math.max(0, RUN_DURATION - g.elapsed);
    const shown = Math.ceil(remaining);
    if (shown !== cache.time || g.phase === 'victory') {
      cache.time = shown;
      this.hudTimer.textContent = g.phase === 'victory' ? 'GOLD!' : g.bossActive || g.bossKilled ? 'BOSS' : formatTime(remaining);
      this.hudTimer.classList.toggle('is-urgent', !g.bossActive && remaining <= 10);
    }

    const wave = Math.min(WAVES.length, Math.floor(g.elapsed / WAVE_SECONDS) + 1);
    if (wave !== cache.wave && !g.bossActive) {
      cache.wave = wave;
      this.hudWave.textContent = `Wave ${wave}`;
      if (this.lastWave !== -1 && wave !== this.lastWave) this.showBanner(`Wave ${wave}`, 'banner--wave');
      this.lastWave = wave;
    }

    const boss = g.boss;
    if (boss) {
      this.bossBar.hidden = false;
      this.bossFill.style.transform = `scaleX(${Math.max(0, boss.hp / boss.maxHp)})`;
    } else if (!this.bossBar.hidden) {
      this.bossBar.hidden = true;
    }
  }

  private showBanner(text: string, modifier: string): void {
    this.banner.textContent = text;
    this.banner.className = `banner ${modifier} is-visible`;
    window.setTimeout(() => this.banner.classList.remove('is-visible'), 1400);
  }

  private onBossSpawn(): void {
    sfx.boss();
    music.enterBoss();
    haptics.death();
    this.showBanner('BOSS INCOMING', 'banner--boss');
  }

  private onVictoryStart(): void {
    sfx.win();
    haptics.levelUp();
    this.showBanner('BOSS DOWN!', 'banner--win');
    qs(this.root, '.chip--gold').classList.add('is-counting');
  }

  // ---------------------------------------------------------------- level up

  private showLevelUp(choices: UpgradeChoice[], level: number): void {
    sfx.levelUp();
    haptics.levelUp();
    qs(this.levelModal, '.modal__eyebrow').textContent = `Level ${level}`;

    this.choiceHost.innerHTML = choices
      .map((c) => {
        const pips = `<div class="choice__pips">${Array.from(
          { length: c.maxPicks },
          (_, i) => `<i class="${i < c.picks ? 'on' : ''}"></i>`,
        ).join('')}</div>`;
        return `
          <button class="choice" type="button" data-id="${c.id}" style="--accent:${c.accent}">
            <span class="choice__icon" aria-hidden="true">${c.icon}</span>
            <span class="choice__text">
              <strong>${c.name}</strong>
              <em>${c.detail}</em>
            </span>
            ${pips}
          </button>`;
      })
      .join('');

    this.choiceHost.querySelectorAll<HTMLButtonElement>('.choice').forEach((btn) => {
      onTap(btn, () => {
        sfx.ui();
        haptics.tap();
        this.levelModal.hidden = true;
        this.game.applyChoice(btn.dataset.id as UpgradeChoice['id']);
        // A card can be open for a while; do not let the pause become a time jump.
        this.lastFrame = performance.now();
        this.accumulator = 0;
      });
    });

    this.levelModal.hidden = false;
  }

  // ------------------------------------------------------------------ ending

  get isActive(): boolean {
    return this.active;
  }

  /** Android hardware back button: leave the run, banking what was earned. */
  requestQuit(): void {
    if (!this.active) return;
    if (this.game.phase === 'ended') {
      this.stop();
      this.onExit(null);
      return;
    }
    this.quit();
  }

  private quit(): void {
    if (this.game.phase === 'ended') return;
    if (this.game.phase === 'victory') {
      // The boss is already dead by this point — backing out of the vacuum
      // early is not the same thing as losing. onEnd (wired to finish()) fires
      // synchronously, so there's nothing further to do here.
      this.game.skipVictory();
      return;
    }
    // Leaving early still banks the gold that was actually earned.
    this.finish({
      won: false,
      bossKilled: false,
      retreated: true,
      kills: this.game.kills,
      gold: Math.floor(this.game.gold),
      level: this.game.level,
      survivedSeconds: this.game.elapsed,
    });
    this.game.abandon();
  }

  private finish(result: RunResult): void {
    this.levelModal.hidden = true;
    qs(this.root, '.chip--gold').classList.remove('is-counting');
    music.enterMenu();

    // The drop is rolled before the gold from it (if any) is added to the
    // total the result screen banks, so "+400" for an all-gear run and the
    // banked total both already agree with each other.
    const drop = result.won && result.bossKilled ? rollBossDrop() : null;
    if (drop) applyBossDrop(drop);

    addGold(result.gold);
    recordRun({
      kills: result.kills,
      level: result.level,
      survivedSeconds: result.survivedSeconds,
      won: result.won,
    });
    if (result.won) {
      haptics.levelUp();
    } else {
      sfx.lose();
      haptics.death();
    }

    const gearHtml = drop
      ? drop.id
        ? `<div class="result__gear" style="--accent:${EQUIPMENT[drop.id].accent}">
             <span class="result__gear-icon" aria-hidden="true">${EQUIPMENT[drop.id].icon}</span>
             <span><strong>New gear:</strong> ${EQUIPMENT[drop.id].name}</span>
           </div>`
        : `<div class="result__gear">
             <span><strong>All gear owned</strong> — bonus +${formatGold(drop.bonusGold)} instead</span>
           </div>`
      : '';

    const card = qs(this.resultModal, '.modal__card');
    card.innerHTML = `
      <p class="result__eyebrow ${result.won ? 'is-win' : 'is-loss'}">${
        result.won ? 'Boss down' : result.retreated ? 'Gold secured' : 'You fell'
      }</p>
      <h2 class="result__title">${result.won ? 'Victory' : result.retreated ? 'Retreat' : 'Defeat'}</h2>
      <div class="result__grid">
        <div><span>Kills</span><strong>${result.kills}</strong></div>
        <div><span>Level</span><strong>${result.level}</strong></div>
        <div><span>Survived</span><strong>${formatTime(result.survivedSeconds)}</strong></div>
      </div>
      ${gearHtml}
      <div class="result__gold">
        <span class="coin coin--lg" aria-hidden="true"></span>
        <strong>+${formatGold(result.gold + (drop?.bonusGold ?? 0))}</strong>
        <em>banked · total ${formatGold(getProfile().gold)}</em>
      </div>
      <div class="result__actions">
        <button class="btn btn--ghost" type="button" data-action="home">Home</button>
        <button class="btn btn--primary" type="button" data-action="retry">Again</button>
      </div>`;

    card.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
      onTap(btn, () => {
        sfx.ui();
        if (btn.dataset.action === 'retry') {
          this.resultModal.hidden = true;
          this.start();
        } else {
          this.stop();
          this.onExit(result);
        }
      });
    });

    this.resultModal.hidden = false;
  }

  private stop(): void {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.root.hidden = true;
  }
}
