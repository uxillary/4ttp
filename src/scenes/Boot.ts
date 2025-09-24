import Phaser from "phaser";
import { ENTITY_SIZE } from "../core/constants";
import { FACTIONS, TEXTURE_KEY } from "../core/factions";
import type { FactionId } from "../core/types";

export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.ensurePixelTexture();
    this.ensureSquareTexture();
    this.createFactionTextures();
    this.createScanlineTexture();
    this.createUiTextures();
  }

  create(): void {
    this.scene.launch('UI');
    this.scene.start('Game');
  }

  private ensurePixelTexture(): void {
    if (this.textures.exists('dot')) return;
    const canvas = this.textures.createCanvas('dot', 1, 1);
    if (!canvas) return;
    canvas.context.fillStyle = '#ffffff';
    canvas.context.fillRect(0, 0, 1, 1);
    canvas.refresh();
  }

  private ensureSquareTexture(): void {
    if (this.textures.exists('square8')) return;
    const canvas = this.textures.createCanvas('square8', 8, 8);
    if (!canvas) return;
    canvas.context.fillStyle = '#ffffff';
    canvas.context.fillRect(0, 0, 8, 8);
    canvas.refresh();
  }

  private createFactionTextures(): void {
    const graphics = this.add.graphics();
    graphics.setVisible(false);
    const size = ENTITY_SIZE * 2.6;
    const half = size / 2;

    const drawGlow = (radius: number) => {
      graphics.fillStyle(0xffffff, 0.12);
      graphics.fillCircle(half, half, radius * 1.8);
      graphics.fillStyle(0xffffff, 0.22);
      graphics.fillCircle(half, half, radius * 1.3);
    };

    const drawTriangle = () => {
      const radius = ENTITY_SIZE * 0.7;
      drawGlow(radius);
      graphics.fillStyle(0xffffff, 1);
      graphics.fillTriangle(
        half,
        half - radius,
        half - radius,
        half + radius,
        half + radius,
        half + radius,
      );
    };

    const drawCircle = () => {
      const radius = ENTITY_SIZE * 0.8;
      drawGlow(radius);
      graphics.fillStyle(0xffffff, 1);
      graphics.fillCircle(half, half, radius);
      graphics.lineStyle(2, 0xffffff, 0.35);
      graphics.strokeCircle(half, half, radius * 1.1);
    };

    const drawHex = () => {
      const radius = ENTITY_SIZE * 0.82;
      drawGlow(radius);
      graphics.fillStyle(0xffffff, 1);
      const points: Phaser.Math.Vector2[] = [];
      for (let i = 0; i < 6; i += 1) {
        const angle = Phaser.Math.DegToRad(60 * i - 30);
        points.push(new Phaser.Math.Vector2(half + Math.cos(angle) * radius, half + Math.sin(angle) * radius));
      }
      graphics.fillPoints(points, true);
    };

    const drawLookup: Record<FactionId, () => void> = {
      Fire: drawTriangle,
      Water: drawCircle,
      Earth: drawHex,
    };

    FACTIONS.forEach((id) => {
      if (this.textures.exists(TEXTURE_KEY[id])) return;
      graphics.clear();
      drawLookup[id]!();
      graphics.generateTexture(TEXTURE_KEY[id], size, size);
    });

    graphics.destroy();
  }

  private createScanlineTexture(): void {
    if (this.textures.exists('overlay-scanline')) return;
    const g = this.add.graphics();
    g.setVisible(false);
    g.fillStyle(0xffffff, 0.08);
    g.fillRect(0, 0, 2, 1);
    g.generateTexture('overlay-scanline', 2, 2);
    g.destroy();
  }

  private createUiTextures(): void {
    if (this.textures.exists('ui-key')) return;
    const graphics = this.add.graphics();
    graphics.setVisible(false);
    const width = 112;
    const height = 48;
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRoundedRect(0, 0, width, height, 14);
    graphics.lineStyle(2, 0xffffff, 0.6);
    graphics.strokeRoundedRect(0, 0, width, height, 14);
    graphics.generateTexture('ui-key', width, height);
    graphics.destroy();
  }
}
