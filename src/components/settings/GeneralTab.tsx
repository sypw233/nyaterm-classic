import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SelectItem } from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { useConfigTransfer } from "@/hooks/useConfigTransfer";
import { AVAILABLE_LANGUAGES } from "@/i18n";
import { runtime, supports } from "@/lib/backend/runtime";
import { HEADER_STATUS_MODES, normalizeHeaderStatusMode } from "@/lib/headerStatus";
import { resolveKeys } from "@/lib/shortcutRegistry";
import {
  SettingFieldGrid,
  SettingNumberInput,
  SettingRow,
  SettingSection,
  SettingSelect,
  SettingSwitch,
} from "./SettingFormItems";

const HIDDEN_HEADER_STATUS_VALUE = "hidden";

export function GeneralTab() {
  const { t, i18n } = useTranslation();
  const { appSettings, updateAppSettings, updateUi } = useApp();
  const { handleExportDiagnostics, handleOpenLogs, transferBusy } = useConfigTransfer();
  const headerStatusSettingValue =
    appSettings.ui.header_status_visible === false
      ? HIDDEN_HEADER_STATUS_VALUE
      : normalizeHeaderStatusMode(appSettings.ui.header_status_mode);
  const freezeDemoBound = Boolean(resolveKeys("special.freezeDemo", appSettings.keybindings));

  return (
    <div className="space-y-5">
      <SettingSection contentClassName="space-y-5">
        <SettingSelect
          label={t("settings.language")}
          desc={t("settings.languageDesc")}
          value={appSettings.ui.language || "en"}
          onValueChange={(lng) => {
            i18n.changeLanguage(lng);
            updateUi({ language: lng });
          }}
        >
          {AVAILABLE_LANGUAGES.map((lng) => (
            <SelectItem key={lng.id} value={lng.id}>
              {lng.name}
            </SelectItem>
          ))}
        </SettingSelect>

        <SettingSelect
          label={t("settings.headerStatus")}
          desc={t("settings.headerStatusDesc")}
          value={headerStatusSettingValue}
          onValueChange={(value) => {
            if (value === HIDDEN_HEADER_STATUS_VALUE) {
              updateUi({ header_status_visible: false });
              return;
            }

            updateUi({
              header_status_visible: true,
              header_status_mode: normalizeHeaderStatusMode(value),
            });
          }}
        >
          <SelectItem value={HIDDEN_HEADER_STATUS_VALUE}>{t("headerStatus.hidden")}</SelectItem>
          {HEADER_STATUS_MODES.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {t(`headerStatus.${mode}`)}
            </SelectItem>
          ))}
        </SettingSelect>
      </SettingSection>

      <SettingSection contentClassName="space-y-4">
        <SettingRow label={t("settings.startupRestore")} desc={t("settings.startupRestoreDesc")}>
          <SettingSwitch
            checked={appSettings.general.startup_restore}
            onChange={(v) =>
              updateAppSettings({ general: { ...appSettings.general, startup_restore: v } })
            }
          />
        </SettingRow>

        {appSettings.general.startup_restore && (
          <div className="border-l pl-4 ml-1" style={{ borderColor: "var(--df-border)" }}>
            <SettingRow
              label={t("settings.startupRestoreWindowLayout")}
              desc={t("settings.startupRestoreWindowLayoutDesc")}
            >
              <SettingSwitch
                checked={appSettings.general.startup_restore_window_layout !== false}
                onChange={(v) =>
                  updateAppSettings({
                    general: { ...appSettings.general, startup_restore_window_layout: v },
                  })
                }
              />
            </SettingRow>
          </div>
        )}

        <SettingRow label={t("settings.minimizeToTray")} desc={t("settings.minimizeToTrayDesc")}>
          <SettingSwitch
            disabled={!supports("tray")}
            checked={appSettings.general.minimize_to_tray}
            onChange={(v) =>
              updateAppSettings({ general: { ...appSettings.general, minimize_to_tray: v } })
            }
          />
        </SettingRow>

        <SettingRow label={t("settings.confirmOnClose")} desc={t("settings.confirmOnCloseDesc")}>
          <SettingSwitch
            checked={appSettings.general.confirm_on_close}
            onChange={(v) =>
              updateAppSettings({ general: { ...appSettings.general, confirm_on_close: v } })
            }
          />
        </SettingRow>

        <SettingRow
          label={t("settings.backgroundAutoDownload")}
          desc={t("settings.backgroundAutoDownloadDesc")}
        >
          <SettingSwitch
            disabled={!supports("updater")}
            checked={appSettings.general.background_auto_download ?? false}
            onChange={(v) =>
              updateAppSettings({
                general: { ...appSettings.general, background_auto_download: v },
              })
            }
          />
        </SettingRow>

        <SettingRow
          label={t("settings.easterEggsEnabled")}
          desc={t("settings.easterEggsEnabledDesc")}
        >
          <SettingSwitch
            checked={appSettings.general.easter_eggs_enabled !== false}
            onChange={(v) =>
              updateAppSettings({ general: { ...appSettings.general, easter_eggs_enabled: v } })
            }
          />
        </SettingRow>

        {freezeDemoBound && appSettings.general.easter_eggs_enabled !== false && (
          <div className="border-l pl-4 ml-1" style={{ borderColor: "var(--df-border)" }}>
            <SettingNumberInput
              label={t("settings.freezeDemoDuration")}
              desc={t("settings.freezeDemoDurationDesc")}
              value={appSettings.general.freeze_demo_ms ?? 3000}
              min={500}
              max={30000}
              step={500}
              onChange={(v) =>
                updateAppSettings({ general: { ...appSettings.general, freeze_demo_ms: v } })
              }
            />
          </div>
        )}
      </SettingSection>

      <SettingSection
        title={t("settings.diagnostics")}
        desc={t("settings.diagnosticsDesc")}
        contentClassName="space-y-4"
      >
        <SettingFieldGrid>
          <SettingSelect
            label={t("settings.logLevel")}
            desc={t("settings.logLevelDesc")}
            value={appSettings.diagnostics.level}
            onValueChange={(level) =>
              updateAppSettings({
                diagnostics: {
                  ...appSettings.diagnostics,
                  level: level as typeof appSettings.diagnostics.level,
                },
              })
            }
          >
            <SelectItem value="warn">{t("settings.logLevelWarn")}</SelectItem>
            <SelectItem value="info">{t("settings.logLevelInfo")}</SelectItem>
            <SelectItem value="debug">{t("settings.logLevelDebug")}</SelectItem>
          </SettingSelect>

          <SettingSelect
            label={t("settings.logRetention")}
            desc={t("settings.logRetentionDesc")}
            value={String(appSettings.diagnostics.retention_days)}
            onValueChange={(retentionDays) =>
              updateAppSettings({
                diagnostics: {
                  ...appSettings.diagnostics,
                  retention_days: Number(retentionDays),
                },
              })
            }
          >
            {[3, 7, 14, 30].map((days) => (
              <SelectItem key={days} value={String(days)}>
                {days} {t("common.days")}
              </SelectItem>
            ))}
          </SettingSelect>
        </SettingFieldGrid>

        {runtime === "desktop" && (
          <SettingRow label={t("settings.openLogs")} desc={t("settings.openLogsDesc")}>
            <Button variant="outline" size="sm" onClick={handleOpenLogs}>
              {t("settings.openLogs")}
            </Button>
          </SettingRow>
        )}

        <SettingRow
          label={t("settings.exportDiagnostics")}
          desc={t("settings.exportDiagnosticsDesc")}
        >
          <Button size="sm" disabled={transferBusy} onClick={handleExportDiagnostics}>
            {t("settings.exportDiagnostics")}
          </Button>
        </SettingRow>
      </SettingSection>
    </div>
  );
}
