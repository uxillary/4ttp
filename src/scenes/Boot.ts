import Phaser from "phaser";
import { TEXTURE_KEY } from "../core/factions";
import type { FactionId } from "../core/types";
import fireIconSvg from "../assets/icons/fire-thermal-protocol.svg?raw";
import waterIconSvg from "../assets/icons/water-liquid-node.svg?raw";
import earthIconSvg from "../assets/icons/earth-core-process.svg?raw";

const ICON_SVGS: Record<FactionId, string> = {
  Fire: fireIconSvg,
  Water: waterIconSvg,
  Earth: earthIconSvg,
};

export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.ensurePixelTexture();
    this.ensureSquareTexture();
    this.loadFactionIcons();
    this.createScanlineTexture();
    this.createUiTextures();
  }

  create(): void {
    this.applyIconFilters();
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

  private loadFactionIcons(): void {
    (Object.entries(ICON_SVGS) as Array<[FactionId, string]>).forEach(([id, rawSvg]) => {
      const key = TEXTURE_KEY[id];
      if (this.textures.exists(key)) {
        return;
      }
      const sanitized = this.sanitizeSvg(rawSvg);
      const blob = new Blob([sanitized], { type: 'image/svg+xml' });
      const objectUrl = URL.createObjectURL(blob);
      const handleComplete = (fileKey: string) => {
        if (fileKey === key) {
          URL.revokeObjectURL(objectUrl);
          this.load.off(Phaser.Loader.Events.FILE_COMPLETE, handleComplete);
        }
      };
      this.load.on(Phaser.Loader.Events.FILE_COMPLETE, handleComplete);
      this.load.svg(key, objectUrl);
    });
  }

  private applyIconFilters(): void {
    (Object.keys(ICON_SVGS) as FactionId[]).forEach((id) => {
      const key = TEXTURE_KEY[id];
      if (!this.textures.exists(key)) {
        return;
      }
      const texture = this.textures.get(key);
      texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    });
  }

  private sanitizeSvg(raw: string): string {
    return raw
      .replace(/currentColor/g, '#ffffff')
      .replace(/var\(--sw,\s*6\)/g, '6')
      .replace(/>\s+</g, '><')
      .replace(/\s{2,}/g, ' ')
      .trim();
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
