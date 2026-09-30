import Phaser from 'phaser';
import {
  NEUTRAL,
  blitzConfig,
  computeScore,
  createGame,
  hashSeed,
  issueSend,
  mulberry32,
  sendAmount,
  step,
  type GameState,
  type OwnerId,
  type StreamState,
} from '../game/engine';
import { BOT_NAMES, BotController, type BotTier } from '../game/bots';
import { MAP_TEMPLATES, PANGAEA_START_IDS } from '../game/map';
import { centroid, pointInPolygon, territoryPolygon, type Vec } from '../game/shapes';
import { NEUTRAL_COLOR, THEME, ownerColor, ownerFill } from '../game/theme';
import {
  EDICTS,
  EDICT_ORDER,
  edictCooldownLeft,
  edictReady,
  maybeCastBotEdict,
  useEdict,
  type EdictType,
} from '../game/edicts';

export interface GameSceneData {
  difficulty: BotTier;
}

const PLAYER_ID: OwnerId = 'player';
const GOLD_CSS = '#f5d67b';

interface BotEntry {
  id: OwnerId;
  name: string;
  colorIdx: number;
  ctl: BotController;
}

interface EdictButton {
  type: EdictType;
  root: Phaser.GameObjects.Container;
  overlay: Phaser.GameObjects.Rectangle;
  cdText: Phaser.GameObjects.Text;
  bg: Phaser.GameObjects.Image;
}

/** The match: engine stepping, WebGL battlefield, drag input, HUD, edicts. */
export class GameScene extends Phaser.Scene {
  private difficulty: BotTier = 'recruit';
  private state!: GameState;
  private bots: BotEntry[] = [];
  private polys: Record<string, Vec[]> = {};
  private centers: Record<string, Vec> = {};
  private prevOwners: Record<string, OwnerId> = {};
  private seenEdicts = new Set<string>();

  private gfx!: Phaser.GameObjects.Graphics;
  private troopTexts: Record<string, Phaser.GameObjects.Text> = {};
  private streamSprites = new Map<number, Phaser.GameObjects.Image>();

  // Camera: manual world transform (zoom + pan), HUD stays in screen space.
  private baseS = 10;
  private view = { s: 10, ox: 0, oy: 0, zoom: 1 };
  private pan = { x: 0, y: 0 };

  // Drag-to-send state.
  private dragFrom: string | null = null;
  private dragging = false;
  private dragHalf = false;
  private dragPos: Vec = { x: 0, y: 0 };
  private dragPreview!: Phaser.GameObjects.Text;
  private selectedId: string | null = null;
  private downPos = { x: 0, y: 0 };
  private moved = false;
  private panning = false;
  private panStart = { x: 0, y: 0, px: 0, py: 0 };

  // Plague targeting mode.
  private plagueTargeting = false;

  // HUD refs.
  private hud!: Phaser.GameObjects.Container;
  private timerText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private edictButtons: EdictButton[] = [];
  private ended = false;
  private edictTickMs = 0;

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

    this.cameras.main.fadeIn(300, 7, 7, 13);
  }

  // --- match setup ----------------------------------------------------------

  private buildMatch(): void {
    const seed = hashSeed('match', Date.now(), Math.floor(Math.random() * 1e9));
    const config = blitzConfig(seed);
    const names = BOT_NAMES[this.difficulty];
    const starts = [...PANGAEA_START_IDS];
    // Deterministic shuffle so the player doesn't always start in one corner.
    const rng = mulberry32(hashSeed(seed, 'starts'));
    for (let i = starts.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [starts[i], starts[j]] = [starts[j], starts[i]];
    }
    const botIds = ['bot0', 'bot1', 'bot2'];
    this.state = createGame(
      'pangaea',
      config,
      [
        { id: PLAYER_ID, name: 'You', colorIdx: 0, isBot: false, tier: null },
        ...botIds.map((id, i) => ({
          id,
          name: names[i % names.length],
          colorIdx: i + 1,
          isBot: true,
          tier: this.difficulty as BotTier,
        })),
      ],
      starts,
      PLAYER_ID,
    );
    this.bots = botIds.map((id, i) => ({
      id,
      name: names[i % names.length],
      colorIdx: i + 1,
      ctl: new BotController(id, names[i % names.length], this.difficulty, seed),
    }));

    const map = MAP_TEMPLATES.pangaea;
    for (const node of map.nodes) {
      this.polys[node.id] = territoryPolygon(node);
      this.centers[node.id] = centroid(this.polys[node.id]);
      this.prevOwners[node.id] = this.state.terrById[node.id].owner;
    }
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

  // --- view transform ---------------------------------------------------------

  private onResize(): void {
    this.layoutView();
    this.buildHud(); // rebuild HUD at the new size
  }

  private layoutView(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.baseS = Math.min(w / 108, h / 70);
    this.view.s = this.baseS * this.view.zoom;
    this.view.ox = (w - 100 * this.view.s) / 2 + this.pan.x;
    this.view.oy = (h - 62.5 * this.view.s) / 2 + this.pan.y;
  }

  private toWorld(px: number, py: number): Vec {
    return { x: (px - this.view.ox) / this.view.s, y: (py - this.view.oy) / this.view.s };
  }

  private toScreen(w: Vec): Vec {
    return { x: this.view.ox + w.x * this.view.s, y: this.view.oy + w.y * this.view.s };
  }

  private territoryAt(w: Vec): string | null {
    for (const node of MAP_TEMPLATES.pangaea.nodes) {
      if (pointInPolygon(w, this.polys[node.id])) return node.id;
    }
    return null;
  }

  // --- HUD --------------------------------------------------------------------

  private buildTroopTexts(): void {
    for (const node of MAP_TEMPLATES.pangaea.nodes) {
      const t = this.add
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
      this.troopTexts[node.id] = t;
    }
  }

  private buildHud(): void {
    if (this.hud) this.hud.destroy(true);
    this.edictButtons = [];
    const w = this.scale.width;
    const h = this.scale.height;
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

    this.bannerText = this.add
      .text(w / 2, 84, '', {
        fontFamily: '"Cinzel", serif',
        fontSize: '17px',
        fontStyle: '700',
        color: GOLD_CSS,
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.hud.add([bar, rule, this.timerText, this.statsText, menuBtn, this.bannerText]);

    // Edict buttons — bottom center.
    EDICT_ORDER.forEach((type, i) => {
      const bx = w / 2 + (i - 1) * 116;
      const by = h - 66;
      const root = this.add.container(bx, by);
      const bg = this.add.image(0, 0, 'btn-sq').setDisplaySize(88, 88);
      const icon = this.add.graphics();
      this.drawEdictIcon(icon, type, 26);
      const keyHint = this.add
        .text(34, -34, `${i + 1}`, {
          fontFamily: '"Spectral", serif',
          fontSize: '12px',
          color: '#8f8a76',
        })
        .setOrigin(0.5);
      const name = this.add
        .text(0, 56, EDICTS[type].name.toUpperCase(), {
          fontFamily: '"Cinzel", serif',
          fontSize: '11px',
          fontStyle: '700',
          color: '#b8b09a',
        })
        .setOrigin(0.5, 0);
      const overlay = this.add.rectangle(0, 0, 88, 88, 0x000000, 0.72).setVisible(false);
      const cdText = this.add
        .text(0, 0, '', {
          fontFamily: '"Cinzel", serif',
          fontSize: '24px',
          fontStyle: '700',
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setVisible(false);
      root.add([bg, icon, keyHint, name, overlay, cdText]);
      root.setSize(88, 88);
      root.setInteractive({ useHandCursor: true });
      root.on('pointerdown', () => this.onEdictButton(type));
      this.hud.add(root);
      this.edictButtons.push({ type, root, overlay, cdText, bg });
    });
  }

  /** Vector icon per edict — sun, spore cluster, shield. */
  private drawEdictIcon(g: Phaser.GameObjects.Graphics, type: EdictType, r: number): void {
    const c = EDICTS[type].color;
    if (type === 'golden-age') {
      g.lineStyle(3, c, 1);
      g.strokeCircle(0, 0, r * 0.45);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.lineBetween(
          Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6,
          Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95,
        );
      }
    } else if (type === 'plague') {
      g.fillStyle(c, 1);
      g.fillCircle(-r * 0.3, -r * 0.15, r * 0.32);
      g.fillCircle(r * 0.32, -r * 0.05, r * 0.26);
      g.fillCircle(0, r * 0.38, r * 0.22);
      g.lineStyle(2, c, 0.6);
      g.strokeCircle(0, 0, r * 0.85);
    } else {
      // iron-wall: shield
      g.fillStyle(c, 0.25);
      g.lineStyle(3, c, 1);
      const pts = [
        { x: 0, y: -r * 0.9 }, { x: r * 0.75, y: -r * 0.45 },
        { x: r * 0.75, y: r * 0.25 }, { x: 0, y: r * 0.9 },
        { x: -r * 0.75, y: r * 0.25 }, { x: -r * 0.75, y: -r * 0.45 },
      ];
      g.fillPoints(pts, true);
      g.strokePoints(pts, true);
    }
  }

  private onEdictButton(type: EdictType): void {
    if (this.state.status !== 'running') return;
    if (!edictReady(this.state, PLAYER_ID, type)) return;
    if (type === 'plague') {
      this.plagueTargeting = true;
      this.announce('PLAGUE — choose a rival land', '#86efac');
    } else {
      if (useEdict(this.state, PLAYER_ID, type)) {
        this.announce(`${EDICTS[type].name.toUpperCase()} invoked — ${EDICTS[type].epithet}`, GOLD_CSS);
        this.burstAtPlayerCapital(EDICTS[type].color);
      }
    }
  }

  private castPlagueAt(targetId: string): void {
    if (useEdict(this.state, PLAYER_ID, 'plague', targetId)) {
      this.announce('PLAGUE unleashed — 1.5s to land', '#86efac');
    }
    this.plagueTargeting = false;
  }

  private burstAtPlayerCapital(tint: number): void {
    const caps = this.state.territories.filter(
      (t) => t.owner === PLAYER_ID && t.isCapital,
    );
    for (const c of caps) {
      const s = this.toScreen(this.centers[c.id]);
      const p = this.add.particles(s.x, s.y, 'px-magic', {
        speed: { min: 40, max: 160 },
        lifespan: 900,
        scale: { start: 0.12, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint,
        blendMode: 'ADD',
      });
      p.explode(26);
      this.time.delayedCall(1000, () => p.destroy());
    }
  }

  private announce(text: string, color: string): void {
    const t = this.add
      .text(this.scale.width / 2, 120, text, {
        fontFamily: '"Cinzel", serif',
        fontSize: '18px',
        fontStyle: '700',
        color,
        stroke: '#000000',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(120);
    this.tweens.add({
      targets: t,
      y: 80,
      alpha: 0,
      duration: 2200,
      ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  // --- input ------------------------------------------------------------------

  private bindInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.downPos = { x: p.x, y: p.y };
      this.moved = false;
      const wpos = this.toWorld(p.x, p.y);

      if (this.plagueTargeting) {
        const id = this.territoryAt(wpos);
        const t = id ? this.state.terrById[id] : null;
        if (t && t.owner !== PLAYER_ID && t.owner !== NEUTRAL) {
          this.castPlagueAt(id as string);
        } else {
          this.plagueTargeting = false; // clicked elsewhere — cancel
        }
        return;
      }

      const id = this.territoryAt(wpos);
      if (id && this.state.terrById[id].owner === PLAYER_ID) {
        this.dragFrom = id;
        this.dragging = true;
        this.dragPos = wpos;
      } else {
        // Empty space (or foreign land): begin pan.
        this.panning = true;
        this.panStart = { x: this.pan.x, y: this.pan.y, px: p.x, py: p.y };
      }
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (Math.hypot(p.x - this.downPos.x, p.y - this.downPos.y) > 8) this.moved = true;
      if (this.dragging) {
        this.dragPos = this.toWorld(p.x, p.y);
        this.dragHalf = this.isHalfSend(p);
      } else if (this.panning && p.isDown) {
        this.pan.x = this.panStart.x + (p.x - this.panStart.px);
        this.pan.y = this.panStart.y + (p.y - this.panStart.py);
        this.layoutView();
      }
      if (this.plagueTargeting) this.dragPos = this.toWorld(p.x, p.y);
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const wasDragging = this.dragging;
      const wasPanning = this.panning;
      this.dragging = false;
      this.panning = false;

      if (this.plagueTargeting) return; // handled on pointerdown

      const wpos = this.toWorld(p.x, p.y);
      const upId = this.territoryAt(wpos);

      if (wasDragging && this.dragFrom) {
        const from = this.dragFrom;
        this.dragFrom = null;
        if (upId && upId !== from && this.moved) {
          issueSend(this.state, PLAYER_ID, from, upId, this.isHalfSend(p) ? 0.5 : 1);
          this.selectedId = null;
        } else if (!this.moved && upId === from) {
          // Simple tap: toggle selection; a second tap elsewhere sends.
          this.selectedId = this.selectedId === from ? null : from;
        }
      } else if (wasPanning && !this.moved && this.selectedId && upId && upId !== this.selectedId) {
        // Tap-to-send via selection: tap own land, then tap a target.
        issueSend(this.state, PLAYER_ID, this.selectedId, upId, this.isHalfSend(p) ? 0.5 : 1);
        this.selectedId = null;
      } else if (!this.moved && !upId) {
        this.selectedId = null;
      }
    });

    this.input.on(
      'wheel',
      (
        p: Phaser.Input.Pointer,
        _objs: unknown,
        _dx: number,
        dy: number,
      ) => {
        const v = this.view;
        const wx = (p.x - v.ox) / v.s;
        const wy = (p.y - v.oy) / v.s;
        v.zoom = Math.min(3, Math.max(0.6, v.zoom * (dy > 0 ? 0.9 : 1.1)));
        v.s = this.baseS * v.zoom;
        v.ox = p.x - wx * v.s;
        v.oy = p.y - wy * v.s;
      },
    );
  }

  private isHalfSend(p: Phaser.Input.Pointer): boolean {
    if (p.rightButtonDown()) return true;
    const ev = p.event as MouseEvent | TouchEvent | undefined;
    if (ev && 'shiftKey' in ev && ev.shiftKey) return true;
    // Two-finger touch: a second finger down means "half".
    if (this.input.pointer2?.isDown) return true;
    return false;
  }

  private bindHotkeys(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on('keydown-ONE', () => this.onEdictButton('golden-age'));
    kb.on('keydown-TWO', () => this.onEdictButton('plague'));
    kb.on('keydown-THREE', () => this.onEdictButton('iron-wall'));
    kb.on('keydown-ESC', () => {
      this.plagueTargeting = false;
      this.dragging = false;
      this.dragFrom = null;
      this.selectedId = null;
    });
  }

  // --- per-frame --------------------------------------------------------------

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 100);
    step(this.state, dt);

    for (const b of this.bots) {
      b.ctl.update(this.state, (f, t, fr) => issueSend(this.state, b.id, f, t, fr));
    }
    this.edictTickMs += dt;
    if (this.edictTickMs >= 1000) {
      this.edictTickMs = 0;
      for (const b of this.bots) maybeCastBotEdict(this.state, b.id, this.difficulty);
      this.detectEdictCasts();
    }

    this.drawWorld();
    this.syncTexts();
    this.syncStreams();
    this.detectCaptures();
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

  private detectEdictCasts(): void {
    for (const e of this.state.edicts) {
      const k = `${e.owner}:${e.type}:${e.expiresMs}`;
      if (this.seenEdicts.has(k)) continue;
      this.seenEdicts.add(k);
      if (e.owner === PLAYER_ID) continue;
      const bot = this.bots.find((b) => b.id === e.owner);
      const name = bot ? bot.name : 'A rival';
      this.announce(`${name} invokes ${EDICTS[e.type].name.toUpperCase()}!`, '#ff9d6b');
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
    const { s, ox, oy } = this.view;
    const t = this.state.timeMs;
    const pulse = 0.55 + 0.45 * Math.sin(t / 130);

    // Selection: faint links to valid targets.
    if (this.selectedId) {
      const sc = this.centers[this.selectedId];
      g.lineStyle(1.5, THEME.gold, 0.4);
      for (const n of this.state.adj[this.selectedId]) {
        const nc = this.centers[n];
        g.lineBetween(ox + sc.x * s, oy + sc.y * s, ox + nc.x * s, oy + nc.y * s);
      }
    }

    for (const node of MAP_TEMPLATES.pangaea.nodes) {
      const ts = this.state.terrById[node.id];
      const pts = this.polys[node.id].map((p) => ({ x: ox + p.x * s, y: oy + p.y * s }));
      const ci = this.ownerColorIdx(ts.owner);
      const fill = ci < 0 ? 0x161a26 : ownerFill(ci);
      const stroke = ci < 0 ? NEUTRAL_COLOR : ownerColor(ci);

      g.fillStyle(fill, 1);
      g.fillPoints(pts, true);
      g.lineStyle(Math.max(1.5, 0.28 * s), stroke, 1);
      g.strokePoints(pts, true);

      // Edict auras — readable at a glance.
      const hasGold = this.state.edicts.some((e) => e.owner === ts.owner && e.type === 'golden-age');
      const hasWall = this.state.edicts.some((e) => e.owner === ts.owner && e.type === 'iron-wall');
      if (hasGold) {
        g.lineStyle(5, THEME.gold, 0.45 + 0.25 * pulse);
        g.strokePoints(pts, true);
      }
      if (hasWall) {
        g.lineStyle(4, THEME.wall, 0.7);
        g.strokePoints(pts, true);
      }

      // Under-attack pulse.
      if (ts.underAttackUntilMs > t) {
        g.lineStyle(3, THEME.danger, pulse);
        g.strokePoints(pts, true);
      }

      // Plague telegraph — 1.5s warning, green ring.
      const mark = this.state.plagueMarks[node.id];
      if (mark && mark > t) {
        g.lineStyle(4, THEME.plague, 0.5 + 0.5 * pulse);
        g.strokePoints(pts, true);
      }

      // Plague targeting highlight.
      if (this.plagueTargeting && ts.owner !== PLAYER_ID && ts.owner !== NEUTRAL) {
        g.lineStyle(3, THEME.plague, 0.4 + 0.4 * pulse);
        g.strokePoints(pts, true);
      }

      // Capital: gold diamond.
      if (ts.isCapital && ts.owner !== NEUTRAL) {
        const c = this.centers[node.id];
        const cx = ox + c.x * s;
        const cy = oy + (c.y - 3.4) * s;
        const r = Math.max(5, 0.55 * s);
        g.fillStyle(ownerColor(ci), 1);
        g.fillPoints(
          [
            { x: cx, y: cy - r },
            { x: cx + r * 0.7, y: cy },
            { x: cx, y: cy + r },
            { x: cx - r * 0.7, y: cy },
          ],
          true,
        );
      }
    }

    // Selection ring.
    if (this.selectedId) {
      const pts = this.polys[this.selectedId].map((p) => ({ x: ox + p.x * s, y: oy + p.y * s }));
      g.lineStyle(3, THEME.goldBright, 0.9);
      g.strokePoints(pts, true);
    }

    // Drag arrow with troop preview.
    if (this.dragging && this.dragFrom) {
      const from = this.state.terrById[this.dragFrom];
      const a = this.toScreen(this.centers[this.dragFrom]);
      const bp = { x: ox + this.dragPos.x * s, y: oy + this.dragPos.y * s };
      g.lineStyle(3, THEME.goldBright, 0.9);
      g.lineBetween(a.x, a.y, bp.x, bp.y);
      // Arrowhead.
      const ang = Math.atan2(bp.y - a.y, bp.x - a.x);
      const ah = 12;
      g.lineBetween(bp.x, bp.y, bp.x - ah * Math.cos(ang - 0.4), bp.y - ah * Math.sin(ang - 0.4));
      g.lineBetween(bp.x, bp.y, bp.x - ah * Math.cos(ang + 0.4), bp.y - ah * Math.sin(ang + 0.4));
      // Troop preview at the arrow midpoint.
      const preview = sendAmount(from.troops, this.dragHalf ? 0.5 : 1);
      this.dragPreview
        .setText(preview > 0 ? `-${preview}` : '')
        .setPosition((a.x + bp.x) / 2, (a.y + bp.y) / 2 - 14)
        .setVisible(preview > 0);
    } else {
      this.dragPreview.setVisible(false);
    }
  }

  private syncTexts(): void {
    const { s } = this.view;
    const fs = Math.max(12, Math.min(34, 3.1 * s));
    for (const node of MAP_TEMPLATES.pangaea.nodes) {
      const ts = this.state.terrById[node.id];
      const txt = this.troopTexts[node.id];
      const c = this.toScreen(this.centers[node.id]);
      txt.setPosition(c.x, c.y + (ts.isCapital ? 0.9 * s : 0));
      txt.setFontSize(fs);
      const label = `${ts.troops}`;
      if (txt.text !== label) txt.setText(label);
      const color = ts.owner === NEUTRAL ? '#9aa0b5' : '#ffffff';
      if (txt.style.color !== color) txt.setColor(color);
    }
  }

  private tintFor(owner: OwnerId): number {
    const ci = this.ownerColorIdx(owner);
    return ci < 0 ? 0x9aa0b5 : ownerColor(ci);
  }

  private syncStreams(): void {
    const seen = new Set<number>();
    const { s } = this.view;
    const dotScale = Math.max(0.012, (0.55 * s) / 512);
    for (const st of this.state.streams as StreamState[]) {
      seen.add(st.id);
      let img = this.streamSprites.get(st.id);
      if (!img) {
        img = this.add.image(0, 0, 'px-dot').setDepth(15).setBlendMode(Phaser.BlendModes.ADD);
        this.streamSprites.set(st.id, img);
      }
      const a = this.centers[st.from];
      const b = this.centers[st.to];
      const k = Math.min(1, Math.max(0, (this.state.timeMs - st.departMs) / Math.max(1, st.arriveMs - st.departMs)));
      const w = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      const scr = this.toScreen(w);
      img.setPosition(scr.x, scr.y).setScale(dotScale).setTint(this.tintFor(st.owner)).setAlpha(0.95);
    }
    for (const [id, img] of this.streamSprites) {
      if (!seen.has(id)) {
        img.destroy();
        this.streamSprites.delete(id);
      }
    }
  }

  private detectCaptures(): void {
    for (const node of MAP_TEMPLATES.pangaea.nodes) {
      const owner = this.state.terrById[node.id].owner;
      if (this.prevOwners[node.id] !== owner) {
        this.prevOwners[node.id] = owner;
        const scr = this.toScreen(this.centers[node.id]);
        const tint = this.tintFor(owner);
        const p = this.add.particles(scr.x, scr.y, 'px-magic', {
          speed: { min: 30, max: 150 },
          lifespan: 700,
          scale: { start: 0.1, end: 0 },
          alpha: { start: 0.9, end: 0 },
          tint,
          blendMode: 'ADD',
        });
        p.setDepth(30);
        p.explode(22);
        this.time.delayedCall(900, () => p.destroy());
      }
    }
  }

  private updateHud(): void {
    const secs = Math.floor(this.state.timeMs / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    this.timerText.setText(`${mm}:${ss}`);

    const mine = this.state.territories.filter((t) => t.owner === PLAYER_ID);
    const troops = mine.reduce((a, t) => a + t.troops, 0);
    const score = computeScore(this.state, PLAYER_ID).total;
    this.statsText.setText(
      `YOU · ${mine.length}/${this.state.territories.length} lands · ${troops} troops · ${score} pts`,
    );

    // Active edict banner.
    const active = this.state.edicts.find((e) => e.owner === PLAYER_ID);
    if (active) {
      const left = Math.ceil((active.expiresMs - this.state.timeMs) / 1000);
      this.bannerText
        .setText(`${EDICTS[active.type].name.toUpperCase()} · ${left}s`)
        .setColor(active.type === 'plague' ? '#86efac' : GOLD_CSS)
        .setVisible(true);
    } else {
      this.bannerText.setVisible(false);
    }

    // Edict buttons: cooldown overlays + dimming.
    const anyActive = this.state.edicts.some((e) => e.owner === PLAYER_ID);
    for (const b of this.edictButtons) {
      const left = edictCooldownLeft(this.state, PLAYER_ID, b.type);
      const ready = edictReady(this.state, PLAYER_ID, b.type);
      b.overlay.setVisible(left > 0);
      b.cdText.setVisible(left > 0);
      if (left > 0) b.cdText.setText(`${Math.ceil(left / 1000)}`);
      b.bg.setAlpha(anyActive && !this.state.edicts.some((e) => e.owner === PLAYER_ID && e.type === b.type) ? 0.45 : 1);
      b.root.setAlpha(ready || left > 0 ? 1 : 0.55);
    }
  }
}
