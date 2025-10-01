import Phaser from 'phaser';
import { clearLog, getLogHistory, logEvent, logEvents, type GameEvent } from '../systems/log';
import {
  HUD_FONT_FAMILY,
  HUD_MONO_FONT_FAMILY,
  HUD_RADIUS,
  PANEL_BACKGROUND_ALPHA,
  PANEL_BACKGROUND_COLOR,
  PANEL_BORDER_ALPHA,
  PANEL_BORDER_COLOR,
  getHudScale,
} from './theme';

type FilterKey = 'all' | 'damage' | 'status' | 'spawns' | 'system';

type FilterButton = {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  width: number;
  height: number;
};

type IconButton = {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Text;
};

const FILTER_LABELS: Record<FilterKey, string> = {
  all: 'All',
  damage: 'Damage',
  status: 'Status',
  spawns: 'Spawns',
  system: 'System',
};

const FILTER_ORDER: FilterKey[] = ['all', 'damage', 'status', 'spawns', 'system'];

const DAMAGE_TYPES = new Set<GameEvent['t']>(['hit', 'kill']);
const STATUS_TYPES = new Set<GameEvent['t']>(['buff']);
const SPAWN_TYPES = new Set<GameEvent['t']>(['spawn']);
const SYSTEM_TYPES = new Set<GameEvent['t']>(['system']);
const BASE_HEADER_HEIGHT = 44;
const BASE_BODY_PADDING_X = 12;
const BASE_BODY_PADDING_Y = 8;
const FILTER_GAP = 6;
const CHIP_PADDING_X = 8;
const CHIP_PADDING_Y = 4;
const CHIP_HEIGHT = 24;
const ICON_BUTTON_SIZE = 26;
const TITLE_FONT_SIZE = 14;
const BODY_FONT_SIZE = 12;
const HEADER_HORIZONTAL_PADDING = 16;
const CHIP_ROW_GAP = 4;

export class VerboseCLI extends Phaser.GameObjects.Container {
  private readonly background: Phaser.GameObjects.Graphics;
  private readonly border: Phaser.GameObjects.Graphics;
  private readonly header: Phaser.GameObjects.Container;
  private readonly filterButtons: Record<FilterKey, FilterButton> = {} as Record<FilterKey, FilterButton>;
  private readonly pauseButton: IconButton;
  private readonly clearButton: IconButton;
  private readonly collapseButton: IconButton;
  private readonly body: Phaser.GameObjects.Container;
  private readonly maskRect: Phaser.GameObjects.Rectangle;
  private readonly bodyMask: Phaser.Display.Masks.GeometryMask;
  private readonly scrollZone: Phaser.GameObjects.Zone;
  private readonly resizeHandle: Phaser.GameObjects.Triangle;
  private readonly chipTooltip: Phaser.GameObjects.Container;
  private readonly chipTooltipBackground: Phaser.GameObjects.Graphics;
  private readonly chipTooltipLabel: Phaser.GameObjects.Text;
  private readonly lines: Phaser.GameObjects.Text[] = [];

  private events: GameEvent[] = [];
  private filtered: GameEvent[] = [];
  private filter: FilterKey = 'all';
  private paused = false;
  private minimized = false;
  private atBottom = true;
  private scrollOffset = 0;
  private maxScroll = 0;

  private currentWidth: number;
  private currentHeight: number;
  private savedHeight: number;
  private baseWidth: number;
  private baseHeight: number;
  private hudScale = getHudScale();
  private headerHeight = BASE_HEADER_HEIGHT;

  private readonly minWidth = 320;
  private readonly maxWidth = 620;
  private readonly minHeight = 140;
  private readonly maxHeight = 320;
  private readonly maxVisible = 50;
  private readonly lineHeight = 18;

  private resizing = false;
  private resizeStart: { x: number; y: number; width: number; height: number } | null = null;

  private scaled(value: number): number {
    return value * this.hudScale;
  }

  private bodyPaddingX(): number {
    return this.scaled(BASE_BODY_PADDING_X);
  }

  private bodyPaddingY(): number {
    return this.scaled(BASE_BODY_PADDING_Y);
  }

  constructor(scene: Phaser.Scene, x: number, y: number, width = 420, height = 180) {
    super(scene, x, y);
    this.currentWidth = Phaser.Math.Clamp(width, this.minWidth, this.maxWidth);
    this.currentHeight = Phaser.Math.Clamp(height, this.minHeight, this.maxHeight);
    this.savedHeight = this.currentHeight;
    this.baseWidth = this.currentWidth / this.hudScale;
    this.baseHeight = this.currentHeight / this.hudScale;
    this.setSize(this.currentWidth, this.currentHeight);
    this.setScrollFactor(0);

    this.background = scene.add.graphics();
    this.border = scene.add.graphics();
    this.background.setScrollFactor(0);
    this.border.setScrollFactor(0);

    this.header = scene.add.container(0, 0);
    const title = scene.add
      .text(0, 0, 'Events', {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: `${TITLE_FONT_SIZE}px`,
        fontStyle: '600',
        color: '#d7efff',
      })
      .setOrigin(0, 0);
    this.header.add(title);

    FILTER_ORDER.forEach((key) => {
      const button = this.createFilterButton(FILTER_LABELS[key], key);
      this.filterButtons[key] = button;
      this.header.add(button.container);
    });

    this.pauseButton = this.createIconButton('⏸');
    this.clearButton = this.createIconButton('🧹');
    this.collapseButton = this.createIconButton('⌄');
    [this.pauseButton, this.clearButton, this.collapseButton].forEach((entry) =>
      this.header.add(entry.container),
    );

    this.body = scene.add.container(0, 0);
    this.maskRect = scene.add
      .rectangle(0, 0, this.currentWidth, this.bodyHeight())
      .setOrigin(0)
      .setVisible(false)
      .setActive(false);
    this.maskRect.setScrollFactor(0);
    this.bodyMask = this.maskRect.createGeometryMask();
    this.body.setMask(this.bodyMask);

    for (let i = 0; i < this.maxVisible; i += 1) {
      const line = scene.add
        .text(0, 0, '', {
          fontFamily: HUD_MONO_FONT_FAMILY,
          fontSize: `${BODY_FONT_SIZE}px`,
          color: '#c0d6f6',
        })
        .setOrigin(0, 0);
      line.setFontSize(BODY_FONT_SIZE * this.hudScale);
      line.setVisible(false);
      this.body.add(line);
      this.lines.push(line);
    }

    this.scrollZone = scene.add
      .zone(0, 0, this.currentWidth, this.bodyHeight())
      .setOrigin(0)
      .setInteractive({ cursor: 'default' });
    this.scrollZone.setScrollFactor(0);

    this.resizeHandle = scene.add
      .triangle(this.currentWidth - 18, this.currentHeight - 18, 0, 16, 16, 16, 16, 0, 0xffffff, 0.28)
      .setOrigin(0, 0);
    this.resizeHandle.setStrokeStyle(1, 0x2a4f73, 0.75);
    this.resizeHandle.setInteractive({ cursor: 'nwse-resize' });

    this.chipTooltipBackground = scene.add.graphics();
    this.chipTooltipBackground.setScrollFactor(0);
    this.chipTooltipLabel = scene.add
      .text(0, 0, '', {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: `${BODY_FONT_SIZE}px`,
        fontStyle: '500',
        color: '#e2f4ff',
      })
      .setOrigin(0.5);
    this.chipTooltipLabel.setScrollFactor(0);
    this.chipTooltip = scene.add
      .container(0, 0, [this.chipTooltipBackground, this.chipTooltipLabel])
      .setVisible(false);
    this.chipTooltip.setScrollFactor(0);

    this.add([
      this.background,
      this.border,
      this.maskRect,
      this.body,
      this.scrollZone,
      this.header,
      this.resizeHandle,
      this.chipTooltip,
    ]);

    this.registerInteractions();
    this.bindLogEvents();

    const history = getLogHistory();
    if (history.length) {
      this.events = history.slice();
    }
    this.applyFilter(true);
    this.updateHeaderLayout();
    this.updateLayout();

    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      logEvents.off('event', this.handleIncomingEvent, this);
      logEvents.off('cleared', this.handleLogCleared, this);
      this.scene.input.off('pointermove', this.handlePointerMove, this);
      this.scene.input.off('pointerup', this.handlePointerUp, this);
    });
  }

  override destroy(fromScene?: boolean): void {
    this.background.destroy();
    this.border.destroy();
    this.header.destroy(true);
    this.body.destroy(true);
    this.maskRect.destroy();
    this.scrollZone.destroy();
    this.resizeHandle.destroy();
    this.chipTooltip.destroy(true);
    super.destroy(fromScene);
  }

  getDimensions(scale = this.hudScale): { width: number; height: number } {
    const width = this.baseWidth * scale;
    const minimizedHeight = Math.min(32 * scale, (CHIP_HEIGHT + BASE_BODY_PADDING_Y * 2) * scale);
    const height = this.minimized ? minimizedHeight : this.baseHeight * scale;
    return { width, height };
  }

  setHudScale(scale: number): void {
    const clamped = Phaser.Math.Clamp(scale, 1, 1.5);
    if (Math.abs(clamped - this.hudScale) < 0.001) {
      return;
    }
    this.hudScale = clamped;
    const targetWidth = Phaser.Math.Clamp(this.baseWidth * this.hudScale, this.minWidth * this.hudScale, this.maxWidth * this.hudScale);
    const targetHeightBase = this.minimized
      ? Math.min(32, CHIP_HEIGHT + BASE_BODY_PADDING_Y * 2)
      : this.baseHeight;
    const targetHeight = Phaser.Math.Clamp(targetHeightBase * this.hudScale, this.minHeight * this.hudScale, this.maxHeight * this.hudScale);
    this.setSize(targetWidth, targetHeight);
    this.currentWidth = targetWidth;
    this.currentHeight = targetHeight;
    if (!this.minimized) {
      this.savedHeight = targetHeight;
    }
    this.lines.forEach((line) => line.setFontSize(BODY_FONT_SIZE * this.hudScale));
    this.hideChipTooltip();
    this.updateHeaderLayout();
    this.updateLayout();
    this.updateScrollBounds(false);
    this.render();
  }

  setPanelActive(enabled: boolean): void {
    this.setVisible(enabled);
    if (!enabled) {
      this.scrollZone.disableInteractive();
      this.resizeHandle.disableInteractive();
      this.hideChipTooltip();
      return;
    }
    this.updateLayout();
  }

  private registerInteractions(): void {
    FILTER_ORDER.forEach((key) => {
      const button = this.filterButtons[key];
      if (!button) return;
      button.container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        pointer.event?.preventDefault?.();
        pointer.event?.stopPropagation?.();
        this.setFilter(key);
      });
    });

    const pauseHandler = (pointer: Phaser.Input.Pointer) => {
      pointer.event?.preventDefault?.();
      pointer.event?.stopPropagation?.();
      this.paused = !this.paused;
      this.updatePauseIcon();
      if (!this.paused && this.atBottom) {
        this.scrollOffset = this.maxScroll;
        this.render();
      }
    };
    this.pauseButton.container.on('pointerdown', pauseHandler);

    this.clearButton.container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event?.preventDefault?.();
      pointer.event?.stopPropagation?.();
      clearLog();
      this.events = [];
      this.filtered = [];
      this.scrollOffset = 0;
      this.maxScroll = 0;
      this.render();
    });

    this.collapseButton.container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event?.preventDefault?.();
      pointer.event?.stopPropagation?.();
      this.toggleMinimized();
    });

    this.scrollZone.on(
      'wheel',
      (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number, _dz: number, event: WheelEvent) => {
        if (this.minimized) return;
        event.preventDefault();
        event.stopPropagation();
        const delta = dy * 0.4;
        this.scrollOffset = Phaser.Math.Clamp(this.scrollOffset + delta, 0, this.maxScroll);
        this.atBottom = this.scrollOffset >= this.maxScroll - 1;
        this.render();
      },
    );

    this.scrollZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event?.preventDefault?.();
      pointer.event?.stopPropagation?.();
    });

    this.resizeHandle.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event?.preventDefault?.();
      pointer.event?.stopPropagation?.();
      if (this.minimized) {
        return;
      }
      this.resizing = true;
      this.resizeStart = {
        x: pointer.x,
        y: pointer.y,
        width: this.currentWidth,
        height: this.currentHeight,
      };
    });

    this.scene.input.on('pointermove', this.handlePointerMove, this);
    this.scene.input.on('pointerup', this.handlePointerUp, this);
  }

  private bindLogEvents(): void {
    logEvents.on('event', this.handleIncomingEvent, this);
    logEvents.on('cleared', this.handleLogCleared, this);
  }

  private handleIncomingEvent(event: GameEvent): void {
    const wasAtBottom = this.atBottom && !this.paused;
    this.events.push(event);
    if (this.events.length > 250) {
      this.events.splice(0, this.events.length - 250);
    }
    this.applyFilter(wasAtBottom);
  }

  private handleLogCleared(): void {
    this.events = [];
    this.filtered = [];
    this.scrollOffset = 0;
    this.maxScroll = 0;
    this.atBottom = true;
    this.render();
  }

  private bodyHeight(): number {
    return Math.max(0, this.currentHeight - this.headerHeight - this.bodyPaddingY() * 2);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.resizing || !this.resizeStart) {
      return;
    }
    const scaleX = this.scaleX || 1;
    const scaleY = this.scaleY || 1;
    const deltaX = (pointer.x - this.resizeStart.x) / scaleX;
    const deltaY = (pointer.y - this.resizeStart.y) / scaleY;
    const minWidth = this.minWidth * this.hudScale;
    const maxWidth = this.maxWidth * this.hudScale;
    const minHeight = this.minHeight * this.hudScale;
    const maxHeight = this.maxHeight * this.hudScale;
    const width = Phaser.Math.Clamp(this.resizeStart.width + deltaX, minWidth, maxWidth);
    const height = Phaser.Math.Clamp(this.resizeStart.height + deltaY, minHeight, maxHeight);
    this.setPanelSize(width, height);
  }

  private handlePointerUp(): void {
    if (!this.resizing) return;
    this.resizing = false;
    this.resizeStart = null;
    this.savedHeight = this.currentHeight;
  }

  private setPanelSize(width: number, height: number): void {
    const minWidth = this.minWidth * this.hudScale;
    const maxWidth = this.maxWidth * this.hudScale;
    const minHeight = this.minHeight * this.hudScale;
    const maxHeight = this.maxHeight * this.hudScale;
    this.currentWidth = Phaser.Math.Clamp(width, minWidth, maxWidth);
    this.currentHeight = Phaser.Math.Clamp(height, minHeight, maxHeight);
    if (!this.minimized) {
      this.savedHeight = this.currentHeight;
      this.baseWidth = this.currentWidth / this.hudScale;
      this.baseHeight = this.currentHeight / this.hudScale;
    }
    this.setSize(this.currentWidth, this.currentHeight);
    this.updateHeaderLayout();
    this.updateLayout();
    this.updateScrollBounds(false);
    this.render();
  }

  private toggleMinimized(): void {
    if (this.minimized) {
      this.minimized = false;
      this.setPanelSize(this.currentWidth, this.baseHeight * this.hudScale);
    } else {
      this.minimized = true;
      const stubHeight = Math.min(32 * this.hudScale, this.scaled(CHIP_HEIGHT) + this.bodyPaddingY() * 2);
      this.setPanelSize(this.currentWidth, stubHeight);
    }
    this.updateCollapseIcon();
    this.hideChipTooltip();
  }

  private setFilter(filter: FilterKey): void {
    if (this.filter === filter) return;
    this.filter = filter;
    this.applyFilter(true);
    this.updateFilterStyles();
    this.hideChipTooltip();
  }

  private applyFilter(stickToBottom: boolean): void {
    this.filtered = this.events.filter((event) => this.filterEvent(event));
    this.updateScrollBounds(stickToBottom);
    this.render();
  }

  private filterEvent(event: GameEvent): boolean {
    switch (this.filter) {
      case 'damage':
        return DAMAGE_TYPES.has(event.t);
      case 'status':
        return STATUS_TYPES.has(event.t);
      case 'spawns':
        return SPAWN_TYPES.has(event.t);
      case 'system':
        return SYSTEM_TYPES.has(event.t);
      default:
        return true;
    }
  }

  private updateScrollBounds(stickToBottom: boolean): void {
    const lineStep = this.lineHeight * this.hudScale;
    this.maxScroll = Math.max(0, this.filtered.length * lineStep - this.bodyHeight());
    if (stickToBottom) {
      this.scrollOffset = this.maxScroll;
    } else {
      this.scrollOffset = Phaser.Math.Clamp(this.scrollOffset, 0, this.maxScroll);
    }
    this.atBottom = this.scrollOffset >= this.maxScroll - 1;
  }

  private updateLayout(): void {
    this.hideChipTooltip();
    const paddingX = this.bodyPaddingX();
    const paddingY = this.bodyPaddingY();
    const bodyHeight = this.bodyHeight();
    this.body.setPosition(paddingX, this.headerHeight + paddingY);
    this.maskRect.setPosition(paddingX, this.headerHeight + paddingY);
    this.maskRect.setSize(Math.max(0, this.currentWidth - paddingX * 2), Math.max(0, bodyHeight));
    this.scrollZone.setPosition(paddingX, this.headerHeight + paddingY);
    this.scrollZone.setSize(Math.max(0, this.currentWidth - paddingX * 2), Math.max(0, bodyHeight));

    const radius = HUD_RADIUS * this.hudScale;
    this.background.clear();
    this.background.fillStyle(PANEL_BACKGROUND_COLOR, PANEL_BACKGROUND_ALPHA);
    this.background.fillRoundedRect(0, 0, this.currentWidth, this.currentHeight, radius);
    this.border.clear();
    this.border.lineStyle(1, PANEL_BORDER_COLOR, PANEL_BORDER_ALPHA);
    this.border.strokeRoundedRect(0.5, 0.5, this.currentWidth - 1, this.currentHeight - 1, Math.max(0, radius - 1));

    const handleOffset = this.scaled(18);
    const handleX = this.currentWidth - handleOffset;
    const handleY = this.currentHeight - handleOffset;
    this.resizeHandle.setPosition(handleX, handleY);
    this.resizeHandle.setScale(this.hudScale);
    this.resizeHandle.setVisible(!this.minimized);
    if (this.minimized) {
      this.body.setVisible(false);
      this.scrollZone.disableInteractive();
      this.resizeHandle.disableInteractive();
    } else {
      this.body.setVisible(true);
      if (!this.scrollZone.input?.enabled) {
        this.scrollZone.setInteractive({ cursor: 'default' });
      }
      if (!this.resizeHandle.input?.enabled) {
        this.resizeHandle.setInteractive({ cursor: 'nwse-resize' });
      }
    }
  }

  private updateHeaderLayout(): void {
    this.hideChipTooltip();
    const title = this.header.getAt(0) as Phaser.GameObjects.Text;
    const paddingX = this.scaled(HEADER_HORIZONTAL_PADDING);
    const paddingY = this.scaled(CHIP_PADDING_Y);
    title.setFontSize(TITLE_FONT_SIZE * this.hudScale);
    title.setPosition(paddingX, paddingY);

    const actions = [this.pauseButton, this.clearButton, this.collapseButton];
    const actionGap = this.scaled(8);
    const actionSize = ICON_BUTTON_SIZE * this.hudScale;
    let actionX = this.currentWidth - paddingX - actionSize / 2;
    const actionY = paddingY + actionSize / 2;
    for (let i = actions.length - 1; i >= 0; i -= 1) {
      const button = actions[i];
      this.drawIconButton(button, false);
      button.container.setPosition(actionX, actionY);
      actionX -= actionSize + actionGap;
    }

    const availableWidth = this.currentWidth - paddingX * 2 - (actionSize * actions.length + actionGap * (actions.length - 1));
    const chipStart = Math.max(paddingX, title.x + title.displayWidth + this.scaled(12));
    let chipX = chipStart;
    let chipY = paddingY;
    let rowHeight = 0;
    FILTER_ORDER.forEach((key) => {
      const button = this.filterButtons[key];
      if (!button) return;
      this.drawFilterButton(button);
      if (chipX + button.width > paddingX + availableWidth) {
        chipX = paddingX;
        chipY += rowHeight + this.scaled(CHIP_ROW_GAP);
        rowHeight = 0;
      }
      button.container.setPosition(chipX + button.width / 2, chipY + button.height / 2);
      chipX += button.width + this.scaled(FILTER_GAP);
      rowHeight = Math.max(rowHeight, button.height);
    });
    if (rowHeight === 0) {
      rowHeight = title.height;
    }
    const chipsBottom = chipY + rowHeight;
    const actionsBottom = actionY + actionSize / 2;
    this.headerHeight = Math.max(chipsBottom, actionsBottom) + paddingY;
    this.updateFilterStyles();
    this.updatePauseIcon();
    this.updateCollapseIcon();
  }

  private createFilterButton(label: string, key: FilterKey): FilterButton {
    const container = this.scene.add.container(0, 0);
    container.setData('hovered', false);
    container.setData('active', false);
    const background = this.scene.add.graphics();
    const text = this.scene.add
      .text(0, 0, label, {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: `${BODY_FONT_SIZE}px`,
        fontStyle: '500',
        color: '#9bbce4',
      })
      .setOrigin(0.5);
    text.setData('full-text', label);
    text.setData('truncated', false);
    container.add([background, text]);
    container.setSize(CHIP_HEIGHT, CHIP_HEIGHT);
    container.setName(`filter-${key}`);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-CHIP_HEIGHT / 2, -CHIP_HEIGHT / 2, CHIP_HEIGHT, CHIP_HEIGHT),
      Phaser.Geom.Rectangle.Contains,
    );
    const button: FilterButton = { container, background, label: text, width: CHIP_HEIGHT, height: CHIP_HEIGHT };
    container.on('pointerover', () => {
      container.setData('hovered', true);
      this.drawFilterButton(button);
      this.showChipTooltip(button);
    });
    container.on('pointerout', () => {
      container.setData('hovered', false);
      this.drawFilterButton(button);
      this.hideChipTooltip();
    });
    container.on('pointerdown', () => this.hideChipTooltip());
    return button;
  }

  private createIconButton(icon: string): IconButton {
    const container = this.scene.add.container(0, 0);
    const background = this.scene.add.graphics();
    const iconText = this.scene.add
      .text(0, 0, icon, {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: `${BODY_FONT_SIZE + 2}px`,
        fontStyle: '500',
        color: '#b2cff3',
      })
      .setOrigin(0.5);
    container.add([background, iconText]);
    container.setSize(ICON_BUTTON_SIZE, ICON_BUTTON_SIZE);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-ICON_BUTTON_SIZE / 2, -ICON_BUTTON_SIZE / 2, ICON_BUTTON_SIZE, ICON_BUTTON_SIZE),
      Phaser.Geom.Rectangle.Contains,
    );
    const button: IconButton = { container, background, icon: iconText };
    container.on('pointerover', () => this.drawIconButton(button, true));
    container.on('pointerout', () => this.drawIconButton(button, false));
    this.drawIconButton(button);
    return button;
  }

  private updateFilterStyles(): void {
    FILTER_ORDER.forEach((key) => {
      const button = this.filterButtons[key];
      if (!button) return;
      const active = this.filter === key;
      button.container.setData('active', active);
      button.label.setColor(active ? '#e1f1ff' : '#9bbce4');
      this.drawFilterButton(button);
    });
  }

  private updatePauseIcon(): void {
    this.pauseButton.icon.setText(this.paused ? '▶' : '⏸');
    this.pauseButton.icon.setColor(this.paused ? '#f4d38a' : '#b2cff3');
  }

  private updateCollapseIcon(): void {
    this.collapseButton.icon.setText(this.minimized ? '⌃' : '⌄');
  }

  private render(): void {
    if (this.minimized) {
      this.lines.forEach((line) => line.setVisible(false));
      return;
    }
    const total = this.filtered.length;
    if (!total) {
      this.lines.forEach((line) => line.setVisible(false));
      return;
    }
    const lineStep = this.lineHeight * this.hudScale;
    const firstIndex = Math.floor(this.scrollOffset / lineStep);
    const offsetY = -(this.scrollOffset % lineStep);
    for (let i = 0; i < this.lines.length; i += 1) {
      const event = this.filtered[firstIndex + i];
      const line = this.lines[i];
      if (!event) {
        line.setVisible(false);
        continue;
      }
      const descriptor = this.describeEvent(event);
      line.setText(descriptor.text);
      line.setColor(descriptor.color);
      line.setY(offsetY + i * lineStep);
      line.setVisible(true);
    }
  }

  private drawFilterButton(button: FilterButton): void {
    if (!button) return;
    const paddingX = this.scaled(CHIP_PADDING_X);
    const paddingY = this.scaled(CHIP_PADDING_Y);
    const hovered = button.container.getData('hovered') === true;
    const active = button.container.getData('active') === true;
    const original = (button.label.getData('full-text') as string) ?? button.label.text;
    button.label.setFontSize(BODY_FONT_SIZE * this.hudScale);
    button.label.setText(original);
    const textWidth = button.label.width;
    const width = Math.max(this.scaled(CHIP_HEIGHT), textWidth + paddingX * 2);
    const height = this.scaled(CHIP_HEIGHT);
    button.width = width;
    button.height = height;
    button.container.setSize(width, height);
    button.container.setInteractive(
      new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
      Phaser.Geom.Rectangle.Contains,
    );
    button.label.setFixedSize(Math.max(0, width - paddingX * 2), height);
    this.truncateLabel(button.label, width - paddingX * 2);
    button.background.clear();
    const fillColor = active ? 0x25496d : hovered ? 0x1b2b40 : 0x162333;
    const fillAlpha = active ? 0.88 : hovered ? 0.75 : 0.6;
    const radius = HUD_RADIUS * this.hudScale * 0.6;
    button.background.fillStyle(fillColor, fillAlpha);
    button.background.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    button.background.lineStyle(1, PANEL_BORDER_COLOR, PANEL_BORDER_ALPHA);
    button.background.strokeRoundedRect(-width / 2 + 0.5, -height / 2 + 0.5, width - 1, height - 1, Math.max(0, radius - 1));
    button.label.setPosition(0, 0);
  }

  private truncateLabel(text: Phaser.GameObjects.Text, maxWidth: number): void {
    if (maxWidth <= 0) {
      text.setData('truncated', false);
      return;
    }
    const original = (text.getData('full-text') as string) ?? text.text;
    text.setText(original);
    if (text.width <= maxWidth) {
      text.setData('truncated', false);
      return;
    }
    let truncated = original;
    while (truncated.length > 1 && text.width > maxWidth) {
      truncated = truncated.slice(0, -1);
      text.setText(`${truncated}…`);
      if (text.width <= maxWidth) {
        break;
      }
    }
    text.setData('truncated', text.text !== original);
  }

  private showChipTooltip(button: FilterButton): void {
    if (!button || !this.chipTooltip) {
      return;
    }
    const truncated = button.label.getData('truncated') === true;
    if (!truncated) {
      this.hideChipTooltip();
      return;
    }
    const content = (button.label.getData('full-text') as string) ?? button.label.text;
    this.chipTooltipLabel.setFontSize(BODY_FONT_SIZE * this.hudScale);
    this.chipTooltipLabel.setText(content);
    const paddingX = this.scaled(CHIP_PADDING_X + 2);
    const paddingY = this.scaled(CHIP_PADDING_Y + 2);
    const width = this.chipTooltipLabel.width + paddingX * 2;
    const height = this.chipTooltipLabel.height + paddingY * 2;
    const radius = HUD_RADIUS * this.hudScale * 0.6;
    this.chipTooltipBackground.clear();
    this.chipTooltipBackground.fillStyle(PANEL_BACKGROUND_COLOR, PANEL_BACKGROUND_ALPHA);
    this.chipTooltipBackground.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    this.chipTooltipBackground.lineStyle(1, PANEL_BORDER_COLOR, PANEL_BORDER_ALPHA);
    this.chipTooltipBackground.strokeRoundedRect(
      -width / 2 + 0.5,
      -height / 2 + 0.5,
      width - 1,
      height - 1,
      Math.max(0, radius - 1),
    );
    const desiredX = button.container.x;
    const desiredY = button.container.y - button.height / 2 - this.scaled(12);
    const minX = width / 2 + this.scaled(BASE_BODY_PADDING_X);
    const maxX = this.currentWidth - width / 2 - this.scaled(BASE_BODY_PADDING_X);
    const clampedX = Phaser.Math.Clamp(desiredX, minX, Math.max(minX, maxX));
    const minY = height / 2 + this.scaled(CHIP_PADDING_Y);
    const maxY = this.headerHeight - height / 2 - this.scaled(CHIP_PADDING_Y);
    const clampedY = Phaser.Math.Clamp(desiredY, minY, Math.max(minY, maxY));
    this.chipTooltip.setPosition(clampedX, clampedY);
    this.chipTooltip.setVisible(true);
    this.bringToTop(this.chipTooltip);
  }

  private hideChipTooltip(): void {
    if (!this.chipTooltip) {
      return;
    }
    this.chipTooltip.setVisible(false);
  }

  private drawIconButton(button: IconButton, hovered = false): void {
    const size = ICON_BUTTON_SIZE * this.hudScale;
    const radius = HUD_RADIUS * this.hudScale * 0.5;
    button.background.clear();
    button.background.fillStyle(hovered ? 0x21324a : 0x162333, hovered ? 0.68 : 0.42);
    button.background.fillRoundedRect(-size / 2, -size / 2, size, size, radius);
    button.background.lineStyle(1, PANEL_BORDER_COLOR, PANEL_BORDER_ALPHA);
    button.background.strokeRoundedRect(-size / 2 + 0.5, -size / 2 + 0.5, size - 1, size - 1, Math.max(0, radius - 1));
    button.container.setSize(size, size);
    button.container.setInteractive(
      new Phaser.Geom.Rectangle(-size / 2, -size / 2, size, size),
      Phaser.Geom.Rectangle.Contains,
    );
    button.icon.setFontSize(BODY_FONT_SIZE * this.hudScale + 2);
  }

  private describeEvent(event: GameEvent): { text: string; color: string } {
    const time = event.at.toFixed(1).padStart(6, ' ');
    switch (event.t) {
      case 'hit': {
        const text = `[${time}] HIT ${event.src} → ${event.dst} -${event.amount} (${event.rule})`;
        return { text, color: '#f4a8a8' };
      }
      case 'kill': {
        const text = `[${time}] KILL ${event.dst} by ${event.src} (${event.rule})`;
        return { text, color: '#ffbe8c' };
      }
      case 'buff': {
        const duration = event.dur.toFixed(1);
        const text = `[${time}] STATUS ${event.kind} @ ${event.who} (${duration}s)`;
        return { text, color: '#8ad5ff' };
      }
      case 'spawn': {
        const text = `[${time}] SPAWN ${event.kind} ×${event.n}`;
        return { text, color: '#96f7c5' };
      }
      case 'system':
      default: {
        const text = `[${time}] SYSTEM ${event.msg}`;
        return { text, color: '#c7d7f2' };
      }
    }
  }
}

export const logSystemEvent = (scene: Phaser.Scene, msg: string, at: number): void => {
  logEvent({ t: 'system', at, msg });
};
