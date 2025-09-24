import { FactionId } from "./types";

export const FACTIONS: FactionId[] = ["Fire", "Water", "Earth"];

export const COLORS: Record<FactionId, number> = {
  Fire: 0xff5c43,
  Water: 0x55e6a5,
  Earth: 0xc2a97a,
};

export const SPEED: Record<FactionId, number> = {
  Fire: 1.1,
  Water: 1.0,
  Earth: 0.9,
};

export const NAME_MAP: Record<FactionId, string> = {
  Fire: "Thermal Protocol",
  Water: "Liquid Node",
  Earth: "Core Process",
};

// Future expansion values (enable alongside Tier2/Tier3 types):
// COLORS.Growth = 0x5ad674; SPEED.Growth = 0.95; NAME_MAP.Growth = "Bio-Thread";
// COLORS.Decay = 0x8b4dcb; SPEED.Decay = 0.9; NAME_MAP.Decay = "Entropy Agent";
// COLORS.Void = 0x11111f; SPEED.Void = 1.15; NAME_MAP.Void = "Null Packet";
// COLORS.Light = 0xfceea7; SPEED.Light = 1.05; NAME_MAP.Light = "Signal Pulse";

export const TEXTURE_KEY: Record<FactionId, string> = {
  Fire: "faction-fire",
  Water: "faction-water",
  Earth: "faction-earth",
};
