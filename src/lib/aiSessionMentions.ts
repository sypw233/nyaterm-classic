import {
  collectSessionPanes,
  getTabActiveSessionId,
  getTabDisplayName,
} from "@/lib/workspaceTabs";
import type {
  SavedConnection,
  SessionPane,
  SessionTitleSnapshot,
  Tab,
} from "@/types/global";

/** One row in the AI `@` session-mention picker. */
export interface MentionSessionOption {
  sessionId: string;
  /** Pane name, shown as the primary label. */
  name: string;
  type: string;
  /** 1-based position of the owning tab, matching the tab strip. */
  tabNumber: number;
  /** 1-based position inside a split tab; absent for single-pane tabs. */
  paneNumber?: number;
  /**
   * Position label matching the tab strip, e.g. `#2` for the second tab or
   * `#2.1` / `#2.2` for two panes split inside it.
   */
  orderLabel: string;
  /** Display name of the owning tab, resolved the same way the tab strip does. */
  tabLabel: string;
  /** `username@host` (or the best available identity), shown under the name. */
  detail: string;
  /** Connection tags, rendered as `#tag` badges. */
  tags: string[];
  /** Lowercase text matched by the mention query. */
  searchText: string;
}

interface BuildOptionsArgs {
  panes: SessionPane[];
  tabs: Tab[];
  savedConnections: SavedConnection[];
  /**
   * Effective dynamic titles keyed by session id. Passing them keeps the tab
   * label identical to what the tab strip shows.
   */
  dynamicTitles?: ReadonlyMap<string, SessionTitleSnapshot>;
}

/**
 * Build mention options labelled by their position in the tab strip.
 *
 * Sessions used to be distinguished by `username@host`, falling back to the
 * tab name and finally to a short session id. That breaks down for ordinary
 * use: every session to the same account shares `root@host`, and an 8-char id
 * says nothing about which terminal the user is looking at. The tab strip
 * already numbers its tabs, so mirror that instead: `#2` is the second tab,
 * `#2.1` / `#2.2` are the panes split inside it. Options are returned in tab
 * order, so the picker list matches the strip left to right.
 */
export function buildMentionSessionOptions({
  panes,
  tabs,
  savedConnections,
  dynamicTitles,
}: BuildOptionsArgs): MentionSessionOption[] {
  const paneById = new Map(panes.map((pane) => [pane.sessionId, pane]));
  const connectionByPane = new Map<string, SavedConnection | undefined>();

  const describe = (
    tabPane: SessionPane,
    tabNumber: number,
    tabLabel: string,
    paneNumber?: number,
  ): MentionSessionOption => {
    // Prefer the caller's pane object: the tab tree may carry a lighter copy
    // without the connection id.
    const pane = paneById.get(tabPane.sessionId) ?? tabPane;
    let conn = connectionByPane.get(pane.sessionId);
    if (conn === undefined && pane.connectionId) {
      conn = savedConnections.find((item) => item.id === pane.connectionId);
      connectionByPane.set(pane.sessionId, conn);
    }
    const host = conn?.host?.trim();
    const username = conn?.username?.trim();
    const identity =
      username && host ? `${username}@${host}` : host || conn?.name || pane.name;
    const tags = (conn?.tags ?? []).filter((tag) => tag.trim().length > 0);
    const detail = [identity, ...tags.map((tag) => `#${tag}`)].join(" ");
    const orderLabel = paneNumber
      ? `#${tabNumber}.${paneNumber}`
      : `#${tabNumber}`;
    return {
      sessionId: pane.sessionId,
      name: pane.name,
      type: pane.type,
      tabNumber,
      paneNumber,
      orderLabel,
      tabLabel,
      detail,
      tags,
      searchText: [
        orderLabel,
        pane.name,
        pane.type,
        tabLabel,
        detail,
        tabNumber,
        paneNumber ?? "",
      ]
        .join(" ")
        .toLowerCase(),
    };
  };

  const options: MentionSessionOption[] = [];
  const placed = new Set<string>();

  tabs.forEach((tab, index) => {
    const tabNumber = index + 1;
    const tabPanes = collectSessionPanes(tab.root).filter((pane) =>
      paneById.has(pane.sessionId),
    );
    if (tabPanes.length === 0) return;

    const activeSessionId = getTabActiveSessionId(tab);
    const tabLabel = getTabDisplayName(
      tab,
      dynamicTitles?.get(activeSessionId ?? "")?.effectiveTitle ?? null,
    );
    const split = tabPanes.length > 1;

    tabPanes.forEach((pane, paneIndex) => {
      options.push(
        describe(pane, tabNumber, tabLabel, split ? paneIndex + 1 : undefined),
      );
      placed.add(pane.sessionId);
    });
  });

  // A pane the workspace has not placed in a tab yet still needs a row; keep
  // its incoming order after the numbered ones rather than dropping it.
  let trailingNumber = tabs.length;
  for (const pane of panes) {
    if (placed.has(pane.sessionId)) continue;
    trailingNumber += 1;
    options.push(describe(pane, trailingNumber, pane.name));
  }

  return options;
}
