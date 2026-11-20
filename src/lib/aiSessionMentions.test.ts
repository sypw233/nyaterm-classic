import { describe, expect, it } from "vitest";
import type { SavedConnection, SessionPane, Tab } from "@/types/global";
import { buildMentionSessionOptions } from "./aiSessionMentions";

function pane(sessionId: string, name: string, connectionId?: string): SessionPane {
  return {
    id: `pane-${sessionId}`,
    kind: "leaf",
    paneKind: "terminal",
    sessionId,
    name,
    type: "SSH",
    connectionId,
  } as SessionPane;
}

function sessionLeaf(sessionId: string) {
  return {
    id: `pane-${sessionId}`,
    kind: "leaf",
    paneKind: "terminal",
    sessionId,
    name: sessionId,
    type: "SSH",
  } as never;
}

function tab(id: string, customName: string, sessionIds: string[]): Tab {
  return {
    id,
    persistOrder: 0,
    activePaneId: `pane-${sessionIds[0]}`,
    customName,
    root: sessionIds.length === 1 ? sessionLeaf(sessionIds[0]) : ({
      id: "root",
      kind: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: sessionLeaf(sessionIds[0]),
      second: sessionLeaf(sessionIds[1]),
    } as never),
  } as Tab;
}

function connection(
  id: string,
  host: string,
  username: string,
  tags: string[] = [],
): SavedConnection {
  return {
    id,
    name: host,
    type: "ssh",
    host,
    username,
    tags,
  } as SavedConnection;
}

describe("buildMentionSessionOptions", () => {
  it("labels a single-pane tab with its 1-based tab number", () => {
    const options = buildMentionSessionOptions({
      panes: [pane("s1", "prod", "c1")],
      tabs: [tab("t1", "Build box", ["s1"])],
      savedConnections: [connection("c1", "10.0.0.1", "root", ["db", "prod"])],
    });
    expect(options).toHaveLength(1);
    expect(options[0].orderLabel).toBe("#1");
    expect(options[0].tabNumber).toBe(1);
    expect(options[0].paneNumber).toBeUndefined();
    expect(options[0].tabLabel).toBe("Build box");
    // The identity and tags stay available as secondary information.
    expect(options[0].detail).toBe("root@10.0.0.1 #db #prod");
    expect(options[0].tags).toEqual(["db", "prod"]);
  });

  it("numbers tabs in strip order and follows tab reordering", () => {
    const options = buildMentionSessionOptions({
      panes: [pane("s1", "a", "c1"), pane("s2", "b", "c2")],
      tabs: [tab("t2", "Second", ["s2"]), tab("t1", "First", ["s1"])],
      savedConnections: [
        connection("c1", "10.0.0.1", "root"),
        connection("c2", "10.0.0.2", "root"),
      ],
    });
    expect(options.map((option) => option.sessionId)).toEqual(["s2", "s1"]);
    expect(options.map((option) => option.orderLabel)).toEqual(["#1", "#2"]);
    expect(options.map((option) => option.tabLabel)).toEqual(["Second", "First"]);
  });

  it("numbers split panes under their tab so both are distinguishable", () => {
    const options = buildMentionSessionOptions({
      panes: [pane("s1", "prod", "c1"), pane("s2", "prod", "c1")],
      tabs: [tab("t1", "Split view", ["s1", "s2"])],
      savedConnections: [connection("c1", "10.0.0.1", "root")],
    });
    expect(options.map((option) => option.orderLabel)).toEqual(["#1.1", "#1.2"]);
    expect(options.map((option) => option.paneNumber)).toEqual([1, 2]);
    expect(options.every((option) => option.tabLabel === "Split view")).toBe(true);
  });

  it("keeps session ids out of the labels", () => {
    const options = buildMentionSessionOptions({
      panes: [pane("abcdef01", "prod", "c1"), pane("abcdef02", "prod", "c1")],
      tabs: [tab("t1", "Split view", ["abcdef01", "abcdef02"])],
      savedConnections: [connection("c1", "10.0.0.1", "root")],
    });
    for (const option of options) {
      expect(option.orderLabel).not.toContain("abcdef");
      expect(option.tabLabel).not.toContain("abcdef");
    }
  });

  it("uses the dynamic title as the tab label, like the tab strip does", () => {
    const options = buildMentionSessionOptions({
      panes: [pane("s1", "prod", "c1")],
      tabs: [tab("t1", "", ["s1"])],
      savedConnections: [connection("c1", "10.0.0.1", "root")],
      dynamicTitles: new Map([
        [
          "s1",
          {
            applicationTitle: "vim notes.md",
            cwd: null,
            effectiveTitle: "prod · vim notes.md",
            enabled: true,
          },
        ],
      ]),
    });
    expect(options[0].tabLabel).toBe("prod · vim notes.md");
  });

  it("keeps panes that are not placed in a tab after the numbered ones", () => {
    const options = buildMentionSessionOptions({
      panes: [pane("stray", "orphan"), pane("s1", "prod", "c1")],
      tabs: [tab("t1", "First", ["s1"])],
      savedConnections: [connection("c1", "10.0.0.1", "root")],
    });
    expect(options.map((option) => option.sessionId)).toEqual(["s1", "stray"]);
    expect(options[1].orderLabel).toBe("#2");
    expect(options[1].tabLabel).toBe("orphan");
  });

  it("searches by position label, tab name, host and tags", () => {
    const options = buildMentionSessionOptions({
      panes: [pane("s1", "prod", "c1")],
      tabs: [tab("t1", "Build box", ["s1"])],
      savedConnections: [connection("c1", "10.0.0.1", "root", ["db"])],
    });
    for (const needle of ["#1", "build box", "10.0.0.1", "root@", "#db"]) {
      expect(options[0].searchText).toContain(needle);
    }
  });
});
