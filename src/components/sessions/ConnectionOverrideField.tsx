import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MdInfoOutline, MdRefresh } from "react-icons/md";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ConnectionOverrideField } from "@/lib/connectionOverrides";

interface OverrideFieldProps {
  /** Stable override key; identifies the field in `ConnectionOverrides`. */
  field: ConnectionOverrideField;
  label: string;
  /** Explanation shown under the label regardless of the mode. */
  desc?: string;
  /** True when the connection currently overrides this field. */
  overridden: boolean;
  /** Current *effective* value, used when showing the inherited state. */
  globalSummary: ReactNode;
  /** Called when the user switches to "customize"; seeds the override value. */
  onEnable: () => void;
  /** Called when the user switches back; must delete the override key. */
  onDisable: () => void;
  /** The control rendered only while the field is overridden. */
  children: ReactNode;
}

/**
 * One setting that may either follow the global value or be customized for this
 * connection.
 *
 * The important behaviour is on "use global": the caller deletes the override
 * key instead of writing the current global value back. Writing the value would
 * freeze the setting at whatever the global happened to be at that moment, so
 * later global changes would silently stop applying.
 */
export function OverrideField({
  field,
  label,
  desc,
  overridden,
  globalSummary,
  onEnable,
  onDisable,
  children,
}: OverrideFieldProps) {
  const { t } = useTranslation();
  return (
    <div
      className="rounded-lg border border-border/60 bg-background/40 p-3"
      data-override-field={field}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium">{label}</span>
            {overridden ? (
              <span className="rounded-full bg-primary/15 px-1.5 py-px text-[0.625rem] font-medium text-primary">
                {t("connectionOverrides.customized")}
              </span>
            ) : null}
          </div>
          {desc ? (
            <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
              {desc}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[0.6875rem] text-muted-foreground">
            {t("connectionOverrides.useGlobal")}
          </span>
          <Switch
            size="sm"
            checked={overridden}
            aria-label={t("connectionOverrides.toggleField", { field: label })}
            onCheckedChange={(next) => (next ? onEnable() : onDisable())}
          />
        </div>
      </div>

      {overridden ? (
        <div className="mt-3 space-y-2">{children}</div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          <MdInfoOutline className="shrink-0 text-xs" />
          <span className="min-w-0 truncate">
            {globalSummary
              ? t("connectionOverrides.followingGlobalValue", { value: globalSummary })
              : t("connectionOverrides.followingGlobal")}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Header of an override group: states how many settings are customized and
 * offers a single action to go back to the global values.
 */
export function OverrideGroupHeader({
  title,
  desc,
  overriddenCount,
  onResetAll,
}: {
  title: string;
  desc?: string;
  overriddenCount: number;
  onResetAll: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border/70 bg-accent/25 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold">{title}</div>
          {desc ? (
            <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
              {desc}
            </p>
          ) : null}
        </div>
        {overriddenCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 text-[0.6875rem]"
            onClick={onResetAll}
          >
            <MdRefresh className="text-xs" />
            {t("connectionOverrides.resetAll")}
          </Button>
        ) : null}
      </div>
      <p
        className={`mt-2 text-[0.6875rem] leading-relaxed ${
          overriddenCount > 0 ? "text-primary" : "text-muted-foreground"
        }`}
      >
        {overriddenCount > 0
          ? t("connectionOverrides.customizedSummary", { count: overriddenCount })
          : t("connectionOverrides.allFollowingGlobal")}
      </p>
    </div>
  );
}
