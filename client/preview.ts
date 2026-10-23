import Phaser from 'phaser';
import { MapPreviewScene } from './scenes/MapPreviewScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0e1110',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [MapPreviewScene],
});
