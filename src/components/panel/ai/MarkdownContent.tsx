import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MdContentCopy } from "react-icons/md";
import { toast } from "sonner";
import { writeClipboardText } from "@/lib/clipboard";

type MarkdownNodeProps = {
  children?: ReactNode;
  href?: string;
};

/**
 * A fenced code block with a copy action.
 *
 * The copy button reads the rendered block's text so it copies exactly what
 * the user sees, regardless of how react-markdown wrapped the children. The
 * button stays out of the Tab order: code blocks repeat per message, so
 * trapping focus on each one would make keyboard navigation unusable.
 */
function CodeBlock({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const preRef = useRef<HTMLPreElement>(null);

  const copy = () => {
    const text = preRef.current?.textContent ?? "";
    void writeClipboardText(text).then(() => toast.success(t("common.copied")));
  };

  return (
    <div className="group relative my-2">
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("ai.copy")}
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded border border-border/60 bg-background/85 px-1.5 py-0.5 text-[0.625rem] text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100 focus:opacity-100"
        onClick={copy}
      >
        <MdContentCopy className="text-[0.75rem]" />
        {t("ai.copy")}
      </button>
      <pre
        ref={preRef}
        className="terminal-scroll max-h-64 overflow-auto rounded-md border border-border/60 bg-muted/30 p-3 font-mono text-[0.6875rem] leading-5"
      >
        {children}
      </pre>
    </div>
  );
}

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="break-words text-xs leading-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }: MarkdownNodeProps) => (
            <p className="my-2 first:mt-0 last:mb-0">{children}</p>
          ),
          ul: ({ children }: MarkdownNodeProps) => (
            <ul className="my-2 list-disc pl-5">{children}</ul>
          ),
          ol: ({ children }: MarkdownNodeProps) => (
            <ol className="my-2 list-decimal pl-5">{children}</ol>
          ),
          li: ({ children }: MarkdownNodeProps) => <li className="my-0.5">{children}</li>,
          a: ({ children, href }: MarkdownNodeProps) => (
            <a
              className="text-primary underline underline-offset-2"
              href={href}
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }: MarkdownNodeProps) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          pre: ({ children }: MarkdownNodeProps) => <CodeBlock>{children}</CodeBlock>,
          code: ({ children }: MarkdownNodeProps) => (
            <code className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[0.6875rem]">
              {children}
            </code>
          ),
          table: ({ children }: MarkdownNodeProps) => (
            <div className="terminal-scroll my-2 overflow-auto">
              <table className="w-full border-collapse text-left">{children}</table>
            </div>
          ),
          th: ({ children }: MarkdownNodeProps) => (
            <th className="border border-border/60 px-2 py-1 font-medium">{children}</th>
          ),
          td: ({ children }: MarkdownNodeProps) => (
            <td className="border border-border/60 px-2 py-1">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
