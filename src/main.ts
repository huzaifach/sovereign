// SOVEREIGN v2 — Phaser 3 + TypeScript + Vite.
// Pure game logic lives in src/game/* (engine, bots, map, theme)
// with zero Phaser dependency: deterministic and headless-testable.
// Phaser owns scenes, rendering, input, particles, and UI.

import Phaser from 'phaser';
import './ui/styles.css';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { GameOverScene } from './scenes/GameOverScene';
import { initDev } from './game/dev'; // DEV-ONLY: delete this import to remove dev tools
import { isDev } from './game/dev'; // DEV-ONLY: delete with the line above

const game = new Phaser.Game({
  type: Phaser.AUTO, // WebGL with automatic Canvas fallback
  parent: 'app',
  backgroundColor: '#07070d',
  scale: {
    mode: Phaser.Scale.RESIZE,
    parent: 'app',
    width: '100%',
    height: '100%',
  },
  render: {
    antialias: true,
    roundPixels: false,
  },
  scene: [BootScene, MenuScene, GameScene, GameOverScene],
}); // DEV-ONLY: end of game config

initDev(game); // DEV-ONLY: delete this line to remove dev tools

// DEV-ONLY: exposes the game for playtest inspection (window.__game)
if (isDev()) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}
