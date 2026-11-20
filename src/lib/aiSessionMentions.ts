import { collectSessionPanes, getTabDisplayName } from "@/lib/workspaceTabs";
import type { SavedConnection, SessionPane, Tab } from "@/types/global";

/** One row in the AI `@` session-mention picker. */
export interface MentionSessionOption {
  sessionId: string;
  /** Pane name, shown as the primary label. */
  name: string;
  type: string;
  /** `username@host` (or the best available identity), shown under the name. */
  detail: string;
  /** Connection tags, rendered as `#tag` badges. */
  tags: string[];
  /**
   * Tab label, populated only when `detail` + tags are shared by more than one
   * pane, so sessions on the same server can be told apart.
   */
  tabLabel?: string;
  /** Lowercase text matched by the mention query. */
  searchText: string;
}

interface BuildOptionsArgs {
  panes: SessionPane[];
  tabs: Tab[];
  savedConnections: SavedConnection[];
}

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/**
 * Build mention options with just-enough disambiguation: `username@host` plus
 * tags by default; when two panes still look identical, add the tab name, and
 * when the tab name collides too (e.g. split panes in one tab), a short session
 * id. See the AI panel's `@` picker and its selected-session chips.
 */
export function buildMentionSessionOptions({
  panes,
  tabs,
  savedConnections,
}: BuildOptionsArgs): MentionSessionOption[] {
  const connectionByPane = new Map<string, SavedConnection | undefined>();
  const tabLabelByPane = new Map<string, string>();
  for (const tab of tabs) {
    const tabLabel = tab.customName?.trim() || getTabDisplayName(tab);
    for (const pane of collectSessionPanes(tab.root)) {
      tabLabelByPane.set(pane.sessionId, tabLabel);
    }
  }

  const options = panes.map<MentionSessionOption>((pane) => {
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
    return {
      sessionId: pane.sessionId,
      name: pane.name,
      type: pane.type,
      detail,
      tags,
      searchText: `${pane.name} ${pane.type} ${detail} ${pane.sessionId}`.toLowerCase(),
    };
  });

  // Group by the default label; only ambiguous groups get a tab label.
  const byDetail = new Map<string, MentionSessionOption[]>();
  for (const option of options) {
    const group = byDetail.get(option.detail) ?? [];
    group.push(option);
    byDetail.set(option.detail, group);
  }
  for (const group of byDetail.values()) {
    if (group.length < 2) continue;
    const byTabLabel = new Map<string, MentionSessionOption[]>();
    for (const option of group) {
      const label = tabLabelByPane.get(option.sessionId) ?? "";
      const bucket = byTabLabel.get(label) ?? [];
      bucket.push(option);
      byTabLabel.set(label, bucket);
    }
    for (const [label, bucket] of byTabLabel) {
      const ambiguousTab = bucket.length > 1;
      for (const option of bucket) {
        option.tabLabel = ambiguousTab
          ? `${label} · ${shortSessionId(option.sessionId)}`.trim()
          : label;
        option.searchText += ` ${option.tabLabel.toLowerCase()}`;
      }
    }
  }

  return options;
}
