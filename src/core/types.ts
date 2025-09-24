export type Mode = "Balance" | "Domination";

export type FactionId = "Fire" | "Water" | "Earth";

// Future tier expansions (uncomment when unlocked):
// export type Tier2FactionId = FactionId | "Growth" | "Decay";
// export type Tier3FactionId = Tier2FactionId | "Void" | "Light";

const CORE_FACTIONS: readonly FactionId[] = ["Fire", "Water", "Earth"] as const;

export function isFactionId(value: unknown): value is FactionId {
  return typeof value === "string" && (CORE_FACTIONS as readonly string[]).includes(value);
}

export function isFactionIdArray(value: unknown): value is FactionId[] {
  return Array.isArray(value) && value.every(isFactionId);
}
