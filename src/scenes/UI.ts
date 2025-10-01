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
import {
  HUD_SAFE_MARGIN,
  HUD_RADIUS,
  PANEL_BACKGROUND_ALPHA,
  PANEL_BACKGROUND_COLOR,
  PANEL_BORDER_ALPHA,
  PANEL_BORDER_COLOR,
  HUD_FONT_FAMILY,
  getHudScale,
  onHudScaleChange,
  scaleValue,
} from "../ui/theme";
const INFO_PANEL_WIDTH = 340;
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
  background: Phaser.GameObjects.Graphics;
  keycap: Phaser.GameObjects.Graphics;
  keycapLabel: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  metaText: Phaser.GameObjects.Text;
  cooldown: Phaser.GameObjects.Text;
  meta: AbilityMeta;
  width: number;
  height: number;
};

type StatusToggle = {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  key: ToggleKey;
  width: number;
  height: number;
};
export class UI extends Phaser.Scene {
  private hud!: Phaser.GameObjects.Container;
  private hudBackground!: Phaser.GameObjects.Graphics;
  private hudBorder!: Phaser.GameObjects.Graphics;
  private modeText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private factionDisplays: Record<FactionId, { container: Phaser.GameObjects.Container; icon: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image | null; count: Phaser.GameObjects.Text; label: Phaser.GameObjects.Text }> = {} as Record<FactionId, { container: Phaser.GameObjects.Container; icon: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image | null; count: Phaser.GameObjects.Text; label: Phaser.GameObjects.Text }>;
  private equilibriumText!: Phaser.GameObjects.Text;
  private equilibriumValue = 1;
  private balanceBar!: BalanceBar;
  private abilityBar!: Phaser.GameObjects.Container;
  private abilityHint!: Phaser.GameObjects.Text;
  private abilityButtons: Record<AbilityKey, AbilityButton> = {} as Record<AbilityKey, AbilityButton>;
  private statusBar!: Phaser.GameObjects.Container;
  private statusFrame!: Phaser.GameObjects.Rectangle;
  private statusToggles: Record<ToggleKey, StatusToggle> = {} as Record<ToggleKey, StatusToggle>;
  private hotbarDebugOverlay?: Phaser.GameObjects.Graphics;
  private tooltip!: Phaser.GameObjects.Container;
  private tooltipTitle!: Phaser.GameObjects.Text;
  private tooltipText!: Phaser.GameObjects.Text;
  private textTooltip!: Phaser.GameObjects.Container;
  private textTooltipBackground!: Phaser.GameObjects.Graphics;
  private textTooltipLabel!: Phaser.GameObjects.Text;
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
  private infoPanelSize = { width: 0, height: 0 };
  private readonly lastCounts: FactionCounts = { Fire: 0, Water: 0, Earth: 0 };
  private muted = true;
  private colorblind = false;
  private hudVisible = true;
  private paused = false;
  private ready = false;
  private colorMode: 'default' | 'alt' = 'default';
  private infoVisible = false;
  private speedValue = 1;
  private detachHudScale?: () => void;
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
      this.detachHudScale?.();
    });
    this.detachHudScale = onHudScaleChange(() => this.handleResize(this.scale.gameSize));
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
        button.container.setData('cooldown', true);
      } else {
        button.cooldown.setText('');
        button.container.setData('cooldown', false);
      }
      this.layoutAbilityButton(button, button.width, button.height, getHudScale());
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
      button.metaText.setColor(this.colorblind ? '#b9d8ff' : '#8fbfee');
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
      this.hideLabelTooltip();
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
      button.metaText.setColor(this.colorblind ? '#b9d8ff' : '#8fbfee');
    });
  }
  private createHud(): void {
    this.hud = this.add.container(0, 0).setDepth(30).setScrollFactor(0);
    this.hudBackground = this.add.graphics();
    this.hudBorder = this.add.graphics();
    this.hudBackground.setScrollFactor(0);
    this.hudBorder.setScrollFactor(0);
    this.hud.add([this.hudBackground, this.hudBorder]);

    this.modeText = this.add
      .text(0, 0, "Mode: Balance", {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: "18px",
        fontStyle: "bold",
        color: "#e5f6ff",
      })
      .setOrigin(0, 0);
    this.timerText = this.add
      .text(0, 0, "Time: 0.0s", {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: "16px",
        fontStyle: "500",
        color: "#b7d6f6",
      })
      .setOrigin(0, 0);

    const factionPalette = getPalette(false);
    FACTIONS.forEach((faction) => {
      const container = this.add.container(0, 0);
      const icon = this.add.image(0, 0, TEXTURE_KEY[faction]).setOrigin(0.5);
      icon.setTint(factionPalette[faction]);
      const label = this.add
        .text(0, 0, NAME_MAP[faction].split(" ")[0] ?? faction, {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: "13px",
          fontStyle: "500",
          color: "#81bff2",
        })
        .setOrigin(0, 0.5);
      const count = this.add
        .text(0, 0, "000", {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: "18px",
          fontStyle: "700",
          color: "#eef7ff",
        })
        .setOrigin(1, 0.5);
      container.add([icon, label, count]);
      this.hud.add(container);
      this.factionDisplays[faction] = { container, icon, glow: null, label, count };
    });

    this.equilibriumText = this.add
      .text(0, 0, "Equilibrium: 100%", {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: "14px",
        fontStyle: "500",
        color: "#9bdcff",
      })
      .setOrigin(0, 0);

    this.hud.add([this.modeText, this.timerText, this.equilibriumText]);

    this.balanceBar = new BalanceBar(this, 0, 0, INFO_PANEL_WIDTH - 24, 10);
  }
  private createAbilityBar(): void {
    this.abilityBar = this.add.container(0, 0).setDepth(35).setScrollFactor(0);
    ABILITY_ORDER.forEach((key) => {
      const meta = ABILITY_METADATA[key];
      const container = this.add.container(0, 0);
      container.setData('hovered', false);
      container.setData('cooldown', false);
      const background = this.add.graphics();
      background.setScrollFactor(0);
      const keycap = this.add.graphics();
      keycap.setScrollFactor(0);
      const keycapLabel = this.add
        .text(0, 0, key, {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: '16px',
          fontStyle: '700',
          color: '#e8faff',
        })
        .setOrigin(0.5);
      const label = this.add
        .text(0, 0, meta.name, {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: '16px',
          fontStyle: '600',
          color: '#cfe8ff',
        })
        .setOrigin(0, 0.5);
      const metaText = this.add
        .text(0, 0, '', {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: '12px',
          fontStyle: '400',
          color: '#8fbfee',
        })
        .setOrigin(0, 0.5);
      const cooldown = this.add
        .text(0, 0, '', {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: '14px',
          fontStyle: '600',
          color: '#8fbfee',
        })
        .setOrigin(1, 0.5);
      container.add([background, keycap, keycapLabel, label, metaText, cooldown]);
      container.setSize(180, 54);
      container.setInteractive(
        new Phaser.Geom.Rectangle(-90, -27, 180, 54),
        Phaser.Geom.Rectangle.Contains,
      );
      const abilityButton: AbilityButton = {
        container,
        background,
        keycap,
        keycapLabel,
        label,
        metaText,
        cooldown,
        meta,
        width: 180,
        height: 54,
      };
      this.abilityButtons[key] = abilityButton;
      container.on('pointerover', () => {
        container.setData('hovered', true);
        this.hoveredAbility = key;
        this.layoutAbilityButton(abilityButton, abilityButton.width, abilityButton.height, getHudScale());
        this.showTooltipForKey(key, false);
      });
      container.on('pointerout', () => {
        container.setData('hovered', false);
        this.hoveredAbility = null;
        this.layoutAbilityButton(abilityButton, abilityButton.width, abilityButton.height, getHudScale());
        if (!(this.shiftKey?.isDown)) {
          this.hideTooltip();
        }
        this.hideLabelTooltip();
      });
      container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        const nativeEvent = pointer.event as PointerEvent | MouseEvent | TouchEvent | undefined;
        nativeEvent?.stopPropagation?.();
        nativeEvent?.stopImmediatePropagation?.();
        this.hideLabelTooltip();
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
      const baseCooldown = (COOLDOWNS_MS[key] ?? 0) / 1000;
      abilityButton.metaText.setText(`${baseCooldown.toFixed(1)}s cooldown`);
      abilityButton.metaText.setData('full-text', abilityButton.metaText.text);
    });
    this.abilityHint = this.add
      .text(0, 0, 'Hold Shift for ability dossiers', {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: '12px',
        fontStyle: '500',
        color: '#6fa4d9',
      })
      .setOrigin(0.5);
    this.abilityBar.add(this.abilityHint);
  }
  private createStatusBar(): void {
    this.statusBar = this.add.container(0, 0).setDepth(45).setScrollFactor(0);
    this.statusFrame = this.add.graphics();
    this.statusFrame.setScrollFactor(0);
    this.statusBar.add(this.statusFrame);
    const toggleMeta: Record<ToggleKey, { icon: string; label: string }> = {
      audio: { icon: '🔊', label: 'Audio' },
      hud: { icon: '🖥', label: 'HUD' },
      palette: { icon: '🎨', label: 'Palette' },
      speed: { icon: '⏩', label: 'Speed' },
      pause: { icon: '⏯', label: 'Flow' },
      info: { icon: 'ℹ', label: 'Info' },
    };
    TOGGLE_KEYS.forEach((key) => {
      const meta = toggleMeta[key];
      const container = this.add.container(0, 0);
      container.setData('hovered', false);
      const background = this.add.graphics();
      background.setScrollFactor(0);
      const icon = this.add
        .text(0, 0, meta.icon, { fontFamily: HUD_FONT_FAMILY, fontSize: '18px', fontStyle: '500', color: '#d5f6ff' })
        .setOrigin(0.5);
      const label = this.add
        .text(0, 0, meta.label, { fontFamily: HUD_FONT_FAMILY, fontSize: '12px', fontStyle: '500', color: '#8ebfff' })
        .setOrigin(0.5);
      label.setData('full-text', meta.label);
      container.add([background, icon, label]);
      container.setSize(60, 32);
      container.setInteractive(
        new Phaser.Geom.Rectangle(-30, -16, 60, 32),
        Phaser.Geom.Rectangle.Contains,
      );
      const toggle: StatusToggle = { container, background, icon, label, key, width: 60, height: 32 };
      this.statusToggles[key] = toggle;
      container.on('pointerover', () => {
        container.setData('hovered', true);
        this.drawHotbarButton(toggle, true);
        this.maybeShowToggleTooltip(toggle);
      });
      container.on('pointerout', () => {
        container.setData('hovered', false);
        this.drawHotbarButton(toggle, false);
        this.hideLabelTooltip();
      });
      container.on('pointerdown', () => {
        this.hideLabelTooltip();
        this.events.emit('status-toggle', key);
      });
      this.statusBar.add(container);
    });
    this.hotbarDebugOverlay = this.add.graphics();
    this.hotbarDebugOverlay.setScrollFactor(0);
    this.hotbarDebugOverlay.setVisible(false);
    this.statusBar.add(this.hotbarDebugOverlay);
    this.updateSettingsDisplay();
  }
  private createTooltip(): void {
    this.tooltip = this.add.container(0, 0).setDepth(40).setVisible(false).setScrollFactor(0);
    const bg = this.add.image(0, 0, 'ui-tooltip').setOrigin(0.5).setAlpha(0.96);
    const accent = this.add.rectangle(0, -40, 220, 2, 0x1f81ce, 0.32).setOrigin(0.5);
    this.tooltipTitle = this.add.text(0, -56, '', {
      fontFamily: HUD_FONT_FAMILY,
      fontSize: '18px',
      color: '#d5f4ff',
      align: 'center',
    }).setOrigin(0.5);
    this.tooltipText = this.add.text(0, -12, '', {
      fontFamily: HUD_FONT_FAMILY,
      fontSize: '14px',
      color: '#9ed3ff',
      align: 'center',
      wordWrap: { width: 240 },
      lineSpacing: 6,
    }).setOrigin(0.5, 0);
    this.tooltip.add([bg, accent, this.tooltipTitle, this.tooltipText]);
    this.createLabelTooltip();
  }
  private createLabelTooltip(): void {
    this.textTooltip = this.add.container(0, 0).setDepth(48).setVisible(false).setScrollFactor(0);
    this.textTooltipBackground = this.add.graphics();
    this.textTooltipBackground.setScrollFactor(0);
    this.textTooltipLabel = this.add
      .text(0, 0, '', {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: '12px',
        fontStyle: '500',
        color: '#e7f5ff',
        align: 'center',
      })
      .setOrigin(0.5);
    this.textTooltip.add([this.textTooltipBackground, this.textTooltipLabel]);
  }
  private showLabelTooltip(content: string, worldX: number, worldY: number): void {
    if (!content || !this.textTooltip || !this.textTooltipBackground || !this.textTooltipLabel) {
      return;
    }
    const scale = getHudScale();
    this.textTooltipLabel.setFontSize(12 * scale);
    this.textTooltipLabel.setText(content);
    const paddingX = 10 * scale;
    const paddingY = 6 * scale;
    const width = this.textTooltipLabel.width + paddingX * 2;
    const height = this.textTooltipLabel.height + paddingY * 2;
    const radius = HUD_RADIUS * scale * 0.6;
    this.textTooltipBackground.clear();
    this.textTooltipBackground.fillStyle(PANEL_BACKGROUND_COLOR, PANEL_BACKGROUND_ALPHA);
    this.textTooltipBackground.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    this.textTooltipBackground.lineStyle(1, PANEL_BORDER_COLOR, PANEL_BORDER_ALPHA);
    this.textTooltipBackground.strokeRoundedRect(
      -width / 2 + 0.5,
      -height / 2 + 0.5,
      width - 1,
      height - 1,
      Math.max(0, radius - 1),
    );
    const viewportWidth = this.scale.width;
    const viewportHeight = this.scale.height;
    const safeMargin = HUD_SAFE_MARGIN * scale;
    const clampedX = Phaser.Math.Clamp(worldX, safeMargin + width / 2, viewportWidth - safeMargin - width / 2);
    const clampedY = Phaser.Math.Clamp(worldY, safeMargin + height / 2, viewportHeight - safeMargin - height / 2);
    this.textTooltip.setPosition(clampedX, clampedY);
    this.textTooltip.setVisible(this.hudVisible);
    this.children.bringToTop(this.textTooltip);
  }
  private hideLabelTooltip(): void {
    if (!this.textTooltip) {
      return;
    }
    this.textTooltip.setVisible(false);
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
      fontFamily: HUD_FONT_FAMILY,
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
      fontFamily: HUD_FONT_FAMILY,
      fontSize: '15px',
      color: '#9ed3ff',
      align: 'left',
      wordWrap: { width: 520 },
      lineSpacing: 6,
    }).setOrigin(0.5, 0);
    this.infoOverlayFooter = this.add.text(0, 0, 'Press [I] or tap Info to dismiss', {
      fontFamily: HUD_FONT_FAMILY,
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
    const baseStyle = { fontFamily: HUD_FONT_FAMILY, color: '#cfe8ff', align: 'center' as const };
    this.endTitle = this.add.text(0, -140, 'Protocol Complete', { ...baseStyle, fontSize: '28px' }).setOrigin(0.5);
    this.endSummary = this.add.text(0, -48, 'Runtime: 0.0s\nBest: --\nSeed: --', { ...baseStyle, fontSize: '20px' }).setOrigin(0.5);
    this.endLogs = this.add.text(0, 36, '', { ...baseStyle, fontSize: '18px', align: 'left' }).setOrigin(0.5);
    this.endFooter = this.add.text(0, 140, 'R: Restart | Space: Pause | M: Mute | C: Palette', { ...baseStyle, fontSize: '16px', color: '#8fb7ff' }).setOrigin(0.5);
    this.endPanel.add([panelBg, this.endTitle, this.endSummary, this.endLogs, this.endFooter]);
  }
  private showTooltipForKey(key: AbilityKey, pinned: boolean): void {
    const button = this.abilityButtons[key];
    if (!button) return;
    this.hideLabelTooltip();
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
    toggle.label.setData('full-text', label);
    toggle.container.setAlpha(active ? 1 : 0.72);
    toggle.icon.setAlpha(active ? 1 : 0.7);
    toggle.label.setColor(active ? '#cfe8ff' : '#7ea6d8');
    const maxWidth = (toggle.label.getData('max-width') as number) ?? toggle.label.width;
    this.truncateText(toggle.label, maxWidth);
  }

  private layoutInfoPanel(scale: number): void {
    const paddingX = scaleValue(12);
    const paddingY = scaleValue(12);
    const lineGap = scaleValue(6);
    const width = Math.round(INFO_PANEL_WIDTH * scale);
    let cursorY = paddingY;

    this.modeText.setFontSize(18 * scale);
    this.modeText.setPosition(paddingX, cursorY);
    cursorY += this.modeText.height + lineGap;

    this.timerText.setFontSize(16 * scale);
    this.timerText.setPosition(paddingX, cursorY);
    cursorY += this.timerText.height + lineGap * 1.2;

    const iconSize = scaleValue(20);
    const rowHeight = Math.max(iconSize + scaleValue(4), scaleValue(30));
    const containerWidth = width - paddingX * 2;
    const labelColumnWidth = containerWidth * 0.48;
    FACTIONS.forEach((faction, index) => {
      const display = this.factionDisplays[faction];
      if (!display) return;
      const rowTop = cursorY + index * rowHeight;
      display.container.setPosition(paddingX, rowTop);
      display.container.setSize(containerWidth, rowHeight);
      display.icon.setDisplaySize(iconSize, iconSize);
      display.icon.setPosition(iconSize / 2, rowHeight / 2);
      display.label.setFontSize(13 * scale);
      display.label.setPosition(iconSize + scaleValue(8), rowHeight / 2);
      display.label.setFixedSize(labelColumnWidth, rowHeight);
      display.label.setOrigin(0, 0.5);
      display.count.setFontSize(18 * scale);
      display.count.setFixedSize(containerWidth - labelColumnWidth - iconSize - scaleValue(12), rowHeight);
      display.count.setPosition(containerWidth, rowHeight / 2);
      display.count.setOrigin(1, 0.5);
    });
    cursorY += rowHeight * FACTIONS.length + lineGap * 1.2;

    this.equilibriumText.setFontSize(14 * scale);
    this.equilibriumText.setPosition(paddingX, cursorY);
    cursorY += this.equilibriumText.height + scaleValue(10);

    const barWidth = width - paddingX * 2;
    this.balanceBar.setPosition(this.hud.x + paddingX, this.hud.y + cursorY);
    this.balanceBar.setScale(scale, scale);
    const barHeight = 10 * scale;
    cursorY += barHeight + paddingY;

    const height = cursorY;
    this.hudBorder.setPosition(this.hud.x, this.hud.y);
    this.hudBackground.setPosition(this.hud.x, this.hud.y);
    this.redrawInfoPanel(width, height, scale);
    this.infoPanelSize = { width, height };
  }

  private layoutStatusBar(scale: number, viewportWidth: number, safeMargin: number): void {
    const paddingX = 12 * scale;
    const paddingY = 8 * scale;
    const buttonHeight = 36 * scale;
    const gap = 6 * scale;
    let contentWidth = 0;
    const toggles: StatusToggle[] = [];
    TOGGLE_KEYS.forEach((key) => {
      const toggle = this.statusToggles[key];
      if (!toggle) return;
      toggles.push(toggle);
      toggle.icon.setFontSize(18 * scale);
      toggle.label.setFontSize(12 * scale);
      const iconWidth = toggle.icon.width;
      const minWidth = 48 * scale;
      const labelPadding = 6 * scale;
      const horizontalPadding = 10 * scale;
      const estimatedWidth = iconWidth + horizontalPadding * 2 + toggle.label.width + labelPadding;
      const width = Math.max(minWidth, estimatedWidth);
      toggle.width = width;
      toggle.height = buttonHeight;
      toggle.container.setSize(width, buttonHeight);
      toggle.container.setInteractive(
        new Phaser.Geom.Rectangle(-width / 2, -buttonHeight / 2, width, buttonHeight),
        Phaser.Geom.Rectangle.Contains,
      );
      const iconX = -width / 2 + horizontalPadding + iconWidth / 2;
      toggle.icon.setPosition(iconX, 0);
      const labelStart = iconX + iconWidth / 2 + labelPadding;
      const labelEnd = width / 2 - horizontalPadding;
      const labelWidth = Math.max(0, labelEnd - labelStart);
      toggle.label.setPosition(labelStart, 0);
      toggle.label.setOrigin(0, 0.5);
      toggle.label.setFixedSize(labelWidth, buttonHeight);
      toggle.label.setData('max-width', labelWidth);
      this.truncateText(toggle.label, labelWidth);
      contentWidth += width;
    });
    if (toggles.length > 1) {
      contentWidth += gap * (toggles.length - 1);
    }
    const frameWidth = contentWidth + paddingX * 2;
    const frameHeight = buttonHeight + paddingY * 2;
    let cursorX = -contentWidth / 2;
    toggles.forEach((toggle, index) => {
      const posX = cursorX + toggle.width / 2;
      toggle.container.setPosition(posX, 0);
      cursorX += toggle.width + (index < toggles.length - 1 ? gap : 0);
      const hovered = toggle.container.getData('hovered') === true;
      this.drawHotbarButton(toggle, hovered);
    });
    const frameRadius = HUD_RADIUS * scale;
    this.statusFrame.clear();
    this.statusFrame.fillStyle(PANEL_BACKGROUND_COLOR, PANEL_BACKGROUND_ALPHA);
    this.statusFrame.fillRoundedRect(-frameWidth / 2, -frameHeight / 2, frameWidth, frameHeight, frameRadius);
    this.statusFrame.lineStyle(1, PANEL_BORDER_COLOR, PANEL_BORDER_ALPHA);
    this.statusFrame.strokeRoundedRect(-frameWidth / 2 + 0.5, -frameHeight / 2 + 0.5, frameWidth - 1, frameHeight - 1, Math.max(0, frameRadius - 1));
    this.statusBar.setPosition(viewportWidth - safeMargin - frameWidth / 2, safeMargin + frameHeight / 2);
    this.statusBarSize = { width: frameWidth, height: frameHeight };
    if (this.hotbarDebugOverlay) {
      this.hotbarDebugOverlay.clear();
      if (this.hotbarDebugOverlay.visible) {
        this.hotbarDebugOverlay.lineStyle(1, 0xff00ff, 0.6);
        toggles.forEach((toggle) => {
          this.hotbarDebugOverlay.strokeRect(
            toggle.container.x - toggle.width / 2,
            toggle.container.y - toggle.height / 2,
            toggle.width,
            toggle.height,
          );
        });
      }
    }
  }

  private maybeShowToggleTooltip(toggle: StatusToggle): void {
    const truncated = toggle.label.getData('truncated') === true;
    if (!truncated) {
      this.hideLabelTooltip();
      return;
    }
    const content = (toggle.label.getData('full-text') as string) ?? toggle.label.text;
    const scale = getHudScale();
    const verticalOffset = toggle.height / 2 + 12 * scale;
    const worldX = this.statusBar.x + toggle.container.x;
    const worldY = this.statusBar.y + toggle.container.y - verticalOffset;
    this.showLabelTooltip(content, worldX, worldY);
  }

  private layoutAbilityBar(scale: number, viewportWidth: number, viewportHeight: number, safeMargin: number): void {
    const count = ABILITY_ORDER.length;
    const minWidth = 150 * scale;
    const maxWidth = 220 * scale;
    const gap = 10 * scale;
    const availableWidth = Math.max(viewportWidth - safeMargin * 2, minWidth * count + gap * (count - 1));
    const idealWidth = (availableWidth - gap * (count - 1)) / count;
    const buttonWidth = Phaser.Math.Clamp(idealWidth, minWidth, maxWidth);
    const buttonHeight = 54 * scale;
    const totalWidth = count * buttonWidth + (count - 1) * gap;
    let cursorX = -totalWidth / 2;
    ABILITY_ORDER.forEach((key) => {
      const button = this.abilityButtons[key];
      if (!button) return;
      button.container.setPosition(cursorX + buttonWidth / 2, 0);
      button.container.setSize(buttonWidth, buttonHeight);
      this.layoutAbilityButton(button, buttonWidth, buttonHeight, scale);
      cursorX += buttonWidth + gap;
    });
    const abilityY = viewportHeight - safeMargin - buttonHeight / 2;
    this.abilityBar.setPosition(viewportWidth / 2, abilityY);
    this.abilityButtonSize = { width: buttonWidth, height: buttonHeight };
    if (this.abilityHint) {
      this.abilityHint.setFontSize(12 * scale);
      this.abilityHint.setPosition(0, buttonHeight / 2 + 20 * scale);
    }
  }

  private positionCli(scale: number, viewportWidth: number, viewportHeight: number, safeMargin: number): void {
    if (!this.verboseCli) return;
    const cliDimensions = this.verboseCli.getDimensions(scale);
    const abilityBounds = this.getAbilityBarBounds();
    const cliWidth = cliDimensions.width;
    const cliHeight = cliDimensions.height;
    let cliX = safeMargin;
    let cliY = viewportHeight - safeMargin - cliHeight;
    if (abilityBounds.bottom + 8 * scale > viewportHeight - cliHeight - safeMargin) {
      cliY = abilityBounds.top - cliHeight - 8 * scale;
    }
    cliY = Phaser.Math.Clamp(cliY, safeMargin, viewportHeight - safeMargin - cliHeight);
    this.verboseCli.setPosition(cliX, cliY);
  }

  private getAbilityBarBounds(): { left: number; right: number; top: number; bottom: number } {
    const width = this.abilityButtonSize.width;
    const height = this.abilityButtonSize.height;
    const scale = getHudScale();
    const gap = 10 * scale;
    const totalWidth = width * ABILITY_ORDER.length + gap * (ABILITY_ORDER.length - 1);
    return {
      left: this.abilityBar.x - totalWidth / 2,
      right: this.abilityBar.x + totalWidth / 2,
      top: this.abilityBar.y - height / 2,
      bottom: this.abilityBar.y + height / 2,
    };
  }

  private layoutAbilityButton(button: AbilityButton, width: number, height: number, scale: number): void {
    button.width = width;
    button.height = height;
    const rightPadding = 10 * scale;
    const paddingY = 6 * scale;
    const keycapSize = 28 * scale;
    const keycapPadding = 8 * scale;
    const gap = 10 * scale;
    const countdownWidth = 42 * scale;
    const hovered = button.container.getData('hovered') === true;
    const leftEdge = -width / 2;
    const keycapX = leftEdge + keycapPadding + keycapSize / 2;
    const textStartX = leftEdge + keycapPadding + keycapSize + gap;
    const textRightLimit = width / 2 - rightPadding - countdownWidth;
    const stackWidth = Math.max(0, textRightLimit - textStartX);
    const nameY = -height / 2 + paddingY + 14 * scale;
    const metaY = nameY + 16 * scale;
    button.keycap.setPosition(keycapX, 0);
    button.keycap.clear();
    const isCooling = button.container.getData('cooldown') === true;
    const keycapColor = hovered ? 0x1d3b58 : 0x13273d;
    const keycapAlpha = isCooling ? 0.6 : 0.85;
    const keycapRadius = HUD_RADIUS * scale * 0.6;
    button.keycap.fillStyle(keycapColor, keycapAlpha);
    button.keycap.fillRoundedRect(-keycapSize / 2, -keycapSize / 2, keycapSize, keycapSize, keycapRadius);
    button.keycap.lineStyle(1, PANEL_BORDER_COLOR, PANEL_BORDER_ALPHA * 1.4);
    button.keycap.strokeRoundedRect(-keycapSize / 2 + 0.5, -keycapSize / 2 + 0.5, keycapSize - 1, keycapSize - 1, Math.max(0, keycapRadius - 1));
    button.keycapLabel.setFontSize(16 * scale);
    button.keycapLabel.setPosition(button.keycap.x, button.keycap.y);
    button.label.setFontSize(16 * scale);
    button.label.setPosition(textStartX, nameY);
    button.label.setOrigin(0, 0);
    button.label.setFixedSize(stackWidth, 20 * scale);
    button.label.setData('full-text', button.meta.name);
    button.label.setText(button.meta.name);
    this.truncateText(button.label, stackWidth);
    button.metaText.setFontSize(12 * scale);
    button.metaText.setPosition(textStartX, metaY);
    button.metaText.setOrigin(0, 0);
    button.metaText.setFixedSize(stackWidth, 16 * scale);
    this.truncateText(button.metaText, stackWidth);
    button.cooldown.setFontSize(14 * scale);
    button.cooldown.setPosition(width / 2 - rightPadding, 0);
    button.cooldown.setOrigin(1, 0.5);
    button.cooldown.setFixedSize(countdownWidth, height - paddingY * 2);
    button.container.setInteractive(
      new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
      Phaser.Geom.Rectangle.Contains,
    );
    this.drawAbilityBackground(button, hovered);
  }

  private drawAbilityBackground(button: AbilityButton | undefined, hovered: boolean): void {
    if (!button) return;
    const width = button.width;
    const height = button.height;
    const scale = getHudScale();
    const isCooling = button.container.getData('cooldown') === true;
    const radius = HUD_RADIUS * scale;
    const fill = hovered ? 0x18324a : 0x101f2e;
    const alpha = isCooling ? 0.55 : hovered ? 0.82 : 0.72;
    button.background.clear();
    button.background.fillStyle(fill, alpha);
    button.background.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    button.background.lineStyle(1, PANEL_BORDER_COLOR, PANEL_BORDER_ALPHA);
    button.background.strokeRoundedRect(-width / 2 + 0.5, -height / 2 + 0.5, width - 1, height - 1, Math.max(0, radius - 1));
  }

  private drawHotbarButton(toggle: StatusToggle | undefined, hovered: boolean): void {
    if (!toggle) return;
    const scale = getHudScale();
    const radius = HUD_RADIUS * scale;
    const fill = hovered ? 0x1a3450 : 0x102030;
    toggle.background.clear();
    toggle.background.fillStyle(fill, hovered ? 0.78 : 0.65);
    toggle.background.fillRoundedRect(-toggle.width / 2, -toggle.height / 2, toggle.width, toggle.height, radius * 0.6);
    toggle.background.lineStyle(1, PANEL_BORDER_COLOR, PANEL_BORDER_ALPHA);
    toggle.background.strokeRoundedRect(
      -toggle.width / 2 + 0.5,
      -toggle.height / 2 + 0.5,
      toggle.width - 1,
      toggle.height - 1,
      Math.max(0, radius * 0.6 - 1),
    );
  }

  private truncateText(text: Phaser.GameObjects.Text, maxWidth: number): void {
    if (maxWidth <= 0) {
      text.setData('truncated', false);
      return;
    }
    const original = (text.getData('full-text') as string) ?? text.text;
    text.setData('full-text', original);
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

  setHotbarDebug(enabled: boolean): void {
    if (!this.hotbarDebugOverlay) return;
    this.hotbarDebugOverlay.setVisible(enabled);
    this.handleResize(this.scale.gameSize);
  }

  private handleResize(size: Phaser.Structs.Size): void {
    const { width, height } = size;
    const hudScale = getHudScale();
    const safeMargin = HUD_SAFE_MARGIN * hudScale;

    this.hideLabelTooltip();
    this.hud.setPosition(safeMargin, safeMargin);
    this.layoutInfoPanel(hudScale);

    this.layoutStatusBar(hudScale, width, safeMargin);
    this.layoutAbilityBar(hudScale, width, height, safeMargin);
    this.tooltip.setScale(hudScale);
    if (this.verboseCli) {
      this.verboseCli.setHudScale(hudScale);
      this.positionCli(hudScale, width, height, safeMargin);
    }

    this.endPanel.setPosition(width / 2, height / 2);
    const tooltipMargin = 160 * hudScale;
    this.tooltip.setPosition(Phaser.Math.Clamp(this.tooltip.x, tooltipMargin, width - tooltipMargin), this.tooltip.y);
    const overlayWidth = Phaser.Math.Clamp(width - safeMargin * 2, 480, 760);
    const overlayHeight = Phaser.Math.Clamp(height - safeMargin * 2, 320, 520);
    this.infoOverlay.setPosition(width / 2, height / 2);
    this.layoutInfoOverlay(overlayWidth, overlayHeight);

    this.game.events.emit('hud-layout', {
      safeMargin,
      infoPanel: {
        left: this.hud.x,
        top: this.hud.y,
        right: this.hud.x + this.infoPanelSize.width,
        bottom: this.hud.y + this.infoPanelSize.height,
      },
      abilityBar: this.getAbilityBarBounds(),
    });
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

  private redrawInfoPanel(width: number, height: number, scale: number): void {
    const radius = HUD_RADIUS * scale;
    this.hudBackground.clear();
    this.hudBackground.fillStyle(PANEL_BACKGROUND_COLOR, PANEL_BACKGROUND_ALPHA);
    this.hudBackground.fillRoundedRect(0, 0, width, height, radius);
    this.hudBorder.clear();
    this.hudBorder.lineStyle(1, PANEL_BORDER_COLOR, PANEL_BORDER_ALPHA);
    this.hudBorder.strokeRoundedRect(0.5, 0.5, width - 1, height - 1, Math.max(0, radius - 1));
  }
}

