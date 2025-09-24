import { getString, setString } from './save';

const SEED_KEY = 'seed';

let currentSeed = 'default';
let state = 0;

function mulberry32(a: number): () => number {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

let generator = mulberry32(0);

function ensureSeed(seed?: string): string {
  if (seed && seed.trim().length > 0) {
    return seed.trim();
  }
  const stored = getString(SEED_KEY, '');
  if (stored.trim().length > 0) {
    return stored;
  }
  const randomSeed = (typeof crypto !== 'undefined' && 'getRandomValues' in crypto)
    ? Array.from(crypto.getRandomValues(new Uint32Array(2)))
        .map((value) => value.toString(16))
        .join('')
        .slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  setString(SEED_KEY, randomSeed);
  return randomSeed;
}

export function initSeed(seed?: string): void {
  const resolved = ensureSeed(seed);
  currentSeed = resolved;
  setString(SEED_KEY, resolved);
  state = hashSeed(resolved);
  generator = mulberry32(state);
}

export function rand(): number {
  return generator();
}

export function between(min: number, max: number): number {
  if (max <= min) return min;
  return min + rand() * (max - min);
}

export function pick<T>(items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('Cannot pick from an empty array.');
  }
  const index = Math.floor(rand() * items.length) % items.length;
  return items[index]!;
}

export function getSeed(): string {
  return currentSeed;
}
