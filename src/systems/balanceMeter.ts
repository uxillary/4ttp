import Phaser from 'phaser';
import type { FactionId } from '../core/types';
import { FACTIONS } from '../core/factions';
import type { Palette } from '../core/palette';

const EQUILIBRIUM_HOT = Phaser.Display.Color.ValueToColor(0xff6347);
const EQUILIBRIUM_COOL = Phaser.Display.Color.ValueToColor(0x55e6a5);
const SEGMENT_LIGHT = Phaser.Display.Color.ValueToColor(0xffffff);
const SEGMENT_DARK = Phaser.Display.Color.ValueToColor(0x0c2034);

export type FactionCounts = Record<FactionId, number>;

type Counts = FactionCounts;

type GroupMap = Record<FactionId, Phaser.Physics.Arcade.Group>;

export class BalanceMeter {
  private readonly groups: GroupMap;

  constructor(groups: GroupMap) {
    this.groups = groups;
  }

  counts(): Counts {
    const counts = {} as Counts;
    FACTIONS.forEach((id) => {
      counts[id] = this.groups[id].countActive(true);
    });
    return counts;
  }

  weakest(): FactionId {
    const counts = this.counts();
    let chosen: FactionId = FACTIONS[0]!;
    let lowest = Number.POSITIVE_INFINITY;
    FACTIONS.forEach((id) => {
      const value = counts[id];
      if (value < lowest) {
        lowest = value;
        chosen = id;
      }
    });
    return chosen;
  }

  strongest(): FactionId {
    const counts = this.counts();
    let chosen: FactionId = FACTIONS[0]!;
    let highest = Number.NEGATIVE_INFINITY;
    FACTIONS.forEach((id) => {
      const value = counts[id];
      if (value > highest) {
        highest = value;
        chosen = id;
      }
    });
    return chosen;
  }

  equilibrium(): number {
    return computeEquilibrium(this.counts());
  }
}

export function computeEquilibrium(counts: Counts): number {
  const totals = FACTIONS.map((id) => counts[id]);
  const sum = totals.reduce((acc, value) => acc + value, 0);
  if (sum === 0) {
    return 1;
  }
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  const balance = 1 - (max - min) / sum;
  return Phaser.Math.Clamp(balance, 0, 1);
}

export class BalanceBar {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly width: number;
  private readonly height: number;
  private displayedEquilibrium = 1;

  constructor(scene: Phaser.Scene, x: number, y: number, width = 320, height = 12) {
    this.width = width;
    this.height = height;
    this.graphics = scene.add.graphics({ x, y }).setScrollFactor(0).setDepth(40);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.graphics.destroy());
  }

  update(counts: Counts, palette: Palette, equilibrium = 1): void {
    const total = FACTIONS.reduce((sum, id) => sum + counts[id], 0);
    const { width } = this;
    this.graphics.clear();
    this.displayedEquilibrium = Phaser.Math.Linear(this.displayedEquilibrium, equilibrium, 0.18);
    const stability = Phaser.Display.Color.Interpolate.ColorWithColor(
      EQUILIBRIUM_HOT,
      EQUILIBRIUM_COOL,
      100,
      Math.floor(this.displayedEquilibrium * 100)
    );
    const borderColor = Phaser.Display.Color.GetColor(stability.r, stability.g, stability.b);
    this.graphics.fillStyle(0x05101d, 0.92);
    this.graphics.fillRoundedRect(0, 0, width, this.height, 8);

    if (total <= 0) {
      this.graphics.lineStyle(2, borderColor, 0.95);
      this.graphics.strokeRoundedRect(0, 0, width, this.height, 8);
      return;
    }

    let offset = 0;
    FACTIONS.forEach((id, index) => {
      const fraction = counts[id] / total;
      const segmentWidth = index === FACTIONS.length - 1 ? width - offset : Math.max(width * fraction, 0);
      const color = palette[id];
      const base = Phaser.Display.Color.IntegerToColor(color);
      const lighter = Phaser.Display.Color.Interpolate.ColorWithColor(
        base,
        SEGMENT_LIGHT,
        100,
        24
      );
      const darker = Phaser.Display.Color.Interpolate.ColorWithColor(
        base,
        SEGMENT_DARK,
        100,
        38
      );
      const topColor = Phaser.Display.Color.GetColor(lighter.r, lighter.g, lighter.b);
      const bottomColor = Phaser.Display.Color.GetColor(darker.r, darker.g, darker.b);
      const radius: Phaser.Types.GameObjects.Graphics.RoundedRectRadius =
        index === 0
          ? { tl: 8, bl: 8 }
          : index === FACTIONS.length - 1
            ? { tr: 8, br: 8 }
            : { tl: 0, tr: 0, bl: 0, br: 0 };
      this.graphics.fillGradientStyle(topColor, topColor, bottomColor, bottomColor, 0.98, 0.98, 0.92, 0.92);
      this.graphics.fillRoundedRect(offset, 0, segmentWidth, this.height, radius);
      offset += segmentWidth;
    });
    this.graphics.lineStyle(2, borderColor, 0.95);
    this.graphics.strokeRoundedRect(0, 0, width, this.height, 8);
    this.graphics.lineStyle(1, borderColor, 0.4);
    this.graphics.strokeRoundedRect(2, 2, width - 4, this.height - 4, 6);
  }

  setVisible(visible: boolean): void {
    this.graphics.setVisible(visible);
  }

  setPosition(x: number, y: number): void {
    this.graphics.setPosition(x, y);
  }

  setScale(x: number, y?: number): void {
    this.graphics.setScale(x, y ?? x);
  }
}
