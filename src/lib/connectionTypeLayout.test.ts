import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONNECTION_TYPE_ORDER,
  moveConnectionType,
  resolveConnectionTypeLayout,
  setConnectionTypeVisible,
  visibleConnectionTypeIds,
} from "./connectionTypeLayout";

describe("resolveConnectionTypeLayout", () => {
  it("returns the built-in order, all visible, when nothing is stored", () => {
    expect(resolveConnectionTypeLayout(undefined).map((entry) => entry.id)).toEqual([
      ...DEFAULT_CONNECTION_TYPE_ORDER,
    ]);
    expect(resolveConnectionTypeLayout(undefined).every((entry) => entry.visible)).toBe(true);
  });

  it("appends types the stored layout does not mention", () => {
    const resolved = resolveConnectionTypeLayout({
      entries: [{ id: "rdp", visible: false }],
    });
    expect(resolved[0]).toEqual({ id: "rdp", visible: false });
    expect(resolved.map((entry) => entry.id)).toContain("ssh");
    expect(resolved).toHaveLength(DEFAULT_CONNECTION_TYPE_ORDER.length);
  });

  it("ignores unknown and duplicate ids", () => {
    const resolved = resolveConnectionTypeLayout({
      entries: [
        { id: "unknown", visible: true },
        { id: "ssh", visible: true },
        { id: "ssh", visible: false },
      ],
    });
    expect(resolved.filter((entry) => entry.id === "ssh")).toHaveLength(1);
    expect(resolved.some((entry) => entry.id === "unknown")).toBe(false);
  });
});

describe("visibleConnectionTypeIds", () => {
  it("filters out hidden types while keeping order", () => {
    const ids = visibleConnectionTypeIds({
      entries: [
        { id: "rdp", visible: true },
        { id: "ssh", visible: true },
        { id: "vnc", visible: false },
      ],
    });
    expect(ids.slice(0, 2)).toEqual(["rdp", "ssh"]);
    expect(ids).not.toContain("vnc");
  });
});

describe("setConnectionTypeVisible", () => {
  it("toggles visibility without changing order", () => {
    const order = resolveConnectionTypeLayout(undefined).map((entry) => entry.id);
    const next = setConnectionTypeVisible(undefined, "telnet", false);
    expect(next.entries.map((entry) => entry.id)).toEqual(order);
    expect(next.entries.find((entry) => entry.id === "telnet")?.visible).toBe(false);
  });
});

describe("moveConnectionType", () => {
  it("moves a type and clamps the target index", () => {
    const moved = moveConnectionType(undefined, "vnc", 0);
    expect(moved.entries[0].id).toBe("vnc");

    const clamped = moveConnectionType(undefined, "ssh", 999);
    expect(clamped.entries[clamped.entries.length - 1].id).toBe("ssh");
  });

  it("is a no-op for an unknown id", () => {
    const before = resolveConnectionTypeLayout(undefined);
    const after = moveConnectionType(undefined, "nope", 0);
    expect(after.entries).toEqual(before);
  });
});
