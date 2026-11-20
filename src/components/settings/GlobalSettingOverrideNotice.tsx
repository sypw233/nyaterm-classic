import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MdInfoOutline } from "react-icons/md";
import { useApp } from "@/context/AppContext";
import {
  connectionsOverridingField,
  type ConnectionOverrideField,
} from "@/lib/connectionOverrides";

/**
 * Warns that a change to a global setting will not reach every session.
 *
 * Shown under the global control itself, because that is where the confusion
 * happens: the user changes the font, one tab does not follow, and nothing on
 * screen says why. Naming the connections turns a silent surprise into an
 * actionable explanation.
 *
 * Renders nothing when no connection overrides the field, so the common case
 * stays uncluttered.
 */
export function GlobalSettingOverrideNotice({
  field,
}: {
  field: ConnectionOverrideField;
}) {
  const { t } = useTranslation();
  const { savedConnections } = useApp();

  const names = useMemo(
    () => connectionsOverridingField(savedConnections, field),
    [savedConnections, field],
  );

  if (names.length === 0) return null;

  const preview = names.slice(0, 3).join(", ");
  const extra = names.length > 3 ? ` +${names.length - 3}` : "";

  return (
    <p className="flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-amber-600 dark:text-amber-500">
      <MdInfoOutline className="mt-0.5 shrink-0 text-xs" />
      <span className="min-w-0">
        {t("connectionOverrides.globalImpact", {
          count: names.length,
          connections: `${preview}${extra}`,
        })}
      </span>
    </p>
  );
}
