import Phaser from 'phaser';

type ArcadeImage = Phaser.Physics.Arcade.Image;

type BurstSize = 'small' | 'medium' | 'large';

const BURST_CONFIG: Record<BurstSize, { quantity: number; speed: { min: number; max: number }; scale: { start: number; end: number }; lifespan: number }> = {
  small: { quantity: 6, speed: { min: 60, max: 140 }, scale: { start: 3, end: 0 }, lifespan: 180 },
  medium: { quantity: 12, speed: { min: 80, max: 220 }, scale: { start: 4, end: 0 }, lifespan: 240 },
  large: { quantity: 20, speed: { min: 100, max: 260 }, scale: { start: 5.5, end: 0 }, lifespan: 320 },
};

export function pulse(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject): void {
  scene.tweens.add({
    targets: target,
    scaleX: { from: 1, to: 1.2 },
    scaleY: { from: 1, to: 1.2 },
    duration: 160,
    ease: Phaser.Math.Easing.Sine.InOut,
    yoyo: true,
  });
}

export function burst(scene: Phaser.Scene, x: number, y: number, tint: number, size: BurstSize = 'medium'): void {
  const { quantity, speed, scale, lifespan } = BURST_CONFIG[size];
  const emitter = scene.add.particles(x, y, 'dot', {
    speed,
    angle: { min: 0, max: 360 },
    scale,
    alpha: { start: 0.6, end: 0, ease: 'Expo.easeOut' },
    lifespan,
    quantity,
    tint,
    blendMode: Phaser.BlendModes.ADD,
  });
  scene.time.delayedCall(lifespan + 40, () => emitter.destroy());
}

export function haze(scene: Phaser.Scene, group: Phaser.Physics.Arcade.Group, durationMs: number, multiplier: number): void {
  const children = group.getChildren() as ArcadeImage[];
  const overlay = scene.add.rectangle(scene.scale.width / 2, 32, scene.scale.width * 1.2, 96, 0x223a60, 0.18)
    .setScrollFactor(0)
    .setDepth(450);
  scene.tweens.add({
    targets: overlay,
    alpha: { from: 0.25, to: 0 },
    duration: durationMs,
    onComplete: () => overlay.destroy(),
  });
  children.forEach((child) => {
    if (!child.active) return;
    const originalAlpha = child.alpha;
    child.setData('hazeMultiplier', multiplier);
    child.setAlpha(0.65);
    scene.tweens.add({
      targets: child,
      alpha: originalAlpha,
      ease: Phaser.Math.Easing.Sine.InOut,
      duration: durationMs,
    });
  });
}

export function shieldFx(scene: Phaser.Scene, targets: ArcadeImage[], durationMs: number): void {
  targets.forEach((sprite) => {
    if (!sprite.active) return;
    const ring = scene.add.graphics({ x: sprite.x, y: sprite.y }).setDepth(600);
    ring.fillStyle(0x7fd1ff, 0.18);
    ring.fillCircle(0, 0, sprite.displayWidth * 0.75);
    ring.lineStyle(2, 0x9bdcff, 0.9);
    ring.strokeCircle(0, 0, sprite.displayWidth * 0.8);
    const updatePosition = () => ring.setPosition(sprite.x, sprite.y);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, updatePosition);
    scene.tweens.add({
      targets: [ring, sprite],
      alpha: { from: 0.8, to: 0.5 },
      yoyo: true,
      duration: 260,
      repeat: Math.max(0, Math.floor(durationMs / 260) - 1),
    });
    scene.time.delayedCall(durationMs, () => {
      scene.events.off(Phaser.Scenes.Events.POST_UPDATE, updatePosition);
      ring.destroy();
    });
  });
}
