type SfxKey = 'convert' | 'spawn' | 'slow' | 'buff' | 'shield' | 'nuke';

type Tone = {
  type: OscillatorType;
  frequency: number;
  duration: number;
  gain?: number;
  detune?: number;
  delay?: number;
};

let muted = true;
let context: AudioContext | null = null;

const SOUND_LIBRARY: Record<SfxKey, Tone[]> = {
  convert: [
    { type: 'triangle', frequency: 320, duration: 0.16, gain: 0.18 },
    { type: 'triangle', frequency: 460, duration: 0.12, gain: 0.14, delay: 0.06 },
  ],
  spawn: [
    { type: 'sine', frequency: 540, duration: 0.18, gain: 0.22 },
    { type: 'sine', frequency: 680, duration: 0.12, gain: 0.16, delay: 0.1 },
  ],
  slow: [
    { type: 'sawtooth', frequency: 160, duration: 0.36, gain: 0.2 },
    { type: 'sawtooth', frequency: 120, duration: 0.32, gain: 0.14, delay: 0.18 },
  ],
  buff: [
    { type: 'triangle', frequency: 420, duration: 0.22, gain: 0.22 },
    { type: 'triangle', frequency: 640, duration: 0.2, gain: 0.18, delay: 0.16 },
  ],
  shield: [
    { type: 'sine', frequency: 310, duration: 0.28, gain: 0.24 },
    { type: 'sine', frequency: 520, duration: 0.3, gain: 0.16, delay: 0.18 },
  ],
  nuke: [
    { type: 'sawtooth', frequency: 540, duration: 0.4, gain: 0.26 },
    { type: 'square', frequency: 240, duration: 0.42, gain: 0.22, delay: 0.2 },
  ],
};

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
  if (!Ctor) return null;
  if (!context) {
    context = new Ctor();
  }
  return context;
}

function playTone(ctx: AudioContext, tone: Tone): void {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = tone.type;
  oscillator.frequency.value = tone.frequency;
  if (typeof tone.detune === 'number') {
    oscillator.detune.value = tone.detune;
  }
  const now = ctx.currentTime + (tone.delay ?? 0);
  const duration = Math.max(0.05, tone.duration);
  const peak = tone.gain ?? 0.2;
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(peak, now + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.05);
}

export function playSfx(key: SfxKey): void {
  if (muted) return;
  const ctx = ensureContext();
  if (!ctx) return;
  void ctx.resume().catch(() => undefined);
  const tones = SOUND_LIBRARY[key];
  if (!tones) return;
  tones.forEach((tone) => playTone(ctx, tone));
}

export function setMuted(value: boolean): void {
  muted = value;
  if (!context) return;
  if (value) {
    void context.suspend().catch(() => undefined);
  } else {
    void context.resume().catch(() => undefined);
  }
}

export function isMuted(): boolean {
  return muted;
}

