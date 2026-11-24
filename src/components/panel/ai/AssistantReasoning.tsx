import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdExpandLess, MdExpandMore } from "react-icons/md";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AIMessage } from "@/types/global";
import { AnimatedStatusText } from "./AnimatedStatusText";
import { MarkdownContent } from "./MarkdownContent";
import { extractThinkContent } from "./structuredOutput";

export function AssistantReasoning({ message, loading }: { message: AIMessage; loading: boolean }) {
  const { t } = useTranslation();
  const contentThink = useMemo(() => extractThinkContent(message.content), [message.content]);
  const reasoningContent = message.reasoningContent?.trim() || contentThink.reasoning || undefined;
  const [open, setOpen] = useState(false);

  const hasResponseContent =
    contentThink.visible.length > 0 ||
    (message.reasoningContent && contentThink.visible.length > 0);
  const stillThinking = loading && !hasResponseContent;

  if (!reasoningContent) {
    return stillThinking ? (
      <div className="mt-3 overflow-hidden rounded-md border border-primary/25 bg-primary/8 shadow-sm">
        <div className="px-3 py-2.5 text-[0.6875rem]">
          <AnimatedStatusText label={t("ai.thinking")} />
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent animate-pulse" />
      </div>
    ) : null;
  }

  return (
    <div className="group relative">
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className={`mt-3 rounded-md border bg-background/40 ${
          stillThinking ? "border-primary/25 bg-primary/6 shadow-sm" : "border-border/60"
        }`}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={`flex w-full items-center justify-between gap-2 py-2 pl-7 pr-3 text-left text-[0.6875rem] font-medium transition hover:text-foreground ${
              stillThinking ? "text-primary" : "text-muted-foreground"
            }`}
          >
          <span className="flex min-w-0 items-center gap-2">
            {stillThinking ? (
              <AnimatedStatusText label={t("ai.thinking")} />
            ) : (
              <span>{t("ai.thoughtComplete")}</span>
            )}
          </span>
          <span className="flex items-center gap-1">
            {open ? t("ai.collapseReasoning") : t("ai.expandReasoning")}
            {open ? <MdExpandLess className="text-sm" /> : <MdExpandMore className="text-sm" />}
          </span>
        </button>
      </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border/60 px-3 py-3">
            <MarkdownContent content={reasoningContent} />
          </div>
        </CollapsibleContent>
      </Collapsible>
      <button
        type="button"
        aria-label={open ? t("ai.collapseReasoning") : t("ai.expandReasoning")}
        title={open ? t("ai.collapseReasoning") : t("ai.expandReasoning")}
        className="absolute left-1 top-4 z-10 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <MdExpandLess className="text-sm" /> : <MdExpandMore className="text-sm" />}
      </button>
    </div>
  );
}
