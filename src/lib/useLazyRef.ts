import { useRef } from "react";

/**
 * Like useRef, but initializes the value lazily on first render only.
 *
 * `useRef(new X())` evaluates `new X()` on EVERY render and immediately throws
 * the result away — pure GC pressure on components that re-render frequently
 * (e.g. a terminal whose suggestion hook updates on each keystroke).
 */
export function useLazyRef<T>(factory: () => T): { current: T } {
  const ref = useRef<{ current: T } | null>(null);
  if (ref.current === null) {
    ref.current = { current: factory() };
  }
  return ref.current;
}
