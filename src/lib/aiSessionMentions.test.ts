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
  it("uses username@host plus tags as the default distinguishing detail", () => {
    const pane1 = pane("s1", "prod", "c1");
    const options = buildMentionSessionOptions({
      panes: [pane1],
      tabs: [],
      savedConnections: [connection("c1", "10.0.0.1", "root", ["db", "prod"])],
    });
    expect(options[0].detail).toBe("root@10.0.0.1 #db #prod");
    expect(options[0].tags).toEqual(["db", "prod"]);
    expect(options[0].tabLabel).toBeUndefined();
    expect(options[0].searchText).toContain("root@10.0.0.1");
    expect(options[0].searchText).toContain("#db");
  });

  it("adds the tab label when username@host and tags are shared", () => {
    const panes = [pane("s1", "prod", "c1"), pane("s2", "prod", "c1")];
    const options = buildMentionSessionOptions({
      panes,
      tabs: [tab("t1", "DB session", ["s1"]), tab("t2", "Log tail", ["s2"])],
      savedConnections: [connection("c1", "10.0.0.1", "root")],
    });
    expect(options[0].tabLabel).toBe("DB session");
    expect(options[1].tabLabel).toBe("Log tail");
  });

  it("adds a short session id when panes share the same tab too", () => {
    const panes = [pane("abcdef01", "prod", "c1"), pane("abcdef02", "prod", "c1")];
    const sharedTab = tab("t1", "Split view", ["abcdef01", "abcdef02"]);
    const options = buildMentionSessionOptions({
      panes,
      tabs: [sharedTab],
      savedConnections: [connection("c1", "10.0.0.1", "root")],
    });
    expect(options[0].tabLabel).toBe("Split view · abcdef01");
    expect(options[1].tabLabel).toBe("Split view · abcdef02");
    expect(options[0].searchText).toContain("abcdef01");
  });

  it("keeps distinct details free of a tab label", () => {
    const options = buildMentionSessionOptions({
      panes: [pane("s1", "a", "c1"), pane("s2", "b", "c2")],
      tabs: [tab("t1", "Same tab", ["s1", "s2"])],
      savedConnections: [
        connection("c1", "10.0.0.1", "root"),
        connection("c2", "10.0.0.2", "admin"),
      ],
    });
    expect(options.every((option) => option.tabLabel === undefined)).toBe(true);
  });
});
