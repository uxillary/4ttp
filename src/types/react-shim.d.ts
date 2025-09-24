export type ReactNode = any;
export type FormEvent<T = any> = { preventDefault(): void; target: T };
export type ChangeEvent<T = any> = { target: T };
export interface MutableRefObject<T> { current: T; }
export type SetStateAction<T> = T | ((prev: T) => T);
export type Dispatch<A> = (value: A) => void;
export function useState<T>(initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>];
export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
export function useMemo<T>(factory: () => T, deps: unknown[]): T;
export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: unknown[]): T;
export function useRef<T>(initialValue: T): MutableRefObject<T>;
export function useRef<T = undefined>(): MutableRefObject<T | undefined>;
export const Fragment: any;
declare const React: {
  useState: typeof useState;
  useEffect: typeof useEffect;
  useMemo: typeof useMemo;
  useCallback: typeof useCallback;
  useRef: typeof useRef;
};
export default React;
