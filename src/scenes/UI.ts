import Phaser from "phaser";
import type { Mode } from "../core/types";
import { getPalette } from "../core/palette";
import { NAME_MAP } from "../core/factions";
import { BalanceBar, type FactionCounts } from "../systems/balanceMeter";
import type { CooldownState } from "../systems/interventions";
import type { GameTickPayload, GameEndSummary } from "./types";
const FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace";
const HUD_WIDTH = 380;
export class UI extends Phaser.Scene {
  private ready = false;
  private hud!: Phaser.GameObjects.Container;
  private modeText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private countsText!: Phaser.GameObjects.Text;
  private equilibriumText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private cooldownText!: Phaser.GameObjects.Text;
  private stateText!: Phaser.GameObjects.Text;
  private balanceBar!: BalanceBar;
  private endPanel!: Phaser.GameObjects.Container;
  private endTitle!: Phaser.GameObjects.Text;
  private endSummary!: Phaser.GameObjects.Text;
  private endLogs!: Phaser.GameObjects.Text;
  private endFooter!: Phaser.GameObjects.Text;
  private readonly lastCounts: FactionCounts = { Fire: 0, Water: 0, Earth: 0 };
  private colorblind = false;
  private muted = true;
  private hudVisible = true;
  private paused = false;
  constructor() {
    super("UI");
  }
  create() {
    this.createHud();
    this.createEndPanel();
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
    const countsLine = `${NAME_MAP.Fire.slice(0, 6)} ${Fire}  |  ${NAME_MAP.Water.slice(0, 6)} ${Water}  |  ${NAME_MAP.Earth.slice(0, 6)} ${Earth}`;
    this.countsText.setText(countsLine);
    this.equilibriumText.setText(`Equilibrium: ${(payload.equilibrium * 100).toFixed(0)}%`);
    this.balanceBar.update(this.lastCounts, getPalette(this.colorblind));
    this.paused = payload.paused;
    this.updateStateText();
    if (!payload.ended) {
      this.hideEndPanel();
    }
  }
  setCooldowns(map: CooldownState): void {
    const active = (Object.entries(map) as Array<[keyof CooldownState, number]>)
      .filter(([, remaining]) => remaining > 0.05)
      .map(([key, remaining]) => `[${key}] ${remaining.toFixed(1)}s`);
    this.cooldownText.setText(active.length ? active.join("    ") : "");
  }
  setMuted(value: boolean): void {
    this.muted = value;
    this.updateStateText();
  }
  setColorblind(value: boolean): void {
    this.colorblind = value;
    this.updateStateText();
    this.balanceBar.update(this.lastCounts, getPalette(this.colorblind));
  }
  setHudVisible(visible: boolean): void {
    this.hudVisible = visible;
    this.hud.setVisible(visible);
    this.balanceBar.setVisible(visible);
    this.updateStateText();
  }
  showEndPanel(summary: GameEndSummary): void {
    const best = summary.bestScore !== null ? summary.bestScore.toFixed(1) : "--";
    this.endTitle.setText(`${summary.mode} Protocol Complete`);
    this.endSummary.setText(`Runtime: ${summary.elapsed.toFixed(1)}s\nScore: ${summary.score.toFixed(1)}s\nBest: ${best}s`);
    const topLogs = summary.achievements.slice(0, 3);
    const logsText = topLogs.length
      ? topLogs.map((log) => `- ${log}`).join("\n")
      : "System Logs pending. Maintain balance to unlock.";
    this.endLogs.setText(logsText);
    this.endPanel.setVisible(true);
  }
  hideEndPanel(): void {
    this.endPanel.setVisible(false);
  }
  setMutedAndColorblind(muted: boolean, colorblind: boolean): void {
    this.muted = muted;
    this.colorblind = colorblind;
    this.updateStateText();
    this.balanceBar.update(this.lastCounts, getPalette(this.colorblind));
  }
  private createHud(): void {
    this.hud = this.add.container(24, 24).setDepth(20).setScrollFactor(0);
    const bg = this.add.rectangle(0, 0, HUD_WIDTH, 160, 0x041227, 0.7)
      .setOrigin(0)
      .setStrokeStyle(2, 0x1a2a46, 0.9);
    const primaryStyle = { fontFamily: FONT_FAMILY, fontSize: "20px", color: "#cfe8ff" } as const;
    const secondaryStyle = { fontFamily: FONT_FAMILY, fontSize: "16px", color: "#8fb7ff" } as const;
    this.modeText = this.add.text(12, 12, "Mode: Balance", primaryStyle);
    this.timerText = this.add.text(12, 38, "Time: 0.0s", primaryStyle);
    this.countsText = this.add.text(12, 64, "Therm 0 | Liquid 0 | Core 0", primaryStyle);
    this.equilibriumText = this.add.text(12, 90, "Equilibrium: 100%", secondaryStyle);
    this.hintText = this.add.text(12, 114, "1 Spawn | 2 Slow | 3 Buff | 4 Shield | 5 Nuke | Tab Mode", secondaryStyle);
    this.cooldownText = this.add.text(12, 136, "", { ...secondaryStyle, fontSize: "14px" });
    this.stateText = this.add.text(12, 154, "Muted: On | Palette: Default", { ...secondaryStyle, fontSize: "14px" });
    this.hud.add([bg, this.modeText, this.timerText, this.countsText, this.equilibriumText, this.hintText, this.cooldownText, this.stateText]);
    this.balanceBar = new BalanceBar(this, 24, 190, HUD_WIDTH - 48, 12);
    this.updateStateText();
  }
  private createEndPanel(): void {
    this.endPanel = this.add.container(1280 / 2, 720 / 2).setDepth(200).setScrollFactor(0).setVisible(false);
    const panelBg = this.add.rectangle(0, 0, 520, 320, 0x07192f, 0.92)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0x1f3659, 0.85);
    const baseStyle = { fontFamily: FONT_FAMILY, color: "#cfe8ff", align: "center" as const };
    this.endTitle = this.add.text(0, -120, "Protocol Complete", { ...baseStyle, fontSize: "28px" }).setOrigin(0.5);
    this.endSummary = this.add.text(0, -40, "Runtime: 0.0s\nScore: 0.0s\nBest: --", { ...baseStyle, fontSize: "22px" }).setOrigin(0.5);
    this.endLogs = this.add.text(0, 56, "", { ...baseStyle, fontSize: "18px" }).setOrigin(0.5);
    this.endFooter = this.add.text(0, 120, "R: Restart | Space: Pause | M: Mute | C: Colorblind", { ...baseStyle, fontSize: "16px", color: "#8fb7ff" }).setOrigin(0.5);
    this.endPanel.add([panelBg, this.endTitle, this.endSummary, this.endLogs, this.endFooter]);
  }
  private updateStateText(): void {
    const muteLabel = this.muted ? "Muted" : "Audio On";
    const paletteLabel = this.colorblind ? "Colorblind" : "Default";
    const hudLabel = this.hudVisible ? "HUD Visible" : "HUD Hidden";
    const pausedLabel = this.paused ? "Paused" : "Running";
    this.stateText.setText(`${muteLabel} | Palette: ${paletteLabel} | ${hudLabel} | ${pausedLabel}`);
  }
}