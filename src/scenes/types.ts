import type { Mode, FactionId } from '../core/types';
import type { FactionCounts } from '../systems/balanceMeter';

export interface GameTickPayload {
  mode: Mode;
  elapsed: number;
  counts: FactionCounts;
  equilibrium: number;
  total: number;
  paused: boolean;
  ended: boolean;
}

export interface GameEndSummary {
  mode: Mode;
  elapsed: number;
  score: number;
  bestScore: number | null;
  counts: FactionCounts;
  achievements: string[];
  seed: string;
}
