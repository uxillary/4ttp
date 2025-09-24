import Phaser from "phaser";
import { Boot } from "./scenes/Boot";
import { Game } from "./scenes/Game";
import { UI } from "./scenes/UI";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  pixelArt: true,
  backgroundColor: "#0b1220",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720
  },
  physics: {
    default: "arcade",
    arcade: { gravity: { x: 0, y: 0 }, debug: false }
  },
  scene: [Boot, Game, UI],
  parent: "app"
};

new Phaser.Game(config);
