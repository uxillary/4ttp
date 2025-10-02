import Phaser from "phaser";
import { Bus } from "../systems/EventBus";
import { clearLog, getLogHistory, type GameEvent } from "../systems/log";
import {
  HUD_FONT_FAMILY,
  HUD_MONO_FONT_FAMILY,
  HUD_RADIUS,
  PANEL_BACKGROUND_ALPHA,
  PANEL_BACKGROUND_COLOR,
  PANEL_BORDER_ALPHA,
  PANEL_BORDER_COLOR,
  getHudScale,
} from "./theme";

const PANEL_BASE_WIDTH = 420;
const PANEL_BASE_HEIGHT = 228;
const MINIMIZED_HEIGHT = 28;
const HEADER_PADDING_X = 14;
const HEADER_PADDING_Y = 12;
const HEADER_GAP = 8;
const CHIP_PADDING_X = 10;
const CHIP_PADDING_Y = 5;
const CHIP_GAP = 6;
const CHIP_ROW_GAP = 6;
const ACTION_GAP = 8;
const ACTION_PADDING_X = 12;
const BODY_PADDING_X = 14;
const BODY_PADDING_Y = 10;
const LINE_HEIGHT = 16;
const MAX_VISIBLE_LINES = 50;
const MAX_BUFFER = 250;

const DAMAGE_TYPES: Array<GameEvent["t"]> = ["hit", "kill"];
const STATUS_TYPES: Array<GameEvent["t"]> = ["buff"];
const SPAWN_TYPES: Array<GameEvent["t"]> = ["spawn"];
const SYSTEM_TYPES: Array<GameEvent["t"]> = ["system"];

type FilterKey = "all" | "damage" | "status" | "spawns" | "system";

type FilterChip = {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  width: number;
  height: number;
};

type HeaderButton = {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  width: number;
  height: number;
};

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  damage: "Damage",
  status: "Status",
  spawns: "Spawns",
  system: "System",
};

const FILTER_ORDER: FilterKey[] = ["all", "damage", "status", "spawns", "system"];

function matchesFilter(filter: FilterKey, event: GameEvent): boolean {
  switch (filter) {
    case "all":
      return true;
    case "damage":
      return DAMAGE_TYPES.includes(event.t);
    case "status":
      return STATUS_TYPES.includes(event.t);
    case "spawns":
      return SPAWN_TYPES.includes(event.t);
    case "system":
      return SYSTEM_TYPES.includes(event.t);
    default:
      return true;
  }
}

function formatEvent(event: GameEvent): string {
  const stamp = event.at.toFixed(1).padStart(6, " ");
  switch (event.t) {
    case "hit":
      return `@${stamp} HIT ${event.src} → ${event.dst}  -${event.amount.toFixed(0)} (${event.rule})`;
    case "kill":
      return `@${stamp} KILL ${event.src} ✕ ${event.dst} (${event.rule})`;
    case "buff":
      return `@${stamp} STATUS ${event.who} +${event.kind} ${(event.dur / 1000).toFixed(1)}s`;
    case "spawn":
      return `@${stamp} SPAWN ${event.kind} ×${event.n}`;
    case "system":
      return `@${stamp} SYSTEM ${event.msg}`;
    default:
      return `@${stamp} EVENT`;
  }
}

export class VerboseCLI extends Phaser.GameObjects.Container {
  private readonly background: Phaser.GameObjects.Graphics;
  private readonly border: Phaser.GameObjects.Graphics;
  private readonly header: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.Text;
  private readonly filterChips: Record<FilterKey, FilterChip> = {} as Record<FilterKey, FilterChip>;
  private readonly pauseButton: HeaderButton;
  private readonly clearButton: HeaderButton;
  private readonly collapseButton: HeaderButton;
  private readonly body: Phaser.GameObjects.Container;
  private readonly maskRect: Phaser.GameObjects.Rectangle;
  private readonly bodyMask: Phaser.Display.Masks.GeometryMask;
  private readonly scrollZone: Phaser.GameObjects.Zone;
  private readonly lines: Phaser.GameObjects.Text[] = [];

  private hudScale = getHudScale();
  private panelWidth = PANEL_BASE_WIDTH;
  private panelHeight = PANEL_BASE_HEIGHT;
  private headerHeight = 0;
  private bodyWidth = 0;
  private bodyHeight = 0;
  private lineHeight = LINE_HEIGHT;

  private events: GameEvent[] = [];
  private filter: FilterKey = "all";
  private paused = false;
  private minimized = false;
  private stickToBottom = true;
  private scrollIndex = 0;
  private maxScrollIndex = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    this.setScrollFactor(0);
    this.setDepth(46);

    this.background = scene.add.graphics();
    this.border = scene.add.graphics();
    this.background.setScrollFactor(0);
    this.border.setScrollFactor(0);

    this.header = scene.add.container(0, 0);
    this.header.setScrollFactor(0);

    this.title = scene.add
      .text(0, 0, "Verbose CLI", {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: "14px",
        fontStyle: "600",
        color: "#d8ecff",
      })
      .setOrigin(0, 0);
    this.header.add(this.title);

    FILTER_ORDER.forEach((key) => {
      const chip = this.createFilterChip(FILTER_LABELS[key], key);
      this.filterChips[key] = chip;
      this.header.add(chip.container);
    });

    this.pauseButton = this.createActionButton("Pause");
    this.clearButton = this.createActionButton("Clear");
    this.collapseButton = this.createActionButton("Minimise");

    this.header.add([this.pauseButton.container, this.clearButton.container, this.collapseButton.container]);

    this.body = scene.add.container(0, 0);
    this.body.setScrollFactor(0);

    this.maskRect = scene.add.rectangle(0, 0, this.panelWidth, this.panelHeight, 0x000000, 0);
    this.maskRect.setScrollFactor(0);
    this.maskRect.setOrigin(0, 0);
    this.maskRect.setVisible(false);
    this.bodyMask = this.maskRect.createGeometryMask();
    this.body.setMask(this.bodyMask);

    for (let i = 0; i < MAX_VISIBLE_LINES; i += 1) {
      const line = scene.add
        .text(0, 0, "", {
          fontFamily: HUD_MONO_FONT_FAMILY,
          fontSize: `${LINE_HEIGHT}px`,
          color: "#c4d9ff",
        })
        .setOrigin(0, 0);
      line.setScrollFactor(0);
      this.body.add(line);
      this.lines.push(line);
    }

    this.scrollZone = scene.add.zone(0, 0, this.panelWidth, this.panelHeight);
    this.scrollZone.setOrigin(0, 0);
    this.scrollZone.setScrollFactor(0);
    this.scrollZone.setInteractive({ cursor: "default" });

    this.add([this.background, this.border, this.header, this.body, this.scrollZone]);

    this.scrollZone.on(
      "wheel",
      (_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number, _dz: number, event: WheelEvent) => {
        if (this.minimized || this.bodyHeight <= 0) return;
        event.preventDefault();
        event.stopPropagation();
        const direction = Math.sign(dy) || 1;
        this.scrollIndex = Phaser.Math.Clamp(this.scrollIndex + direction, 0, this.maxScrollIndex);
        this.stickToBottom = this.scrollIndex === 0;
        this.render();
      },
    );

    this.scrollZone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      pointer.event?.preventDefault?.();
      pointer.event?.stopPropagation?.();
    });

    this.pauseButton.container.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      pointer.event?.preventDefault?.();
      pointer.event?.stopPropagation?.();
      this.togglePause();
    });

    this.clearButton.container.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      pointer.event?.preventDefault?.();
      pointer.event?.stopPropagation?.();
      clearLog();
    });

    this.collapseButton.container.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      pointer.event?.preventDefault?.();
      pointer.event?.stopPropagation?.();
      this.toggleMinimized();
    });

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      Bus.off("log", this.handleIncomingEvent, this);
      Bus.off("log:clear", this.handleLogCleared, this);
    });

    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      Bus.off("log", this.handleIncomingEvent, this);
      Bus.off("log:clear", this.handleLogCleared, this);
      this.maskRect.destroy();
    });

    Bus.on("log", this.handleIncomingEvent, this);
    Bus.on("log:clear", this.handleLogCleared, this);

    this.events = getLogHistory().slice(-MAX_BUFFER);
    this.layout();
    this.render(true);
  }

  setPanelActive(enabled: boolean): void {
    this.setVisible(enabled);
    if (enabled && !this.minimized && this.bodyHeight > 0) {
      this.scrollZone.setInteractive({ cursor: "default" });
    } else {
      this.scrollZone.disableInteractive();
    }
  }

  getDimensions(scale = this.hudScale): { width: number; height: number } {
    const width = Math.round(PANEL_BASE_WIDTH * Phaser.Math.Clamp(scale, 1, 1.5));
    const heightBase = this.minimized ? MINIMIZED_HEIGHT : PANEL_BASE_HEIGHT;
    const height = Math.round(heightBase * Phaser.Math.Clamp(scale, 1, 1.5));
    return { width, height };
  }

  setHudScale(scale: number): void {
    const clamped = Phaser.Math.Clamp(scale, 1, 1.5);
    if (Math.abs(clamped - this.hudScale) < 0.001) return;
    this.hudScale = clamped;
    this.layout();
    this.render(true);
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.pauseButton.label.setText(this.paused ? "Resume" : "Pause");
    this.layout();
    if (!this.paused) {
      this.scrollIndex = 0;
      this.stickToBottom = true;
      this.render(true);
    }
  }

  private toggleMinimized(): void {
    this.minimized = !this.minimized;
    this.collapseButton.label.setText(this.minimized ? "Expand" : "Minimise");
    if (this.minimized) {
      this.scrollZone.disableInteractive();
    } else if (this.visible) {
      this.scrollZone.setInteractive({ cursor: "default" });
    }
    this.layout();
    this.render(true);
  }

  private createFilterChip(label: string, key: FilterKey): FilterChip {
    const container = this.scene.add.container(0, 0);
    container.setSize(1, 1);
    container.setScrollFactor(0);
    const background = this.scene.add.graphics();
    background.setScrollFactor(0);
    const text = this.scene.add
      .text(0, 0, label, {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: "12px",
        fontStyle: "500",
        color: "#d6ecff",
      })
      .setOrigin(0.5);
    text.setScrollFactor(0);
    container.add([background, text]);
    container.setInteractive(new Phaser.Geom.Rectangle(0, 0, 1, 1), Phaser.Geom.Rectangle.Contains);
    container.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      pointer.event?.preventDefault?.();
      pointer.event?.stopPropagation?.();
      if (this.filter === key) return;
      this.filter = key;
      this.scrollIndex = 0;
      this.stickToBottom = true;
      this.layout();
      this.render(true);
    });
    return { container, background, label: text, width: 0, height: 0 };
  }

  private createActionButton(label: string): HeaderButton {
    const container = this.scene.add.container(0, 0);
    container.setScrollFactor(0);
    const background = this.scene.add.graphics();
    background.setScrollFactor(0);
    const text = this.scene.add
      .text(0, 0, label, {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: "12px",
        fontStyle: "600",
        color: "#e5f4ff",
      })
      .setOrigin(0.5);
    text.setScrollFactor(0);
    container.add([background, text]);
    container.setSize(1, 1);
    container.setInteractive(new Phaser.Geom.Rectangle(0, 0, 1, 1), Phaser.Geom.Rectangle.Contains);
    return { container, background, label: text, width: 0, height: 0 };
  }

  private handleIncomingEvent(event: GameEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_BUFFER) {
      this.events.splice(0, this.events.length - MAX_BUFFER);
    }
    if (this.paused) {
      this.updateScrollBounds();
      return;
    }
    if (this.stickToBottom) {
      this.scrollIndex = 0;
    }
    this.render();
  }

  private handleLogCleared(): void {
    this.events = [];
    this.scrollIndex = 0;
    this.stickToBottom = true;
    this.render(true);
  }

  private layout(): void {
    this.panelWidth = Math.round(PANEL_BASE_WIDTH * this.hudScale);
    const baseHeight = this.minimized ? MINIMIZED_HEIGHT : PANEL_BASE_HEIGHT;
    this.panelHeight = Math.round(baseHeight * this.hudScale);
    this.lineHeight = Math.round(LINE_HEIGHT * this.hudScale);

    const radius = HUD_RADIUS * this.hudScale;
    this.background.clear();
    this.background.fillStyle(PANEL_BACKGROUND_COLOR, PANEL_BACKGROUND_ALPHA);
    this.background.fillRoundedRect(0, 0, this.panelWidth, this.panelHeight, radius);

    this.border.clear();
    this.border.lineStyle(1, PANEL_BORDER_COLOR, PANEL_BORDER_ALPHA);
    this.border.strokeRoundedRect(0.5, 0.5, this.panelWidth - 1, this.panelHeight - 1, Math.max(0, radius - 1));

    this.title.setFontSize(14 * this.hudScale);

    const paddingX = HEADER_PADDING_X * this.hudScale;
    const paddingY = HEADER_PADDING_Y * this.hudScale;
    const chipPaddingX = CHIP_PADDING_X * this.hudScale;
    const chipPaddingY = CHIP_PADDING_Y * this.hudScale;
    const chipHeight = Math.max(this.title.height, (LINE_HEIGHT + CHIP_PADDING_Y * 2) * this.hudScale * 0.9);
    const chipGap = CHIP_GAP * this.hudScale;
    const chipRowGap = CHIP_ROW_GAP * this.hudScale;
    const actionGap = ACTION_GAP * this.hudScale;
    const actionPaddingX = ACTION_PADDING_X * this.hudScale;

    this.title.setPosition(paddingX, paddingY);

    const actionButtons: HeaderButton[] = [this.pauseButton, this.clearButton, this.collapseButton];
    let actionX = this.panelWidth - paddingX;
    const actionHeight = chipHeight;

    actionButtons.forEach((button) => {
      const text = button.label;
      text.setFontSize(12 * this.hudScale);
      const width = text.width + actionPaddingX * 2;
      const height = actionHeight;
      actionX -= width;
      button.width = width;
      button.height = height;
      button.container.setPosition(actionX, paddingY);
      this.drawChip(button.background, width, height, this.minimized ? 0.55 : 0.7, true);
      text.setPosition(width / 2, height / 2);
      button.container.setSize(width, height);
      actionX -= actionGap;
    });

    const filtersTop = this.title.y + this.title.height + HEADER_GAP * this.hudScale;
    let chipX = paddingX;
    let chipY = filtersTop;
    let chipsBottom = filtersTop;

    FILTER_ORDER.forEach((key) => {
      const chip = this.filterChips[key];
      const label = chip.label;
      label.setFontSize(12 * this.hudScale);
      label.setText(FILTER_LABELS[key]);
      const width = label.width + chipPaddingX * 2;
      const height = chipHeight;
      if (chipX + width > this.panelWidth - paddingX) {
        chipX = paddingX;
        chipY += height + chipRowGap;
      }
      chip.width = width;
      chip.height = height;
      chip.container.setPosition(chipX, chipY);
      chip.container.setSize(width, height);
      chip.container.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
      const active = this.filter === key;
      this.drawChip(chip.background, width, height, active ? 0.9 : 0.65, active);
      label.setPosition(width / 2, height / 2);
      chipX += width + chipGap;
      chipsBottom = chipY + height;
    });

    const firstRowBottom = paddingY + actionHeight;
    const titleBottom = this.title.y + this.title.height;
    const filtersBottom = FILTER_ORDER.length ? chipsBottom : titleBottom;
    const headerBottom = Math.max(firstRowBottom, titleBottom, filtersBottom);
    this.headerHeight = this.minimized ? this.panelHeight : headerBottom + paddingY;

    this.header.setSize(this.panelWidth, this.headerHeight);

    const bodyPaddingX = BODY_PADDING_X * this.hudScale;
    const bodyPaddingY = BODY_PADDING_Y * this.hudScale;
    this.bodyWidth = Math.max(0, this.panelWidth - bodyPaddingX * 2);
    this.bodyHeight = this.minimized
      ? 0
      : Math.max(0, this.panelHeight - this.headerHeight - bodyPaddingY * 2);

    this.body.setPosition(bodyPaddingX, this.headerHeight + bodyPaddingY);
    this.maskRect.setPosition(bodyPaddingX, this.headerHeight + bodyPaddingY);
    this.maskRect.setSize(this.bodyWidth, this.bodyHeight);
    this.scrollZone.setPosition(bodyPaddingX, this.headerHeight + bodyPaddingY);
    this.scrollZone.setSize(this.bodyWidth, this.bodyHeight);

    this.body.setVisible(!this.minimized);

    if (this.minimized || this.bodyHeight <= 0) {
      this.scrollZone.disableInteractive();
    } else if (this.visible) {
      this.scrollZone.setInteractive({ cursor: "default" });
    }

    this.updateScrollBounds();
    this.setSize(this.panelWidth, this.panelHeight);
  }

  private drawChip(
    graphics: Phaser.GameObjects.Graphics,
    width: number,
    height: number,
    alpha: number,
    active: boolean,
  ): void {
    const radius = HUD_RADIUS * this.hudScale * 0.6;
    graphics.clear();
    const fill = active ? 0x1a3c5d : 0x102132;
    graphics.fillStyle(fill, alpha);
    graphics.fillRoundedRect(0, 0, width, height, radius);
    graphics.lineStyle(1, PANEL_BORDER_COLOR, PANEL_BORDER_ALPHA);
    graphics.strokeRoundedRect(0.5, 0.5, width - 1, height - 1, Math.max(0, radius - 1));
  }

  private updateScrollBounds(): void {
    const filtered = this.events.filter((event) => matchesFilter(this.filter, event));
    const capacity = this.bodyHeight > 0 ? Math.max(1, Math.min(MAX_VISIBLE_LINES, Math.floor(this.bodyHeight / this.lineHeight))) : 0;
    this.maxScrollIndex = capacity > 0 ? Math.max(0, filtered.length - capacity) : 0;
    this.scrollIndex = Phaser.Math.Clamp(this.scrollIndex, 0, this.maxScrollIndex);
    if (this.stickToBottom) {
      this.scrollIndex = 0;
    }
  }

  private render(forceBottom = false): void {
    if (this.minimized || this.bodyHeight <= 0) {
      this.lines.forEach((line) => line.setVisible(false));
      return;
    }

    const filtered = this.events.filter((event) => matchesFilter(this.filter, event));
    const capacity = Math.max(1, Math.min(MAX_VISIBLE_LINES, Math.floor(this.bodyHeight / this.lineHeight)));
    this.maxScrollIndex = Math.max(0, filtered.length - capacity);

    if (forceBottom) {
      this.scrollIndex = 0;
      this.stickToBottom = true;
    } else if (this.stickToBottom) {
      this.scrollIndex = 0;
    } else {
      this.scrollIndex = Phaser.Math.Clamp(this.scrollIndex, 0, this.maxScrollIndex);
    }

    const end = filtered.length - this.scrollIndex;
    const start = Math.max(0, end - capacity);
    const visible = filtered.slice(start, end);

    const baseY = 0;
    this.lines.forEach((line, index) => {
      const entry = visible[index];
      if (!entry) {
        line.setVisible(false);
        return;
      }
      line.setVisible(true);
      line.setFontSize(this.lineHeight * 0.92);
      line.setText(formatEvent(entry));
      line.setPosition(baseY, index * this.lineHeight);
    });
  }
}
