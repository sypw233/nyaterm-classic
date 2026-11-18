import { describe, expect, it } from "vitest";
import {
  isMouseReportingActive,
  routeTerminalRightClick,
  type MouseTrackingMode,
  type TerminalRightClickAction,
} from "./terminalRightClickRouting";

const base = {
  button: 2,
  altKey: false,
  mouseTrackingMode: "none" as MouseTrackingMode,
  rightClickAction: "menu" as TerminalRightClickAction,
  altForcesLocalMenu: true,
};

describe("isMouseReportingActive", () => {
  it("treats every tracking mode except none as active", () => {
    expect(isMouseReportingActive("none")).toBe(false);
    for (const mode of ["x10", "vt200", "drag", "any"] as const) {
      expect(isMouseReportingActive(mode)).toBe(true);
    }
  });
});

describe("routeTerminalRightClick", () => {
  it("ignores anything that is not a right-click", () => {
    expect(routeTerminalRightClick({ ...base, button: 0 })).toEqual({
      owner: "ignore",
      suppressDefault: false,
    });
    expect(routeTerminalRightClick({ ...base, button: 1 })).toEqual({
      owner: "ignore",
      suppressDefault: false,
    });
  });

  it("keeps the local menu when the application is not using the mouse", () => {
    expect(routeTerminalRightClick(base)).toEqual({
      owner: "local",
      suppressDefault: true,
    });
  });

  it("keeps local paste when the application is not using the mouse", () => {
    expect(
      routeTerminalRightClick({ ...base, rightClickAction: "paste" }),
    ).toEqual({ owner: "local", suppressDefault: true });
  });

  it("does nothing when right-click behavior is off and no application uses the mouse", () => {
    expect(
      routeTerminalRightClick({ ...base, rightClickAction: "none" }),
    ).toEqual({ owner: "ignore", suppressDefault: false });
  });

  it.each(["x10", "vt200", "drag", "any"] as const)(
    "yields to the application in %s mouse mode",
    (mode) => {
      for (const action of ["menu", "paste", "none"] as const) {
        expect(
          routeTerminalRightClick({
            ...base,
            mouseTrackingMode: mode,
            rightClickAction: action,
          }),
        ).toEqual({ owner: "remote", suppressDefault: false });
      }
    },
  );

  it("lets Alt force the local menu past a mouse-reporting application", () => {
    expect(
      routeTerminalRightClick({
        ...base,
        altKey: true,
        mouseTrackingMode: "vt200",
      }),
    ).toEqual({ owner: "local", suppressDefault: true });
  });

  it("ignores Alt when the escape hatch is disabled", () => {
    expect(
      routeTerminalRightClick({
        ...base,
        altKey: true,
        altForcesLocalMenu: false,
        mouseTrackingMode: "vt200",
      }),
    ).toEqual({ owner: "remote", suppressDefault: false });
  });

  it("still opens the local menu with Alt when the application is idle", () => {
    expect(
      routeTerminalRightClick({
        ...base,
        altKey: true,
        mouseTrackingMode: "none",
      }),
    ).toEqual({ owner: "local", suppressDefault: true });
  });
});
