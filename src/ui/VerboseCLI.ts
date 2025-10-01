import Phaser from 'phaser';
import { clearLog, getLogHistory, logEvent, logEvents, type GameEvent } from '../systems/log';

type FilterKey = 'all' | 'damage' | 'status' | 'spawns' | 'system';

type FilterButton = {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
};

type IconButton = {
  container: Phaser.GameObjects.Container;
  icon: Phaser.GameObjects.Text;
};

const FONT_FAMILY =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace";

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

const HEADER_HEIGHT = 38;
const BODY_PADDING_X = 12;
const BODY_PADDING_Y = 8;
const BUTTON_WIDTH = 68;
const BUTTON_HEIGHT = 24;

export class VerboseCLI extends Phaser.GameObjects.Container {
  private readonly background: Phaser.GameObjects.Rectangle;
  private readonly innerBorder: Phaser.GameObjects.Rectangle;
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

  private readonly minWidth = 320;
  private readonly maxWidth = 620;
  private readonly minHeight = 140;
  private readonly maxHeight = 320;
  private readonly maxVisible = 50;
  private readonly lineHeight = 18;

  private resizing = false;
  private resizeStart: { x: number; y: number; width: number; height: number } | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, width = 420, height = 180) {
    super(scene, x, y);
    this.currentWidth = Phaser.Math.Clamp(width, this.minWidth, this.maxWidth);
    this.currentHeight = Phaser.Math.Clamp(height, this.minHeight, this.maxHeight);
    this.savedHeight = this.currentHeight;
    this.setSize(this.currentWidth, this.currentHeight);
    this.setScrollFactor(0);

    this.background = scene.add
      .rectangle(0, 0, this.currentWidth, this.currentHeight, 0x0c121c, 0.78)
      .setOrigin(0);
    this.innerBorder = scene.add
      .rectangle(1, 1, this.currentWidth - 2, this.currentHeight - 2, 0x101b29, 0)
      .setOrigin(0)
      .setStrokeStyle(1, 0x1f3652, 0.85);

    this.header = scene.add.container(0, 0);
    const title = scene.add
      .text(16, HEADER_HEIGHT / 2, 'Events', {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        color: '#d7efff',
      })
      .setOrigin(0, 0.5);
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

    this.body = scene.add.container(BODY_PADDING_X, HEADER_HEIGHT + BODY_PADDING_Y);
    this.maskRect = scene.add
      .rectangle(BODY_PADDING_X, HEADER_HEIGHT + BODY_PADDING_Y, this.currentWidth - BODY_PADDING_X * 2, this.bodyHeight())
      .setOrigin(0)
      .setVisible(false)
      .setActive(false);
    this.bodyMask = this.maskRect.createGeometryMask();
    this.body.setMask(this.bodyMask);

    for (let i = 0; i < this.maxVisible; i += 1) {
      const line = scene.add
        .text(0, 0, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '13px',
          color: '#c0d6f6',
        })
        .setOrigin(0, 0);
      line.setVisible(false);
      this.body.add(line);
      this.lines.push(line);
    }

    this.scrollZone = scene.add
      .zone(BODY_PADDING_X, HEADER_HEIGHT + BODY_PADDING_Y, this.currentWidth - BODY_PADDING_X * 2, this.bodyHeight())
      .setOrigin(0)
      .setInteractive({ cursor: 'default' });

    this.resizeHandle = scene.add
      .triangle(this.currentWidth - 18, this.currentHeight - 18, 0, 16, 16, 16, 16, 0, 0xffffff, 0.28)
      .setOrigin(0, 0);
    this.resizeHandle.setStrokeStyle(1, 0x2a4f73, 0.75);
    this.resizeHandle.setInteractive({ cursor: 'nwse-resize' });

    this.add([
      this.background,
      this.innerBorder,
      this.maskRect,
      this.body,
      this.scrollZone,
      this.header,
      this.resizeHandle,
    ]);

    this.registerInteractions();
    this.bindLogEvents();

    const history = getLogHistory();
    if (history.length) {
      this.events = history.slice();
    }
    this.applyFilter(true);
    this.updateHeaderLayout();

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
    this.innerBorder.destroy();
    this.header.destroy(true);
    this.body.destroy(true);
    this.maskRect.destroy();
    this.scrollZone.destroy();
    this.resizeHandle.destroy();
    super.destroy(fromScene);
  }

  getDimensions(): { width: number; height: number } {
    return { width: this.currentWidth, height: this.currentHeight };
  }

  setPanelActive(enabled: boolean): void {
    this.setVisible(enabled);
    if (!enabled) {
      this.scrollZone.disableInteractive();
      this.resizeHandle.disableInteractive();
      return;
    }
    this.updateLayout();
  }

  private registerInteractions(): void {
    Object.values(this.filterButtons).forEach(({ container }, index) => {
      container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        pointer.event?.preventDefault?.();
        pointer.event?.stopPropagation?.();
        const key = FILTER_ORDER[index]!;
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
    return Math.max(0, this.currentHeight - HEADER_HEIGHT - BODY_PADDING_Y * 2);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.resizing || !this.resizeStart) {
      return;
    }
    const scaleX = this.scaleX || 1;
    const scaleY = this.scaleY || 1;
    const deltaX = (pointer.x - this.resizeStart.x) / scaleX;
    const deltaY = (pointer.y - this.resizeStart.y) / scaleY;
    const width = Phaser.Math.Clamp(this.resizeStart.width + deltaX, this.minWidth, this.maxWidth);
    const height = Phaser.Math.Clamp(this.resizeStart.height + deltaY, this.minHeight, this.maxHeight);
    this.setPanelSize(width, height);
  }

  private handlePointerUp(): void {
    if (!this.resizing) return;
    this.resizing = false;
    this.resizeStart = null;
    this.savedHeight = this.currentHeight;
  }

  private setPanelSize(width: number, height: number): void {
    this.currentWidth = Phaser.Math.Clamp(width, this.minWidth, this.maxWidth);
    this.currentHeight = Phaser.Math.Clamp(height, this.minHeight, this.maxHeight);
    if (!this.minimized) {
      this.savedHeight = this.currentHeight;
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
      this.setPanelSize(this.currentWidth, this.savedHeight || 180);
    } else {
      this.minimized = true;
      this.setPanelSize(this.currentWidth, HEADER_HEIGHT + BODY_PADDING_Y * 2);
    }
    this.updateCollapseIcon();
  }

  private setFilter(filter: FilterKey): void {
    if (this.filter === filter) return;
    this.filter = filter;
    this.applyFilter(true);
    this.updateFilterStyles();
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
    this.maxScroll = Math.max(0, this.filtered.length * this.lineHeight - this.bodyHeight());
    if (stickToBottom) {
      this.scrollOffset = this.maxScroll;
    } else {
      this.scrollOffset = Phaser.Math.Clamp(this.scrollOffset, 0, this.maxScroll);
    }
    this.atBottom = this.scrollOffset >= this.maxScroll - 1;
  }

  private updateLayout(): void {
    this.background.setSize(this.currentWidth, this.currentHeight);
    this.innerBorder.setSize(this.currentWidth - 2, this.currentHeight - 2);
    this.innerBorder.setPosition(1, 1);

    const bodyHeight = this.bodyHeight();
    this.body.setPosition(BODY_PADDING_X, HEADER_HEIGHT + BODY_PADDING_Y);
    this.maskRect.setPosition(BODY_PADDING_X, HEADER_HEIGHT + BODY_PADDING_Y);
    this.maskRect.setSize(Math.max(0, this.currentWidth - BODY_PADDING_X * 2), Math.max(0, bodyHeight));
    this.scrollZone.setPosition(BODY_PADDING_X, HEADER_HEIGHT + BODY_PADDING_Y);
    this.scrollZone.setSize(Math.max(0, this.currentWidth - BODY_PADDING_X * 2), Math.max(0, bodyHeight));

    const handleX = this.currentWidth - 18;
    const handleY = this.currentHeight - 18;
    this.resizeHandle.setPosition(handleX, handleY);
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
    const title = this.header.getAt(0) as Phaser.GameObjects.Text;
    let x = title.displayWidth + 28;
    FILTER_ORDER.forEach((key) => {
      const button = this.filterButtons[key];
      if (!button) return;
      button.container.setPosition(x, HEADER_HEIGHT / 2);
      x += BUTTON_WIDTH + 8;
    });

    let right = this.currentWidth - 20;
    this.collapseButton.container.setPosition(right, HEADER_HEIGHT / 2);
    right -= 28;
    this.clearButton.container.setPosition(right, HEADER_HEIGHT / 2);
    right -= 28;
    this.pauseButton.container.setPosition(right, HEADER_HEIGHT / 2);
    this.updateFilterStyles();
    this.updatePauseIcon();
    this.updateCollapseIcon();
  }

  private createFilterButton(label: string, key: FilterKey): FilterButton {
    const container = this.scene.add.container(0, HEADER_HEIGHT / 2);
    const background = this.scene.add
      .rectangle(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 0x162333, 0.62)
      .setStrokeStyle(1, 0x1f3a57, 0.8)
      .setOrigin(0.5);
    const text = this.scene.add
      .text(0, 0, label, {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        color: '#9bbce4',
      })
      .setOrigin(0.5);
    container.add([background, text]);
    container.setSize(BUTTON_WIDTH, BUTTON_HEIGHT);
    container.setName(`filter-${key}`);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-BUTTON_WIDTH / 2, -BUTTON_HEIGHT / 2, BUTTON_WIDTH, BUTTON_HEIGHT),
      Phaser.Geom.Rectangle.Contains,
    );
    container.on('pointerover', () => {
      if (this.filter !== key) {
        background.setFillStyle(0x1b2b40, 0.72);
      }
    });
    container.on('pointerout', () => {
      if (this.filter !== key) {
        background.setFillStyle(0x162333, 0.62);
      }
    });
    return { container, background, label: text };
  }

  private createIconButton(icon: string): IconButton {
    const container = this.scene.add.container(0, HEADER_HEIGHT / 2);
    const background = this.scene.add
      .rectangle(0, 0, 26, 26, 0x162333, 0.4)
      .setStrokeStyle(1, 0x1f3a57, 0.8)
      .setOrigin(0.5);
    const iconText = this.scene.add
      .text(0, 0, icon, {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        color: '#b2cff3',
      })
      .setOrigin(0.5);
    container.add([background, iconText]);
    container.setSize(26, 26);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-13, -13, 26, 26),
      Phaser.Geom.Rectangle.Contains,
    );
    container.on('pointerover', () => background.setFillStyle(0x21324a, 0.68));
    container.on('pointerout', () => background.setFillStyle(0x162333, 0.4));
    return { container, icon: iconText };
  }

  private updateFilterStyles(): void {
    FILTER_ORDER.forEach((key) => {
      const button = this.filterButtons[key];
      if (!button) return;
      const active = this.filter === key;
      button.background.setFillStyle(active ? 0x25496d : 0x162333, active ? 0.82 : 0.62);
      button.label.setColor(active ? '#e1f1ff' : '#9bbce4');
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
    const firstIndex = Math.floor(this.scrollOffset / this.lineHeight);
    const offsetY = -(this.scrollOffset % this.lineHeight);
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
      line.setY(offsetY + i * this.lineHeight);
      line.setVisible(true);
    }
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
