import Phaser from "phaser";

export class Boot extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload(): void {
    this.ensurePixelTexture();
    this.ensureSquareTexture();
  }

  create(): void {
    this.scene.start("Game");
    this.scene.launch("UI");
  }

  private ensurePixelTexture(): void {
    if (this.textures.exists("dot")) return;
    const canvas = this.textures.createCanvas("dot", 1, 1);
    if (!canvas) return;
    canvas.context.fillStyle = "#ffffff";
    canvas.context.fillRect(0, 0, 1, 1);
    canvas.refresh();
  }

  private ensureSquareTexture(): void {
    if (this.textures.exists("square8")) return;
    const canvas = this.textures.createCanvas("square8", 8, 8);
    if (!canvas) return;
    canvas.context.fillStyle = "#ffffff";
    canvas.context.fillRect(0, 0, 8, 8);
    canvas.refresh();
  }
}
