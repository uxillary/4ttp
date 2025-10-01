import Phaser from "phaser";
import type { Mode, FactionId } from "../core/types";
import { FACTIONS, SPEED, TEXTURE_KEY } from "../core/factions";
import { beats } from "../core/rules";
import { BalanceMeter, computeEquilibrium, type FactionCounts } from "../systems/balanceMeter";
import {
  Interventions,
  EFFECT_DURATIONS_MS,
  type CooldownState,
  type AbilityKey,
} from "../systems/interventions";
import { getPalette } from "../core/palette";
import { ENTITY_SIZE, BASE_SPEED, ENTITY_DRAG, GRID_SIZE } from "../core/constants";
import { initSeed, getSeed, between } from "../utils/rng";
import { playSfx, setMuted as setMutedAudio } from "../audio";
import { getBool, setBool, getNumber, setNumber } from "../utils/save";
import { UI } from "./UI";
import { burst, pulse, shieldFx } from "../utils/fx";
import type { GameTickPayload, GameEndSummary } from "./types";
import { logEvent } from "../systems/log";

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
const SOFT_ENTITY_CAP = 480;
const ENTITY_SCALE_MIN = 0.45;
const ENTITY_SCALE_MAX = 1;
const FX_SUPPRESSION_THRESHOLD = 520;
const WORLD_PADDING = 48;
const INTERACTION_COOLDOWN_ATTACKER = 1400;
const INTERACTION_COOLDOWN_DEFENDER = 900;
const EARTH_FRAGMENT_CHANCE = 0.55;
const WATER_DUPLICATION_CHANCE = 0.5;
const COMBO_DEFINITIONS = [
  { sequence: ['2', '5'] as const, window: 4000, effect: 'freezeExplosion' as const },
  { sequence: ['3', '4'] as const, window: 3500, effect: 'resonantBulwark' as const },
  { sequence: ['4', '1'] as const, window: 4000, effect: 'terraEscort' as const },
  { sequence: ['1', '3'] as const, window: 3200, effect: 'surgeBloom' as const },
  { sequence: ['3', '5'] as const, window: 3600, effect: 'overclockDetonation' as const },
] as const;
type ComboEffect = (typeof COMBO_DEFINITIONS)[number]['effect'];

const BACKGROUND_UNSTABLE = Phaser.Display.Color.ValueToColor(0xff6347);
const BACKGROUND_STABLE = Phaser.Display.Color.ValueToColor(0x55e6a5);
const MINIMAP_SIZE = 168;
const MINIMAP_PADDING = 18;
const MINIMAP_TOP_OFFSET = 252;
const ENTITY_TRAIL_CONFIG: Record<FactionId, { tint: number; lifespan: number }> = {
  Fire: { tint: 0xff5c43, lifespan: 220 },
  Water: { tint: 0x55e6a5, lifespan: 260 },
  Earth: { tint: 0xc2a97a, lifespan: 320 },
};

const SPAWN_KIND_MAP: Record<FactionId, 'Thermal' | 'Liquid' | 'Core'> = {
  Fire: 'Thermal',
  Water: 'Liquid',
  Earth: 'Core',
};

const COMBO_LABEL: Record<ComboEffect, string> = {
  freezeExplosion: 'Freeze Explosion',
  resonantBulwark: 'Resonant Bulwark',
  terraEscort: 'Terra Escort',
  surgeBloom: 'Surge Bloom',
  overclockDetonation: 'Overclock Detonation',
};

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
  private speedLevels: number[] = [0.6, 0.85, 1.1];
  private speedIndex = 1;
  private currentSpeed = 1;
  private comboHistory: Array<{ key: AbilityKey; time: number; data?: ComboContext }> = [];
  private abilityQueue: Array<{ key: AbilityKey; point?: Phaser.Math.Vector2 }> = [];
  private lastAbilityTime = 0;
  private driftAccumulator = 0;
  private despawnAccumulator = 0;
  private globalEntityScale = 1;
  private lowDetailFx = false;
  private miniMapContainer?: Phaser.GameObjects.Container;
  private miniMapGraphics?: Phaser.GameObjects.Graphics;
  private totalEntityCount = 0;
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
    this.interventions.setLowDetail(this.lowDetailFx);

    this.events.on('entity-created', this.handleEntityCreated, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off('entity-created', this.handleEntityCreated, this);
    });

    this.createMiniMap();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
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
        this.queueAbility('1', this.pointerWorld());
        break;
      case '2':
        this.queueAbility('2');
        break;
      case '3':
        this.queueAbility('3');
        break;
      case '4':
        this.queueAbility('4');
        break;
      case '5':
        this.queueAbility('5', this.pointerWorld());
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
      this.processAbilityQueue();
      const counts = this.meter.counts();
      this.counts = { ...counts };
      const equilibrium = computeEquilibrium(counts);
      if (equilibrium >= EQUILIBRIUM_THRESHOLD) {
        this.equilibriumStable += dt;
      } else {
        this.equilibriumStable = 0;
      }
      this.totalEntityCount = FACTIONS.reduce((sum, id) => sum + counts[id], 0);
      this.updateEntityScale(dt);
      this.updateFxDetailLevel();
      this.applyProgressiveDrift(dt);
      this.enforceSoftCap(dt);
      this.applyFactionBehaviours(dt);
      this.checkEndConditions(counts, equilibrium);
      this.publishTick(counts, equilibrium);
      this.animateBackground(equilibrium);
      this.updateMiniMap();
    } else {
      const equilibrium = computeEquilibrium(this.counts);
      this.publishTick(this.counts, equilibrium);
      this.animateBackground(equilibrium);
      this.processAbilityQueue();
      this.updateMiniMap();
    }
    this.updateCooldowns();
  }

  private processAbilityQueue(): void {
    if (this.abilityQueue.length === 0) {
      return;
    }
    if (!this.canAct()) {
      this.abilityQueue.length = 0;
      return;
    }
    const queue = [...this.abilityQueue];
    this.abilityQueue.length = 0;
    queue.forEach((entry) => {
      switch (entry.key) {
        case '1':
          if (entry.point) this.trySpawnAt(entry.point.clone());
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
          if (entry.point) this.tryNukeAt(entry.point.clone());
          break;
        default:
          break;
      }
    });
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
    this.abilityQueue.length = 0;
    this.lastAbilityTime = 0;
    this.driftAccumulator = 0;
    this.despawnAccumulator = 0;
    this.globalEntityScale = 1;
    this.lowDetailFx = false;
    this.totalEntityCount = 0;
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
      if (!this.canSpawnAdditional(1)) {
        break;
      }
      const faction = FACTIONS[i % FACTIONS.length]!;
      const x = between(WORLD_PADDING, this.scale.width - WORLD_PADDING);
      const y = between(WORLD_PADDING, this.scale.height - WORLD_PADDING);
      this.spawnEntity(faction, x, y);
    }
    this.totalEntityCount = this.totalActiveEntities();
    this.globalEntityScale = Phaser.Math.Clamp(1 - this.totalEntityCount / ENTITY_CAP, ENTITY_SCALE_MIN, ENTITY_SCALE_MAX);
    this.rescaleActiveSprites();
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
    sprite.setData('speedScale', 1);
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

  private queueAbility(key: AbilityKey, point?: Phaser.Math.Vector2): void {
    if (point) {
      this.abilityQueue.push({ key, point: point.clone() });
    } else {
      this.abilityQueue.push({ key });
    }
  }

  private registerInput(): void {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) return;
      this.queueAbility('1', this.pointerWorld(pointer));
    });

    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    keyboard.on("keydown-ONE", () => this.queueAbility('1', this.pointerWorld()));
    keyboard.on("keydown-TWO", () => this.queueAbility('2'));
    keyboard.on("keydown-THREE", () => this.queueAbility('3'));
    keyboard.on("keydown-FOUR", () => this.queueAbility('4'));
    keyboard.on("keydown-FIVE", () => this.queueAbility('5', this.pointerWorld()));

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
      this.onAbilityUsed();
      playSfx('spawn');
      this.registerAbilityUse('1', { point: point.clone(), faction });
      logEvent({ t: 'spawn', at: this.elapsed, kind: SPAWN_KIND_MAP[faction], n: 1 });
      this.refreshAndPublish();
    }
  }

  private trySlowStrongest(): void {
    if (!this.canAct()) return;
    const faction = this.meter.strongest();
    if (this.interventions.slowStrongest()) {
      this.interventionsUsed += 1;
      this.onAbilityUsed();
      playSfx('slow');
      this.registerAbilityUse('2', { faction });
      logEvent({
        t: 'buff',
        at: this.elapsed,
        who: `Faction:${faction}`,
        kind: 'Slow',
        dur: EFFECT_DURATIONS_MS.slow / 1000,
      });
    }
  }

  private tryBuffWeakest(): void {
    if (!this.canAct()) return;
    const faction = this.meter.weakest();
    if (this.interventions.buffWeakest()) {
      this.interventionsUsed += 1;
      this.onAbilityUsed();
      playSfx('buff');
      this.registerAbilityUse('3', { faction });
      logEvent({
        t: 'buff',
        at: this.elapsed,
        who: `Faction:${faction}`,
        kind: 'Buff',
        dur: EFFECT_DURATIONS_MS.buff / 1000,
      });
    }
  }

  private tryShieldWeakest(): void {
    if (!this.canAct()) return;
    const faction = this.meter.weakest();
    if (this.interventions.shieldWeakest()) {
      this.interventionsUsed += 1;
      this.onAbilityUsed();
      playSfx('shield');
      const count = this.groups[faction].countActive(true);
      this.registerAbilityUse('4', { faction, count });
      logEvent({
        t: 'buff',
        at: this.elapsed,
        who: `Faction:${faction}`,
        kind: 'Shield',
        dur: EFFECT_DURATIONS_MS.shield / 1000,
      });
      this.refreshAndPublish();
    }
  }

  private tryNukeAt(point: Phaser.Math.Vector2): void {
    if (!this.canAct()) return;
    const purged = this.interventions.nuke(point);
    if (purged > 0) {
      this.interventionsUsed += 1;
      this.nukeUsed = true;
      this.onAbilityUsed();
      playSfx('nuke');
      this.registerAbilityUse('5', { point: point.clone() });
      logEvent({ t: 'system', at: this.elapsed, msg: `Nuke purged ${purged} entities` });
      this.refreshAndPublish();
    }
  }

  private onAbilityUsed(): void {
    this.lastAbilityTime = this.elapsed;
    this.driftAccumulator = 0;
    this.despawnAccumulator = Math.max(0, this.despawnAccumulator - 0.5);
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
    const label = COMBO_LABEL[effect];
    if (label) {
      logEvent({ t: 'system', at: this.elapsed, msg: `Combo triggered: ${label}` });
    }
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
      case 'overclockDetonation':
        this.comboOverclockDetonation(second.point ?? first.point ?? this.pointerWorld());
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
    if (!this.canTriggerInteraction(attacker, defender)) {
      return;
    }
    const impact = new Phaser.Math.Vector2(defender.x, defender.y);
    if (
      attackerFaction === 'Fire' &&
      defenderFaction === 'Earth' &&
      this.canSpawnAdditional(1) &&
      Phaser.Math.FloatBetween(0, 1) < EARTH_FRAGMENT_CHANCE
    ) {
      this.fireSplits += this.spawnEarthFragments(impact);
    } else if (
      attackerFaction === 'Water' &&
      defenderFaction === 'Fire' &&
      this.canSpawnAdditional(1) &&
      Phaser.Math.FloatBetween(0, 1) < WATER_DUPLICATION_CHANCE
    ) {
      this.waterDuplications += this.spawnWaterDroplets(attacker, impact);
    } else if (attackerFaction === 'Earth' && defenderFaction === 'Water') {
      this.earthShieldBursts += 1;
      this.applyEarthShield(attacker);
    }
    if (Phaser.Math.FloatBetween(0, 1) < 0.05) {
      this.triggerCritical(attackerFaction, impact);
    }
  }

  private canTriggerInteraction(attacker: Phaser.Physics.Arcade.Image, defender: Phaser.Physics.Arcade.Image): boolean {
    const now = this.time.now;
    const attackerReady = (attacker.getData('nextInteraction') as number | undefined) ?? 0;
    const defenderGuarded = (defender.getData('interactionGuard') as number | undefined) ?? 0;
    if (now < attackerReady || now < defenderGuarded) {
      return false;
    }
    attacker.setData('nextInteraction', now + INTERACTION_COOLDOWN_ATTACKER);
    defender.setData('interactionGuard', now + INTERACTION_COOLDOWN_DEFENDER);
    return true;
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
    shieldFx(this, sprites, 4800, this.lowDetailFx ? 'low' : 'high');
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
      if (!this.canSpawnAdditional(1)) {
        break;
      }
      const angle = (Math.PI * 2 * i) / count;
      const offset = new Phaser.Math.Vector2().setToPolar(angle, 40);
      const sprite = this.spawnEntity(faction, Phaser.Math.Clamp(point.x + offset.x, WORLD_PADDING, this.scale.width - WORLD_PADDING), Phaser.Math.Clamp(point.y + offset.y, WORLD_PADDING, this.scale.height - WORLD_PADDING));
      sprite.setData('shielded', true);
      shieldFx(this, [sprite], 2600, this.lowDetailFx ? 'low' : 'high');
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

  private comboOverclockDetonation(origin: Phaser.Math.Vector2): void {
    const radius = 140;
    const radiusSq = radius * radius;
    const sprites = this.collectSprites();
    const candidates = sprites
      .map((sprite) => ({
        sprite,
        dist: (sprite.x - origin.x) * (sprite.x - origin.x) + (sprite.y - origin.y) * (sprite.y - origin.y),
      }))
      .filter((entry) => entry.dist <= radiusSq)
      .sort((a, b) => a.dist - b.dist);
    const extra = candidates.slice(0, 4);
    extra.forEach(({ sprite }) => sprite.destroy());
    const shockwave = candidates.slice(4);
    shockwave.forEach(({ sprite }) => {
      if (!sprite.active) return;
      const body = sprite.body as Phaser.Physics.Arcade.Body | null;
      if (body) {
        body.velocity.scale(0.6);
      }
      this.tweens.add({
        targets: sprite,
        alpha: { from: sprite.alpha, to: Math.max(0.45, sprite.alpha * 0.7) },
        yoyo: true,
        duration: 220,
      });
    });
    burst(this, origin.x, origin.y, 0xffc67a, 'large');
    this.cameras.main.shake(140, 0.006);
  }

  private spawnEarthFragments(origin: Phaser.Math.Vector2): number {
    if (!this.canSpawnAdditional(1)) {
      return 0;
    }
    const fragments = Phaser.Math.Between(1, 2);
    let spawned = 0;
    for (let i = 0; i < fragments; i += 1) {
      if (!this.canSpawnAdditional(1)) {
        break;
      }
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.FloatBetween(12, 30);
      const offset = new Phaser.Math.Vector2().setToPolar(angle, distance);
      const x = Phaser.Math.Clamp(origin.x + offset.x, WORLD_PADDING, this.scale.width - WORLD_PADDING);
      const y = Phaser.Math.Clamp(origin.y + offset.y, WORLD_PADDING, this.scale.height - WORLD_PADDING);
      const sprite = this.spawnEntity('Earth', x, y);
      this.applySpriteScale(sprite, this.globalEntityScale * 0.85);
      sprite.setAlpha(0.9);
      sprite.setData('fragment', true);
      sprite.setData('baseSpeed', SPEED.Earth * BASE_SPEED * 0.85);
      const body = sprite.body as Phaser.Physics.Arcade.Body | null;
      if (body) {
        const radius = sprite.displayWidth * 0.45;
        body.setCircle(radius, (sprite.displayWidth - radius * 2) / 2, (sprite.displayHeight - radius * 2) / 2);
        const fragmentSpeed = (sprite.getData('baseSpeed') as number) * 0.9;
        body.maxVelocity.set(fragmentSpeed * 1.25, fragmentSpeed * 1.25);
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
      spawned += 1;
    }
    if (spawned > 0) {
      logEvent({ t: 'spawn', at: this.elapsed, kind: SPAWN_KIND_MAP.Earth, n: spawned });
    }
    return spawned;
  }

  private spawnWaterDroplets(attacker: Phaser.Physics.Arcade.Image, origin: Phaser.Math.Vector2): number {
    if (!this.canSpawnAdditional(1)) {
      return 0;
    }
    let spawned = 0;
    const droplets = 1 + (this.canSpawnAdditional(1) && Phaser.Math.FloatBetween(0, 1) < 0.35 ? 1 : 0);
    for (let i = 0; i < droplets; i += 1) {
      if (!this.canSpawnAdditional(1)) {
        break;
      }
      const offset = new Phaser.Math.Vector2().setToPolar(
        Phaser.Math.FloatBetween(0, Math.PI * 2),
        Phaser.Math.FloatBetween(10, 26),
      );
      const x = Phaser.Math.Clamp(origin.x + offset.x, WORLD_PADDING, this.scale.width - WORLD_PADDING);
      const y = Phaser.Math.Clamp(origin.y + offset.y, WORLD_PADDING, this.scale.height - WORLD_PADDING);
      const sprite = this.spawnEntity('Water', x, y);
      sprite.setAlpha(0.85);
      const body = sprite.body as Phaser.Physics.Arcade.Body | null;
      if (body) {
        const direction = new Phaser.Math.Vector2(attacker.x - x, attacker.y - y).normalize();
        body.velocity.add(direction.scale(60));
      }
      spawned += 1;
    }
    if (spawned > 0) {
      logEvent({ t: 'spawn', at: this.elapsed, kind: SPAWN_KIND_MAP.Water, n: spawned });
    }
    return spawned;
  }

  private applyEarthShield(anchor: Phaser.Physics.Arcade.Image): void {
    const radius = 160;
    const radiusSq = radius * radius;
    const sprites = this.groups.Earth.getChildren() as Phaser.Physics.Arcade.Image[];
    const targets = sprites.filter((sprite) => sprite.active && (sprite.x - anchor.x) ** 2 + (sprite.y - anchor.y) ** 2 <= radiusSq);
    if (!targets.length) return;
    targets.forEach((sprite) => sprite.setData('shielded', true));
    shieldFx(this, targets, 2800, this.lowDetailFx ? 'low' : 'high');
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
    shieldFx(this, targets, 2400, this.lowDetailFx ? 'low' : 'high');
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
    const altKey = `${baseKey}-alt`;
    const preferAlt = this.colorblind || this.globalEntityScale < 0.9;
    const textureKey = preferAlt && this.textures.exists(altKey) ? altKey : baseKey;
    sprite.setTexture(textureKey);
    this.applySpriteScale(sprite, this.globalEntityScale);
    const baseVisualScale = sprite.displayWidth / Math.max(sprite.width, 1);
    sprite.setData('visualScale', baseVisualScale);
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
    const now = this.time.now;
    const existingNext = (sprite.getData('nextInteraction') as number | undefined) ?? 0;
    const existingGuard = (sprite.getData('interactionGuard') as number | undefined) ?? 0;
    if (fresh) {
      sprite.setData('nextInteraction', Math.max(now + 320, existingNext));
      sprite.setData('interactionGuard', Math.max(now + 200, existingGuard));
    } else {
      sprite.setData('nextInteraction', Math.max(now + 240, existingNext));
      sprite.setData('interactionGuard', Math.max(now + 160, existingGuard));
    }
    sprite.setData('baseSpeed', SPEED[faction] * BASE_SPEED);
    if (fresh || typeof sprite.getData('speedScale') !== 'number') {
      sprite.setData('speedScale', 1);
    }
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
    sprite.setScale((sprite.getData('visualScale') as number) ?? baseVisualScale);
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
    this.configureTrail(sprite, faction);
  }

  private createFactionTween(sprite: Phaser.Physics.Arcade.Image, faction: FactionId): Phaser.Tweens.Tween | null {
    const baseScale = (sprite.getData('visualScale') as number) ?? 1;
    switch (faction) {
      case 'Fire':
        return this.tweens.add({
          targets: sprite,
          duration: 280,
          repeat: -1,
          ease: 'Linear',
          keyframes: [
            { offset: 0, scaleX: baseScale, scaleY: baseScale, angle: 0.2 },
            { offset: 0.4, scaleX: baseScale * 1.03, scaleY: baseScale * 1.03, angle: -0.4 },
            { offset: 0.65, scaleX: baseScale * 0.99, scaleY: baseScale * 0.99, angle: 0.3 },
            { offset: 1, scaleX: baseScale, scaleY: baseScale, angle: 0 },
          ],
        });
      case 'Water':
        return this.tweens.add({
          targets: sprite,
          duration: 1600,
          repeat: -1,
          ease: Phaser.Math.Easing.Sine.InOut,
          keyframes: [
            { offset: 0, scaleX: baseScale * 0.98, scaleY: baseScale * 1.02, angle: -0.4 },
            { offset: 0.5, scaleX: baseScale * 1.04, scaleY: baseScale * 0.96, angle: 0.4 },
            { offset: 1, scaleX: baseScale * 0.98, scaleY: baseScale * 1.02, angle: -0.4 },
          ],
        });
      case 'Earth':
        return this.tweens.add({
          targets: sprite,
          duration: 320,
          repeat: -1,
          ease: Phaser.Math.Easing.Sine.InOut,
          keyframes: [
            { offset: 0, scaleX: baseScale, scaleY: baseScale, angle: 0 },
            { offset: 0.35, scaleX: baseScale * 0.98, scaleY: baseScale * 1.02, angle: 1.2 },
            { offset: 0.65, scaleX: baseScale * 1.02, scaleY: baseScale * 0.98, angle: -1.2 },
            { offset: 1, scaleX: baseScale, scaleY: baseScale, angle: 0 },
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
    const jitter = 32;
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
    phase += dt * 2.4;
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
    const speedScale = (sprite.getData('speedScale') as number) ?? 1;
    const targetSpeed = baseSpeed * speedScale;
    const current = body.velocity.length();
    if (current <= 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      body.velocity.setToPolar(angle, targetSpeed);
      return;
    }
    const newLength = Phaser.Math.Linear(current, targetSpeed, lerp);
    body.velocity.setLength(newLength);
  }

  private applySpriteScale(sprite: Phaser.Physics.Arcade.Image, scale: number): void {
    const clamped = Phaser.Math.Clamp(scale, ENTITY_SCALE_MIN * 0.8, ENTITY_SCALE_MAX);
    const size = ENTITY_SIZE * clamped;
    sprite.setDisplaySize(size, size);
    this.syncBodyShape(sprite);
  }

  private syncBodyShape(sprite: Phaser.Physics.Arcade.Image): void {
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return;
    const radius = sprite.displayWidth * 0.45;
    const offset = (sprite.displayWidth - radius * 2) / 2;
    body.setCircle(radius, offset, offset);
    body.setDamping(true);
    body.setDrag(ENTITY_DRAG, ENTITY_DRAG);
  }

  private configureTrail(sprite: Phaser.Physics.Arcade.Image, faction: FactionId): void {
    const config = ENTITY_TRAIL_CONFIG[faction];
    if (!this.textures.exists('dot')) {
      return;
    }
    const existing = sprite.getData('trailEmitter') as Phaser.GameObjects.Particles.ParticleEmitter | undefined;
    if (existing && existing.scene) {
      existing.stop();
      existing.destroy();
    }
    const emitter = this.add.particles(sprite.x, sprite.y, 'dot', {
      quantity: this.lowDetailFx ? 1 : 2,
      frequency: this.lowDetailFx ? 140 : 90,
      lifespan: config.lifespan,
      speed: { min: 0, max: 18 },
      alpha: { start: 0.42, end: 0 },
      scale: { start: 0.55 * this.globalEntityScale, end: 0 },
      tint: config.tint,
      blendMode: Phaser.BlendModes.ADD,
    }) as Phaser.GameObjects.Particles.ParticleEmitter;
    emitter.startFollow(sprite);
    sprite.setData('trailEmitter', emitter);
    sprite.once(Phaser.GameObjects.Events.DESTROY, () => {
      emitter.stop();
      emitter.destroy();
    });
  }

  private updateEntityScale(dt: number): void {
    const target = Phaser.Math.Clamp(1 - this.totalEntityCount / ENTITY_CAP, ENTITY_SCALE_MIN, ENTITY_SCALE_MAX);
    const lerpFactor = Phaser.Math.Clamp(dt * 6, 0, 1);
    const next = Phaser.Math.Linear(this.globalEntityScale, target, lerpFactor);
    if (Math.abs(next - this.globalEntityScale) > 0.015) {
      this.globalEntityScale = next;
      this.rescaleActiveSprites();
    }
  }

  private rescaleActiveSprites(): void {
    FACTIONS.forEach((faction) => {
      const sprites = this.groups[faction].getChildren() as Phaser.Physics.Arcade.Image[];
      sprites.forEach((sprite) => {
        if (!sprite.active) return;
        this.applySpriteScale(sprite, this.globalEntityScale);
        const baseScale = sprite.displayWidth / Math.max(sprite.width, 1);
        sprite.setData('visualScale', baseScale);
        sprite.setScale(baseScale);
        this.configureTrail(sprite, faction);
      });
    });
  }

  private updateFxDetailLevel(): void {
    const lowDetail = this.totalEntityCount > FX_SUPPRESSION_THRESHOLD;
    if (lowDetail === this.lowDetailFx) {
      return;
    }
    this.lowDetailFx = lowDetail;
    this.interventions.setLowDetail(lowDetail);
    this.rescaleActiveSprites();
  }

  private createMiniMap(): void {
    if (this.miniMapContainer) {
      this.miniMapContainer.destroy(true);
    }
    const container = this.add
      .container(MINIMAP_PADDING, MINIMAP_TOP_OFFSET)
      .setDepth(58)
      .setScrollFactor(0);
    const background = this.add
      .rectangle(0, 0, MINIMAP_SIZE + 16, MINIMAP_SIZE + 16, 0x041425, 0.86)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x123252, 0.85);
    const graphics = this.add.graphics({ x: 8, y: 8 }).setScrollFactor(0).setDepth(53);
    container.add([background, graphics]);
    this.miniMapContainer = container;
    this.miniMapGraphics = graphics;
  }

  private updateMiniMap(): void {
    if (!this.miniMapGraphics || !this.miniMapGraphics.scene) {
      return;
    }
    const gfx = this.miniMapGraphics;
    gfx.clear();
    gfx.fillStyle(0x0a1b30, 0.78);
    gfx.fillRoundedRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE, 10);
    const width = Math.max(this.scale.width, 1);
    const height = Math.max(this.scale.height, 1);
    const scaleX = MINIMAP_SIZE / width;
    const scaleY = MINIMAP_SIZE / height;
    const dotSize = Phaser.Math.Clamp(2 + this.globalEntityScale * 3, 2, 6);
    FACTIONS.forEach((faction) => {
      gfx.fillStyle(this.palette[faction], 0.85);
      const sprites = this.groups[faction].getChildren() as Phaser.Physics.Arcade.Image[];
      sprites.forEach((sprite) => {
        if (!sprite.active) return;
        const x = Phaser.Math.Clamp(sprite.x * scaleX, 0, MINIMAP_SIZE);
        const y = Phaser.Math.Clamp(sprite.y * scaleY, 0, MINIMAP_SIZE);
        gfx.fillRect(x - dotSize * 0.5, y - dotSize * 0.5, dotSize, dotSize);
      });
    });
  }

  private handleResize(size: Phaser.Structs.Size): void {
    const { width, height } = size;
    this.physics.world.setBounds(0, 0, width, height);
    if (this.backgroundGrid) {
      this.backgroundGrid.setDisplaySize(width, height);
      this.backgroundGrid.setPosition(width / 2, height / 2);
    }
    if (this.scanlineOverlay) {
      this.scanlineOverlay.setSize(width, height);
      this.scanlineOverlay.setPosition(width / 2, height / 2);
    }
    const availableHeight = height - MINIMAP_SIZE - MINIMAP_PADDING;
    const y = Phaser.Math.Clamp(MINIMAP_TOP_OFFSET, MINIMAP_PADDING, availableHeight);
    this.miniMapContainer?.setPosition(MINIMAP_PADDING, y);
  }

  private applyProgressiveDrift(dt: number): void {
    const idle = this.elapsed - this.lastAbilityTime;
    if (idle <= 6) {
      this.driftAccumulator = 0;
      return;
    }
    const elapsedFactor = Phaser.Math.Clamp((this.elapsed - 30) / 90, 0, 1);
    const idleFactor = Phaser.Math.Clamp((idle - 6) / 24, 0, 1);
    const rate = (0.25 + 0.6 * elapsedFactor) * idleFactor;
    this.driftAccumulator += dt * rate;
    if (this.driftAccumulator >= 1) {
      this.driftAccumulator -= 1;
      this.forceEquilibriumDrift();
    }
  }

  private forceEquilibriumDrift(): void {
    const strongest = this.meter.strongest();
    const weakest = this.meter.weakest();
    if (strongest === weakest) {
      return;
    }
    const weakGroup = this.groups[weakest];
    const candidates = (weakGroup.getChildren() as Phaser.Physics.Arcade.Image[]).filter((sprite) => sprite.active);
    if (candidates.length === 0) {
      return;
    }
    const target = Phaser.Utils.Array.GetRandom(candidates);
    if (!target) return;
    this.convert(target, strongest);
  }

  private enforceSoftCap(dt: number): void {
    if (this.totalEntityCount <= SOFT_ENTITY_CAP) {
      this.despawnAccumulator = 0;
      return;
    }
    const excess = this.totalEntityCount - SOFT_ENTITY_CAP;
    this.despawnAccumulator += dt * Phaser.Math.Clamp(excess / 24, 0.15, 1.2);
    while (this.despawnAccumulator >= 1) {
      this.despawnAccumulator -= 1;
      this.fadeDespawnOne();
    }
  }

  private fadeDespawnOne(): void {
    const faction = this.meter.strongest();
    const sprites = (this.groups[faction].getChildren() as Phaser.Physics.Arcade.Image[]).filter((sprite) => sprite.active);
    if (sprites.length === 0) {
      return;
    }
    const sprite = Phaser.Utils.Array.GetRandom(sprites);
    if (!sprite) {
      return;
    }
    this.tweens.add({
      targets: sprite,
      alpha: { from: sprite.alpha, to: 0 },
      scale: { from: 1, to: 0.4 },
      duration: 260,
      ease: Phaser.Math.Easing.Sine.In,
      onComplete: () => {
        sprite.destroy();
      },
    });
  }

  private totalActiveEntities(): number {
    return (Object.values(this.groups) as Phaser.Physics.Arcade.Group[]).reduce(
      (sum, group) => sum + group.countActive(true),
      0,
    );
  }

  private canSpawnAdditional(amount: number): boolean {
    return this.totalActiveEntities() + amount <= ENTITY_CAP;
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
