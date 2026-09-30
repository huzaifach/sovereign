import Phaser from 'phaser';
import type { ScoreBreakdown } from '../game/engine';
import type { BotTier } from '../game/bots';
import { THEME_CSS } from '../game/theme';

export interface GameOverData {
  score: ScoreBreakdown;
  won: boolean;
  difficulty: BotTier;
}

/** Victory/defeat screen: score breakdown, restart, menu. */
export class GameOverScene extends Phaser.Scene {
  private result!: GameOverData;

  constructor() {
    super('gameover');
  }

  init(data: GameOverData): void {
    this.result = data;
  }

  create(): void {
    this.scale.on('resize', () => this.scene.restart());
    this.cameras.main.fadeIn(500, 7, 7, 13);
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;
    const { score, won } = this.result;

    this.add.particles(0, 0, won ? 'px-magic' : 'px-dot', {
      x: { min: 0, max: w },
      y: { min: 0, max: h },
      lifespan: 5000,
      speedY: { min: -24, max: -6 },
      scale: { min: 0.02, max: 0.07 },
      alpha: { start: 0.6, end: 0 },
      quantity: 1,
      frequency: 300,
      tint: won ? [0xd8b45a, 0xf5d67b] : [0x4a5578, 0x2b2f3d],
      blendMode: 'ADD',
    });

    const titleColor = won ? THEME_CSS.goldBright : '#ff6b7a';
    this.add
      .text(cx, h * 0.24, won ? 'VICTORY' : 'DEFEAT', {
        fontFamily: '"Cinzel", serif',
        fontSize: `${Math.min(84, w * 0.1)}px`,
        fontStyle: '900',
        color: titleColor,
      })
      .setOrigin(0.5);

    this.add
      .text(
        cx,
        h * 0.24 + 64,
        won ? 'The shattered world kneels.' : 'Your line has fallen. The bots feast.',
        {
          fontFamily: '"Spectral", serif',
          fontSize: '18px',
          fontStyle: 'italic',
          color: THEME_CSS.muted,
        },
      )
      .setOrigin(0.5);

    // Score breakdown.
    const mm = String(Math.floor(score.seconds / 60)).padStart(2, '0');
    const ss = String(score.seconds % 60).padStart(2, '0');
    const rows: [string, string][] = [
      ['Territories held', `${score.territories} × 100`],
      ['Commanders eliminated', `${score.eliminations} × 500`],
      ['Time bonus', `${score.timeBonus}`],
      ['Match time', `${mm}:${ss}`],
    ];
    rows.forEach(([k, v], i) => {
      const y = h * 0.44 + i * 34;
      this.add
        .text(cx - 190, y, k, {
          fontFamily: '"Spectral", serif',
          fontSize: '17px',
          color: THEME_CSS.muted,
        })
        .setOrigin(0, 0.5);
      this.add
        .text(cx + 190, y, v, {
          fontFamily: '"Spectral", serif',
          fontSize: '17px',
          fontStyle: '700',
          color: THEME_CSS.text,
        })
        .setOrigin(1, 0.5);
    });

    this.add
      .text(cx, h * 0.44 + rows.length * 34 + 18, `SCORE  ${score.total}`, {
        fontFamily: '"Cinzel", serif',
        fontSize: '34px',
        fontStyle: '900',
        color: THEME_CSS.goldBright,
      })
      .setOrigin(0.5);

    // Buttons.
    const mkButton = (y: number, label: string, primary: boolean, cb: () => void) => {
      const btn = this.add.container(cx, y);
      const bg = this.add
        .image(0, 0, primary ? 'btn-rect' : 'btn-rect-flat')
        .setDisplaySize(320, 64);
      const t = this.add
        .text(0, 0, label, {
          fontFamily: '"Cinzel", serif',
          fontSize: '20px',
          fontStyle: '700',
          color: '#1a1408',
        })
        .setOrigin(0.5);
      btn.add([bg, t]);
      btn.setSize(320, 64);
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => this.tweens.add({ targets: btn, scale: 1.05, duration: 120 }));
      btn.on('pointerout', () => this.tweens.add({ targets: btn, scale: 1, duration: 120 }));
      btn.on('pointerdown', cb);
    };

    const by = h * 0.44 + rows.length * 34 + 110;
    mkButton(by, 'PLAY AGAIN', true, () => {
      this.scene.start('game', { difficulty: this.result.difficulty });
    });
    mkButton(by + 84, 'RETURN TO MENU', false, () => {
      this.scene.start('menu');
    });
  }
}
