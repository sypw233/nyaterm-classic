import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: ResizeObserverMock,
});

Element.prototype.scrollIntoView = vi.fn();

// jsdom in this toolchain does not expose a PointerEvent constructor, but
// @testing-library/dom builds pointer events via `window[EventType]`. Without
// it, fireEvent.pointer* falls back to a plain Event that drops pointerType,
// button and clientX, so Radix menus never open and drag handlers see no
// coordinates. Provide a minimal MouseEvent-backed implementation on both
// globals (window for testing-library, globalThis for `expect.any`).
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerType: string;
    isPrimary: boolean;
    pointerId: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "";
      this.isPrimary = init.isPrimary ?? false;
      this.pointerId = init.pointerId ?? 0;
    }
  }

  Object.defineProperty(globalThis, "PointerEvent", {
    value: PointerEventPolyfill,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "PointerEvent", {
    value: PointerEventPolyfill,
    writable: true,
    configurable: true,
  });
}

// Existing unit tests exercise the Desktop transport and its Tauri mocks.
Object.defineProperty(window, "__TAURI_INTERNALS__", {
  configurable: true,
  value: {},
});
