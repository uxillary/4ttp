export const HUD_SAFE_MARGIN = 16;
export const HUD_RADIUS = 10;

export const PANEL_BACKGROUND_COLOR = 0x0a1018;
export const PANEL_BACKGROUND_ALPHA = 0.78;
export const PANEL_BORDER_COLOR = 0x78b4dc;
export const PANEL_BORDER_ALPHA = 0.18;

export const PANEL_BACKGROUND_RGBA = "rgba(10, 16, 24, 0.78)";
export const PANEL_BORDER_RGBA = "rgba(120, 180, 220, 0.18)";

export const HUD_FONT_FAMILY =
  "'Inter', 'JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', monospace";
export const HUD_MONO_FONT_FAMILY =
  "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', monospace";

/**
 * Tweak HUD_SAFE_MARGIN, HUD_RADIUS, or the font families above to adjust the core HUD aesthetic.
 * Call setHudScale(1.0–1.5) to globally scale panel padding, typography, and hit areas.
 */

export const HUD_SCALE_MIN = 1;
export const HUD_SCALE_MAX = 1.5;

let hudScale = HUD_SCALE_MIN;
const listeners = new Set<(scale: number) => void>();

export const getHudScale = (): number => hudScale;

export const setHudScale = (scale: number): void => {
  const clamped = Math.min(HUD_SCALE_MAX, Math.max(HUD_SCALE_MIN, scale));
  if (Math.abs(clamped - hudScale) < 0.001) {
    return;
  }
  hudScale = clamped;
  listeners.forEach((listener) => listener(hudScale));
};

export const onHudScaleChange = (listener: (scale: number) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const scaleValue = (value: number): number => value * hudScale;
