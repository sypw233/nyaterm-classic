import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MdChevronRight,
  MdContentCopy,
  MdSend,
  MdMyLocation,
} from "react-icons/md";
import { toast } from "sonner";
import PanelHeader from "@/components/layout/PanelHeader";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { writeClipboardText } from "@/lib/clipboard";
import {
  emitSessionCommandNavigate,
  getSessionCommandHistory,
  listenSessionCommandHistory,
} from "@/lib/sessionInput";

interface CommandHistoryProps {
  activeSessionId: string | null;
  onCommandSend: (command: string) => void;
}

interface HistoryEntry {
  command: string;
  key: string;
}

/** Command history list scoped to the selected session. */
function CommandHistory({
  activeSessionId,
  onCommandSend,
}: CommandHistoryProps) {
  const { t } = useTranslation();
  const [history, setHistory] = useState<string[]>(() =>
    activeSessionId ? getSessionCommandHistory(activeSessionId) : [],
  );

  useEffect(() => {
    if (!activeSessionId) {
      setHistory([]);
      return;
    }

    setHistory(getSessionCommandHistory(activeSessionId));
    return listenSessionCommandHistory(activeSessionId, setHistory);
  }, [activeSessionId]);

  const handleDoubleClick = useCallback(
    (command: string) => {
      onCommandSend(command);
    },
    [onCommandSend],
  );

  const handleCopy = useCallback(
    async (command: string) => {
      try {
        await writeClipboardText(command);
        toast.success(t("common.copied"));
      } catch {
        toast.error(t("panel.commandHistoryCopyFailed"));
      }
    },
    [t],
  );

  const handleJump = useCallback(
    (entry: HistoryEntry) => {
      if (!activeSessionId) return;
      emitSessionCommandNavigate(activeSessionId, entry.command);
    },
    [activeSessionId],
  );

  const historyEntries = useMemo(() => {
    const counts = new Map<string, number>();
    return history.map((command) => {
      const occurrence = (counts.get(command) ?? 0) + 1;
      counts.set(command, occurrence);
      return { command, key: `${command}-${occurrence}` };
    });
  }, [history]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PanelHeader title={t("panel.commandHistory")} />
      <div className="flex-1 overflow-y-auto p-2 text-xs font-mono space-y-0.5 terminal-scroll">
        {history.length === 0 ? (
          <div
            className="text-center py-4 font-display text-[0.6875rem]"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {t("panel.noCommandsYet")}
          </div>
        ) : (
          historyEntries.map((entry) => (
            <ContextMenu key={entry.key}>
              <ContextMenuTrigger asChild>
                <div
                  className="px-2 py-1.5 rounded cursor-pointer transition-colors truncate flex items-center gap-1.5 group df-hover"
                  style={{ color: "var(--df-text)" }}
                  title={entry.command}
                  onDoubleClick={() => handleDoubleClick(entry.command)}
                >
                  <MdChevronRight
                    className="text-[0.625rem] transition-colors"
                    style={{ color: "var(--df-text-dimmed)" }}
                  />
                  <span className="truncate">{entry.command}</span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-[140px]">
                <ContextMenuItem
                  className="text-xs gap-2"
                  onSelect={() => void handleCopy(entry.command)}
                >
                  <MdContentCopy className="text-[0.875rem]" />
                  {t("panel.commandHistoryCopy")}
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-xs gap-2"
                  onSelect={() => handleJump(entry)}
                >
                  <MdMyLocation className="text-[0.875rem]" />
                  {t("panel.commandHistoryJump")}
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-xs gap-2"
                  onSelect={() => handleDoubleClick(entry.command)}
                >
                  <MdSend className="text-[0.875rem]" />
                  {t("quickCommands.send")}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))
        )}
      </div>
    </div>
  );
}

export default memo(CommandHistory);
