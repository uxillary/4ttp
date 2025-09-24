import { COLORS } from './factions';
import type { FactionId } from './types';

export type Palette = Record<FactionId, number>;

export const DEFAULT_PALETTE: Palette = { ...COLORS };

export const COLORBLIND_PALETTE: Palette = {
  Fire: 0xffb400,
  Water: 0x2887ff,
  Earth: 0x6ac45f,
};

export function getPalette(colorblind: boolean): Palette {
  return colorblind ? COLORBLIND_PALETTE : DEFAULT_PALETTE;
}
