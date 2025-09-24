import Phaser from "phaser";
import type { Mode } from "../core/types";
import { getPalette } from "../core/palette";
import { NAME_MAP } from "../core/factions";
import { BalanceBar, type FactionCounts, computeEquilibrium } from "../systems/balanceMeter";
import type { CooldownState, AbilityKey } from "../systems/interventions";
import { ABILITY_METADATA } from "../systems/interventions";
import type { GameTickPayload, GameEndSummary } from "./types";
const FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace";
const HUD_WIDTH = 360;
const ABILITY_ORDER: AbilityKey[] = ['1', '2', '3', '4', '5'];
type AbilityMeta = (typeof ABILITY_METADATA)[AbilityKey];
type AbilityButton = {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  cooldown: Phaser.GameObjects.Text;
  meta: AbilityMeta;
};
export class UI extends Phaser.Scene {
  private hud!: Phaser.GameObjects.Container;
  private modeText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private countsText!: Phaser.GameObjects.Text;
  private equilibriumText!: Phaser.GameObjects.Text;
  private balanceBar!: BalanceBar;
  private abilityBar!: Phaser.GameObjects.Container;
  private abilityButtons: Record<AbilityKey, AbilityButton> = {} as Record<AbilityKey, AbilityButton>;
  private settingsPanel!: Phaser.GameObjects.Container;
  private settingsText!: Phaser.GameObjects.Text;
  private tooltip!: Phaser.GameObjects.Container;
  private tooltipText!: Phaser.GameObjects.Text;
  private shiftKey?: Phaser.Input.Keyboard.Key;
  private hoveredAbility: AbilityKey | null = null;
  private tooltipKey: AbilityKey | null = null;
  private endPanel!: Phaser.GameObjects.Container;
  private endTitle!: Phaser.GameObjects.Text;
  private endSummary!: Phaser.GameObjects.Text;
  private endLogs!: Phaser.GameObjects.Text;
  private endFooter!: Phaser.GameObjects.Text;
  private endLogTimer?: Phaser.Time.TimerEvent;
  private readonly lastCounts: FactionCounts = { Fire: 0, Water: 0, Earth: 0 };
  private muted = true;
  private colorblind = false;
  private hudVisible = true;
  private paused = false;
  private ready = false;
  constructor() {
    super("UI");
  }
  create(): void {
    this.createHud();
    this.createAbilityBar();
    this.createSettingsPanel();
    this.createTooltip();
    this.createEndPanel();
    this.shiftKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ready = false;
    });
    this.ready = true;
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
    const countsLine = `${NAME_MAP.Fire.split(' ')[0]} ${Fire.toString().padStart(3, ' ')}   ${NAME_MAP.Water.split(' ')[0]} ${Water.toString().padStart(3, ' ')}   ${NAME_MAP.Earth.split(' ')[0]} ${Earth.toString().padStart(3, ' ')}`;
    this.countsText.setText(countsLine);
    this.equilibriumText.setText(`Equilibrium: ${(payload.equilibrium * 100).toFixed(0)}%`);
    this.balanceBar.update(this.lastCounts, getPalette(this.colorblind));
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
  setColorblind(value: boolean): void {
    this.colorblind = value;
    this.updateSettingsDisplay();
    this.balanceBar.update(this.lastCounts, getPalette(this.colorblind));
    const palette = getPalette(this.colorblind);
    ABILITY_ORDER.forEach((key) => {
      const button = this.abilityButtons[key];
      if (!button) return;
      const accent = palette.Fire.toString(16).padStart(6, '0');
      button.label.setColor(`#${accent}`);
    });
  }
  setHudVisible(visible: boolean): void {
    this.hudVisible = visible;
    this.hud.setVisible(visible);
    this.balanceBar.setVisible(visible);
    this.abilityBar.setVisible(visible);
    this.settingsPanel.setVisible(visible);
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
    const palette = getPalette(this.colorblind);
    ABILITY_ORDER.forEach((key) => {
      const button = this.abilityButtons[key];
      if (!button) return;
      const accent = palette.Fire.toString(16).padStart(6, '0');
      button.label.setColor(`#${accent}`);
    });
    this.updateSettingsDisplay();
    this.balanceBar.update(this.lastCounts, palette);
  }
  private createHud(): void {
    this.hud = this.add.container(24, 24).setDepth(20).setScrollFactor(0);
    const bg = this.add.rectangle(0, 0, HUD_WIDTH, 134, 0x041227, 0.72)
      .setOrigin(0)
      .setStrokeStyle(2, 0x1a2a46, 0.9);
    const primary = { fontFamily: FONT_FAMILY, fontSize: '20px', color: '#cfe8ff' } as const;
    const secondary = { fontFamily: FONT_FAMILY, fontSize: '16px', color: '#8fb7ff' } as const;
    this.modeText = this.add.text(12, 12, 'Mode: Balance', primary);
    this.timerText = this.add.text(12, 38, 'Time: 0.0s', primary);
    this.countsText = this.add.text(12, 64, 'Therm 0   Liquid 0   Core 0', secondary);
    this.equilibriumText = this.add.text(12, 90, 'Equilibrium: 100%', secondary);
    this.hud.add([bg, this.modeText, this.timerText, this.countsText, this.equilibriumText]);
    this.balanceBar = new BalanceBar(this, 24, 170, HUD_WIDTH - 48, 12);
  }
  private createAbilityBar(): void {
    this.abilityBar = this.add.container(this.scale.width / 2, this.scale.height - 82)
      .setDepth(25)
      .setScrollFactor(0);
    const spacing = 126;
    ABILITY_ORDER.forEach((key, index) => {
      const meta = ABILITY_METADATA[key];
      const container = this.add.container(index * spacing - ((ABILITY_ORDER.length - 1) * spacing) / 2, 0);
      const background = this.add.image(0, 0, 'ui-key').setOrigin(0.5).setAlpha(0.9).setTint(0x14324c);
      const keyText = this.add.text(-30, -6, key, { fontFamily: FONT_FAMILY, fontSize: '18px', color: '#9bdcff' }).setOrigin(0.5);
      const label = this.add.text(16, -6, meta.name, { fontFamily: FONT_FAMILY, fontSize: '18px', color: '#cfe8ff' }).setOrigin(0, 0.5);
      const cooldown = this.add.text(0, 16, '', { fontFamily: FONT_FAMILY, fontSize: '14px', color: '#7aa5cc' }).setOrigin(0.5);
      container.add([background, keyText, label, cooldown]);
      container.setSize(110, 48);
      container.setInteractive(new Phaser.Geom.Rectangle(-55, -24, 110, 48), Phaser.Geom.Rectangle.Contains);
      container.on('pointerover', () => {
        background.setTint(0x1f4b7a);
        this.hoveredAbility = key;
        this.showTooltipForKey(key, false);
      });
      container.on('pointerout', () => {
        background.setTint(0x14324c);
        this.hoveredAbility = null;
        if (!(this.shiftKey?.isDown)) {
          this.hideTooltip();
        }
      });
      this.abilityBar.add(container);
      this.abilityButtons[key] = { container, background, label, cooldown, meta };
    });
    const hint = this.add.text(0, 60, 'Hold Shift for ability dossiers', {
      fontFamily: FONT_FAMILY,
      fontSize: '14px',
      color: '#6fa4d9'
    }).setOrigin(0.5);
    this.abilityBar.add(hint);
  }
  private createSettingsPanel(): void {
    this.settingsPanel = this.add.container(this.scale.width - 210, this.scale.height - 88)
      .setDepth(25)
      .setScrollFactor(0);
    const panelBg = this.add.rectangle(0, 0, 220, 86, 0x04152a, 0.78)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0x12233a, 0.9);
    this.settingsText = this.add.text(0, 0, '', {
      fontFamily: FONT_FAMILY,
      fontSize: '14px',
      color: '#93c3ff',
      align: 'center',
    }).setOrigin(0.5);
    this.settingsPanel.add([panelBg, this.settingsText]);
    this.updateSettingsDisplay();
  }
  private createTooltip(): void {
    this.tooltip = this.add.container(0, 0).setDepth(40).setVisible(false).setScrollFactor(0);
    const bg = this.add.rectangle(0, 0, 280, 96, 0x071629, 0.94)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0x1d3a57, 0.9);
    this.tooltipText = this.add.text(0, 0, '', {
      fontFamily: FONT_FAMILY,
      fontSize: '16px',
      color: '#d1ecff',
      align: 'center',
      wordWrap: { width: 240 },
    }).setOrigin(0.5);
    this.tooltip.add([bg, this.tooltipText]);
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
    this.tooltip.setPosition(worldX, worldY - 80);
    this.tooltipText.setText(`${meta.name.toUpperCase()}\n${meta.description}`);
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
    const muteLabel = this.muted ? 'Muted' : 'Audio On';
    const paletteLabel = this.colorblind ? 'Palette: Colorblind' : 'Palette: Default';
    const hudLabel = this.hudVisible ? 'HUD: Visible' : 'HUD: Hidden';
    const pausedLabel = this.paused ? 'Status: Paused' : 'Status: Running';
    this.settingsText.setText(`${muteLabel}
${paletteLabel}
${hudLabel}
${pausedLabel}`);
  }
}
