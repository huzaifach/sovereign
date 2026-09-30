import Phaser from 'phaser';

/** Loads all vendored assets, waits for the OFL display fonts, then boots the menu. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const label = this.add
      .text(w / 2, h / 2, 'Forging Aethermoor…', {
        fontFamily: '"Spectral", serif',
        fontSize: '22px',
        color: '#8f8a76',
      })
      .setOrigin(0.5);

    this.load.on('progress', (p: number) => {
      label.setText(`Forging Aethermoor… ${Math.round(p * 100)}%`);
    });

    // Kenney Particle Pack (CC0) — embers, glows, capture bursts.
    this.load.image('px-dot', 'assets/particles/circle_01.png');
    this.load.image('px-dot-soft', 'assets/particles/circle_03.png');
    this.load.image('px-magic', 'assets/particles/magic_01.png');
    this.load.image('px-magic2', 'assets/particles/magic_03.png');
    this.load.image('px-flare', 'assets/particles/flare_01.png');
    this.load.image('px-light', 'assets/particles/light_02.png');
    // Kenney UI Pack (CC0) — sovereign-gold buttons and icons.
    this.load.image('btn-rect', 'assets/ui/button_rectangle_depth_gradient.png');
    this.load.image('btn-rect-flat', 'assets/ui/button_rectangle_depth_flat.png');
    this.load.image('btn-sq', 'assets/ui/button_square_depth_gradient.png');
    this.load.image('btn-sq-flat', 'assets/ui/button_square_depth_flat.png');
    this.load.image('icon-play', 'assets/ui/icon_play_light.png');
  }

  create(): void {
    // The vendored OFL fonts must be ready before any Cinzel/Spectral text
    // renders, or Phaser caches fallback glyphs. 4s hard fallback.
    const need = [
      document.fonts.load('900 64px Cinzel'),
      document.fonts.load('700 32px Cinzel'),
      document.fonts.load('400 18px Spectral'),
      document.fonts.load('700 18px Spectral'),
    ];
    const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
    void Promise.race([Promise.all(need), timeout]).then(() => {
      this.scene.start('menu');
    });
  }
}
