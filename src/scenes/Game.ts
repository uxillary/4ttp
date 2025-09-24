import Phaser from "phaser";
import type { Mode, FactionId } from "../core/types";
import { FACTIONS, SPEED } from "../core/factions";
import { beats } from "../core/rules";
import { BalanceMeter, computeEquilibrium, type FactionCounts } from "../systems/balanceMeter";
import { Interventions, type CooldownState } from "../systems/interventions";
import { getPalette } from "../core/palette";
import { initSeed, getSeed, between } from "../utils/rng";
import { playSfx, setMuted as setMutedAudio } from "../audio";
import { getBool, setBool, getNumber, setNumber } from "../utils/save";
import { UI } from "./UI";
import { burst, pulse } from "../utils/fx";
import type { GameTickPayload, GameEndSummary } from "./types";

type GameInitData = {
  mode?: Mode;
  seed?: string | null;
};

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

export class Game extends Phaser.Scene {
  private mode: Mode = "Balance";
  private seed = "";
  private groups!: Record<FactionId, Phaser.Physics.Arcade.Group>;
  private meter!: BalanceMeter;
  private interventions!: Interventions;
  private ui!: UI;
  private uiReady = false;
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

  private equilibriumStable = 0;
  private nukeUsed = false;
  private interventionsUsed = 0;

  private pendingSeed: string | null = null;

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

    this.physics.world.setBounds(0, 0, this.scale.width, this.scale.height);
    this.physics.world.setBoundsCollision(true, true, true, true);

    this.buildGroups();
    this.meter = new BalanceMeter(this.groups);
    this.interventions = new Interventions(this, this.groups, { maxEntities: ENTITY_CAP });
    this.interventions.setPalette(this.palette);

    this.spawnInitial(SPAWN_COUNT);
    this.setupCollisions();
    this.registerInput();

    this.updateCooldowns();
    this.refreshAndPublish();
    this.ensureUiBinding();
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
    this.ui.setMode(this.mode);
    this.ui.setHudVisible(this.hudVisible);
    this.ui.setMutedAndColorblind(this.muted, this.colorblind);
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

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;
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
      this.checkEndConditions(counts, equilibrium);
      this.publishTick(counts, equilibrium);
    } else {
      this.publishTick(this.counts, computeEquilibrium(this.counts));
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
    this.equilibriumStable = 0;
    this.nukeUsed = false;
    this.interventionsUsed = 0;
    this.cooldowns = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    this.counts = { Fire: 0, Water: 0, Earth: 0 };
    this.physics.world.resume();
    this.time.timeScale = 1;
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
      this.convert(spriteB, factionA);
    } else if (beats(factionB, factionA)) {
      this.convert(spriteA, factionB);
    }
  };

  private convert(sprite: Phaser.Physics.Arcade.Image, faction: FactionId): void {
    sprite.setData("faction", faction);
    sprite.setData("shielded", false);
    sprite.setTint(this.palette[faction]);
    sprite.setData("baseSpeed", SPEED[faction]);
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (body) {
      body.velocity.scale(1.04);
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
    keyboard.on("keydown-R", (event: KeyboardEvent) => this.restart(event.shiftKey));
    keyboard.on("keydown-TAB", (event: KeyboardEvent) => {
      event.preventDefault();
      this.toggleMode();
    });
  }

  private trySpawnAt(point: Phaser.Math.Vector2): void {
    if (!this.canAct()) return;
    const success = this.interventions.spawnWeakest(point);
    if (success) {
      this.interventionsUsed += 1;
      playSfx('spawn');
      this.refreshAndPublish();
    }
  }

  private trySlowStrongest(): void {
    if (!this.canAct()) return;
    if (this.interventions.slowStrongest()) {
      this.interventionsUsed += 1;
      playSfx('slow');
    }
  }

  private tryBuffWeakest(): void {
    if (!this.canAct()) return;
    if (this.interventions.buffWeakest()) {
      this.interventionsUsed += 1;
      playSfx('buff');
    }
  }

  private tryShieldWeakest(): void {
    if (!this.canAct()) return;
    if (this.interventions.shieldWeakest()) {
      this.interventionsUsed += 1;
      playSfx('shield');
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
      this.refreshAndPublish();
    }
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    setMutedAudio(this.muted);
    setBool(MUTED_KEY, this.muted);
    this.ui.setMuted(this.muted);
  }

  private toggleColorblind(): void {
    this.colorblind = !this.colorblind;
    setBool(COLORBLIND_KEY, this.colorblind);
    this.palette = getPalette(this.colorblind);
    this.interventions.setPalette(this.palette);
    this.ui.setColorblind(this.colorblind);
    this.refreshAndPublish();
  }

  private toggleHud(): void {
    this.hudVisible = !this.hudVisible;
    this.ui.setHudVisible(this.hudVisible);
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.physics.world.isPaused = this.paused;
    this.time.timeScale = this.paused ? 0 : 1;
    this.refreshAndPublish();
  }

  private canAct(): boolean {
    return !this.ended && !this.paused;
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

    this.ui.showEndPanel(summary);
    this.publishTick(counts, equilibrium);
  }

  private collectAchievements(): string[] {
    const achievements: string[] = [];
    if (this.equilibriumStable >= EQUILIBRIUM_WINDOW) achievements.push("EquilibriumKeeper");
    if (!this.nukeUsed) achievements.push("Merciful");
    if (this.interventionsUsed <= 5) achievements.push("Minimalist");
    if (this.mode === "Domination" && this.elapsed < 120) achievements.push("SwiftDominion");
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
