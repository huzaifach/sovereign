import Phaser from 'phaser';
import {
  NEUTRAL,
  computeScore,
  createGame,
  defaultConfig,
  hashSeed,
  issueSend,
  step,
  type DotState,
  type GameState,
  type OwnerId,
  type TerritoryState,
} from '../game/engine';
import { BOT_NAMES, BotController, type BotTier } from '../game/bots';
import { FIELD_H, FIELD_W } from '../game/map';
import { NEUTRAL_COLOR, THEME, ownerColor, ownerFill } from '../game/theme';

export interface GameSceneData {
  difficulty: BotTier;
}

const PLAYER_ID: OwnerId = 'player';
const GOLD_CSS = '#f5d67b';

interface BotEntry {
  id: OwnerId;
  ctl: BotController;
}

/** Bots per difficulty: Recruit is gentle (2 rivals), Sovereign is war (4). */
const BOT_COUNT: Record<BotTier, number> = {
  recruit: 2,
  veteran: 3,
  sovereign: 4,
};

/** The match: State.io-exact rules under the SOVEREIGN skin. */
export class GameScene extends Phaser.Scene {
  private difficulty: BotTier = 'recruit';
  private state!: GameState;
  private bots: BotEntry[] = [];

  private gfx!: Phaser.GameObjects.Graphics;
  private troopTexts: Record<string, Phaser.GameObjects.Text> = {};

  // Fixed camera: the whole field always fits on screen (like State.io).
  private view = { s: 10, ox: 0, oy: 0 };

  // Tap / drag state.
  private selectedId: string | null = null;
  private pressId: string | null = null;
  private pressOwn = false;
  private dragging = false;
  private downXY = { x: 0, y: 0 };
  private dragXY = { x: 0, y: 0 };
  private moved = false;
  private dragPreview!: Phaser.GameObjects.Text;

  // HUD refs.
  private hud!: Phaser.GameObjects.Container;
  private timerText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private ended = false;

  constructor() {
    super('game');
  }

  init(data: GameSceneData): void {
    this.difficulty = data.difficulty ?? 'recruit';
  }

  create(): void {
    this.cameras.main.fadeIn(400, 7, 7, 13);
    this.input.mouse?.disableContextMenu();
    this.scale.on('resize', () => this.onResize());

    this.buildMatch();
    this.buildBackdrop();
    this.layoutView();

    this.gfx = this.add.graphics().setDepth(10);
    this.buildTroopTexts();
    this.dragPreview = this.add
      .text(0, 0, '', {
        fontFamily: '"Cinzel", serif',
        fontSize: '20px',
        fontStyle: '700',
        color: GOLD_CSS,
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(25)
      .setVisible(false);
    this.buildHud();
    this.bindInput();
    this.bindHotkeys();
  }

  // --- match setup ----------------------------------------------------------

  private buildMatch(): void {
    const seed = hashSeed('match', Date.now(), Math.floor(Math.random() * 1e9));
    const config = defaultConfig(seed);
    const names = BOT_NAMES[this.difficulty];
    const nBots = BOT_COUNT[this.difficulty];
    const botIds = Array.from({ length: nBots }, (_, i) => `bot${i}`);
    const setups = [
      { id: PLAYER_ID, name: 'You', colorIdx: 0, isBot: false },
      ...botIds.map((id, i) => ({
        id,
        name: names[i % names.length],
        colorIdx: i + 1,
        isBot: true,
      })),
    ];
    this.state = createGame(config, setups, PLAYER_ID);
    this.bots = botIds.map((id, i) => ({
      id,
      ctl: new BotController(id, names[i % names.length], this.difficulty, seed),
    }));
  }

  private buildBackdrop(): void {
    // Starfield embers drifting behind the battlefield.
    this.add.particles(0, 0, 'px-dot-soft', {
      x: { min: 0, max: this.scale.width },
      y: { min: 0, max: this.scale.height },
      lifespan: 9000,
      speedY: { min: -12, max: -3 },
      speedX: { min: -4, max: 4 },
      scale: { min: 0.01, max: 0.05 },
      alpha: { start: 0.5, end: 0 },
      quantity: 1,
      frequency: 400,
      tint: [0xd8b45a, 0x4a5578, 0x7a5fd0],
      blendMode: 'ADD',
    }).setDepth(1);
  }

  // --- view -------------------------------------------------------------------

  private onResize(): void {
    this.layoutView();
    this.buildHud();
  }

  private layoutView(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const topBar = 64;
    this.view.s = Math.min(w / (FIELD_W + 4), (h - topBar - 8) / (FIELD_H + 4));
    this.view.ox = (w - FIELD_W * this.view.s) / 2;
    this.view.oy = topBar + (h - topBar - FIELD_H * this.view.s) / 2;
  }

  private toWorld(px: number, py: number): { x: number; y: number } {
    return {
      x: (px - this.view.ox) / this.view.s,
      y: (py - this.view.oy) / this.view.s,
    };
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: this.view.ox + x * this.view.s,
      y: this.view.oy + y * this.view.s,
    };
  }

  private circleAt(wx: number, wy: number): TerritoryState | null {
    for (const t of this.state.territories) {
      if (Math.hypot(t.x - wx, t.y - wy) <= t.r) return t;
    }
    return null;
  }

  // --- HUD --------------------------------------------------------------------

  private buildTroopTexts(): void {
    for (const t of this.state.territories) {
      const txt = this.add
        .text(0, 0, '', {
          fontFamily: '"Spectral", serif',
          fontSize: '18px',
          fontStyle: '700',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(20);
      this.troopTexts[t.id] = txt;
    }
  }

  private buildHud(): void {
    if (this.hud) this.hud.destroy(true);
    const w = this.scale.width;
    this.hud = this.add.container(0, 0).setDepth(100).setScrollFactor(0);

    const bar = this.add.rectangle(0, 0, w, 56, 0x0e0e1a, 0.88).setOrigin(0);
    const rule = this.add.rectangle(0, 56, w, 2, THEME.gold, 0.6).setOrigin(0);
    this.timerText = this.add
      .text(16, 28, '00:00', {
        fontFamily: '"Cinzel", serif',
        fontSize: '22px',
        fontStyle: '700',
        color: GOLD_CSS,
      })
      .setOrigin(0, 0.5);
    this.statsText = this.add
      .text(w / 2, 28, '', {
        fontFamily: '"Spectral", serif',
        fontSize: '16px',
        color: '#ece5cf',
      })
      .setOrigin(0.5);
    const menuBtn = this.add
      .text(w - 16, 28, 'MENU', {
        fontFamily: '"Cinzel", serif',
        fontSize: '15px',
        fontStyle: '700',
        color: '#8f8a76',
      })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true });
    menuBtn.on('pointerover', () => menuBtn.setColor(GOLD_CSS));
    menuBtn.on('pointerout', () => menuBtn.setColor('#8f8a76'));
    menuBtn.on('pointerdown', () => this.scene.start('menu'));

    const hint = this.add
      .text(
        w / 2,
        this.scale.height - 18,
        'Tap your circle, then tap a target — every troop marches. Conquer them all.',
        {
          fontFamily: '"Spectral", serif',
          fontSize: '14px',
          fontStyle: 'italic',
          color: '#8f8a76',
        },
      )
      .setOrigin(0.5);

    this.hud.add([bar, rule, this.timerText, this.statsText, menuBtn, hint]);
  }

  // --- input ------------------------------------------------------------------

  private bindInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const wpos = this.toWorld(p.x, p.y);
      const hit = this.circleAt(wpos.x, wpos.y);
      this.downXY = { x: p.x, y: p.y };
      this.dragXY = { x: p.x, y: p.y };
      this.moved = false;
      this.pressId = hit ? hit.id : null;
      this.pressOwn = !!hit && hit.owner === PLAYER_ID;
      this.dragging = this.pressOwn;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (Math.hypot(p.x - this.downXY.x, p.y - this.downXY.y) > 10) {
        this.moved = true;
      }
      if (this.dragging) this.dragXY = { x: p.x, y: p.y };
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const wasDragging = this.dragging;
      this.dragging = false;
      const wpos = this.toWorld(p.x, p.y);
      const up = this.circleAt(wpos.x, wpos.y);
      const upId = up ? up.id : null;

      if (wasDragging && this.pressOwn && this.pressId) {
        const from = this.pressId;
        this.pressId = null;
        this.pressOwn = false;
        if (this.moved && upId && upId !== from) {
          // Drag-release onto a target: march!
          issueSend(this.state, PLAYER_ID, from, upId);
          this.selectedId = null;
          return;
        }
        if (!this.moved && upId === from) {
          // Plain tap on own circle: toggle selection.
          this.selectedId = this.selectedId === from ? null : from;
          return;
        }
      }

      // Tap-to-send: a circle is selected, tap any other circle to attack it.
      if (!this.moved && this.selectedId && upId && upId !== this.selectedId) {
        issueSend(this.state, PLAYER_ID, this.selectedId, upId);
        this.selectedId = null;
        return;
      }
      // Tapping empty space (or the selected circle again) clears selection.
      if (!this.moved && (!upId || upId === this.selectedId)) {
        this.selectedId = null;
      }
      this.pressId = null;
      this.pressOwn = false;
    });
  }

  private bindHotkeys(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on('keydown-ESC', () => {
      this.selectedId = null;
      this.dragging = false;
    });
  }

  // --- per-frame --------------------------------------------------------------

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 100);
    step(this.state, dt);

    for (const b of this.bots) {
      b.ctl.update(this.state, (f, t) => issueSend(this.state, b.id, f, t));
    }

    this.drawWorld();
    this.syncTexts();
    this.updateHud();

    if (this.state.status !== 'running' && !this.ended) {
      this.ended = true;
      const score = computeScore(this.state, PLAYER_ID);
      this.time.delayedCall(1600, () => {
        this.scene.start('gameover', {
          score,
          won: this.state.status === 'won',
          difficulty: this.difficulty,
        });
      });
    }
  }

  private ownerColorIdx(owner: OwnerId): number {
    if (owner === NEUTRAL) return -1;
    const c = this.state.commanders.find((cc) => cc.id === owner);
    return c ? c.colorIdx : -1;
  }

  private drawWorld(): void {
    const g = this.gfx;
    g.clear();
    const { s } = this.view;
    const t = this.state.timeMs;
    const pulse = 0.55 + 0.45 * Math.sin(t / 130);

    for (const terr of this.state.territories) {
      const c = this.toScreen(terr.x, terr.y);
      const r = terr.r * s;
      const ci = this.ownerColorIdx(terr.owner);
      const fill = ci < 0 ? 0x141824 : ownerFill(ci);
      const stroke = ci < 0 ? NEUTRAL_COLOR : ownerColor(ci);

      // Body.
      g.fillStyle(fill, 1);
      g.fillCircle(c.x, c.y, r);
      // Ring — thicker + brighter for the player's circles.
      const isPlayer = terr.owner === PLAYER_ID;
      g.lineStyle(isPlayer ? 3.5 : 2.5, stroke, isPlayer ? 1 : 0.9);
      g.strokeCircle(c.x, c.y, r);

      // Under-attack pulse.
      if (terr.underAttackUntilMs > t) {
        g.lineStyle(3, THEME.danger, pulse);
        g.strokeCircle(c.x, c.y, r + 3);
      }

      // Selection ring.
      if (this.selectedId === terr.id) {
        g.lineStyle(3, THEME.goldBright, 0.65 + 0.35 * pulse);
        g.strokeCircle(c.x, c.y, r + 5);
      }
    }

    // Marching dots — one per troop, colored by owner.
    const dotR = Math.max(2, 0.32 * s);
    for (const d of this.state.dots as DotState[]) {
      const k =
        this.state.timeMs <= d.departMs
          ? 0
          : Math.min(
              1,
              (this.state.timeMs - d.departMs) /
                Math.max(1, d.arriveMs - d.departMs),
            );
      const a = this.toScreen(d.x0, d.y0);
      const b = this.toScreen(d.x1, d.y1);
      // Lateral offset, perpendicular to travel direction.
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const lx = -dy / len;
      const ly = dx / len;
      const off = d.lat * s * Math.sin(Math.PI * Math.min(1, k));
      const x = a.x + dx * k + lx * off;
      const y = a.y + dy * k + ly * off;
      const ci = this.ownerColorIdx(d.owner);
      g.fillStyle(ci < 0 ? 0x9aa0b5 : ownerColor(ci), 0.95);
      g.fillCircle(x, y, dotR);
    }

    // Drag arrow + troop preview.
    if (this.dragging && this.pressOwn && this.pressId && this.moved) {
      const from = this.state.terrById[this.pressId];
      if (from) {
        const a = this.toScreen(from.x, from.y);
        const bx = this.dragXY.x;
        const by = this.dragXY.y;
        g.lineStyle(3, THEME.goldBright, 0.9);
        g.lineBetween(a.x, a.y, bx, by);
        const ang = Math.atan2(by - a.y, bx - a.x);
        const ah = 12;
        g.lineBetween(bx, by, bx - ah * Math.cos(ang - 0.4), by - ah * Math.sin(ang - 0.4));
        g.lineBetween(bx, by, bx - ah * Math.cos(ang + 0.4), by - ah * Math.sin(ang + 0.4));
        this.dragPreview
          .setText(from.troops > 0 ? `-${from.troops}` : '')
          .setPosition((a.x + bx) / 2, (a.y + by) / 2 - 16)
          .setVisible(from.troops > 0);
      }
    } else {
      this.dragPreview.setVisible(false);
    }
  }

  private syncTexts(): void {
    const { s } = this.view;
    const fs = Math.max(12, Math.min(30, 2.6 * s));
    for (const terr of this.state.territories) {
      const txt = this.troopTexts[terr.id];
      if (!txt) continue;
      const c = this.toScreen(terr.x, terr.y);
      txt.setPosition(c.x, c.y);
      txt.setFontSize(fs);
      const label = `${terr.troops}`;
      if (txt.text !== label) txt.setText(label);
      const color = terr.owner === NEUTRAL ? '#9aa0b5' : '#ffffff';
      if (txt.style.color !== color) txt.setColor(color);
    }
  }

  private updateHud(): void {
    const secs = Math.floor(this.state.timeMs / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    this.timerText.setText(`${mm}:${ss}`);

    const mine = this.state.territories.filter((t) => t.owner === PLAYER_ID);
    const troops = mine.reduce((a, t) => a + t.troops, 0);
    const dotsOut = this.state.dots.filter((d) => d.owner === PLAYER_ID).length;
    this.statsText.setText(
      `YOU · ${mine.length}/${this.state.territories.length} lands · ${troops + dotsOut} troops`,
    );
  }
}
