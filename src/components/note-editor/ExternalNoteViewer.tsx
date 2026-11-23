import "@mdxeditor/editor/style.css";

import { MDXEditor, headingsPlugin, linkPlugin, listsPlugin, markdownShortcutPlugin, quotePlugin, tablePlugin, thematicBreakPlugin } from "@mdxeditor/editor";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/**
 * Read-only view for an external Markdown file. It intentionally shares only
 * the rendering plugins with the note editor; there is no save/autosave path.
 */
export default function ExternalNoteViewer({ markdown }: { markdown: string }) {
  const { t } = useTranslation();
  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      tablePlugin(),
      markdownShortcutPlugin(),
    ],
    [],
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-3 py-1 text-xs text-[var(--df-text-dimmed)]">
        {t("notes.readOnly")}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <MDXEditor markdown={markdown} plugins={plugins} readOnly />
      </div>
    </div>
  );
}
