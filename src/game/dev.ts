// SOVEREIGN — in-game dev tools: debug/error panel + cheat-menu bubble.
//
// ============================ THE ONLY SWITCH ============================
//   const DEV_DEBUG = false   →  everything below is dead at runtime.
//                                No panel, no bubble, no listeners, no hooks.
//                                This is the SHIP state.
//   const DEV_DEBUG = true    →  tools always on.
//   ?debug=1  (URL param)     →  force ON for this page load (playtesting).
//   ?debug=0  (URL param)     →  force OFF.
// ===========================================================================
// REMOVAL (seconds): delete this file, then remove the 3 marked lines in
// src/main.ts (search for "DEV-ONLY"). Nothing else in the game references it.

import Phaser from 'phaser';
import { step, totalTroops, GameState } from './engine';
import type { BotTier } from './bots';

const DEV_DEBUG = false; // ←←← THE FLAG. Flip it. That's it.

// ---------------------------------------------------------------------------
// Flag + event bus (zero-cost when disabled)
// ---------------------------------------------------------------------------

let cachedFlag: boolean | null = null;

/** Single choke point: is any dev tooling active right now? */
export function isDev(): boolean {
  if (cachedFlag !== null) return cachedFlag;
  let on = DEV_DEBUG;
  try {
    const p = new URLSearchParams(window.location.search).get('debug');
    if (p === '1') on = true;
    if (p === '0') on = false;
  } catch {
    /* non-browser (tests) → flag only */
  }
  cachedFlag = on;
  return on;
}

export type DevTag = 'error' | 'scene' | 'match' | 'cheat' | 'watch' | 'dev';
export interface DevEvent {
  t: string;
  tag: DevTag;
  msg: string;
}

const MAX_EVENTS = 80;
const events: DevEvent[] = [];

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Append a dev event. No-op (single branch) when tools are off — safe to leave anywhere. */
export function devLog(tag: DevTag, msg: string): void {
  if (!isDev()) return;
  events.push({ t: stamp(), tag, msg });
  if (events.length > MAX_EVENTS) events.shift();
  // An actual error auto-opens the (hidden-by-default) panel so it is seen.
  if (tag === 'error') panelAutoOpen = true;
}

// Set when an error is logged; the overlay opens the panel on its next update.
let panelAutoOpen = false;

export function devEvents(): DevEvent[] {
  return events;
}

export function devClearEvents(): void {
  events.length = 0;
}

// ---------------------------------------------------------------------------
// Boot hook — called once from src/main.ts (DEV-ONLY lines)
// ---------------------------------------------------------------------------

/** Wire global error capture + mount the overlay scene. Does nothing when off. */
export function initDev(game: Phaser.Game): void {
  if (!isDev()) return;
  devLog('dev', 'debug tools enabled (DEV_DEBUG / ?debug=1)');
  window.addEventListener('error', (e) => {
    devLog('error', `${e.message} @ ${(e.filename || '?').split('/').pop()}:${e.lineno ?? '?'}`);
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: string } | null;
    devLog('error', `unhandled rejection: ${String((r && r.message) || r || 'unknown')}`);
  });
  // Mounted LAST → renders on top of every scene, updates after them.
  game.scene.add('dev', DevOverlay, true);
}

// ---------------------------------------------------------------------------
// Overlay scene: debug panel + cheat bubble. Exists only when isDev().
// ---------------------------------------------------------------------------

const GOLD = 0xd8b45a;
const INK = '#f5d67b';
const MUT = '#9aa3b2';
const ERR = '#ff6b6b';
const PANEL_BG = 0x0b0d14;

type GameSceneLike = { state: GameState };

class DevOverlay extends Phaser.Scene {
  private bar!: Phaser.GameObjects.Container;
  private barText!: Phaser.GameObjects.Text;
  private panel!: Phaser.GameObjects.Container;
  private panelOpen = false;
  private errText!: Phaser.GameObjects.Text;
  private evtText!: Phaser.GameObjects.Text;
  private stateText!: Phaser.GameObjects.Text;
  private bubble!: Phaser.GameObjects.Container;
  private cheats!: Phaser.GameObjects.Container;
  private cheatsOpen = false;
  private godMode = false;
  private godLabel!: Phaser.GameObjects.Text;
  private speed = 1;
  private speedLabel!: Phaser.GameObjects.Text;

  private lastT = 0;
  private lastFrameT = 0;
  private lastTimeMs = -1;
  private simStuckMs = 0;
  private simStuckLogged = false;
  private lastActiveKeys = '';
  private lastMatchStatus: string | null = null;
  private refreshAcc = 0;

  constructor() {
    super('dev');
  }

  create(): void {
    if (!isDev()) return; // belt & braces — scene is never added when off
    this.lastT = performance.now();
    this.lastFrameT = this.lastT;
    this.buildBar();
    this.buildPanel();
    this.buildBubble();
    this.buildCheats();
    this.layout();
    this.scale.on('resize', () => this.layout());

    // Freeze watchdog: setInterval survives rAF stalls, so a frozen tab gets
    // reported (with the last known state) as soon as the event loop breathes.
    window.setInterval(() => {
      const now = performance.now();
      const gap = now - this.lastFrameT;
      if (gap > 3000) {
        devLog(
          'watch',
          `LOOP STALLED ${(gap / 1000).toFixed(1)}s — no frame ran (tab frozen / rAF halted). Last known: ${this.summarize()}`,
        );
        this.lastFrameT = now; // re-arm; fires again if still stalled
      }
    }, 1000);
    devLog('dev', 'overlay ready — tap DEV bar for panel, ⚡ bubble for cheats');
  }

  // ----- scene/state access (read-only poke into the live game; dev only) ---

  private get gameScene(): GameSceneLike | null {
    if (!this.scene.isActive('game')) return null;
    const s = this.scene.get('game') as unknown as { state?: GameState } | null;
    return s && s.state ? (s as GameSceneLike) : null;
  }

  private activeKeys(): string {
    return ['boot', 'menu', 'game', 'gameover']
      .filter((k) => this.scene.isActive(k))
      .join(',');
  }

  private summarize(): string {
    const g = this.gameScene;
    if (!g) return 'no active match';
    const st = g.state;
    const lands = st.territories.filter((t) => t.owner === 'player').length;
    const troops = totalTroops(st, 'player');
    const bots = st.commanders.filter((c) => c.isBot && c.alive).length;
    const mm = String(Math.floor(st.timeMs / 60000)).padStart(2, '0');
    const ss = String(Math.floor(st.timeMs / 1000) % 60).padStart(2, '0');
    return `match ${mm}:${ss} · you ${lands}/${st.territories.length} lands ${troops} troops · dots ${st.dots.length} · bots ${bots} alive · ${st.status}`;
  }

  /** While any dev panel is open, the game canvas ignores pointer input. */
  private setGameInput(on: boolean): void {
    const s = this.scene.get('game') as unknown as { input?: { enabled: boolean } } | null;
    if (s && s.input) s.input.enabled = on;
  }

  private syncGameInput(): void {
    this.setGameInput(!(this.panelOpen || this.cheatsOpen));
  }

  // ----- UI builders ---------------------------------------------------------

  private button(
    parent: Phaser.GameObjects.Container,
    x: number,
    y: number,
    w: number,
    label: string,
    cb: () => void,
    fontSize = 13,
  ): { c: Phaser.GameObjects.Container; bg: Phaser.GameObjects.Rectangle; tx: Phaser.GameObjects.Text } {
    const h = 34;
    const bg = this.add.rectangle(0, 0, w, h, 0x141824, 0.97).setStrokeStyle(1, GOLD, 0.75);
    const tx = this.add
      .text(0, 1, label, { fontFamily: 'monospace', fontSize: `${fontSize}px`, color: INK })
      .setOrigin(0.5);
    const c = this.add.container(x, y, [bg, tx]);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0x2a3040, 0.98));
    bg.on('pointerout', () => bg.setFillStyle(0x141824, 0.97));
    bg.on('pointerdown', () => cb());
    parent.add(c);
    return { c, bg, tx };
  }

  private buildBar(): void {
    // NOTE: the bar lives in a Container (like the bubble) — interactive shapes
    // parented directly to this overlay scene did not receive pointer events in
    // testing, while container children do. Only the bg rect is interactive: the
    // label overlaps it, and two handlers would fire pointerdown twice.
    const bw = 176;
    const bg = this.add.rectangle(0, 0, bw, 26, PANEL_BG, 0.88).setStrokeStyle(1, GOLD, 0.9);
    this.barText = this.add
      .text(-bw / 2 + 8, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: INK })
      .setOrigin(0, 0.5);
    this.bar = this.add.container(0, 0, [bg, this.barText]);
    // setInteractive AFTER the container exists (same order as the working bubble)
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerdown', () => this.togglePanel());
  }

  private buildPanel(): void {
    const W = 500;
    const H = 372;
    const bg = this.add.rectangle(0, 0, W, H, PANEL_BG, 0.94).setStrokeStyle(1, GOLD, 0.9).setOrigin(0);
    const title = this.add
      .text(12, 8, 'DEBUG PANEL', { fontFamily: 'monospace', fontSize: '13px', color: INK })
      .setOrigin(0);
    this.panel = this.add.container(0, 0, [bg, title]);
    this.button(this.panel, W - 46, 22, 76, 'clear', () => devClearEvents(), 11);
    this.button(this.panel, W - 128, 22, 76, 'close', () => this.togglePanel(), 11);

    const sec = (y: number, label: string, color: string) => {
      this.panel.add(
        this.add.text(12, y, label, { fontFamily: 'monospace', fontSize: '11px', color }).setOrigin(0),
      );
    };
    sec(44, 'ERRORS / WATCHDOG', ERR);
    this.errText = this.add
      .text(12, 62, '—', { fontFamily: 'monospace', fontSize: '11px', color: ERR, lineSpacing: 3 })
      .setOrigin(0);
    sec(142, 'EVENTS', MUT);
    this.evtText = this.add
      .text(12, 160, '—', { fontFamily: 'monospace', fontSize: '11px', color: MUT, lineSpacing: 3 })
      .setOrigin(0);
    sec(272, 'STATE', INK);
    this.stateText = this.add
      .text(12, 290, '—', { fontFamily: 'monospace', fontSize: '11px', color: '#e8ecf4', lineSpacing: 3 })
      .setOrigin(0);
    this.panel.add([this.errText, this.evtText, this.stateText]);
    this.panel.setVisible(false);
  }

  private buildBubble(): void {
    const r = 30;
    const ring = this.add.circle(0, 0, r, 0x0b0d14, 0.92).setStrokeStyle(2, GOLD, 1);
    const tx = this.add
      .text(0, 1, '⚡', { fontFamily: 'monospace', fontSize: '22px', color: INK })
      .setOrigin(0.5);
    this.bubble = this.add.container(0, 0, [ring, tx]);
    ring.setInteractive({ useHandCursor: true });
    ring.on('pointerdown', () => this.toggleCheats());
  }

  private buildCheats(): void {
    const W = 300;
    const rows = 9;
    const H = 56 + rows * 42;
    const bg = this.add.rectangle(0, 0, W, H, PANEL_BG, 0.96).setStrokeStyle(1, GOLD, 0.9).setOrigin(0);
    const title = this.add
      .text(12, 10, 'CHEAT MENU', { fontFamily: 'monospace', fontSize: '13px', color: INK })
      .setOrigin(0);
    this.cheats = this.add.container(0, 0, [bg, title]);

    let y = 56;
    const row = (label: string, cb: () => void): { tx: Phaser.GameObjects.Text } => {
      const b = this.button(this.cheats, W / 2, y, W - 24, label, () => {
        if (!this.gameScene && label !== '🗑 reset progress' && label !== '✕ close') {
          devLog('cheat', 'no active match — start one first');
          return;
        }
        cb();
      });
      y += 42;
      return { tx: b.tx };
    };
    row('⚡ victory now', () => this.forceEnd(true));
    row('💀 defeat now', () => this.forceEnd(false));
    const god = row('♾ god mode: OFF', () => {
      this.godMode = !this.godMode;
      this.godLabel.setText(`♾ god mode: ${this.godMode ? 'ON' : 'OFF'}`);
      devLog('cheat', `god mode ${this.godMode ? 'ON' : 'OFF'}`);
    });
    this.godLabel = god.tx;
    row('➕ +50 troops', () => {
      const g = this.gameScene;
      if (!g) return;
      for (const t of g.state.territories) {
        if (t.owner === 'player') t.troops = Math.min(99, t.troops + 50);
      }
      devLog('cheat', '+50 troops to all your lands');
    });
    const spd = row('🎮 speed: 1x', () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
      this.speedLabel.setText(`🎮 speed: ${this.speed}x`);
      devLog('cheat', `game speed ${this.speed}x`);
    });
    this.speedLabel = spd.tx;
    row('👑 play sovereign', () => this.restartMatch('sovereign'));
    row('🔓 unlock all', () => {
      // This build has no locked modes/templates — every difficulty is already
      // selectable. The flag records the unlock; the log says so truthfully.
      try {
        localStorage.setItem('sovereign.dev.unlocked', '1');
      } catch { /* private mode */ }
      devLog('cheat', 'unlock all: every difficulty/mode in this build is already available');
    });
    row('🗑 reset progress', () => this.resetProgress());
    row('✕ close', () => this.toggleCheats());
    this.cheats.setVisible(false);
  }

  private layout(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    this.bar.setPosition(12 + 88, 16);
    this.panel.setPosition(12, 46);
    this.bubble.setPosition(W - 48, H - 48);
    this.cheats.setPosition(W - 324, H - 48 - 434);
  }

  // ----- panel / cheats toggling ----------------------------------------------

  private togglePanel(): void {
    this.panelOpen = !this.panelOpen;
    this.panel.setVisible(this.panelOpen);
    this.barText.setText(this.panelOpen ? 'DEV ▾' : 'DEV ▸');
    this.syncGameInput();
    if (this.panelOpen) this.refresh();
  }

  private toggleCheats(): void {
    this.cheatsOpen = !this.cheatsOpen;
    this.cheats.setVisible(this.cheatsOpen);
    this.syncGameInput();
  }

  // ----- cheats ----------------------------------------------------------------

  /** Force the match outcome through the real engine path (no fake state). */
  private forceEnd(win: boolean): void {
    const g = this.gameScene;
    if (!g || g.state.status !== 'running') return;
    for (const c of g.state.commanders) {
      if (win && c.isBot) c.alive = false;
      if (!win && !c.isBot) c.alive = false;
    }
    devLog('cheat', win ? 'forced VICTORY (bots eliminated)' : 'forced DEFEAT (player eliminated)');
  }

  private restartMatch(difficulty: BotTier): void {
    if (this.scene.isActive('gameover')) this.scene.stop('gameover');
    if (this.scene.isActive('game')) {
      const gs = this.scene.get('game');
      gs.scene.restart({ difficulty });
    } else {
      this.scene.launch('game', { difficulty });
    }
    this.setGameInput(true);
    devLog('cheat', `match restarted on ${difficulty}`);
  }

  private resetProgress(): void {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('sovereign')) localStorage.removeItem(k);
      }
    } catch {
      /* storage unavailable — nothing to clear */
    }
    if (this.scene.isActive('game')) this.scene.stop('game');
    if (this.scene.isActive('gameover')) this.scene.stop('gameover');
    if (!this.scene.isActive('menu')) this.scene.launch('menu');
    this.setGameInput(true);
    devLog('cheat', 'progress reset → menu');
  }

  // ----- per-frame: cheats application + stall detection + UI refresh -----------

  update(): void {
    const now = performance.now();
    const dt = now - this.lastT;
    this.lastT = now;
    this.lastFrameT = now; // heartbeat — the watchdog interval reads this
    if (!isDev()) return;

    // Error auto-open: the panel stays hidden during clean play; an error pops it.
    if (panelAutoOpen && !this.panelOpen) {
      panelAutoOpen = false;
      this.togglePanel();
    }

    // Scene-transition events (no hooks inside game scenes needed).
    const keys = this.activeKeys();
    if (keys !== this.lastActiveKeys) {
      devLog('scene', `active scenes → ${keys || '(none)'}`);
      this.lastActiveKeys = keys;
    }

    const g = this.gameScene;

    // Match-outcome events: log running → won / running → lost explicitly.
    const st = g ? g.state.status : null;
    if (st !== this.lastMatchStatus) {
      if (this.lastMatchStatus === 'running' && (st === 'won' || st === 'lost')) {
        const w = g && g.state.winnerId ? ` winner=${g.state.winnerId}` : '';
        devLog('match', `match ${this.lastMatchStatus} → ${st}${w}`);
      }
      this.lastMatchStatus = st;
    }

    // God mode: infinite troops — every player land pinned at 99 (the max) and
    // the player commander kept alive. Applied after the game scene's own
    // update (this overlay is the last scene), so elimination is impossible
    // while enabled.
    if (this.godMode && g && g.state.status === 'running') {
      for (const t of g.state.territories) {
        if (t.owner === 'player') t.troops = Math.max(t.troops, 99);
      }
      const player = g.state.commanders.find((c) => c.id === g.state.playerId);
      if (player) player.alive = true;
    }

    // Speed: run the real fixed-step sim extra times with the same dt.
    if (this.speed > 1 && g && g.state.status === 'running') {
      const sdt = Math.min(dt, 100);
      for (let i = 1; i < this.speed; i++) step(g.state, sdt);
    }

    // Sim-stall detection: rendering alive but the sim clock not advancing.
    if (g && g.state.status === 'running') {
      if (g.state.timeMs === this.lastTimeMs) {
        this.simStuckMs += dt;
        if (this.simStuckMs > 5000 && !this.simStuckLogged) {
          this.simStuckLogged = true;
          devLog(
            'watch',
            `SIM STALLED: timeMs frozen at ${g.state.timeMs} for 5s — step() not advancing. ` +
              `Dots in flight: ${g.state.dots.length}. ${this.summarize()}`,
          );
        }
      } else {
        this.lastTimeMs = g.state.timeMs;
        this.simStuckMs = 0;
        this.simStuckLogged = false;
      }
    } else {
      this.simStuckMs = 0;
      this.simStuckLogged = false;
    }

    // Throttled UI refresh (~2Hz) — the panel is cheap, but no need for 60fps.
    this.refreshAcc += dt;
    if (this.refreshAcc > 500) {
      this.refreshAcc = 0;
      this.refresh();
    }
  }

  private refresh(): void {
    const keys = this.activeKeys();
    const g = this.gameScene;
    const errs = events.filter((e) => e.tag === 'error' || e.tag === 'watch').slice(-3);
    const evts = events.filter((e) => e.tag !== 'error' && e.tag !== 'watch').slice(-7);
    const short = (s: string) => (s.length > 62 ? s.slice(0, 61) + '…' : s);

    this.barText.setText(
      `${this.panelOpen ? 'DEV ▾' : 'DEV ▸'} ${errs.length ? '🔴' : '🟢'} ${keys.replace(/,/g, '+') || '—'}`,
    );
    if (!this.panelOpen) return;

    this.errText.setText(
      errs.length ? errs.map((e) => `[${e.t}] ${short(e.msg)}`).join('\n') : '— none —',
    );
    this.evtText.setText(
      evts.length
        ? evts.map((e) => `[${e.t}] ${e.tag}: ${short(e.msg)}`).join('\n')
        : '— no events yet —',
    );
    const stall =
      this.simStuckMs > 2000 && g
        ? `\n⚠ sim clock unchanged for ${(this.simStuckMs / 1000).toFixed(0)}s`
        : '';
    this.stateText.setText(
      `scenes: ${keys || '(none)'}\n${this.summarize()}\ngod:${this.godMode ? 'ON' : 'off'} speed:${this.speed}x${stall}`,
    );
  }
}
