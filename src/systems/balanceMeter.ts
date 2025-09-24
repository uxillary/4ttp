import Phaser from 'phaser';
import type { FactionId } from '../core/types';
import { FACTIONS } from '../core/factions';
import type { Palette } from '../core/palette';

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
      counts[id] = this.groups[id].getLength();
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

  constructor(scene: Phaser.Scene, x: number, y: number, width = 320, height = 12) {
    this.width = width;
    this.height = height;
    this.graphics = scene.add.graphics({ x, y }).setScrollFactor(0).setDepth(40);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.graphics.destroy());
  }

  update(counts: Counts, palette: Palette): void {
    const total = FACTIONS.reduce((sum, id) => sum + counts[id], 0);
    const { width } = this;
    this.graphics.clear();
    this.graphics.fillStyle(0x0c1526, 0.85);
    this.graphics.fillRoundedRect(0, 0, width, this.height, 6);

    if (total <= 0) {
      this.graphics.lineStyle(1, 0x1f2c44, 0.9);
      this.graphics.strokeRoundedRect(0, 0, width, this.height, 6);
      return;
    }

    let offset = 0;
    FACTIONS.forEach((id, index) => {
      const fraction = counts[id] / total;
      const segmentWidth = index === FACTIONS.length - 1 ? width - offset : Math.max(width * fraction, 0);
      const color = palette[id];
      const radius: Phaser.Types.GameObjects.Graphics.RoundedRectRadius =
        index === 0
          ? { tl: 6, bl: 6 }
          : index === FACTIONS.length - 1
            ? { tr: 6, br: 6 }
            : { tl: 0, tr: 0, bl: 0, br: 0 };
      this.graphics.fillStyle(color, 0.92);
      this.graphics.fillRoundedRect(offset, 0, segmentWidth, this.height, radius);
      offset += segmentWidth;
    });

    this.graphics.lineStyle(1, 0x1f2c44, 0.9);
    this.graphics.strokeRoundedRect(0, 0, width, this.height, 6);
  }

  setVisible(visible: boolean): void {
    this.graphics.setVisible(visible);
  }
}
