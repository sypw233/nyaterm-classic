import { getVersion } from "@/lib/backend/platform/app";
import { openUrl } from "@/lib/backend/platform/opener";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { MdCheckCircle, MdError, MdRestartAlt } from "react-icons/md";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useApp } from "@/context/AppContext";
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  relaunchApp,
  cancelDownload,
  subscribeUpdater,
  getUpdaterState,
  type UpdateInfo,
} from "@/lib/updater";
import { formatBytes } from "@/lib/byteSize";

interface UpdateDialogProps {
  open: boolean;
  onClose: () => void;
  onUpdateFound?: (info: UpdateInfo) => void;
}

type MarkdownNodeProps = {
  children?: ReactNode;
  href?: string;
};

type MarkdownCodeProps = {
  children?: ReactNode;
  className?: string;
};

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="min-w-0 overflow-x-hidden break-words text-xs leading-5 text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }: MarkdownNodeProps) => (
            <h1 className="mt-3 mb-2 text-sm font-semibold tracking-tight first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }: MarkdownNodeProps) => (
            <h2 className="mt-3 mb-2 text-[13px] font-semibold tracking-tight first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }: MarkdownNodeProps) => (
            <h3 className="mt-3 mb-1.5 text-xs font-semibold first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }: MarkdownNodeProps) => (
            <h4 className="mt-2.5 mb-1.5 text-xs font-medium first:mt-0">
              {children}
            </h4>
          ),
          p: ({ children }: MarkdownNodeProps) => (
            <p className="my-2 text-xs leading-5 first:mt-0 last:mb-0">
              {children}
            </p>
          ),
          ul: ({ children }: MarkdownNodeProps) => (
            <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">
              {children}
            </ul>
          ),
          ol: ({ children }: MarkdownNodeProps) => (
            <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">
              {children}
            </ol>
          ),
          li: ({ children }: MarkdownNodeProps) => (
            <li className="pl-0.5">{children}</li>
          ),
          hr: () => <hr className="my-3 border-border/70" />,
          a: ({ children, href }: MarkdownNodeProps) => (
            <button
              className="inline max-w-full cursor-pointer break-all text-left align-baseline text-primary underline underline-offset-2 transition-opacity hover:opacity-80"
              onClick={() => {
                if (href) {
                  void openUrl(href);
                }
              }}
              type="button"
            >
              {children}
            </button>
          ),
          blockquote: ({ children }: MarkdownNodeProps) => (
            <blockquote className="my-3 rounded-r-md border-l-2 border-border bg-muted/20 py-1 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          pre: ({ children }: MarkdownNodeProps) => (
            <pre className="terminal-scroll my-3 max-h-52 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded-md border border-border/70 bg-muted/40 p-3 font-mono text-[11px] leading-5 shadow-sm [&_code]:whitespace-pre-wrap [&_code]:break-all">
              {children}
            </pre>
          ),
          code: ({ children, className }: MarkdownCodeProps) => {
            if (className) {
              return <code className={className}>{children}</code>;
            }
            return (
              <code className="break-all rounded border border-border/50 bg-muted/50 px-1 py-0.5 font-mono text-[11px]">
                {children}
              </code>
            );
          },
          table: ({ children }: MarkdownNodeProps) => (
            <div className="my-3 min-w-0 overflow-hidden rounded-md border border-border/60">
              <table className="w-full table-fixed border-collapse text-left text-[11px] leading-5">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }: MarkdownNodeProps) => (
            <thead className="bg-muted/40">{children}</thead>
          ),
          tbody: ({ children }: MarkdownNodeProps) => (
            <tbody className="[&_tr:last-child]:border-0">{children}</tbody>
          ),
          tr: ({ children }: MarkdownNodeProps) => (
            <tr className="border-b border-border/60">{children}</tr>
          ),
          th: ({ children }: MarkdownNodeProps) => (
            <th className="break-words px-2.5 py-1.5 font-semibold text-foreground">
              {children}
            </th>
          ),
          td: ({ children }: MarkdownNodeProps) => (
            <td className="break-words px-2.5 py-1.5 align-top text-muted-foreground">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function UpdateDialog({
  open,
  onClose,
  onUpdateFound,
}: UpdateDialogProps) {
  const { t } = useTranslation();
  const { runtimeInfo, runtimeInfoLoaded } = useApp();
  const snapshot = useSyncExternalStore(subscribeUpdater, getUpdaterState);
  const status = snapshot.status;
  const progress = snapshot.progress;
  const error = snapshot.error;
  const localUpdateInfo = snapshot.info;
  const [currentVersion, setCurrentVersion] = useState("");
  const onUpdateFoundRef = useRef(onUpdateFound);
  onUpdateFoundRef.current = onUpdateFound;

  useEffect(() => {
    if (!open || !runtimeInfoLoaded || runtimeInfo.packageManager) return;
    getVersion().then(setCurrentVersion).catch(() => {});
    // Reuse a background download/check already in flight. Only start a new
    // check when there is nothing cached; otherwise the shared store is the
    // single source of truth for phase and progress.
    const phase = getUpdaterState().status;
    if (phase === "idle" || phase === "error") {
      void checkForUpdate(runtimeInfo.portable)
        .then((info) => {
          if (info) onUpdateFoundRef.current?.(info);
        })
        .catch(() => {});
    }
  }, [open, runtimeInfo.packageManager, runtimeInfo.portable, runtimeInfoLoaded]);

  const handleUpdate = useCallback(async () => {
    if (runtimeInfo.packageManager) return;
    try {
      if (getUpdaterState().status !== "available") {
        await checkForUpdate(runtimeInfo.portable);
      }
      // Download only. Installing happens when the user confirms the restart.
      await downloadUpdate();
    } catch {
      // Errors are reflected in the shared store.
    }
  }, [runtimeInfo.packageManager, runtimeInfo.portable]);

  const handleRelaunch = useCallback(async () => {
    try {
      // Non-portable updates are downloaded but not installed yet; install()
      // applies them in place. Portable updates are applied by relaunchApp()
      // (apply_portable_update), so don't apply them twice.
      if (!runtimeInfo.portable && getUpdaterState().status === "ready") {
        await installUpdate();
      }
      await relaunchApp(runtimeInfo.portable);
    } catch {
      // Errors are reflected in the shared store and shown in the error view.
    }
  }, [runtimeInfo.portable]);

  const [backgroundDownload, setBackgroundDownload] = useState(false);
  const handleBackgroundDownload = useCallback(async () => {
    if (runtimeInfo.packageManager) return;
    setBackgroundDownload(true);
    try {
      if (getUpdaterState().status !== "available") {
        await checkForUpdate(runtimeInfo.portable);
      }
      await downloadUpdate();
    } catch {
      // Errors are reflected in the shared store.
    } finally {
      setBackgroundDownload(false);
    }
  }, [runtimeInfo.packageManager, runtimeInfo.portable]);

  const canClose =
    status !== "downloading" ||
    backgroundDownload;
  const percent =
    progress.total > 0
      ? Math.round((progress.downloaded / progress.total) * 100)
      : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && canClose) onClose();
      }}
    >
      <DialogContent
        className="w-[min(92vw,560px)] overflow-x-hidden sm:max-w-[560px]"
        showCloseButton={canClose}
        onPointerDownOutside={(e) => {
          if (!canClose) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (!canClose) e.preventDefault();
        }}
      >
        {status === "checking" && (
          <DialogHeader>
            <DialogTitle>{t("updater.checking")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("updater.checking")}
            </DialogDescription>
          </DialogHeader>
        )}

        {status === "idle" && (
          <>
            <DialogHeader>
              <DialogTitle>{t("updater.noUpdate")}</DialogTitle>
              <DialogDescription className="text-xs pt-1">
                {t("updater.currentVersion")}: v{currentVersion}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={onClose}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          </>
        )}

        {status === "available" && localUpdateInfo && (
          <>
            <DialogHeader>
              <DialogTitle>{t("updater.newVersionAvailable")}</DialogTitle>
              <DialogDescription className="space-y-1 pt-1">
                <span className="block text-xs">
                  {t("updater.currentVersion")}: v{currentVersion}
                </span>
                <span className="block text-xs">
                  {t("updater.newVersion")}: v{localUpdateInfo.version}
                </span>
                {localUpdateInfo.date && (
                  <span className="block text-xs">
                    {t("updater.releaseDate")}:{" "}
                    {new Date(localUpdateInfo.date).toLocaleDateString()}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            {localUpdateInfo.body && (
              <div className="terminal-scroll max-h-[min(42vh,320px)] min-w-0 max-w-full overflow-y-auto overflow-x-hidden rounded-md border p-3">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  {t("updater.releaseNotes")}
                </p>
                <MarkdownContent content={localUpdateInfo.body} />
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleBackgroundDownload()}>
                {t("updater.downloadInBackground")}
              </Button>
              <Button size="sm" onClick={() => void handleUpdate()}>
                {t("updater.updateNow")}
              </Button>
            </DialogFooter>
          </>
        )}

        {status === "downloading" && (
          <>
            <DialogHeader>
              <DialogTitle>{t("updater.downloading")}</DialogTitle>
              <DialogDescription>
                {formatBytes(progress.downloaded)} /{" "}
                {progress.total > 0 ? formatBytes(progress.total) : "..."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Progress value={percent} className="h-2" />
              <p className="text-xs text-center text-muted-foreground">
                {percent}%
              </p>
              <p className="text-xs text-center text-muted-foreground">
                {t("updater.downloadInBackgroundHint")}
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBackgroundDownload(true);
                  onClose();
                }}
              >
                {t("updater.downloadInBackground")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  cancelDownload();
                  setBackgroundDownload(false);
                }}
              >
                {t("updater.cancelDownload")}
              </Button>
            </DialogFooter>
          </>
        )}

        {status === "ready" && (
          <>
            <DialogHeader className="items-center pt-2">
              <MdCheckCircle className="text-4xl text-green-500 mb-2" />
              <DialogTitle>{t("updater.readyToRestart")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("updater.readyToRestart")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                {t("updater.restartLater")}
              </Button>
              <Button size="sm" onClick={handleRelaunch}>
                <MdRestartAlt className="mr-1.5" />
                {t("updater.restartNow")}
              </Button>
            </DialogFooter>
          </>
        )}

        {status === "installed" && (
          <>
            <DialogHeader className="items-center pt-2">
              <MdCheckCircle className="text-4xl text-green-500 mb-2" />
              <DialogTitle>{t("updater.autoUpdateInstalled")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("updater.autoUpdateInstalled")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                {t("updater.restartLater")}
              </Button>
              <Button size="sm" onClick={handleRelaunch}>
                <MdRestartAlt className="mr-1.5" />
                {t("updater.restartNow")}
              </Button>
            </DialogFooter>
          </>
        )}

        {status === "error" && (
          <>
            <DialogHeader className="items-center pt-2">
              <MdError className="text-4xl text-red-500 mb-2" />
              <DialogTitle>{t("updater.updateFailed")}</DialogTitle>
              <DialogDescription className="terminal-scroll max-h-32 overflow-y-auto overflow-x-hidden break-all rounded-md bg-muted/30 p-2 text-left text-xs">
                {error}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                {t("common.cancel")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
