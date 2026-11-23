import { useEffect, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { resolveWorkspaceActivePane } from "@/lib/tmux/tree";
import type { NoteTreeNode } from "@/types/notes";

/**
 * Switch the notes panel to the folder bound to the active connection.
 *
 * The binding lives in UiConfig (`notes_folder_id_by_connection_id`) so it
 * survives renames and needs no change to the notes data format. The active
 * connection is derived from the same tab/pane state the rest of the app uses.
 * Only a definite binding triggers a change, so manual navigation is never
 * overwritten when switching to an unbound connection.
 */
export function useNotesAutoSwitch({
  tree,
  boundFolderIdForConnection,
  selectFolder,
  enabled = true,
}: {
  tree: NoteTreeNode[];
  boundFolderIdForConnection: (connectionId: string) => string | null;
  selectFolder: (folderId: string) => void;
  enabled?: boolean;
}) {
  const { tabs, activeTabId, savedConnections } = useApp();
  const lastConnectionIdRef = useRef<string | null>(null);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activePane = activeTab ? resolveWorkspaceActivePane(tabs, activeTab) : null;
  const activeConnectionId = activePane?.connectionId ?? null;

  useEffect(() => {
    if (!enabled) return;
    if (!activeConnectionId) {
      lastConnectionIdRef.current = null;
      return;
    }
    // Only react when the active connection actually changes, not on any
    // savedConnections refresh.
    if (lastConnectionIdRef.current === activeConnectionId) return;
    lastConnectionIdRef.current = activeConnectionId;

    const folderId = boundFolderIdForConnection(activeConnectionId);
    if (!folderId) return;

    // Verify the bound folder still exists before selecting it.
    const exists = (nodes: NoteTreeNode[]): boolean =>
      nodes.some((node) => node.id === folderId || exists(node.children));
    if (exists(tree)) selectFolder(folderId);
  }, [
    activeConnectionId,
    boundFolderIdForConnection,
    enabled,
    savedConnections,
    selectFolder,
    tree,
  ]);
}
