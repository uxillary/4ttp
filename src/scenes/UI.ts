import Phaser from "phaser";
import type { Mode } from "../core/types";
import { getPalette } from "../core/palette";
import { NAME_MAP, TEXTURE_KEY, FACTIONS } from "../core/factions";
import type { FactionId } from "../core/types";
import { BalanceBar, type FactionCounts, computeEquilibrium } from "../systems/balanceMeter";
import type { CooldownState, AbilityKey } from "../systems/interventions";
import { ABILITY_METADATA, COOLDOWNS_MS, EFFECT_DURATIONS_MS } from "../systems/interventions";
import type { GameTickPayload, GameEndSummary } from "./types";
import { VerboseCLI } from "../ui/VerboseCLI";
const FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace";
const HUD_WIDTH = 360;
const ABILITY_ORDER: AbilityKey[] = ['1', '2', '3', '4', '5'];
const ABILITY_INPUT_HINT: Record<AbilityKey, string> = {
  '1': 'LMB / [1]',
  '2': '[2]',
  '3': '[3]',
  '4': '[4]',
  '5': '[5]',
};
const ABILITY_DURATION_HINT: Partial<Record<AbilityKey, string>> = {
  '2': `Effect: Slow for ${(EFFECT_DURATIONS_MS.slow / 1000).toFixed(1)}s`,
  '3': `Effect: Buff for ${(EFFECT_DURATIONS_MS.buff / 1000).toFixed(1)}s`,
  '4': `Effect: Shield for ${(EFFECT_DURATIONS_MS.shield / 1000).toFixed(1)}s`,
};
const TOGGLE_KEYS = ['audio', 'hud', 'palette', 'speed', 'pause', 'info'] as const;
type ToggleKey = (typeof TOGGLE_KEYS)[number];
type AbilityMeta = (typeof ABILITY_METADATA)[AbilityKey];
type AbilityButton = {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Image;
  keycap: Phaser.GameObjects.Image;
  keycapLabel: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  detail: Phaser.GameObjects.Text;
  cooldown: Phaser.GameObjects.Text;
  meta: AbilityMeta;
};

type StatusToggle = {
  container: Phaser.GameObjects.Container;
  icon: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  key: ToggleKey;
};
export class UI extends Phaser.Scene {
  private hud!: Phaser.GameObjects.Container;
  private modeText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private factionDisplays: Record<FactionId, { container: Phaser.GameObjects.Container; icon: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image | null; count: Phaser.GameObjects.Text; label: Phaser.GameObjects.Text }> = {} as Record<FactionId, { container: Phaser.GameObjects.Container; icon: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image | null; count: Phaser.GameObjects.Text; label: Phaser.GameObjects.Text }>;
  private equilibriumText!: Phaser.GameObjects.Text;
  private equilibriumValue = 1;
  private balanceBar!: BalanceBar;
  private abilityBar!: Phaser.GameObjects.Container;
  private abilityButtons: Record<AbilityKey, AbilityButton> = {} as Record<AbilityKey, AbilityButton>;
  private statusBar!: Phaser.GameObjects.Container;
  private statusToggles: Record<ToggleKey, StatusToggle> = {} as Record<ToggleKey, StatusToggle>;
  private tooltip!: Phaser.GameObjects.Container;
  private tooltipTitle!: Phaser.GameObjects.Text;
  private tooltipText!: Phaser.GameObjects.Text;
  private infoOverlay!: Phaser.GameObjects.Container;
  private infoOverlayBg!: Phaser.GameObjects.Rectangle;
  private infoOverlayTitle!: Phaser.GameObjects.Text;
  private infoOverlayText!: Phaser.GameObjects.Text;
  private infoOverlayFooter!: Phaser.GameObjects.Text;
  private shiftKey?: Phaser.Input.Keyboard.Key;
  private hoveredAbility: AbilityKey | null = null;
  private tooltipKey: AbilityKey | null = null;
  private endPanel!: Phaser.GameObjects.Container;
  private endTitle!: Phaser.GameObjects.Text;
  private endSummary!: Phaser.GameObjects.Text;
  private endLogs!: Phaser.GameObjects.Text;
  private endFooter!: Phaser.GameObjects.Text;
  private endLogTimer?: Phaser.Time.TimerEvent;
  private verboseCli!: VerboseCLI;
  private abilityButtonSize = { width: 0, height: 0 };
  private statusBarSize = { width: 0, height: 0 };
  private readonly lastCounts: FactionCounts = { Fire: 0, Water: 0, Earth: 0 };
  private muted = true;
  private colorblind = false;
  private hudVisible = true;
  private paused = false;
  private ready = false;
  private colorMode: 'default' | 'alt' = 'default';
  private infoVisible = false;
  private speedValue = 1;
  constructor() {
    super("UI");
  }
  create(): void {
    this.createHud();
    this.createAbilityBar();
    this.createStatusBar();
    this.verboseCli = new VerboseCLI(this, 24, this.scale.height - 280);
    this.add.existing(this.verboseCli);
    this.verboseCli.setDepth(46);
    this.createTooltip();
    this.createEndPanel();
    this.createInfoOverlay();
    this.shiftKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ready = false;
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
    this.ready = true;
    this.handleResize(this.scale.gameSize);
    this.events.emit('ui-ready');
  }
  override update(): void {
    const shiftHeld = this.shiftKey?.isDown ?? false;
    if (shiftHeld) {
      const key = this.hoveredAbility ?? this.tooltipKey ?? ABILITY_ORDER[0];
      if (key) this.showTooltipForKey(key, true);
    } else if (this.hoveredAbility) {
      this.showTooltipForKey(this.hoveredAbility, false);
    } else {
      this.hideTooltip();
    }
  }
  isReady(): boolean {
    return this.ready;
  }
  setMode(mode: Mode): void {
    this.modeText.setText(`Mode: ${mode}`);
  }
  tick(payload: GameTickPayload): void {
    this.modeText.setText(`Mode: ${payload.mode}`);
    this.timerText.setText(`Time: ${payload.elapsed.toFixed(1)}s`);
    const { Fire, Water, Earth } = payload.counts;
    this.lastCounts.Fire = Fire;
    this.lastCounts.Water = Water;
    this.lastCounts.Earth = Earth;
    FACTIONS.forEach((id) => {
      const display = this.factionDisplays[id];
      if (!display) return;
      display.count.setText(payload.counts[id].toString().padStart(3, ' '));
    });
    this.equilibriumValue = Phaser.Math.Linear(this.equilibriumValue, payload.equilibrium, 0.15);
    this.equilibriumText.setText(`Equilibrium: ${(this.equilibriumValue * 100).toFixed(0)}%`);
    this.balanceBar.update(this.lastCounts, getPalette(this.colorblind), this.equilibriumValue);
    this.paused = payload.paused;
    this.updateSettingsDisplay();
    if (!payload.ended) {
      this.hideEndPanel();
    }
  }
  setCooldowns(map: CooldownState): void {
    ABILITY_ORDER.forEach((key) => {
      const button = this.abilityButtons[key];
      if (!button) return;
      const remaining = map[key];
      if (remaining > 0.05) {
        button.cooldown.setText(`${remaining.toFixed(1)}s`);
        button.background.setAlpha(0.45);
      } else {
        button.cooldown.setText('');
        button.background.setAlpha(0.9);
      }
    });
  }
  setMuted(value: boolean): void {
    this.muted = value;
    this.updateSettingsDisplay();
  }
  setSpeedMultiplier(multiplier: number): void {
    this.speedValue = multiplier;
    this.updateSettingsDisplay();
  }
  setInfoVisible(visible: boolean): void {
    if (this.infoVisible === visible) return;
    this.infoVisible = visible;
    this.infoOverlay.setVisible(true);
    this.tweens.killTweensOf(this.infoOverlay);
    this.tweens.add({
      targets: this.infoOverlay,
      alpha: visible ? 1 : 0,
      duration: 220,
      ease: Phaser.Math.Easing.Sine.InOut,
      onComplete: () => {
        if (!visible) {
          this.infoOverlay.setVisible(false);
        }
      },
    });
    this.updateSettingsDisplay();
  }
  setColorblind(value: boolean): void {
    this.colorblind = value;
    this.colorMode = value ? 'alt' : 'default';
    const palette = getPalette(this.colorblind);
    this.updateSettingsDisplay();
    this.balanceBar.update(this.lastCounts, palette, this.equilibriumValue);
    this.refreshFactionIcons(palette);
    ABILITY_ORDER.forEach((key) => {
      const button = this.abilityButtons[key];
      if (!button) return;
      const accent = palette.Fire.toString(16).padStart(6, '0');
      button.label.setColor(`#${accent}`);
      button.detail.setColor(this.colorblind ? '#d1e4ff' : '#7fb8ff');
    });
  }
  setHudVisible(visible: boolean): void {
    this.hudVisible = visible;
    this.hud.setVisible(visible);
    this.balanceBar.setVisible(visible);
    this.abilityBar.setVisible(visible);
    this.verboseCli.setPanelActive(visible);
    this.statusBar.setAlpha(visible ? 1 : 0.6);
    if (!visible) {
      this.hideTooltip();
    }
    this.updateSettingsDisplay();
  }
  showEndPanel(summary: GameEndSummary): void {
    const bestLabel = summary.bestScore !== null ? summary.bestScore.toFixed(1) : '--';
    this.endTitle.setText(`${summary.mode} Protocol Complete`);
    this.endSummary.setText(`Runtime: ${summary.elapsed.toFixed(1)}s
Best: ${bestLabel}s
Seed: ${summary.seed}`);
    const equilibrium = computeEquilibrium(summary.counts);
    const logs: string[] = [
      `> Final Time: ${summary.elapsed.toFixed(1)}s`,
      `> Remaining Fire/Water/Earth: ${summary.counts.Fire}/${summary.counts.Water}/${summary.counts.Earth}`,
      `> [LOG] Equilibrium maintained ${(equilibrium * 100).toFixed(0)}%`,
    ];
    if (summary.achievements.length) {
      summary.achievements.forEach((entry) => logs.push(`> [ARCHIVE] ${entry}`));
    } else {
      logs.push('> [ARCHIVE] No optional logs unlocked');
    }
    this.endLogs.setText('');
    this.endPanel.setVisible(true);
    if (this.endLogTimer) {
      this.endLogTimer.remove(false);
    }
    let index = 0;
    const reveal = () => {
      const existing = this.endLogs.text ? `${this.endLogs.text}
` : '';
      this.endLogs.setText(`${existing}${logs[index]!}`);
      index += 1;
      if (index < logs.length) {
        this.endLogTimer = this.time.delayedCall(260, reveal);
      }
    };
    reveal();
  }
  hideEndPanel(): void {
    this.endPanel.setVisible(false);
    if (this.endLogTimer) {
      this.endLogTimer.remove(false);
      this.endLogTimer = undefined;
    }
  }
  setMutedAndColorblind(muted: boolean, colorblind: boolean): void {
    this.muted = muted;
    this.colorblind = colorblind;
    this.colorMode = colorblind ? 'alt' : 'default';
    const palette = getPalette(this.colorblind);
    this.updateSettingsDisplay();
    this.balanceBar.update(this.lastCounts, palette, this.equilibriumValue);
    this.refreshFactionIcons(palette);
    ABILITY_ORDER.forEach((key) => {
      const button = this.abilityButtons[key];
      if (!button) return;
      const accent = palette.Fire.toString(16).padStart(6, '0');
      button.label.setColor(`#${accent}`);
      button.detail.setColor(this.colorblind ? '#d1e4ff' : '#7fb8ff');
    });
  }
  private createHud(): void {
    this.hud = this.add.container(24, 24).setDepth(20).setScrollFactor(0);
    const bg = this.add.image(0, 0, 'ui-card').setOrigin(0);
    const primary = { fontFamily: FONT_FAMILY, fontSize: '20px', color: '#e5f6ff', shadow: { offsetX: 0, offsetY: 0, color: '#10395a', fill: true, blur: 4 } } as const;
    const secondary = { fontFamily: FONT_FAMILY, fontSize: '16px', color: '#9bdcff' } as const;
    this.modeText = this.add.text(28, 24, 'Mode: Balance', primary);
    this.timerText = this.add.text(28, 52, 'Time: 0.0s', { ...primary, fontSize: '18px' });

    const factionPalette = getPalette(false);
    const baseY = 92;
    const spacing = 110;
    FACTIONS.forEach((faction, index) => {
      const container = this.add.container(46 + index * spacing, baseY);
      const glowKey = this.textures.exists(`${TEXTURE_KEY[faction]}-glow`) ? `${TEXTURE_KEY[faction]}-glow` : null;
      const glow = glowKey
        ? this.add.image(0, 0, glowKey).setOrigin(0.5).setScale(0.44).setAlpha(0.4).setBlendMode(Phaser.BlendModes.ADD)
        : null;
      const icon = this.add.image(0, 0, TEXTURE_KEY[faction]).setOrigin(0.5).setScale(0.42);
      icon.setTint(factionPalette[faction]);
      const label = this.add.text(0, 34, NAME_MAP[faction].split(' ')[0] ?? faction, { fontFamily: FONT_FAMILY, fontSize: '14px', color: '#79b7ff' }).setOrigin(0.5, 0);
      const count = this.add.text(0, 50, '000', { fontFamily: FONT_FAMILY, fontSize: '18px', color: '#e7f7ff' }).setOrigin(0.5, 0);
      const elements: Phaser.GameObjects.GameObject[] = [];
      if (glow) elements.push(glow);
      elements.push(icon, label, count);
      container.add(elements);
      this.hud.add(container);
      this.factionDisplays[faction] = { container, icon, glow, label, count };
    });

    this.equilibriumText = this.add.text(28, 190, 'Equilibrium: 100%', secondary);

    this.hud.add([bg, this.modeText, this.timerText, this.equilibriumText]);
    this.hud.sendToBack(bg);

    this.balanceBar = new BalanceBar(this, this.hud.x + 36, this.hud.y + 172, HUD_WIDTH - 24, 16);
  }
  private createAbilityBar(): void {
    this.abilityBar = this.add.container(this.scale.width / 2, this.scale.height - 82)
      .setDepth(25)
      .setScrollFactor(0);
    const spacing = 146;
    ABILITY_ORDER.forEach((key, index) => {
      const meta = ABILITY_METADATA[key];
      const offset = index * spacing - ((ABILITY_ORDER.length - 1) * spacing) / 2;
      const container = this.add.container(offset, 0);
      const background = this.add.image(0, 0, 'ui-ability').setOrigin(0.5).setAlpha(0.96);
      const cardWidth = background.displayWidth;
      const cardHeight = background.displayHeight;
      if (!this.abilityButtonSize.width || !this.abilityButtonSize.height) {
        this.abilityButtonSize = { width: cardWidth, height: cardHeight };
      }
      const cardLeft = -cardWidth / 2;
      const keycapX = cardLeft + 36;
      const textStartX = cardLeft + 74;
      const textAreaWidth = Math.max(92, cardWidth - (textStartX - cardLeft) - 24);
      const keycap = this.add.image(keycapX, 0, 'ui-keycap').setOrigin(0.5).setAlpha(0.96);
      const keycapLabel = this.add
        .text(keycapX, 0, key, { fontFamily: FONT_FAMILY, fontSize: '18px', color: '#e8faff' })
        .setOrigin(0.5);
      const label = this.add
        .text(textStartX, -14, meta.name, {
          fontFamily: FONT_FAMILY,
          fontSize: '17px',
          color: '#cfe8ff',
          wordWrap: { width: textAreaWidth },
        })
        .setOrigin(0, 0.5);
      const detail = this.add
        .text(textStartX, 12, meta.hint ?? '', {
          fontFamily: FONT_FAMILY,
          fontSize: '12px',
          color: '#7fb8ff',
          wordWrap: { width: textAreaWidth },
          lineSpacing: 2,
        })
        .setOrigin(0, 0.5);
      const cooldownSeconds = (COOLDOWNS_MS[key] ?? 0) / 1000;
      const inputHint = ABILITY_INPUT_HINT[key];
      detail.setText(`${inputHint} · ${cooldownSeconds.toFixed(1)}s CD`);
      const cooldown = this.add
        .text(cardLeft + cardWidth - 18, -26, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '14px',
          color: '#8fbfee',
        })
        .setOrigin(1, 0.5);
      container.add([background, keycap, keycapLabel, label, detail, cooldown]);
      container.setSize(cardWidth, cardHeight);
      container.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(cardLeft, -cardHeight / 2, cardWidth, cardHeight),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        cursor: 'pointer',
      });
      container.on('pointerover', () => {
        background.setTint(0x174264);
        keycap.setTint(0x22658c);
        this.hoveredAbility = key;
        this.showTooltipForKey(key, false);
      });
      container.on('pointerout', () => {
        background.clearTint();
        keycap.clearTint();
        this.hoveredAbility = null;
        if (!(this.shiftKey?.isDown)) {
          this.hideTooltip();
        }
      });
      container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        const nativeEvent = pointer.event as PointerEvent | MouseEvent | TouchEvent | undefined;
        nativeEvent?.stopPropagation?.();
        nativeEvent?.stopImmediatePropagation?.();
      });
      container.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        const nativeEvent = pointer.event as PointerEvent | MouseEvent | TouchEvent | undefined;
        nativeEvent?.stopPropagation?.();
        nativeEvent?.stopImmediatePropagation?.();
        if (nativeEvent && 'button' in nativeEvent && nativeEvent.button !== 0) {
          return;
        }
        this.events.emit('ability-clicked', key);
      });
      container.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => {
        const nativeEvent = pointer.event as PointerEvent | MouseEvent | TouchEvent | undefined;
        nativeEvent?.stopPropagation?.();
        nativeEvent?.stopImmediatePropagation?.();
      });
      this.abilityBar.add(container);
      this.abilityButtons[key] = { container, background, keycap, keycapLabel, label, detail, cooldown, meta };
    });
    const hint = this.add.text(0, 68, 'Hold Shift for ability dossiers', {
      fontFamily: FONT_FAMILY,
      fontSize: '13px',
      color: '#6fa4d9'
    }).setOrigin(0.5);
    this.abilityBar.add(hint);
  }
  private createStatusBar(): void {
    this.statusBar = this.add.container(this.scale.width - 234, 42)
      .setDepth(45)
      .setScrollFactor(0);
    const background = this.add.image(0, 0, 'ui-status-pill').setOrigin(0.5);
    this.statusBarSize = { width: background.displayWidth, height: background.displayHeight };
    const row = this.add.container(0, 0);
    const toggleMeta: Record<ToggleKey, { icon: string; label: string }> = {
      audio: { icon: '🔊', label: 'Audio' },
      hud: { icon: '🖥', label: 'HUD' },
      palette: { icon: '🎨', label: 'Palette' },
      speed: { icon: '⏩', label: 'Speed' },
      pause: { icon: '⏯', label: 'Flow' },
      info: { icon: 'ℹ', label: 'Info' },
    };
    const chipWidth = 60;
    const horizontalSpace = Math.max(chipWidth, background.displayWidth - 112);
    const spacing = TOGGLE_KEYS.length > 1 ? horizontalSpace / (TOGGLE_KEYS.length - 1) : 0;
    const startX = -horizontalSpace / 2;
    TOGGLE_KEYS.forEach((key, index) => {
      const meta = toggleMeta[key];
      const container = this.add.container(startX + index * spacing, 0);
      const chip = this.add.image(0, 0, 'ui-status-chip').setOrigin(0.5);
      const icon = this.add.text(0, -6, meta.icon, { fontFamily: FONT_FAMILY, fontSize: '18px', color: '#d5f6ff' }).setOrigin(0.5);
      const label = this.add.text(0, 12, meta.label, { fontFamily: FONT_FAMILY, fontSize: '12px', color: '#8ebfff' }).setOrigin(0.5);
      container.add([chip, icon, label]);
      container.setSize(chipWidth, 48);
      container.setInteractive(new Phaser.Geom.Rectangle(-chipWidth / 2, -24, chipWidth, 48), Phaser.Geom.Rectangle.Contains);
      container.on('pointerover', () => chip.setTint(0x245c86));
      container.on('pointerout', () => chip.clearTint());
      container.on('pointerdown', () => this.events.emit('status-toggle', key));
      row.add(container);
      this.statusToggles[key] = { container, icon, label, key };
    });
    this.statusBar.add([background, row]);
    this.updateSettingsDisplay();
  }
  private createTooltip(): void {
    this.tooltip = this.add.container(0, 0).setDepth(40).setVisible(false).setScrollFactor(0);
    const bg = this.add.image(0, 0, 'ui-tooltip').setOrigin(0.5).setAlpha(0.96);
    const accent = this.add.rectangle(0, -40, 220, 2, 0x1f81ce, 0.32).setOrigin(0.5);
    this.tooltipTitle = this.add.text(0, -56, '', {
      fontFamily: FONT_FAMILY,
      fontSize: '18px',
      color: '#d5f4ff',
      align: 'center',
    }).setOrigin(0.5);
    this.tooltipText = this.add.text(0, -12, '', {
      fontFamily: FONT_FAMILY,
      fontSize: '14px',
      color: '#9ed3ff',
      align: 'center',
      wordWrap: { width: 240 },
      lineSpacing: 6,
    }).setOrigin(0.5, 0);
    this.tooltip.add([bg, accent, this.tooltipTitle, this.tooltipText]);
  }
  private createInfoOverlay(): void {
    this.infoOverlay = this.add.container(this.scale.width / 2, this.scale.height / 2)
      .setDepth(160)
      .setScrollFactor(0)
      .setVisible(false)
      .setAlpha(0);
    this.infoOverlayBg = this.add.rectangle(0, 0, 640, 420, 0x040d18, 0.92)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0x1f4a73, 0.85);
    this.infoOverlayTitle = this.add.text(0, 0, 'Protocol Codex', {
      fontFamily: FONT_FAMILY,
      fontSize: '26px',
      color: '#d5f4ff',
    }).setOrigin(0.5);
    const body = [
      'Factions:',
      '🔥 Thermal Protocol – volatile flares that can shatter Core Process into shards.',
      '💧 Liquid Node – adaptive currents that clone into micro-droplets.',
      '🪨 Core Process – stabilising lattice that shields nearby allies.',
      '',
      'Synergies:',
      'Slow + Nuke → Freeze-Explosion to lock sectors before purging.',
      'Buff + Shield → Resonant Bulwark for sustained pushes.',
      'Shield + Spawn → Terra Escort to usher new fragments safely.',
      'Spawn + Buff → Surge Bloom granting instant acceleration.',
      '',
      'Controls: Use the status bar to mute, swap palettes, adjust speed, pause or revisit this codex. Hold [Shift] to pin ability dossiers. Press [X] to export a snapshot.',
    ].join('\n');
    this.infoOverlayText = this.add.text(0, -120, body, {
      fontFamily: FONT_FAMILY,
      fontSize: '15px',
      color: '#9ed3ff',
      align: 'left',
      wordWrap: { width: 520 },
      lineSpacing: 6,
    }).setOrigin(0.5, 0);
    this.infoOverlayFooter = this.add.text(0, 0, 'Press [I] or tap Info to dismiss', {
      fontFamily: FONT_FAMILY,
      fontSize: '14px',
      color: '#6ea6d9',
    }).setOrigin(0.5);
    this.infoOverlay.add([this.infoOverlayBg, this.infoOverlayTitle, this.infoOverlayText, this.infoOverlayFooter]);
    this.layoutInfoOverlay(640, 420);
  }
  private createEndPanel(): void {
    this.endPanel = this.add.container(this.scale.width / 2, this.scale.height / 2)
      .setDepth(200)
      .setScrollFactor(0)
      .setVisible(false);
    const panelBg = this.add.rectangle(0, 0, 560, 360, 0x07192f, 0.92)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0x1f3659, 0.85);
    const baseStyle = { fontFamily: FONT_FAMILY, color: '#cfe8ff', align: 'center' as const };
    this.endTitle = this.add.text(0, -140, 'Protocol Complete', { ...baseStyle, fontSize: '28px' }).setOrigin(0.5);
    this.endSummary = this.add.text(0, -48, 'Runtime: 0.0s\nBest: --\nSeed: --', { ...baseStyle, fontSize: '20px' }).setOrigin(0.5);
    this.endLogs = this.add.text(0, 36, '', { ...baseStyle, fontSize: '18px', align: 'left' }).setOrigin(0.5);
    this.endFooter = this.add.text(0, 140, 'R: Restart | Space: Pause | M: Mute | C: Palette', { ...baseStyle, fontSize: '16px', color: '#8fb7ff' }).setOrigin(0.5);
    this.endPanel.add([panelBg, this.endTitle, this.endSummary, this.endLogs, this.endFooter]);
  }
  private showTooltipForKey(key: AbilityKey, pinned: boolean): void {
    const button = this.abilityButtons[key];
    if (!button) return;
    const meta = button.meta;
    this.tooltipKey = key;
    const worldX = this.abilityBar.x + button.container.x;
    const worldY = this.abilityBar.y + button.container.y;
    this.tooltip.setPosition(worldX, worldY - 100);
    this.tooltipTitle.setText(meta.name.toUpperCase());
    const lines: string[] = [meta.description, meta.hint];
    const cooldownSeconds = (COOLDOWNS_MS[key] ?? 0) / 1000;
    const inputHint = ABILITY_INPUT_HINT[key];
    lines.push(`Input: ${inputHint} • Cooldown: ${cooldownSeconds.toFixed(1)}s`);
    const durationHint = ABILITY_DURATION_HINT[key];
    if (durationHint) {
      lines.push(durationHint);
    }
    if (meta.combo) {
      lines.push(`Synergy: ${meta.combo}`);
    }
    this.tooltipText.setText(lines.join('\n\n'));
    this.tooltip.setVisible(this.hudVisible);
    if (!pinned) {
      this.tooltip.setAlpha(1);
    }
  }
  private hideTooltip(): void {
    this.tooltipKey = null;
    this.tooltip.setVisible(false);
  }
  private updateSettingsDisplay(): void {
    this.updateToggleState('audio', !this.muted, this.muted ? 'Muted' : 'Audio');
    this.updateToggleState('hud', this.hudVisible, this.hudVisible ? 'HUD On' : 'HUD Off');
    this.updateToggleState('palette', this.colorblind, this.colorblind ? 'Alt Mode' : 'Default');
    this.updateToggleState('speed', true, `${this.speedValue.toFixed(1)}x`);
    this.updateToggleState('pause', !this.paused, this.paused ? 'Paused' : 'Flowing');
    this.updateToggleState('info', this.infoVisible, this.infoVisible ? 'Info On' : 'Info');
  }

  private updateToggleState(key: ToggleKey, active: boolean, label: string): void {
    const toggle = this.statusToggles[key];
    if (!toggle) return;
    toggle.label.setText(label);
    toggle.container.setAlpha(active ? 1 : 0.72);
    toggle.icon.setAlpha(active ? 1 : 0.7);
    toggle.label.setColor(active ? '#cfe8ff' : '#7ea6d8');
  }

  private handleResize(size: Phaser.Structs.Size): void {
    const { width, height } = size;
    const scaleFactor = Phaser.Math.Clamp(width / 1280, 0.95, 1.5);
    const safeMargin = Math.max(18, 16 * scaleFactor);

    this.hud.setScale(scaleFactor);
    this.hud.setPosition(safeMargin, safeMargin);

    this.abilityBar.setScale(scaleFactor);
    this.statusBar.setScale(scaleFactor);
    this.tooltip.setScale(scaleFactor);
    this.balanceBar.setScale(scaleFactor, scaleFactor);
    if (this.verboseCli) {
      this.verboseCli.setScale(scaleFactor);
    }

    const abilityHeight = this.abilityButtonSize.height || 96;
    const abilityHalf = (abilityHeight * scaleFactor) / 2;
    const minAbilityY = safeMargin + abilityHalf + 32;
    let abilityY = Math.max(minAbilityY, height - safeMargin - abilityHalf);
    abilityY = Math.min(abilityY, height - safeMargin - abilityHalf);
    this.abilityBar.setPosition(width / 2, abilityY);

    const statusWidth = this.statusBarSize.width || 360;
    const statusHeight = this.statusBarSize.height || 72;
    const statusHalfWidth = (statusWidth * scaleFactor) / 2;
    const statusHalfHeight = (statusHeight * scaleFactor) / 2;
    this.statusBar.setPosition(width - safeMargin - statusHalfWidth, safeMargin + statusHalfHeight);

    this.balanceBar.setPosition(this.hud.x + 36 * scaleFactor, this.hud.y + 172 * scaleFactor);

    if (this.verboseCli) {
      const cliDimensions = this.verboseCli.getDimensions();
      const cliWidth = cliDimensions.width * scaleFactor;
      const cliHeight = cliDimensions.height * scaleFactor;
      const abilityTop = abilityY - abilityHalf;
      let cliY = abilityTop - cliHeight - 16;
      cliY = Math.min(cliY, height - cliHeight - safeMargin);
      cliY = Math.max(safeMargin, cliY);
      const cliX = safeMargin;
      this.verboseCli.setPosition(cliX, cliY);
    }

    this.endPanel.setPosition(width / 2, height / 2);
    const tooltipMargin = 160 * scaleFactor;
    this.tooltip.setPosition(Phaser.Math.Clamp(this.tooltip.x, tooltipMargin, width - tooltipMargin), this.tooltip.y);
    const overlayWidth = Phaser.Math.Clamp(width - safeMargin * 2, 480, 760);
    const overlayHeight = Phaser.Math.Clamp(height - safeMargin * 2, 320, 520);
    this.infoOverlay.setPosition(width / 2, height / 2);
    this.layoutInfoOverlay(overlayWidth, overlayHeight);
  }

  private refreshFactionIcons(palette: Record<FactionId, number>): void {
    FACTIONS.forEach((faction) => {
      const display = this.factionDisplays[faction];
      if (!display) return;
      const textureKey = this.colorMode === 'alt' ? `${TEXTURE_KEY[faction]}-alt` : TEXTURE_KEY[faction];
      if (this.textures.exists(textureKey)) {
        display.icon.setTexture(textureKey);
      }
      if (display.glow) {
        const glowKey = this.colorMode === 'alt' ? `${TEXTURE_KEY[faction]}-alt-glow` : `${TEXTURE_KEY[faction]}-glow`;
        if (this.textures.exists(glowKey)) {
          display.glow.setTexture(glowKey);
        }
      }
      display.icon.setTint(palette[faction]);
    });
  }

  private layoutInfoOverlay(width: number, height: number): void {
    if (!this.infoOverlayBg) return;
    const halfHeight = height / 2;
    this.infoOverlayBg.setSize(width, height);
    this.infoOverlayTitle.setPosition(0, -halfHeight + 48);
    this.infoOverlayText.setPosition(0, -halfHeight + 100);
    this.infoOverlayText.setWordWrapWidth(width - 160);
    this.infoOverlayFooter.setPosition(0, halfHeight - 52);
  }
}

