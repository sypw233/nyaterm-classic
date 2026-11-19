import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdErrorOutline, MdFolderOpen, MdRefresh } from "react-icons/md";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { invoke } from "@/lib/invoke";

/** Mirrors `storage::DatabaseHealth` on the Rust side. */
type DatabaseHealth =
  | "healthy"
  | "missing"
  | "corrupt"
  | "upgrade_required"
  | "in_use"
  | "data_invalid"
  | "unavailable";

interface StorageStartupFailure {
  dataDir: string;
  health: DatabaseHealth;
  databasePath: string;
}

interface DatabaseRebuildTicket {
  data_dir: string;
  health: DatabaseHealth;
  digest: string | null;
}

/** Only a missing or corrupt file may be replaced without losing known data. */
function isRebuildable(health: DatabaseHealth): boolean {
  return health === "missing" || health === "corrupt";
}

/**
 * Startup screen shown when the database could not be opened.
 *
 * Rebuilding deletes the store's contents, so the flow is deliberately two
 * steps: describe the file, then require a second, separate confirmation whose
 * ticket is bound to that exact file. A damaged database is archived beside the
 * new one rather than overwritten.
 */
export default function StorageRecoveryDialog() {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<StorageStartupFailure | null>(null);
  const [checking, setChecking] = useState(true);
  const [ticket, setTicket] = useState<DatabaseRebuildTicket | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    invoke<StorageStartupFailure | null>("get_storage_startup_failure")
      .then((result) => {
        if (!disposed) setFailure(result);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) setChecking(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const requestRebuild = useCallback(async () => {
    setBusy(true);
    try {
      setTicket(await invoke<DatabaseRebuildTicket>("prepare_database_rebuild"));
      setConfirming(true);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const confirmRebuild = useCallback(async () => {
    if (!ticket) return;
    setBusy(true);
    try {
      const archive = await invoke<string | null>("rebuild_database", { ticket });
      setConfirming(false);
      // The store is open again, so a reload is the cheapest way to bring the
      // rest of the app up against the new database.
      toast.success(
        archive
          ? t("storageRecovery.rebuiltWithArchive", { path: archive })
          : t("storageRecovery.rebuilt"),
      );
      window.location.reload();
    } catch (error) {
      toast.error(String(error));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }, [t, ticket]);

  const revealDirectory = useCallback(async () => {
    try {
      await invoke("reveal_storage_directory");
    } catch (error) {
      toast.error(String(error));
    }
  }, []);

  if (checking || !failure) return null;

  const rebuildable = isRebuildable(failure.health);

  return (
    <>
      <Dialog open>
        <DialogContent
          className="sm:max-w-xl"
          showCloseButton={false}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MdErrorOutline className="text-destructive" />
              {t("storageRecovery.title")}
            </DialogTitle>
            <DialogDescription>
              {t(`storageRecovery.health.${failure.health}`)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <div className="text-muted-foreground">{t("storageRecovery.databaseFile")}</div>
              <code className="block break-all rounded bg-muted px-2 py-1 font-mono">
                {failure.databasePath}
              </code>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">{t("storageRecovery.dataDirectory")}</div>
              <code className="block break-all rounded bg-muted px-2 py-1 font-mono">
                {failure.dataDir}
              </code>
            </div>
            {rebuildable ? (
              <p className="text-muted-foreground">{t("storageRecovery.rebuildExplanation")}</p>
            ) : (
              <p className="text-muted-foreground">{t("storageRecovery.notRebuildable")}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => void revealDirectory()}>
              <MdFolderOpen className="mr-1.5" />
              {t("storageRecovery.openDirectory")}
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              <MdRefresh className="mr-1.5" />
              {t("storageRecovery.retry")}
            </Button>
            {rebuildable && (
              <Button variant="destructive" disabled={busy} onClick={() => void requestRebuild()}>
                {t("storageRecovery.rebuild")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("storageRecovery.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("storageRecovery.confirmDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmRebuild()}>
              {t("storageRecovery.confirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
