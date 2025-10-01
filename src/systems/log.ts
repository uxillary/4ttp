import Phaser from 'phaser';

export type ElementId = string;

export type GameEvent =
  | { t: 'hit'; at: number; src: ElementId; dst: ElementId; amount: number; rule: string }
  | { t: 'kill'; at: number; src: ElementId; dst: ElementId; rule: string }
  | { t: 'buff'; at: number; who: ElementId; kind: string; dur: number }
  | { t: 'spawn'; at: number; kind: 'Thermal' | 'Liquid' | 'Core'; n: number }
  | { t: 'system'; at: number; msg: string };

const MAX_BUFFER = 250;
const buffer: GameEvent[] = [];
const emitter = new Phaser.Events.EventEmitter();

export const logEvent = (event: GameEvent): void => {
  buffer.push(event);
  if (buffer.length > MAX_BUFFER) {
    buffer.splice(0, buffer.length - MAX_BUFFER);
  }
  emitter.emit('event', event);
};

export const clearLog = (): void => {
  if (!buffer.length) return;
  buffer.length = 0;
  emitter.emit('cleared');
};

export const getLogHistory = (): GameEvent[] => buffer.slice();

export const logEvents = emitter;
