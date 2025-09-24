import Phaser from 'phaser';
import { BalanceMeter } from './balanceMeter';
import type { FactionId } from '../core/types';
import { COLORS, SPEED, TEXTURE_KEY } from '../core/factions';
import { ENTITY_SIZE, BASE_SPEED } from '../core/constants';
import { burst, haze, pulse, shieldFx } from '../utils/fx';
import { rand, between } from '../utils/rng';

export type AbilityKey = '1' | '2' | '3' | '4' | '5';

const COOLDOWNS_MS: Record<AbilityKey, number> = {
  '1': 500,
  '2': 8000,
  '3': 8000,
  '4': 10000,
  '5': 12000,
};

const EFFECT_DURATIONS_MS = {
  slow: 5000,
  buff: 5000,
  shield: 3000,
} as const;

const NUKE_TINT = 0xb2d7ff;
const NUKE_RADIUS = 80;
const NUKE_LIMIT = 6;

export const ABILITY_METADATA = {
  '1': { name: 'Spawn', description: 'Adds one entity of the weakest faction at the cursor.' },
  '2': { name: 'Slow', description: 'Reduces the strongest faction speed to 75% for 5s.' },
  '3': { name: 'Buff', description: 'Boosts the weakest faction speed to 125% for 5s.' },
  '4': { name: 'Shield', description: 'Grants 3s invulnerability to the weakest faction.' },
  '5': { name: 'Nuke', description: 'Removes up to six nearby entities within 80px.' },
} as const satisfies Record<AbilityKey, { name: string; description: string }>;

export type CooldownState = Record<AbilityKey, number>;

export interface InterventionsOptions {
  maxEntities: number;
}

export class Interventions {
  private readonly scene: Phaser.Scene;
  private readonly groups: Record<FactionId, Phaser.Physics.Arcade.Group>;
  private readonly meter: BalanceMeter;
  private palette: Record<FactionId, number> = { ...COLORS };
private readonly cooldownExpires: Record<AbilityKey, number> = {
    '1': 0,
    '2': 0,
    '3': 0,
    '4': 0,
    '5': 0,
  };

  private readonly activeVelocity: Partial<Record<'slow' | 'buff', { faction: FactionId; factor: number }>> = {};
  private readonly scheduled: Partial<Record<'slow' | 'buff' | 'shield', Phaser.Time.TimerEvent>> = {};
  private readonly options: InterventionsOptions;

  constructor(scene: Phaser.Scene, groups: Record<FactionId, Phaser.Physics.Arcade.Group>, options: InterventionsOptions) {
    this.scene = scene;
    this.groups = groups;
    this.meter = new BalanceMeter(groups);
    this.options = options;
  }

  setPalette(palette: Record<FactionId, number>): void {
    this.palette = palette;
    this.applyPalette();
  }

  cooldowns(): CooldownState {
    const now = this.scene.time.now;
    return {
      '1': Math.max(0, (this.cooldownExpires['1'] - now) / 1000),
      '2': Math.max(0, (this.cooldownExpires['2'] - now) / 1000),
      '3': Math.max(0, (this.cooldownExpires['3'] - now) / 1000),
      '4': Math.max(0, (this.cooldownExpires['4'] - now) / 1000),
      '5': Math.max(0, (this.cooldownExpires['5'] - now) / 1000),
    };
  }

  spawnWeakest(pointer: Phaser.Math.Vector2): boolean {
    if (!this.consumeCooldown('1')) {
      return false;
    }
    const faction = this.meter.weakest();
    if (this.totalEntities() >= this.options.maxEntities) {
      return false;
    }
    const sprite = this.createEntity(faction, pointer.x, pointer.y);
    pulse(this.scene, sprite);
    burst(this.scene, pointer.x, pointer.y, this.palette[faction], 'small');
    return true;
  }

  slowStrongest(): boolean {
    if (!this.consumeCooldown('2')) {
      return false;
    }
    const faction = this.meter.strongest();
    this.applyVelocityModifier('slow', faction, 0.75, EFFECT_DURATIONS_MS.slow);
    haze(this.scene, this.groups[faction], EFFECT_DURATIONS_MS.slow, 0.75);
    return true;
  }

  buffWeakest(): boolean {
    if (!this.consumeCooldown('3')) {
      return false;
    }
    const faction = this.meter.weakest();
    this.applyVelocityModifier('buff', faction, 1.25, EFFECT_DURATIONS_MS.buff);
    const sprites = this.groups[faction].getChildren() as Phaser.Physics.Arcade.Image[];
    sprites.forEach((sprite) => pulse(this.scene, sprite));
    return true;
  }

  shieldWeakest(): boolean {
    if (!this.consumeCooldown('4')) {
      return false;
    }
    const faction = this.meter.weakest();
    const sprites = this.groups[faction].getChildren() as Phaser.Physics.Arcade.Image[];
    sprites.forEach((sprite) => sprite.setData('shielded', true));
    shieldFx(this.scene, sprites, EFFECT_DURATIONS_MS.shield);
    this.scheduleEffect('shield', () => {
      sprites.forEach((sprite) => {
        if (!sprite.active) return;
        sprite.setData('shielded', false);
      });
    }, EFFECT_DURATIONS_MS.shield);
    return true;
  }

  spawnFaction(faction: FactionId, x: number, y: number): Phaser.Physics.Arcade.Image {
    return this.createEntity(faction, x, y);
  }

  nuke(pointer: Phaser.Math.Vector2): boolean {
    if (!this.consumeCooldown('5')) {
      return false;
    }
    const sprites = this.collectSprites();
    const within = sprites
      .map((sprite) => ({ sprite, dist: (sprite.x - pointer.x) ** 2 + (sprite.y - pointer.y) ** 2 }))
      .filter((entry) => entry.dist <= NUKE_RADIUS * NUKE_RADIUS)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, NUKE_LIMIT)
      .map((entry) => entry.sprite);
    within.forEach((sprite) => sprite.destroy());
    burst(this.scene, pointer.x, pointer.y, NUKE_TINT, 'large');
    return within.length > 0;
  }

  private collectSprites(): Phaser.Physics.Arcade.Image[] {
    const list: Phaser.Physics.Arcade.Image[] = [];
    (Object.values(this.groups) as Phaser.Physics.Arcade.Group[]).forEach((group) => {
      const children = group.getChildren() as Phaser.Physics.Arcade.Image[];
      children.forEach((sprite) => {
        if (sprite.active) {
          list.push(sprite);
        }
      });
    });
    return list;
  }

  private totalEntities(): number {
    return (Object.values(this.groups) as Phaser.Physics.Arcade.Group[]).reduce((sum, group) => sum + group.getLength(), 0);
  }

  private createEntity(faction: FactionId, x: number, y: number): Phaser.Physics.Arcade.Image {
    const group = this.groups[faction];
    const sprite = group.create(x, y, TEXTURE_KEY[faction]) as Phaser.Physics.Arcade.Image;
    sprite.setDisplaySize(ENTITY_SIZE, ENTITY_SIZE).setTint(this.palette[faction]);
    sprite.setAlpha(Phaser.Math.FloatBetween(0.82, 1));
    sprite.setData('faction', faction);
    sprite.setData('shielded', false);
    const baseSpeed = SPEED[faction] * BASE_SPEED;
    sprite.setData('baseSpeed', baseSpeed);
    if (faction === 'Water') {
      sprite.setData('wavePhase', Phaser.Math.FloatBetween(0, Math.PI * 2));
    }
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (body) {
      body.setAllowRotation(false);
      body.setBounce(1, 1);
      body.setCollideWorldBounds(true);
      const radius = ENTITY_SIZE * 0.45;
      body.setCircle(radius, (ENTITY_SIZE - radius * 2) / 2, (ENTITY_SIZE - radius * 2) / 2);
      const angle = rand() * Math.PI * 2;
      const speed = baseSpeed * Phaser.Math.FloatBetween(0.9, 1.15);
      body.velocity.setToPolar(angle, speed);
      body.maxVelocity.set(baseSpeed * 1.4, baseSpeed * 1.4);
    }
    this.scene.events.emit('entity-created', sprite, faction);
    return sprite;
  }

  private consumeCooldown(key: AbilityKey): boolean {
    const now = this.scene.time.now;
    if (now < this.cooldownExpires[key]) {
      return false;
    }
    this.cooldownExpires[key] = now + COOLDOWNS_MS[key];
    return true;
  }

  private applyVelocityModifier(effect: 'slow' | 'buff', faction: FactionId, factor: number, duration: number): void {
    const existing = this.activeVelocity[effect];
    if (existing) {
      this.scaleGroup(existing.faction, 1 / existing.factor);
    }
    this.scaleGroup(faction, factor);
    this.activeVelocity[effect] = { faction, factor };
    this.scheduleEffect(effect, () => {
      this.scaleGroup(faction, 1 / factor);
      this.activeVelocity[effect] = undefined;
    }, duration);
  }

  private scaleGroup(faction: FactionId, factor: number): void {
    const children = this.groups[faction].getChildren() as Phaser.Physics.Arcade.Image[];
    children.forEach((sprite) => {
      const body = sprite.body as Phaser.Physics.Arcade.Body | null;
      if (!body) return;
      body.velocity.scale(factor);
    });
  }

  private applyPalette(): void {
    (Object.entries(this.groups) as Array<[FactionId, Phaser.Physics.Arcade.Group]>).forEach(([id, group]) => {
      const tint = this.palette[id];
      const sprites = group.getChildren() as Phaser.Physics.Arcade.Image[];
      sprites.forEach((sprite) => {
        if (!sprite.active) return;
        sprite.setTint(tint);
      });
    });
  }

  private scheduleEffect(key: 'slow' | 'buff' | 'shield', callback: () => void, duration: number): void {
    const existing = this.scheduled[key];
    if (existing) {
      existing.remove(false);
    }
    this.scheduled[key] = this.scene.time.delayedCall(duration, () => {
      callback();
      this.scheduled[key] = undefined;
    });
  }
}
