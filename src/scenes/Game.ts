import Phaser from "phaser";
import type { Mode, FactionId } from "../core/types";
import { FACTIONS, SPEED, TEXTURE_KEY } from "../core/factions";
import { beats } from "../core/rules";
import { BalanceMeter, computeEquilibrium, type FactionCounts } from "../systems/balanceMeter";
import { Interventions, type CooldownState, type AbilityKey } from "../systems/interventions";
import { getPalette } from "../core/palette";
import { ENTITY_SIZE, BASE_SPEED, GRID_SIZE } from "../core/constants";
import { initSeed, getSeed, between } from "../utils/rng";
import { playSfx, setMuted as setMutedAudio } from "../audio";
import { getBool, setBool, getNumber, setNumber } from "../utils/save";
import { UI } from "./UI";
import { burst, pulse, shieldFx } from "../utils/fx";
import type { GameTickPayload, GameEndSummary } from "./types";

type GameInitData = {
  mode?: Mode;
  seed?: string | null;
};

type ComboContext = {
  point?: Phaser.Math.Vector2;
  faction?: FactionId;
  count?: number;
};

type UiToggleKey = 'audio' | 'hud' | 'palette' | 'speed' | 'pause' | 'info';

const MUTED_KEY = "muted";
const COLORBLIND_KEY = "colorblind";
const BEST_SCORE_KEY: Record<Mode, string> = {
  Balance: "best.balance",
  Domination: "best.domination",
};
const EQUILIBRIUM_THRESHOLD = 0.28;
const EQUILIBRIUM_WINDOW = 60;
const SPAWN_COUNT = 60;
const ENTITY_CAP = 600;
const WORLD_PADDING = 48;
const COMBO_DEFINITIONS = [
  { sequence: ['2', '5'] as const, window: 4000, effect: 'freezeExplosion' as const },
  { sequence: ['3', '4'] as const, window: 3500, effect: 'resonantBulwark' as const },
  { sequence: ['4', '1'] as const, window: 4000, effect: 'terraEscort' as const },
  { sequence: ['1', '3'] as const, window: 3200, effect: 'surgeBloom' as const },
] as const;
type ComboEffect = (typeof COMBO_DEFINITIONS)[number]['effect'];

const BACKGROUND_UNSTABLE = Phaser.Display.Color.ValueToColor(0xff6347);
const BACKGROUND_STABLE = Phaser.Display.Color.ValueToColor(0x55e6a5);

export class Game extends Phaser.Scene {
  private mode: Mode = "Balance";
  private seed = "";
  private groups!: Record<FactionId, Phaser.Physics.Arcade.Group>;
  private meter!: BalanceMeter;
  private interventions!: Interventions;
  private ui!: UI;
  private uiReady = false;
  private uiEventsBound = false;
  private pendingEnd: GameEndSummary | null = null;
  private lastPayload: GameTickPayload | null = null;

  private palette = getPalette(false);
  private counts: FactionCounts = { Fire: 0, Water: 0, Earth: 0 };
  private cooldowns: CooldownState = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

  private elapsed = 0;
  private paused = false;
  private ended = false;
  private hudVisible = true;
  private colorblind = false;
  private muted = true;
  private infoOverlayVisible = false;

  private equilibriumStable = 0;
  private nukeUsed = false;
  private interventionsUsed = 0;
  private comboTriggers = 0;
  private fireSplits = 0;
  private waterDuplications = 0;
  private earthShieldBursts = 0;

  private pendingSeed: string | null = null;
  private scanlineOverlay?: Phaser.GameObjects.TileSprite;
  private backgroundGrid?: Phaser.GameObjects.Grid;
  private speedLevels: number[] = [0.75, 1, 1.35];
  private speedIndex = 1;
  private currentSpeed = 1;
  private comboHistory: Array<{ key: AbilityKey; time: number; data?: ComboContext }> = [];
  private readonly handleEntityCreated = (sprite: Phaser.Physics.Arcade.Image, faction: FactionId) => {
    this.decorateFactionSprite(sprite, faction, true);
  };

  constructor() {
    super("Game");
  }

  init(data?: GameInitData): void {
    if (data?.mode) {
      this.mode = data.mode;
    }
    if (typeof data?.seed === "string" && data.seed.trim().length > 0) {
      this.pendingSeed = data.seed;
    }
  }

  create(): void {
    this.resetState();
    this.initializeSettings();
    this.createBackground();
    this.animateBackground(1);

    this.physics.world.setBounds(0, 0, this.scale.width, this.scale.height);
    this.physics.world.setBoundsCollision(true, true, true, true);

    this.buildGroups();
    this.meter = new BalanceMeter(this.groups);
    this.interventions = new Interventions(this, this.groups, { maxEntities: ENTITY_CAP });
    this.interventions.setPalette(this.palette);

    this.events.on('entity-created', this.handleEntityCreated, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off('entity-created', this.handleEntityCreated, this);
    });

    this.spawnInitial(SPAWN_COUNT);
    this.setupCollisions();
    this.registerInput();

    this.updateCooldowns();
    this.refreshAndPublish();
    this.ensureUiBinding();
  }

  private createBackground(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.backgroundGrid = this.add.grid(width / 2, height / 2, width, height, GRID_SIZE, GRID_SIZE, 0x0a1526, 0.24, 0x12233b, 0.32)
      .setDepth(-20)
      .setScrollFactor(0);
    this.backgroundGrid.setStrokeStyle(1, 0x1a2b3f, 0.25);
    this.scanlineOverlay = this.add.tileSprite(width / 2, height / 2, width, height, 'overlay-scanline')
      .setScrollFactor(0)
      .setDepth(35)
      .setAlpha(0.12);
    this.scanlineOverlay.setBlendMode(Phaser.BlendModes.ADD);
  }

  private ensureUiBinding(): void {
    if (!this.scene.isActive('UI')) {
      this.scene.launch('UI');
    }
    this.ui = this.scene.get('UI') as UI;
    if (this.ui.isReady()) {
      this.onUiReady();
    } else {
      this.ui.events.once('ui-ready', () => this.onUiReady());
    }
  }

  private onUiReady(): void {
    this.uiReady = true;
    this.bindUiEvents();
    this.ui.setMode(this.mode);
    this.ui.setHudVisible(this.hudVisible);
    this.ui.setMutedAndColorblind(this.muted, this.colorblind);
    this.ui.setSpeedMultiplier(this.currentSpeed);
    this.ui.setInfoVisible(this.infoOverlayVisible);
    this.ui.hideEndPanel();
    if (this.lastPayload) {
      this.ui.tick(this.lastPayload);
    }
    this.ui.setCooldowns(this.cooldowns);
    if (this.pendingEnd) {
      this.ui.showEndPanel(this.pendingEnd);
      this.pendingEnd = null;
    }
  }

  private bindUiEvents(): void {
    if (this.uiEventsBound) return;
    this.ui.events.on('ability-clicked', this.handleUiAbilityClick, this);
    this.ui.events.on('status-toggle', this.handleStatusToggle, this);
    this.uiEventsBound = true;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.ui) {
        this.ui.events.off('ability-clicked', this.handleUiAbilityClick, this);
        this.ui.events.off('status-toggle', this.handleStatusToggle, this);
      }
      this.uiEventsBound = false;
    });
  }

  private handleUiAbilityClick(key: AbilityKey): void {
    switch (key) {
      case '1':
        this.trySpawnAt(this.pointerWorld());
        break;
      case '2':
        this.trySlowStrongest();
        break;
      case '3':
        this.tryBuffWeakest();
        break;
      case '4':
        this.tryShieldWeakest();
        break;
      case '5':
        this.tryNukeAt(this.pointerWorld());
        break;
      default:
        break;
    }
  }

  private handleStatusToggle(key: UiToggleKey): void {
    switch (key) {
      case 'audio':
        this.toggleMute();
        break;
      case 'hud':
        this.toggleHud();
        break;
      case 'palette':
        this.toggleColorblind();
        break;
      case 'speed':
        this.cycleSpeed();
        break;
      case 'pause':
        this.togglePause();
        break;
      case 'info':
        this.toggleInfoOverlay();
        break;
      default:
        break;
    }
  }

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;
    if (this.scanlineOverlay) {
      this.scanlineOverlay.tilePositionY = (this.scanlineOverlay.tilePositionY - dt * 50) % this.scanlineOverlay.height;
    }
    if (!this.paused && !this.ended) {
      this.elapsed += dt;
      const counts = this.meter.counts();
      this.counts = { ...counts };
      const equilibrium = computeEquilibrium(counts);
      if (equilibrium >= EQUILIBRIUM_THRESHOLD) {
        this.equilibriumStable += dt;
      } else {
        this.equilibriumStable = 0;
      }
      this.applyFactionBehaviours(dt);
      this.checkEndConditions(counts, equilibrium);
      this.publishTick(counts, equilibrium);
      this.animateBackground(equilibrium);
    } else {
      const equilibrium = computeEquilibrium(this.counts);
      this.publishTick(this.counts, equilibrium);
      this.animateBackground(equilibrium);
    }
    this.updateCooldowns();
  }

  restart(regenerateSeed = false): void {
    const seed = regenerateSeed ? this.generateSeed() : null;
    this.scene.restart({ mode: this.mode, seed });
  }

  toggleMode(): void {
    const nextMode: Mode = this.mode === "Balance" ? "Domination" : "Balance";
    this.scene.restart({ mode: nextMode, seed: null });
  }

  private resetState(): void {
    this.elapsed = 0;
    this.paused = false;
    this.ended = false;
    this.uiReady = false;
    this.uiEventsBound = false;
    this.equilibriumStable = 0;
    this.nukeUsed = false;
    this.interventionsUsed = 0;
    this.comboTriggers = 0;
    this.fireSplits = 0;
    this.waterDuplications = 0;
    this.earthShieldBursts = 0;
    this.comboHistory = [];
    this.infoOverlayVisible = false;
    this.cooldowns = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    this.counts = { Fire: 0, Water: 0, Earth: 0 };
    this.pendingEnd = null;
    this.lastPayload = null;
    this.physics.world.resume();
    this.speedIndex = 1;
    this.applySpeed(this.getCurrentSpeed());
  }

  private initializeSettings(): void {
    initSeed(this.pendingSeed ?? undefined);
    this.seed = getSeed();
    this.pendingSeed = null;

    this.muted = getBool(MUTED_KEY, this.muted);
    this.colorblind = getBool(COLORBLIND_KEY, this.colorblind);
    setMutedAudio(this.muted);
    this.palette = getPalette(this.colorblind);
    if (this.uiReady) {
      this.ui.setMutedAndColorblind(this.muted, this.colorblind);
    }
  }

  private buildGroups(): void {
    const factory = ((): Record<FactionId, Phaser.Physics.Arcade.Group> => {
      const map = {} as Record<FactionId, Phaser.Physics.Arcade.Group>;
      FACTIONS.forEach((id) => {
        map[id] = this.physics.add.group({
          classType: Phaser.Physics.Arcade.Image,
          maxSize: ENTITY_CAP,
          collideWorldBounds: true,
          bounceX: 1,
          bounceY: 1,
        });
      });
      return map;
    })();
    this.groups = factory;
  }

  private spawnInitial(total: number): void {
    for (let i = 0; i < total; i += 1) {
      const faction = FACTIONS[i % FACTIONS.length]!;
      const x = between(WORLD_PADDING, this.scale.width - WORLD_PADDING);
      const y = between(WORLD_PADDING, this.scale.height - WORLD_PADDING);
      this.spawnEntity(faction, x, y);
    }
    this.refreshAndPublish();
  }

  private spawnEntity(faction: FactionId, x: number, y: number): Phaser.Physics.Arcade.Image {
    const sprite = this.interventions.spawnFaction(faction, x, y);
    sprite.setDepth(5);
    return sprite;
  }

  private setupCollisions(): void {
    const values = Object.values(this.groups) as Phaser.Physics.Arcade.Group[];
    for (let i = 0; i < values.length; i += 1) {
      const groupA = values[i]!;
      this.physics.add.collider(groupA, groupA, undefined, undefined, this);
      for (let j = i + 1; j < values.length; j += 1) {
        const groupB = values[j]!;
        this.physics.add.collider(groupA, groupB, this.onCollision, undefined, this);
      }
    }
  }

  private onCollision: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (object1, object2) => {
    const spriteA = object1 as Phaser.Physics.Arcade.Image;
    const spriteB = object2 as Phaser.Physics.Arcade.Image;
    const factionA = spriteA.getData('faction') as FactionId;
    const factionB = spriteB.getData('faction') as FactionId;
    if (!factionA || !factionB || factionA === factionB) {
      return;
    }
    if (spriteA.getData('shielded') || spriteB.getData('shielded')) {
      return;
    }
    if (beats(factionA, factionB)) {
      this.resolveElementalInteraction(spriteA, spriteB, factionA, factionB);
      this.convert(spriteB, factionA);
    } else if (beats(factionB, factionA)) {
      this.resolveElementalInteraction(spriteB, spriteA, factionB, factionA);
      this.convert(spriteA, factionB);
    }
  };

  private convert(sprite: Phaser.Physics.Arcade.Image, faction: FactionId): void {
    const previousFaction = sprite.getData('faction') as FactionId | null;
    if (previousFaction === faction) {
      return;
    }

    if (previousFaction && this.groups[previousFaction]) {
      this.groups[previousFaction].remove(sprite);
    }

    const targetGroup = this.groups[faction];
    if (targetGroup && !targetGroup.contains(sprite)) {
      targetGroup.add(sprite);
    }

    sprite.setData('faction', faction);
    sprite.setData('shielded', false);
    this.decorateFactionSprite(sprite, faction, false);
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (body) {
      const baseSpeed = (sprite.getData('baseSpeed') as number) || BASE_SPEED;
      body.velocity.setLength(baseSpeed * 1.08);
    }
    pulse(this, sprite);
    burst(this, sprite.x, sprite.y, this.palette[faction], 'small');
    playSfx('convert');
  }

  private registerInput(): void {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) return;
      this.trySpawnAt(this.pointerWorld(pointer));
    });

    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    keyboard.on("keydown-ONE", () => this.trySpawnAt(this.pointerWorld()));
    keyboard.on("keydown-TWO", () => this.trySlowStrongest());
    keyboard.on("keydown-THREE", () => this.tryBuffWeakest());
    keyboard.on("keydown-FOUR", () => this.tryShieldWeakest());
    keyboard.on("keydown-FIVE", () => this.tryNukeAt(this.pointerWorld()));

    keyboard.on("keydown-M", () => this.toggleMute());
    keyboard.on("keydown-C", () => this.toggleColorblind());
    keyboard.on("keydown-H", () => this.toggleHud());
    keyboard.on("keydown-SPACE", () => this.togglePause());
    keyboard.on("keydown-I", () => this.toggleInfoOverlay());
    keyboard.on("keydown-X", () => this.exportSnapshot());
    keyboard.on("keydown-R", (event: KeyboardEvent) => this.restart(event.shiftKey));
    keyboard.on("keydown-TAB", (event: KeyboardEvent) => {
      event.preventDefault();
      this.toggleMode();
    });
  }

  private trySpawnAt(point: Phaser.Math.Vector2): void {
    if (!this.canAct()) return;
    const faction = this.meter.weakest();
    const success = this.interventions.spawnWeakest(point);
    if (success) {
      this.interventionsUsed += 1;
      playSfx('spawn');
      this.registerAbilityUse('1', { point: point.clone(), faction });
      this.refreshAndPublish();
    }
  }

  private trySlowStrongest(): void {
    if (!this.canAct()) return;
    const faction = this.meter.strongest();
    if (this.interventions.slowStrongest()) {
      this.interventionsUsed += 1;
      playSfx('slow');
      this.registerAbilityUse('2', { faction });
    }
  }

  private tryBuffWeakest(): void {
    if (!this.canAct()) return;
    const faction = this.meter.weakest();
    if (this.interventions.buffWeakest()) {
      this.interventionsUsed += 1;
      playSfx('buff');
      this.registerAbilityUse('3', { faction });
    }
  }

  private tryShieldWeakest(): void {
    if (!this.canAct()) return;
    const faction = this.meter.weakest();
    if (this.interventions.shieldWeakest()) {
      this.interventionsUsed += 1;
      playSfx('shield');
      const count = this.groups[faction].countActive(true);
      this.registerAbilityUse('4', { faction, count });
      this.refreshAndPublish();
    }
  }

  private tryNukeAt(point: Phaser.Math.Vector2): void {
    if (!this.canAct()) return;
    const success = this.interventions.nuke(point);
    if (success) {
      this.interventionsUsed += 1;
      this.nukeUsed = true;
      playSfx('nuke');
      this.registerAbilityUse('5', { point: point.clone() });
      this.refreshAndPublish();
    }
  }

  private registerAbilityUse(key: AbilityKey, context: ComboContext = {}): void {
    const now = this.time.now;
    this.comboHistory = this.comboHistory.filter((entry) => now - entry.time <= 4500);
    this.comboHistory.push({ key, time: now, data: context });
    this.evaluateCombos(key, context, now);
  }

  private evaluateCombos(key: AbilityKey, context: ComboContext, timestamp: number): void {
    COMBO_DEFINITIONS.forEach(({ sequence, window, effect }) => {
      const [first, second] = sequence;
      if (key !== second) return;
      const candidate = [...this.comboHistory]
        .reverse()
        .find((entry) => entry.key === first && timestamp - entry.time <= window);
      if (!candidate) return;
      this.comboHistory = this.comboHistory.filter((entry) => entry !== candidate);
      this.triggerCombo(effect, candidate.data ?? {}, context);
      this.comboTriggers += 1;
    });
  }

  private triggerCombo(effect: ComboEffect, first: ComboContext, second: ComboContext): void {
    switch (effect) {
      case 'freezeExplosion':
        this.comboFreezeExplosion(second.point ?? first.point ?? this.pointerWorld());
        break;
      case 'resonantBulwark':
        this.comboResonantBulwark(second.faction ?? first.faction ?? this.meter.weakest());
        break;
      case 'terraEscort':
        this.comboTerraEscort(second.point ?? first.point ?? this.pointerWorld(), second.faction ?? first.faction ?? this.meter.weakest());
        break;
      case 'surgeBloom':
        if (first.point && (second.faction ?? first.faction)) {
          this.comboSurgeBloom(first.point, second.faction ?? first.faction!);
        }
        break;
      default:
        break;
    }
  }

  private resolveElementalInteraction(
    attacker: Phaser.Physics.Arcade.Image,
    defender: Phaser.Physics.Arcade.Image,
    attackerFaction: FactionId,
    defenderFaction: FactionId,
  ): void {
    const impact = new Phaser.Math.Vector2(defender.x, defender.y);
    if (attackerFaction === 'Fire' && defenderFaction === 'Earth') {
      this.fireSplits += this.spawnEarthFragments(impact);
    } else if (attackerFaction === 'Water' && defenderFaction === 'Fire') {
      this.waterDuplications += this.spawnWaterDroplets(attacker, impact);
    } else if (attackerFaction === 'Earth' && defenderFaction === 'Water') {
      this.earthShieldBursts += 1;
      this.applyEarthShield(attacker);
    }
    if (Phaser.Math.FloatBetween(0, 1) < 0.08) {
      this.triggerCritical(attackerFaction, impact);
    }
  }

  private comboFreezeExplosion(point: Phaser.Math.Vector2): void {
    const radius = 140;
    const radiusSq = radius * radius;
    const affected: Phaser.Physics.Arcade.Image[] = [];
    this.forEachSprite((sprite) => {
      const dx = sprite.x - point.x;
      const dy = sprite.y - point.y;
      if (dx * dx + dy * dy <= radiusSq) {
        affected.push(sprite);
        const body = sprite.body as Phaser.Physics.Arcade.Body | null;
        if (body) {
          body.velocity.scale(0.2);
        }
        sprite.setTintFill(0xb2d7ff);
        this.tweens.add({
          targets: sprite,
          alpha: { from: sprite.alpha, to: 0.55 },
          yoyo: true,
          duration: 120,
          repeat: 6,
        });
      }
    });
    burst(this, point.x, point.y, 0xb2d7ff, 'large');
    this.time.delayedCall(1600, () => {
      affected.forEach((sprite) => {
        if (!sprite.active) return;
        const faction = sprite.getData('faction') as FactionId | undefined;
        if (faction) {
          sprite.setTint(this.palette[faction]);
        } else {
          sprite.clearTint();
        }
        this.maintainBaseSpeed(sprite, 0.6);
      });
    });
  }

  private comboResonantBulwark(faction: FactionId): void {
    const sprites = this.groups[faction].getChildren() as Phaser.Physics.Arcade.Image[];
    sprites.forEach((sprite) => {
      sprite.setData('shielded', true);
    });
    shieldFx(this, sprites, 4800);
    this.time.delayedCall(4800, () => {
      sprites.forEach((sprite) => {
        if (!sprite.active) return;
        sprite.setData('shielded', false);
      });
    });
  }

  private comboTerraEscort(point: Phaser.Math.Vector2, faction: FactionId): void {
    const count = 2;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count;
      const offset = new Phaser.Math.Vector2().setToPolar(angle, 40);
      const sprite = this.spawnEntity(faction, Phaser.Math.Clamp(point.x + offset.x, WORLD_PADDING, this.scale.width - WORLD_PADDING), Phaser.Math.Clamp(point.y + offset.y, WORLD_PADDING, this.scale.height - WORLD_PADDING));
      sprite.setData('shielded', true);
      shieldFx(this, [sprite], 2600);
      this.time.delayedCall(2600, () => {
        if (sprite.active) sprite.setData('shielded', false);
      });
    }
  }

  private comboSurgeBloom(origin: Phaser.Math.Vector2, faction: FactionId): void {
    const radius = 160;
    const radiusSq = radius * radius;
    const now = this.time.now;
    const sprites = this.groups[faction].getChildren() as Phaser.Physics.Arcade.Image[];
    sprites.forEach((sprite) => {
      const spawnTime = (sprite.getData('spawnTime') as number) ?? 0;
      if (now - spawnTime > 3000) return;
      const dx = sprite.x - origin.x;
      const dy = sprite.y - origin.y;
      if (dx * dx + dy * dy > radiusSq) return;
      const body = sprite.body as Phaser.Physics.Arcade.Body | null;
      if (body) {
        body.velocity.scale(1.35);
      }
      this.tweens.add({
        targets: sprite,
        scale: { from: sprite.scale, to: sprite.scale * 1.2 },
        yoyo: true,
        duration: 180,
      });
    });
    burst(this, origin.x, origin.y, this.palette[faction], 'medium');
  }

  private spawnEarthFragments(origin: Phaser.Math.Vector2): number {
    const fragments = Phaser.Math.Between(2, 3);
    for (let i = 0; i < fragments; i += 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.FloatBetween(18, 42);
      const offset = new Phaser.Math.Vector2().setToPolar(angle, distance);
      const x = Phaser.Math.Clamp(origin.x + offset.x, WORLD_PADDING, this.scale.width - WORLD_PADDING);
      const y = Phaser.Math.Clamp(origin.y + offset.y, WORLD_PADDING, this.scale.height - WORLD_PADDING);
      const sprite = this.spawnEntity('Earth', x, y);
      sprite.setDisplaySize(ENTITY_SIZE * 0.75, ENTITY_SIZE * 0.75);
      sprite.setAlpha(0.9);
      sprite.setData('fragment', true);
      sprite.setData('baseSpeed', SPEED.Earth * BASE_SPEED * 0.85);
      const body = sprite.body as Phaser.Physics.Arcade.Body | null;
      if (body) {
        const radius = sprite.displayWidth * 0.45;
        body.setCircle(radius, (sprite.displayWidth - radius * 2) / 2, (sprite.displayHeight - radius * 2) / 2);
        const fragmentSpeed = (sprite.getData('baseSpeed') as number) * 0.9;
        body.maxVelocity.set(fragmentSpeed * 1.3, fragmentSpeed * 1.3);
        body.velocity.setLength(fragmentSpeed);
        body.velocity.rotate(Phaser.Math.FloatBetween(-0.6, 0.6));
      }
      this.tweens.add({
        targets: sprite,
        scaleX: { from: 0.5, to: 1 },
        scaleY: { from: 0.5, to: 1 },
        duration: 200,
        ease: Phaser.Math.Easing.Sine.Out,
      });
      this.time.delayedCall(6000, () => {
        if (!sprite.active) return;
        burst(this, sprite.x, sprite.y, this.palette.Earth, 'small');
        sprite.destroy();
      });
    }
    return fragments;
  }

  private spawnWaterDroplets(attacker: Phaser.Physics.Arcade.Image, origin: Phaser.Math.Vector2): number {
    const droplets = Phaser.Math.Between(1, 2);
    for (let i = 0; i < droplets; i += 1) {
      const offset = new Phaser.Math.Vector2().setToPolar(Phaser.Math.FloatBetween(0, Math.PI * 2), Phaser.Math.FloatBetween(12, 36));
      const x = Phaser.Math.Clamp(origin.x + offset.x, WORLD_PADDING, this.scale.width - WORLD_PADDING);
      const y = Phaser.Math.Clamp(origin.y + offset.y, WORLD_PADDING, this.scale.height - WORLD_PADDING);
      const sprite = this.spawnEntity('Water', x, y);
      sprite.setAlpha(0.85);
      const body = sprite.body as Phaser.Physics.Arcade.Body | null;
      if (body) {
        const direction = new Phaser.Math.Vector2(attacker.x - x, attacker.y - y).normalize();
        body.velocity.add(direction.scale(60));
      }
    }
    return droplets;
  }

  private applyEarthShield(anchor: Phaser.Physics.Arcade.Image): void {
    const radius = 160;
    const radiusSq = radius * radius;
    const sprites = this.groups.Earth.getChildren() as Phaser.Physics.Arcade.Image[];
    const targets = sprites.filter((sprite) => sprite.active && (sprite.x - anchor.x) ** 2 + (sprite.y - anchor.y) ** 2 <= radiusSq);
    if (!targets.length) return;
    targets.forEach((sprite) => sprite.setData('shielded', true));
    shieldFx(this, targets, 2800);
    this.time.delayedCall(2800, () => {
      targets.forEach((sprite) => {
        if (sprite.active) sprite.setData('shielded', false);
      });
    });
  }

  private triggerCritical(faction: FactionId, point: Phaser.Math.Vector2): void {
    switch (faction) {
      case 'Fire':
        this.fireCritical(point);
        break;
      case 'Water':
        this.waterCritical(point);
        break;
      case 'Earth':
        this.earthCritical(point);
        break;
      default:
        break;
    }
  }

  private fireCritical(point: Phaser.Math.Vector2): void {
    const radius = 90;
    const radiusSq = radius * radius;
    const earth = this.groups.Earth.getChildren() as Phaser.Physics.Arcade.Image[];
    const targets = earth
      .filter((sprite) => sprite.active && (sprite.x - point.x) ** 2 + (sprite.y - point.y) ** 2 <= radiusSq)
      .slice(0, 2);
    targets.forEach((sprite) => this.convert(sprite, 'Fire'));
    if (targets.length > 0) {
      burst(this, point.x, point.y, this.palette.Fire, 'medium');
    }
  }

  private waterCritical(point: Phaser.Math.Vector2): void {
    const radius = 140;
    const radiusSq = radius * radius;
    const fire = this.groups.Fire.getChildren() as Phaser.Physics.Arcade.Image[];
    fire.forEach((sprite) => {
      if (!sprite.active) return;
      const dx = sprite.x - point.x;
      const dy = sprite.y - point.y;
      if (dx * dx + dy * dy > radiusSq) return;
      const body = sprite.body as Phaser.Physics.Arcade.Body | null;
      if (body) {
        body.velocity.scale(0.6);
      }
      sprite.setAlpha(0.75);
      this.tweens.add({
        targets: sprite,
        alpha: { from: 0.75, to: 1 },
        duration: 520,
      });
    });
    burst(this, point.x, point.y, this.palette.Water, 'small');
  }

  private earthCritical(point: Phaser.Math.Vector2): void {
    const radius = 160;
    const radiusSq = radius * radius;
    const targets: Phaser.Physics.Arcade.Image[] = [];
    const earthSprites = this.groups.Earth.getChildren() as Phaser.Physics.Arcade.Image[];
    earthSprites.forEach((sprite) => {
      if (!sprite.active) return;
      const dx = sprite.x - point.x;
      const dy = sprite.y - point.y;
      if (dx * dx + dy * dy <= radiusSq) {
        sprite.setData('shielded', true);
        targets.push(sprite);
      }
    });
    if (!targets.length) return;
    shieldFx(this, targets, 2400);
    this.time.delayedCall(2400, () => {
      targets.forEach((sprite) => {
        if (sprite.active) sprite.setData('shielded', false);
      });
    });
  }

  private forEachSprite(callback: (sprite: Phaser.Physics.Arcade.Image, faction: FactionId) => void): void {
    FACTIONS.forEach((faction) => {
      const children = this.groups[faction].getChildren() as Phaser.Physics.Arcade.Image[];
      children.forEach((sprite) => {
        if (!sprite.active) return;
        callback(sprite, faction);
      });
    });
  }

  private animateBackground(equilibrium: number): void {
    if (!this.backgroundGrid) return;
    const stability = Phaser.Math.Clamp(equilibrium, 0, 1);
    const blend = Phaser.Display.Color.Interpolate.ColorWithColor(
      BACKGROUND_UNSTABLE,
      BACKGROUND_STABLE,
      100,
      Math.floor(stability * 100),
    );
    const tint = Phaser.Display.Color.GetColor(blend.r, blend.g, blend.b);
    const fillAlpha = 0.18 + stability * 0.14;
    const outlineAlpha = 0.22 + stability * 0.18;
    this.backgroundGrid.setFillStyle(tint, fillAlpha);
    this.backgroundGrid.setOutlineStyle(tint, outlineAlpha);
    this.backgroundGrid.setAlpha(fillAlpha);
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    setMutedAudio(this.muted);
    setBool(MUTED_KEY, this.muted);
    if (this.uiReady) {
      this.ui.setMuted(this.muted);
    }
  }

  private toggleColorblind(): void {
    this.colorblind = !this.colorblind;
    setBool(COLORBLIND_KEY, this.colorblind);
    this.palette = getPalette(this.colorblind);
    this.interventions.setPalette(this.palette);
    FACTIONS.forEach((id) => {
      const sprites = this.groups[id].getChildren() as Phaser.Physics.Arcade.Image[];
      sprites.forEach((sprite) => this.decorateFactionSprite(sprite, id, false));
    });
    if (this.uiReady) {
      this.ui.setColorblind(this.colorblind);
    }
    this.refreshAndPublish();
  }

  private toggleHud(): void {
    this.hudVisible = !this.hudVisible;
    if (this.uiReady) {
      this.ui.setHudVisible(this.hudVisible);
    }
    if (!this.hudVisible && this.infoOverlayVisible) {
      this.infoOverlayVisible = false;
      if (this.uiReady) {
        this.ui.setInfoVisible(false);
      }
    }
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.physics.world.isPaused = this.paused;
    this.applySpeed(this.currentSpeed);
    this.refreshAndPublish();
  }

  private canAct(): boolean {
    return !this.ended && !this.paused;
  }

  private applySpeed(multiplier: number): void {
    this.currentSpeed = multiplier;
    const target = this.paused ? 0 : multiplier;
    this.time.timeScale = target;
    this.physics.world.timeScale = target;
    if (this.uiReady) {
      this.ui.setSpeedMultiplier(multiplier);
    }
  }

  private cycleSpeed(): void {
    this.speedIndex = (this.speedIndex + 1) % this.speedLevels.length;
    this.applySpeed(this.getCurrentSpeed());
  }

  private getCurrentSpeed(): number {
    if (this.speedLevels.length === 0) {
      return 1;
    }
    const clampedIndex = Phaser.Math.Clamp(this.speedIndex, 0, this.speedLevels.length - 1);
    const preferredIndex = Math.min(1, this.speedLevels.length - 1);
    return (
      this.speedLevels[clampedIndex]
      ?? this.speedLevels[preferredIndex]
      ?? this.speedLevels[0]
      ?? 1
    );
  }

  private toggleInfoOverlay(): void {
    this.infoOverlayVisible = !this.infoOverlayVisible;
    if (this.uiReady) {
      this.ui.setInfoVisible(this.infoOverlayVisible);
    }
  }

  private exportSnapshot(): void {
    if (typeof document === 'undefined') return;
    const entities: Array<{ faction: FactionId; x: number; y: number; vx: number; vy: number; shielded: boolean }> = [];
    this.forEachSprite((sprite, faction) => {
      const body = sprite.body as Phaser.Physics.Arcade.Body | null;
      const velocity = body ? { vx: body.velocity.x, vy: body.velocity.y } : { vx: 0, vy: 0 };
      entities.push({ faction, x: sprite.x, y: sprite.y, ...velocity, shielded: !!sprite.getData('shielded') });
    });
    const payload = {
      mode: this.mode,
      elapsed: this.elapsed,
      seed: this.seed,
      counts: this.counts,
      stats: {
        comboTriggers: this.comboTriggers,
        fireSplits: this.fireSplits,
        waterDuplications: this.waterDuplications,
        earthShieldBursts: this.earthShieldBursts,
      },
      entities,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `4ttp-snapshot-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  private pointerWorld(pointer?: Phaser.Input.Pointer): Phaser.Math.Vector2 {
    const source = pointer ?? this.input.activePointer;
    const vec = new Phaser.Math.Vector2();
    this.cameras.main.getWorldPoint(source.x, source.y, vec);
    vec.x = Phaser.Math.Clamp(vec.x, WORLD_PADDING, this.scale.width - WORLD_PADDING);
    vec.y = Phaser.Math.Clamp(vec.y, WORLD_PADDING, this.scale.height - WORLD_PADDING);
    return vec;
  }

  private checkEndConditions(counts: FactionCounts, equilibrium: number): void {
    if (this.ended) return;
    const total = FACTIONS.reduce((sum, id) => sum + counts[id], 0);
    if (this.mode === "Balance") {
      const exhausted = FACTIONS.some((id) => counts[id] === 0);
      if (exhausted && total > 0) {
        this.endRun(counts, equilibrium);
      }
    } else {
      const dominant = FACTIONS.some((id) => counts[id] === total && total > 0);
      if (dominant) {
        this.endRun(counts, equilibrium);
      }
    }
  }

  private endRun(counts: FactionCounts, equilibrium: number): void {
    if (this.ended) return;
    this.ended = true;
    this.paused = true;
    this.physics.world.pause();
    this.time.timeScale = 0;
    if (this.infoOverlayVisible) {
      this.infoOverlayVisible = false;
      if (this.uiReady) {
        this.ui.setInfoVisible(false);
      }
    }

    const achievements = this.collectAchievements();
    const bestScore = this.updateBestScore(this.elapsed);
    const summary: GameEndSummary = {
      mode: this.mode,
      elapsed: this.elapsed,
      score: this.elapsed,
      bestScore,
      counts: { ...counts },
      achievements,
      seed: this.seed,
    };

    if (this.uiReady) {
      this.ui.showEndPanel(summary);
    } else {
      this.pendingEnd = summary;
    }
    this.publishTick(counts, equilibrium);
  }

  private collectAchievements(): string[] {
    const achievements: string[] = [];
    if (this.equilibriumStable >= EQUILIBRIUM_WINDOW) achievements.push("Equilibrium Master");
    if (this.fireSplits >= 6) achievements.push("Thermal Overlord");
    if (this.waterDuplications >= 5) achievements.push("Liquid Echoist");
    if (this.earthShieldBursts >= 4) achievements.push("Core Sentinel");
    if (this.comboTriggers >= 3) achievements.push("Synergy Engineer");
    if (!this.nukeUsed) achievements.push("Pacifist Protocol");
    if (this.interventionsUsed <= 5) achievements.push("Silent Operator");
    if (this.mode === "Domination" && this.elapsed < 120) achievements.push("Domination Blitz");
    return achievements;
  }

  private updateBestScore(score: number): number | null {
    const key = BEST_SCORE_KEY[this.mode];
    if (this.mode === "Balance") {
      const previous = getNumber(key, 0);
      if (score > previous) {
        setNumber(key, score);
        return score;
      }
      return previous > 0 ? previous : null;
    }

    const previous = getNumber(key, 0);
    if (previous <= 0 || score < previous) {
      setNumber(key, score);
      return score;
    }
    return previous > 0 ? previous : null;
  }

  private decorateFactionSprite(sprite: Phaser.Physics.Arcade.Image, faction: FactionId, fresh: boolean): void {
    const baseKey = TEXTURE_KEY[faction];
    const variantKey = this.colorblind ? `${baseKey}-alt` : baseKey;
    const textureKey = this.textures.exists(variantKey) ? variantKey : baseKey;
    sprite.setTexture(textureKey);
    sprite.setDisplaySize(ENTITY_SIZE, ENTITY_SIZE);
    sprite.setOrigin(0.5, 0.5);
    sprite.setTint(this.palette[faction]);
    if (fresh) {
      sprite.setAlpha(Phaser.Math.FloatBetween(0.82, 1));
      sprite.setData('spawnTime', this.time.now);
      this.tweens.add({
        targets: sprite,
        scale: { from: 0.6, to: 1 },
        duration: 220,
        ease: Phaser.Math.Easing.Back.Out,
      });
    }
    sprite.setData('baseSpeed', SPEED[faction] * BASE_SPEED);
    if (faction === 'Water' && typeof sprite.getData('wavePhase') !== 'number') {
      sprite.setData('wavePhase', Phaser.Math.FloatBetween(0, Math.PI * 2));
    }
    if (sprite.preFX) {
      sprite.preFX.clear();
      sprite.preFX.addGlow(this.palette[faction], 2.2, 0, false, 0.1, 6);
    }
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (body) {
      const baseSpeed = (sprite.getData('baseSpeed') as number) || BASE_SPEED;
      body.maxVelocity.set(baseSpeed * 1.4, baseSpeed * 1.4);
      if (fresh) {
        body.velocity.setLength(baseSpeed);
      }
    }
    const existingTween = sprite.getData('animTween') as Phaser.Tweens.Tween | undefined;
    if (existingTween) existingTween.remove();
    sprite.setScale(1);
    sprite.setAngle(0);
    const tween = this.createFactionTween(sprite, faction);
    sprite.setData('animTween', tween ?? null);
    if (!sprite.getData('animCleanup')) {
      sprite.once(Phaser.GameObjects.Events.DESTROY, () => {
        const stored = sprite.getData('animTween') as Phaser.Tweens.Tween | undefined;
        if (stored) stored.remove();
      });
      sprite.setData('animCleanup', true);
    }
  }

  private createFactionTween(sprite: Phaser.Physics.Arcade.Image, faction: FactionId): Phaser.Tweens.Tween | null {
    switch (faction) {
      case 'Fire':
        return this.tweens.add({
          targets: sprite,
          duration: 280,
          repeat: -1,
          ease: 'Linear',
          keyframes: [
            { offset: 0, scaleX: 1, scaleY: 1, angle: 0.2 },
            { offset: 0.4, scaleX: 1.03, scaleY: 1.03, angle: -0.4 },
            { offset: 0.65, scaleX: 0.99, scaleY: 0.99, angle: 0.3 },
            { offset: 1, scaleX: 1, scaleY: 1, angle: 0 },
          ],
        });
      case 'Water':
        return this.tweens.add({
          targets: sprite,
          duration: 1600,
          repeat: -1,
          ease: Phaser.Math.Easing.Sine.InOut,
          keyframes: [
            { offset: 0, scaleX: 0.98, scaleY: 1.02, angle: -0.4 },
            { offset: 0.5, scaleX: 1.04, scaleY: 0.96, angle: 0.4 },
            { offset: 1, scaleX: 0.98, scaleY: 1.02, angle: -0.4 },
          ],
        });
      case 'Earth':
        return this.tweens.add({
          targets: sprite,
          duration: 320,
          repeat: -1,
          ease: Phaser.Math.Easing.Sine.InOut,
          keyframes: [
            { offset: 0, scaleX: 1, scaleY: 1, angle: 0 },
            { offset: 0.35, scaleX: 0.98, scaleY: 1.02, angle: 1.2 },
            { offset: 0.65, scaleX: 1.02, scaleY: 0.98, angle: -1.2 },
            { offset: 1, scaleX: 1, scaleY: 1, angle: 0 },
          ],
        });
      default:
        return null;
    }
  }

  private applyFactionBehaviours(dt: number): void {
    const fireSprites = this.groups.Fire.getChildren() as Phaser.Physics.Arcade.Image[];
    fireSprites.forEach((sprite) => this.updateFireBehaviour(sprite, dt));
    const waterSprites = this.groups.Water.getChildren() as Phaser.Physics.Arcade.Image[];
    waterSprites.forEach((sprite) => this.updateWaterBehaviour(sprite, dt));
    const earthSprites = this.groups.Earth.getChildren() as Phaser.Physics.Arcade.Image[];
    earthSprites.forEach((sprite) => this.updateEarthBehaviour(sprite, dt));
  }

  private updateFireBehaviour(sprite: Phaser.Physics.Arcade.Image, dt: number): void {
    if (!sprite.active) return;
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return;
    const jitter = 45;
    body.velocity.x += Phaser.Math.FloatBetween(-jitter, jitter) * dt;
    body.velocity.y += Phaser.Math.FloatBetween(-jitter, jitter) * dt;
    this.maintainBaseSpeed(sprite, 0.25);
  }

  private updateWaterBehaviour(sprite: Phaser.Physics.Arcade.Image, dt: number): void {
    if (!sprite.active) return;
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return;
    let phase = sprite.getData('wavePhase') as number | undefined;
    if (typeof phase !== 'number') {
      phase = Phaser.Math.FloatBetween(0, Math.PI * 2);
    }
    phase += dt * 3.2;
    sprite.setData('wavePhase', phase);
    body.velocity.rotate(Math.sin(phase) * 0.05);
    this.maintainBaseSpeed(sprite, 0.08);
  }

  private updateEarthBehaviour(sprite: Phaser.Physics.Arcade.Image, dt: number): void {
    if (!sprite.active) return;
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return;
    body.velocity.scale(Phaser.Math.Clamp(1 - dt * 0.18, 0.7, 1));
    this.maintainBaseSpeed(sprite, 0.04);
  }

  private maintainBaseSpeed(sprite: Phaser.Physics.Arcade.Image, lerp: number): void {
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return;
    const baseSpeed = (sprite.getData('baseSpeed') as number) || BASE_SPEED;
    const current = body.velocity.length();
    if (current <= 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      body.velocity.setToPolar(angle, baseSpeed);
      return;
    }
    const newLength = Phaser.Math.Linear(current, baseSpeed, lerp);
    body.velocity.setLength(newLength);
  }

  private refreshAndPublish(): void {
    const counts = this.meter.counts();
    const equilibrium = computeEquilibrium(counts);
    this.publishTick(counts, equilibrium);
  }

  private publishTick(counts: FactionCounts, equilibrium: number): void {
    this.counts = { ...counts };
    const payload: GameTickPayload = {
      mode: this.mode,
      elapsed: this.elapsed,
      counts: { ...counts },
      equilibrium,
      total: FACTIONS.reduce((sum, id) => sum + counts[id], 0),
      paused: this.paused,
      ended: this.ended,
    };
    this.lastPayload = payload;
    if (this.uiReady) {
      this.ui.tick(payload);
    }
  }

  private updateCooldowns(): void {
    this.cooldowns = this.interventions.cooldowns();
    if (this.uiReady) {
      this.ui.setCooldowns(this.cooldowns);
    }
  }

  private generateSeed(): string {
    if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
      const buf = new Uint32Array(2);
      crypto.getRandomValues(buf);
      return Array.from(buf).map((value) => value.toString(16)).join("").slice(0, 12);
    }
    return Math.random().toString(36).slice(2, 14);
  }
}

export type { GameTickPayload, GameEndSummary } from "./types";
