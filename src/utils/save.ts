const STORAGE_KEYS = new Set<string>();

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function track(key: string): void {
  STORAGE_KEYS.add(key);
}

export function getString(key: string, fallback: string): string {
  const storage = getStorage();
  if (!storage) return fallback;
  track(key);
  const value = storage.getItem(key);
  return value ?? fallback;
}

export function setString(key: string, value: string): void {
  const storage = getStorage();
  if (!storage) return;
  track(key);
  try {
    storage.setItem(key, value);
  } catch {
    // ignore quota/security errors
  }
}

export function getBool(key: string, fallback: boolean): boolean {
  const raw = getString(key, fallback ? '1' : '0');
  return raw === '1' || raw.toLowerCase() === 'true';
}

export function setBool(key: string, value: boolean): void {
  setString(key, value ? '1' : '0');
}

export function getNumber(key: string, fallback: number): number {
  const raw = getString(key, Number.isFinite(fallback) ? String(fallback) : '0');
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function setNumber(key: string, value: number): void {
  setString(key, Number.isFinite(value) ? String(value) : '0');
}

export function clearTracked(): void {
  const storage = getStorage();
  if (!storage) return;
  STORAGE_KEYS.forEach((key) => storage.removeItem(key));
  STORAGE_KEYS.clear();
}
