/**
 * Right-click routing for the terminal.
 *
 * A right-click can be consumed by two unrelated parties:
 *
 * - the terminal emulator, which forwards it to the remote application when
 *   that application enabled mouse reporting (vim, tmux, htop, ...);
 * - NyaTerm's own context menu or paste action.
 *
 * Nothing in the DOM prevents both from happening: `preventDefault()` on
 * `contextmenu` does not stop the `mousedown` that xterm uses to emit the
 * mouse report. Routing therefore has to be decided once, up front, and a
 * local decision must swallow the pointer event before xterm sees it.
 */

export type TerminalRightClickAction = "none" | "menu" | "paste";

export type MouseTrackingMode = "none" | "x10" | "vt200" | "drag" | "any";

export interface RightClickRoutingInput {
  /** `MouseEvent.button`; only `2` (secondary) is routed here. */
  button: number;
  altKey: boolean;
  mouseTrackingMode: MouseTrackingMode;
  rightClickAction: TerminalRightClickAction;
  /**
   * Whether Alt+right-click is allowed to force the local menu while the
   * remote application is using the mouse.
   */
  altForcesLocalMenu: boolean;
}

export type RightClickOwner = "local" | "remote" | "ignore";

export interface RightClickRoutingDecision {
  owner: RightClickOwner;
  /**
   * When true the caller must stop the pointer event from reaching xterm,
   * otherwise the remote application receives it as well.
   */
  suppressDefault: boolean;
}

const IGNORE: RightClickRoutingDecision = {
  owner: "ignore",
  suppressDefault: false,
};

/** True when the running application is receiving mouse reports. */
export function isMouseReportingActive(mode: MouseTrackingMode): boolean {
  return mode !== "none";
}

/**
 * Decide who owns a right-click.
 *
 * - `local`  — NyaTerm handles it (menu or paste); the event must not reach
 *              xterm, otherwise the remote application would react too.
 * - `remote` — pass it through untouched and stay out of the way.
 * - `ignore` — nothing to do (not a right-click, or the behavior is off).
 */
export function routeTerminalRightClick(
  input: RightClickRoutingInput,
): RightClickRoutingDecision {
  if (input.button !== 2) return IGNORE;

  // An explicit Alt override always wins, but only when the user enabled it.
  if (input.altKey && input.altForcesLocalMenu) {
    return { owner: "local", suppressDefault: true };
  }

  // The application is using the mouse; right-click belongs to it.
  if (isMouseReportingActive(input.mouseTrackingMode)) {
    return { owner: "remote", suppressDefault: false };
  }

  if (input.rightClickAction === "none") return IGNORE;

  return { owner: "local", suppressDefault: true };
}
