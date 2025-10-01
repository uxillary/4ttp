import Phaser from 'phaser';
import { BalanceMeter } from './balanceMeter';
import type { FactionId } from '../core/types';
import { COLORS, SPEED, TEXTURE_KEY } from '../core/factions';
import { ENTITY_SIZE, BASE_SPEED, ENTITY_DRAG } from '../core/constants';
import { auraGlow, burst, haze, pulse, shieldFx, type DetailLevel } from '../utils/fx';
import { rand, between } from '../utils/rng';

export type AbilityKey = '1' | '2' | '3' | '4' | '5';

export const COOLDOWNS_MS: Record<AbilityKey, number> = {
  '1': 320,
  '2': 9000,
  '3': 9500,
  '4': 12000,
  '5': 14000,
};

export const EFFECT_DURATIONS_MS = {
  slow: 5000,
  buff: 5000,
  shield: 3000,
} as const;

const NUKE_TINT = 0xb2d7ff;
const NUKE_RADIUS = 80;
const NUKE_LIMIT = 6;

type AbilityMetaEntry = {
  name: string;
  description: string;
  hint: string;
  combo?: string;
};

export const ABILITY_METADATA = {
  '1': {
    name: 'Spawn',
    description: 'Adds one entity of the weakest faction at the cursor.',
    hint: 'Pulse a reinforcements node where balance breaks.',
    combo: 'Spawn → Buff supercharges new arrivals.',
  },
  '2': {
    name: 'Slow',
    description: 'Reduces the strongest faction speed to 75% for 5s.',
    hint: 'Throttle surging swarms to regain parity.',
    combo: 'Slow → Nuke triggers a freeze-explosion.',
  },
  '3': {
    name: 'Buff',
    description: 'Boosts the weakest faction speed to 125% for 5s.',
    hint: 'Overclock allies to contest momentum.',
    combo: 'Buff → Shield yields a resonant bulwark.',
  },
  '4': {
    name: 'Shield',
    description: 'Grants 3s invulnerability to the weakest faction.',
    hint: 'Phase vulnerable squads through enemy bursts.',
    combo: 'Shield → Spawn escorts new fragments safely.',
  },
  '5': {
    name: 'Nuke',
    description: 'Removes up to six nearby entities within 80px.',
    hint: 'Purge critical overloads before collapse.',
    combo: 'Slow or Buff prep before Nuke amplifies the blast radius.',
  },
} as const satisfies Record<AbilityKey, AbilityMetaEntry>;

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
  private lowDetail = false;

  constructor(scene: Phaser.Scene, groups: Record<FactionId, Phaser.Physics.Arcade.Group>, options: InterventionsOptions) {
    this.scene = scene;
    this.groups = groups;
    this.meter = new BalanceMeter(groups);
    this.options = options;
  }

  setLowDetail(enabled: boolean): void {
    this.lowDetail = enabled;
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
    if (!this.lowDetail) {
      haze(this.scene, this.groups[faction], EFFECT_DURATIONS_MS.slow, 0.75);
    }
    this.applyStatusVisuals('slow', faction, EFFECT_DURATIONS_MS.slow);
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
    this.fadeBuffGroup(sprites, EFFECT_DURATIONS_MS.buff);
    this.applyStatusVisuals('buff', faction, EFFECT_DURATIONS_MS.buff);
    return true;
  }

  shieldWeakest(): boolean {
    if (!this.consumeCooldown('4')) {
      return false;
    }
    const faction = this.meter.weakest();
    const sprites = this.groups[faction].getChildren() as Phaser.Physics.Arcade.Image[];
    sprites.forEach((sprite) => sprite.setData('shielded', true));
    shieldFx(this.scene, sprites, EFFECT_DURATIONS_MS.shield, this.getDetailLevel());
    this.applyStatusVisuals('shield', faction, EFFECT_DURATIONS_MS.shield);
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

  nuke(pointer: Phaser.Math.Vector2): number {
    if (!this.consumeCooldown('5')) {
      return 0;
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
    return within.length;
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
    return (Object.values(this.groups) as Phaser.Physics.Arcade.Group[]).reduce(
      (sum, group) => sum + group.countActive(true),
      0,
    );
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
    sprite.setData('speedScale', 1);
    if (faction === 'Water') {
      sprite.setData('wavePhase', Phaser.Math.FloatBetween(0, Math.PI * 2));
    }
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (body) {
      body.setAllowRotation(false);
      body.setBounce(1, 1);
      body.setCollideWorldBounds(true);
      body.setDamping(true);
      body.setDrag(ENTITY_DRAG, ENTITY_DRAG);
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

  private fadeBuffGroup(sprites: Phaser.Physics.Arcade.Image[], duration: number): void {
    sprites.forEach((sprite) => {
      if (!sprite.active) return;
      const startAlpha = sprite.alpha;
      this.scene.tweens.add({
        targets: sprite,
        alpha: { from: Math.max(0.5, startAlpha - 0.25), to: Math.min(1, startAlpha + 0.15) },
        duration: 220,
        ease: Phaser.Math.Easing.Sine.InOut,
        yoyo: true,
        repeat: Math.max(0, Math.floor(duration / 220) - 1),
      });
      this.scene.time.delayedCall(duration, () => {
        if (!sprite.active) return;
        this.scene.tweens.add({
          targets: sprite,
          alpha: { from: sprite.alpha, to: startAlpha },
          duration: 200,
          ease: Phaser.Math.Easing.Sine.InOut,
        });
      });
    });
  }

  private applyStatusVisuals(effect: 'slow' | 'buff' | 'shield', faction: FactionId, duration: number): void {
    const sprites = this.groups[faction].getChildren() as Phaser.Physics.Arcade.Image[];
    const iconKey = this.iconKeyForEffect(effect);
    sprites.forEach((sprite) => {
      if (!sprite.active) return;
      if (iconKey) {
        this.spawnStatusIcon(sprite, iconKey, duration);
      }
      if (effect === 'shield') {
        auraGlow(this.scene, sprite, 0x91d9ff, 0.9, duration, this.getDetailLevel());
      } else if (effect === 'buff' && !this.lowDetail) {
        auraGlow(this.scene, sprite, 0xffa860, 0.6, 400, this.getDetailLevel());
      }
    });
  }

  private spawnStatusIcon(sprite: Phaser.Physics.Arcade.Image, textureKey: string, duration: number): void {
    if (!this.scene.textures.exists(textureKey)) {
      return;
    }
    const icon = this.scene.add
      .image(sprite.x, sprite.y - sprite.displayHeight * 0.75, textureKey)
      .setDepth(620)
      .setScale(this.lowDetail ? 0.55 : 0.72)
      .setAlpha(0);
    const update = () => icon.setPosition(sprite.x, sprite.y - sprite.displayHeight * 0.75);
    this.scene.events.on(Phaser.Scenes.Events.POST_UPDATE, update);
    this.scene.tweens.add({
      targets: icon,
      alpha: { from: 0, to: 1 },
      duration: 160,
      ease: Phaser.Math.Easing.Sine.Out,
    });
    const teardown = () => {
      this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, update);
      if (!icon.scene) return;
      this.scene.tweens.add({
        targets: icon,
        alpha: { from: icon.alpha, to: 0 },
        duration: 180,
        ease: Phaser.Math.Easing.Sine.In,
        onComplete: () => icon.destroy(),
      });
    };
    this.scene.time.delayedCall(duration, teardown);
    sprite.once(Phaser.GameObjects.Events.DESTROY, teardown);
  }

  private iconKeyForEffect(effect: 'slow' | 'buff' | 'shield'): string | null {
    switch (effect) {
      case 'slow':
        return 'status-slow';
      case 'buff':
        return 'status-buff';
      case 'shield':
        return 'status-shield';
      default:
        return null;
    }
  }

  private getDetailLevel(): DetailLevel {
    return this.lowDetail ? 'low' : 'high';
  }

  private scaleGroup(faction: FactionId, factor: number): void {
    const children = this.groups[faction].getChildren() as Phaser.Physics.Arcade.Image[];
    children.forEach((sprite) => {
      const body = sprite.body as Phaser.Physics.Arcade.Body | null;
      if (!body) return;
      body.velocity.scale(factor);
      const current = (sprite.getData('speedScale') as number) ?? 1;
      const next = Phaser.Math.Clamp(current * factor, 0.25, 3);
      sprite.setData('speedScale', next);
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
