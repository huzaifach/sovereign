import Phaser from 'phaser';
import type { BotTier } from '../game/bots';
import { THEME_CSS } from '../game/theme';

const DIFFICULTIES: BotTier[] = ['recruit', 'veteran', 'sovereign'];

const BLURBS: Record<BotTier, string> = {
  recruit: 'Learn the ropes — the Eager Lieutenant blunders.',
  veteran: 'The real game — the Warden never misses.',
  sovereign: 'The wall — the Namesake shows no mercy.',
};

/** Title screen: grand obsidian-and-gold menu with difficulty select. */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super('menu');
  }

  create(): void {
    // A fresh menu has no state, so a resize can simply rebuild the layout.
    this.scale.on('resize', () => this.scene.restart());
    this.cameras.main.fadeIn(500, 7, 7, 13);

    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;

    // Drifting embers over the void.
    this.add.particles(0, 0, 'px-dot', {
      x: { min: 0, max: w },
      y: { min: h * 0.4, max: h },
      lifespan: 6000,
      speedY: { min: -30, max: -8 },
      speedX: { min: -6, max: 6 },
      scale: { min: 0.008, max: 0.03 },
      alpha: { start: 0.7, end: 0 },
      quantity: 1,
      frequency: 220,
      tint: [0xd8b45a, 0xb03a4b, 0x7a5fd0],
      blendMode: 'ADD',
    });

    // Thin gold rules framing the title block.
    const rule = this.add.graphics();
    const ruleY = h * 0.2;
    rule.lineStyle(1, 0xd8b45a, 0.5);
    rule.lineBetween(cx - 260, ruleY, cx + 260, ruleY);
    rule.lineBetween(cx - 260, ruleY + 190, cx + 260, ruleY + 190);

    this.add
      .text(cx, ruleY + 70, 'SOVEREIGN', {
        fontFamily: '"Cinzel", serif',
        fontSize: `${Math.min(96, w * 0.11)}px`,
        fontStyle: '900',
        color: THEME_CSS.goldBright,
      })
      .setOrigin(0.5);

    this.add
      .text(cx, ruleY + 130, 'Conquer the shattered world of Aethermoor', {
        fontFamily: '"Spectral", serif',
        fontSize: '20px',
        color: THEME_CSS.muted,
        fontStyle: 'italic',
      })
      .setOrigin(0.5);

    // Difficulty buttons.
    const by = h * 0.52;
    DIFFICULTIES.forEach((tier, i) => {
      const y = by + i * 108;
      const btn = this.add.container(cx, y);

      const bg = this.add.image(0, 0, 'btn-rect').setDisplaySize(360, 72);
      const stars = '★'.repeat(i + 1) + '☆'.repeat(2 - i);
      const title = this.add
        .text(0, -12, `${tier.toUpperCase()}  ${stars}`, {
          fontFamily: '"Cinzel", serif',
          fontSize: '24px',
          fontStyle: '700',
          color: '#1a1408',
        })
        .setOrigin(0.5);
      const sub = this.add
        .text(0, 16, BLURBS[tier], {
          fontFamily: '"Spectral", serif',
          fontSize: '14px',
          color: '#3d2f12',
        })
        .setOrigin(0.5);
      btn.add([bg, title, sub]);
      btn.setSize(360, 72);
      btn.setInteractive({ useHandCursor: true });

      btn.on('pointerover', () => {
        bg.setDisplaySize(376, 76);
        this.tweens.add({ targets: btn, scale: 1.04, duration: 120 });
      });
      btn.on('pointerout', () => {
        bg.setDisplaySize(360, 72);
        this.tweens.add({ targets: btn, scale: 1, duration: 120 });
      });
      btn.on('pointerdown', () => {
        this.cameras.main.fadeOut(250, 7, 7, 13);
        this.cameras.main.once('camerafadeoutcomplete', () => {
          this.scene.start('game', { difficulty: tier });
        });
      });

      // Staggered entrance.
      btn.setAlpha(0);
      btn.setY(y + 24);
      this.tweens.add({
        targets: btn,
        alpha: 1,
        y,
        duration: 450,
        delay: 200 + i * 140,
        ease: 'Cubic.easeOut',
      });
    });

    this.add
      .text(cx, h - 64, 'Tap your circle, then tap any target — every troop marches. Conquer them all.', {
        fontFamily: '"Spectral", serif',
        fontSize: '16px',
        color: THEME_CSS.muted,
      })
      .setOrigin(0.5);

    this.add
      .text(cx, h - 36, 'Bots + Global Leaderboards · v2 prototype', {
        fontFamily: '"Spectral", serif',
        fontSize: '13px',
        color: '#5a5546',
      })
      .setOrigin(0.5);
  }
}
