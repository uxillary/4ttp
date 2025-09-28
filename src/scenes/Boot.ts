import Phaser from "phaser";
import { TEXTURE_KEY } from "../core/factions";
import type { FactionId } from "../core/types";
import fireIconSvg from "../assets/icons/fire-thermal-protocol.svg?raw";
import waterIconSvg from "../assets/icons/water-liquid-node.svg?raw";
import earthIconSvg from "../assets/icons/earth-core-process.svg?raw";
import triangleShapeSvg from "../assets/icons/shape-triangle-surge.svg?raw";
import circleOrbitSvg from "../assets/icons/shape-circle-orbit.svg?raw";
import hexLatticeSvg from "../assets/icons/shape-hex-lattice.svg?raw";

const ICON_SVGS: Record<FactionId, string> = {
  Fire: fireIconSvg,
  Water: waterIconSvg,
  Earth: earthIconSvg,
};

const ALT_ICON_SVGS: Record<FactionId, string> = {
  Fire: triangleShapeSvg,
  Water: circleOrbitSvg,
  Earth: hexLatticeSvg,
};

export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.ensurePixelTexture();
    this.ensureSquareTexture();
    this.loadFactionIcons();
    this.loadAlternateIcons();
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
      this.injectGlowFrame(texture, 0xffffff);
    });
    (Object.keys(ALT_ICON_SVGS) as FactionId[]).forEach((id) => {
      const key = `${TEXTURE_KEY[id]}-alt`;
      if (!this.textures.exists(key)) {
        return;
      }
      const texture = this.textures.get(key);
      texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.injectGlowFrame(texture, 0xffffff);
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
    if (this.textures.exists('ui-card')) {
      return;
    }
    const graphics = this.add.graphics();
    graphics.setVisible(false);

    const generate = (
      key: string,
      width: number,
      height: number,
      radius: number,
      fill: number,
      fillAlpha: number,
      stroke: number,
      strokeAlpha: number,
      shadowAlpha = 0
    ) => {
      graphics.clear();
      if (shadowAlpha > 0) {
        graphics.fillStyle(fill, shadowAlpha);
        graphics.fillRoundedRect(-6, 6, width + 12, height + 12, radius + 12);
      }
      graphics.fillStyle(fill, fillAlpha);
      graphics.fillRoundedRect(0, 0, width, height, radius);
      if (strokeAlpha > 0) {
        graphics.lineStyle(2, stroke, strokeAlpha);
        graphics.strokeRoundedRect(0, 0, width, height, radius);
      }
      graphics.generateTexture(key, width + (shadowAlpha > 0 ? 12 : 0), height + (shadowAlpha > 0 ? 12 : 0));
    };

    generate('ui-card', 360, 148, 22, 0x041227, 0.82, 0x1a2a46, 0.9, 0.12);
    generate('ui-ability', 132, 58, 16, 0x061a2c, 0.94, 0x1e3958, 0.85);
    generate('ui-keycap', 44, 44, 12, 0x0b2b44, 0.9, 0x2f80a8, 0.92);
    generate('ui-tooltip', 320, 132, 18, 0x071629, 0.96, 0x204168, 0.92);
    generate('ui-status-pill', 420, 48, 18, 0x04152a, 0.88, 0x123251, 0.88);
    generate('ui-status-chip', 72, 42, 14, 0x041a32, 0.92, 0x1b3d60, 0.85);
    generate('ui-settings-panel', 260, 180, 24, 0x04152a, 0.82, 0x123251, 0.88);

    graphics.destroy();
  }

  private loadAlternateIcons(): void {
    (Object.entries(ALT_ICON_SVGS) as Array<[FactionId, string]>).forEach(([id, rawSvg]) => {
      const key = `${TEXTURE_KEY[id]}-alt`;
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

  private injectGlowFrame(texture: Phaser.Textures.Texture, color: number): void {
    const frame = texture.get();
    if (!frame) return;
    const renderTexture = this.make.renderTexture({
      width: frame.width + 24,
      height: frame.height + 24,
    }, false);
    renderTexture.clear();
    const x = (renderTexture.width - frame.width) / 2;
    const y = (renderTexture.height - frame.height) / 2;
    renderTexture.drawFrame(texture.key, undefined, x, y);
    renderTexture.fill(0xffffff, 0.05);
    const glowKey = `${texture.key}-glow`;
    renderTexture.saveTexture(glowKey);
    renderTexture.destroy();
    const glowTexture = this.textures.get(glowKey);
    glowTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    glowTexture.customData = { baseKey: texture.key, tint: color };
  }
}
