import { FactionId } from "./types";

type DominanceMatrix = Record<FactionId, readonly FactionId[]>;

export const MATRIX_3: DominanceMatrix = {
  Fire: ["Earth"],
  Water: ["Fire"],
  Earth: ["Water"],
};

export function beats(attacker: FactionId, defender: FactionId): boolean {
  const targets = MATRIX_3[attacker] ?? [];
  return targets.includes(defender);
}

// Tier 2 expansion example (5 factions):
// const MATRIX_5 = {
//   Fire: ["Growth"],
//   Water: ["Fire"],
//   Earth: ["Water"],
//   Growth: ["Earth"],
//   Decay: ["Growth"],
// } as const satisfies DominanceMatrix;
//
// Tier 3 expansion example (7 factions):
// const MATRIX_7 = {
//   Fire: ["Growth"],
//   Water: ["Fire"],
//   Earth: ["Water"],
//   Growth: ["Earth"],
//   Decay: ["Growth", "Light"],
//   Void: ["Fire", "Water", "Earth", "Growth", "Decay"],
//   Light: ["Void", "Decay"],
// } as const satisfies DominanceMatrix;
