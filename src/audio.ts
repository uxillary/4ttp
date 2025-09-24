type SfxKey = 'convert' | 'spawn' | 'slow' | 'buff' | 'shield' | 'nuke';

const registry: Partial<Record<SfxKey, HTMLAudioElement>> = {};
let muted = true;

function ensureAudio(key: SfxKey): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return null;
  }
  let element = registry[key];
  if (!element) {
    element = new Audio();
    element.preload = 'auto';
    element.muted = muted;
    element.volume = 0.45;
    element.loop = false;
    // TODO: assign ElevenLabs generated SFX source once assets are ready.
    registry[key] = element;
  }
  return element;
}

export function playSfx(key: SfxKey): void {
  if (muted) return;
  const element = ensureAudio(key);
  if (!element || !element.src) {
    return;
  }
  try {
    element.currentTime = 0;
    element.muted = false;
    void element.play().catch(() => undefined);
  } catch {
    // Browsers may block autoplay; fail silently.
  }
}

export function setMuted(value: boolean): void {
  muted = value;
  Object.values(registry).forEach((audio) => {
    if (audio) audio.muted = value;
  });
}

export function isMuted(): boolean {
  return muted;
}
