import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { OverrideField, OverrideGroupHeader } from "./ConnectionOverrideField";
import { applyOverrideFieldToggle } from "./connectionOverrideToggle";
import { KeywordHighlightRuleEditor } from "@/components/settings/KeywordHighlightRuleEditor";
import {
  SettingNumberInput,
  SettingSection,
  SettingSelect,
} from "@/components/settings/SettingFormItems";
import { useApp } from "@/context/AppContext";
import { useTheme } from "@/context/ThemeContext";
import { getBuiltinRules, hexLuminance } from "@/lib/keywordHighlightPresets";
import type { ConnectionOverrides, SshKeepAliveMode } from "@/types/global";

const KEEP_ALIVE_MODES: SshKeepAliveMode[] = ["compatible", "strict", "disabled"];
const KEEP_ALIVE_MODE_KEYS: Record<SshKeepAliveMode, string> = {
  compatible: "settings.keepAliveModeCompatible",
  strict: "settings.keepAliveModeStrict",
  disabled: "settings.keepAliveModeDisabled",
};

function keepAliveModeLabel(
  mode: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const key = KEEP_ALIVE_MODE_KEYS[mode as SshKeepAliveMode];
  return key ? t(key) : mode;
}
const BACKGROUND_RENDER_POLICIES = ["none", "cap", "pause"] as const;

type Overrides = ConnectionOverrides;

interface ConnectionOverrideSettingsProps {
  value: Overrides;
  onChange: (next: Overrides) => void;
  /**
   * Whether to show the keep-alive fields. They only exist for SSH, so a
   * Telnet/serial/local connection must not be offered a setting that its
   * transport ignores.
   */
  showConnectionSettings?: boolean;
}

/**
 * Terminal appearance and performance settings that a single connection may
 * override.
 *
 * Every control is expressed as "follow global / customize". Turning a control
 * back to "follow global" deletes its key rather than writing the current global
 * value, so the connection keeps tracking future global changes.
 */
export function ConnectionOverrideSettings({
  value,
  onChange,
  showConnectionSettings = true,
}: ConnectionOverrideSettingsProps) {
  const { t } = useTranslation();
  const { appSettings } = useApp();
  const { terminalTheme } = useTheme();

  const appearance = appSettings.appearance;
  const terminal = appSettings.terminal;

  // Keyword rule swatches show the colour that will actually be used, so they
  // need the same light/dark decision the highlighter makes.
  const isDark = useMemo(
    () => hexLuminance(terminalTheme.colors.terminal.background) < 0.5,
    [terminalTheme.colors.terminal.background],
  );
  const ringClass = isDark ? "ring-white/20" : "ring-black/20";
  const builtinRules = useMemo(() => getBuiltinRules(isDark), [isDark]);

  const setField = <K extends keyof Overrides>(field: K, next: Overrides[K]) => {
    onChange({ ...value, [field]: next });
  };
  // Both directions go through the helper so the "delete, never freeze" rule
  // lives in one place instead of being restated at every field.
  const enableField = <K extends keyof Overrides>(field: K, globalValue: Overrides[K]) => {
    onChange(applyOverrideFieldToggle(value, field, true, globalValue));
  };
  const clearField = (field: keyof Overrides) => {
    onChange(applyOverrideFieldToggle(value, field, false, undefined));
  };
  const clearAll = () => onChange({});

  const customizedCount = useMemo(
    () => Object.values(value).filter((entry) => entry !== undefined).length,
    [value],
  );

  const fontSummary = t("connectionOverrides.fontSummary", {
    family: appearance.font_family,
    size: appearance.font_size,
  });

  const keepAliveSummary = t("connectionOverrides.keepAliveSummary", {
    mode: keepAliveModeLabel(terminal.keep_alive_mode, t),
    interval: terminal.keep_alive_interval,
  });

  return (
    <div className="space-y-3">
      <OverrideGroupHeader
        title={t("connectionOverrides.title")}
        desc={t("connectionOverrides.desc")}
        overriddenCount={customizedCount}
        onResetAll={clearAll}
      />

      <SettingSection
        title={t("connectionOverrides.appearanceSection")}
        desc={t("connectionOverrides.appearanceSectionDesc")}
        contentClassName="space-y-3"
      >
        <OverrideField
          field="font_family"
          label={t("settings.fontFamily")}
          overridden={value.font_family !== undefined}
          globalSummary={appearance.font_family}
          onEnable={() => enableField("font_family", appearance.font_family)}
          onDisable={() => clearField("font_family")}
        >
          <Input
            className="h-8 max-w-md text-xs"
            value={value.font_family ?? appearance.font_family}
            onChange={(event) => setField("font_family", event.target.value)}
          />
        </OverrideField>

        <OverrideField
          field="font_size"
          label={t("settings.fontSize")}
          overridden={value.font_size !== undefined}
          globalSummary={`${appearance.font_size} px`}
          onEnable={() => enableField("font_size", appearance.font_size)}
          onDisable={() => clearField("font_size")}
        >
          <SettingNumberInput
            label={t("settings.fontSize")}
            value={value.font_size ?? appearance.font_size}
            min={6}
            max={72}
            step={1}
            onChange={(next) => setField("font_size", next)}
            fieldClassName="max-w-md"
          />
        </OverrideField>

        <OverrideField
          field="cursor_style"
          label={t("settings.cursorStyle")}
          overridden={value.cursor_style !== undefined}
          globalSummary={appearance.cursor_style}
          onEnable={() => enableField("cursor_style", appearance.cursor_style)}
          onDisable={() => clearField("cursor_style")}
        >
          <SettingSelect
            label={t("settings.cursorStyle")}
            value={value.cursor_style ?? appearance.cursor_style}
            onValueChange={(next) => setField("cursor_style", next)}
          >
            <SelectItem value="block">{t("settings.cursorBlock")}</SelectItem>
            <SelectItem value="underline">{t("settings.cursorUnderline")}</SelectItem>
            <SelectItem value="bar">{t("settings.cursorBar")}</SelectItem>
          </SettingSelect>
        </OverrideField>

        <OverrideField
          field="cursor_blink"
          label={t("settings.cursorBlink")}
          overridden={value.cursor_blink !== undefined}
          globalSummary={
            appearance.cursor_blink ? t("connectionOverrides.stateOn") : t("connectionOverrides.stateOff")
          }
          onEnable={() => enableField("cursor_blink", appearance.cursor_blink)}
          onDisable={() => clearField("cursor_blink")}
        >
          <Switch
            checked={value.cursor_blink ?? appearance.cursor_blink}
            onCheckedChange={(next) => setField("cursor_blink", next)}
          />
        </OverrideField>

        <OverrideField
          field="minimum_contrast_ratio"
          label={t("settings.minimumContrastRatio")}
          overridden={value.minimum_contrast_ratio !== undefined}
          globalSummary={String(appearance.minimum_contrast_ratio)}
          onEnable={() =>
            setField("minimum_contrast_ratio", appearance.minimum_contrast_ratio)
          }
          onDisable={() => clearField("minimum_contrast_ratio")}
        >
          <SettingNumberInput
            label={t("settings.minimumContrastRatio")}
            value={value.minimum_contrast_ratio ?? appearance.minimum_contrast_ratio}
            min={1}
            max={21}
            step={0.5}
            onChange={(next) => setField("minimum_contrast_ratio", next)}
            fieldClassName="max-w-md"
          />
        </OverrideField>

        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
          {t("connectionOverrides.appearanceNote", { summary: fontSummary })}
        </p>
      </SettingSection>

      <SettingSection
        title={t("connectionOverrides.behaviourSection")}
        desc={t("connectionOverrides.behaviourSectionDesc")}
        contentClassName="space-y-3"
      >
        <OverrideField
          field="scrollback_lines"
          label={t("settings.scrollbackLines")}
          overridden={value.scrollback_lines !== undefined}
          globalSummary={String(terminal.scrollback_lines)}
          onEnable={() => enableField("scrollback_lines", terminal.scrollback_lines)}
          onDisable={() => clearField("scrollback_lines")}
        >
          <SettingNumberInput
            label={t("settings.scrollbackLines")}
            value={value.scrollback_lines ?? terminal.scrollback_lines}
            min={100}
            max={100000}
            step={100}
            onChange={(next) => setField("scrollback_lines", next)}
            fieldClassName="max-w-md"
          />
        </OverrideField>

        <OverrideField
          field="keyword_highlights_enabled"
          label={t("settings.keywordHighlightingExperimental")}
          overridden={value.keyword_highlights_enabled !== undefined}
          globalSummary={
            terminal.keyword_highlights_enabled ? t("connectionOverrides.stateOn") : t("connectionOverrides.stateOff")
          }
          onEnable={() =>
            setField("keyword_highlights_enabled", terminal.keyword_highlights_enabled)
          }
          onDisable={() => clearField("keyword_highlights_enabled")}
        >
          <Switch
            checked={value.keyword_highlights_enabled ?? terminal.keyword_highlights_enabled}
            onCheckedChange={(next) => setField("keyword_highlights_enabled", next)}
          />
        </OverrideField>

        <OverrideField
          field="keyword_highlight_builtin_rules"
          label={t("settings.keywordHighlightBuiltinRules")}
          desc={t("settings.keywordHighlightBuiltinNote")}
          overridden={value.keyword_highlight_builtin_rules !== undefined}
          globalSummary={t("connectionOverrides.builtinRuleCount", {
            count: Object.values(terminal.keyword_highlight_builtin_rules ?? {}).filter(
              (enabled) => enabled,
            ).length,
          })}
          onEnable={() =>
            setField(
              "keyword_highlight_builtin_rules",
              terminal.keyword_highlight_builtin_rules ?? {},
            )
          }
          onDisable={() => clearField("keyword_highlight_builtin_rules")}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {builtinRules.map((rule) => {
              const settings =
                value.keyword_highlight_builtin_rules ??
                terminal.keyword_highlight_builtin_rules ??
                {};
              return (
                <div
                  key={rule.id}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ${ringClass}`}
                      style={{ backgroundColor: rule.color }}
                    />
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {rule.name}
                    </span>
                  </div>
                  <Switch
                    checked={settings[rule.id] ?? true}
                    onCheckedChange={(enabled) =>
                      setField("keyword_highlight_builtin_rules", {
                        ...settings,
                        [rule.id]: enabled,
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
        </OverrideField>

        <OverrideField
          field="keyword_highlights"
          label={t("settings.keywordHighlightRules")}
          desc={t("connectionOverrides.keywordRulesDesc")}
          overridden={value.keyword_highlights !== undefined}
          globalSummary={t("connectionOverrides.ruleCount", {
            count: terminal.keyword_highlights.length,
          })}
          onEnable={() => enableField("keyword_highlights", terminal.keyword_highlights)}
          onDisable={() => clearField("keyword_highlights")}
        >
          <div className="space-y-3">
            <p className="text-[0.6875rem] leading-relaxed text-amber-600 dark:text-amber-500">
              {t("connectionOverrides.keywordRulesSnapshotWarning")}
            </p>
            <KeywordHighlightRuleEditor
              rules={value.keyword_highlights ?? terminal.keyword_highlights}
              onChange={(rules) => setField("keyword_highlights", rules)}
              isDark={isDark}
              ringClass={ringClass}
            />
          </div>
        </OverrideField>

        <OverrideField
          field="action_links_enabled"
          label={t("settings.actionLinks")}
          overridden={value.action_links_enabled !== undefined}
          globalSummary={
            terminal.action_links_enabled ? t("connectionOverrides.stateOn") : t("connectionOverrides.stateOff")
          }
          onEnable={() => enableField("action_links_enabled", terminal.action_links_enabled)}
          onDisable={() => clearField("action_links_enabled")}
        >
          <Switch
            checked={value.action_links_enabled ?? terminal.action_links_enabled}
            onCheckedChange={(next) => setField("action_links_enabled", next)}
          />
        </OverrideField>

        <OverrideField
          field="show_line_numbers"
          label={t("settings.showLineNumbers")}
          overridden={value.show_line_numbers !== undefined}
          globalSummary={terminal.show_line_numbers ? t("connectionOverrides.stateOn") : t("connectionOverrides.stateOff")}
          onEnable={() => enableField("show_line_numbers", terminal.show_line_numbers)}
          onDisable={() => clearField("show_line_numbers")}
        >
          <Switch
            checked={value.show_line_numbers ?? terminal.show_line_numbers}
            onCheckedChange={(next) => setField("show_line_numbers", next)}
          />
        </OverrideField>

        <OverrideField
          field="show_timestamps"
          label={t("settings.showTimestamps")}
          overridden={value.show_timestamps !== undefined}
          globalSummary={terminal.show_timestamps ? t("connectionOverrides.stateOn") : t("connectionOverrides.stateOff")}
          onEnable={() => enableField("show_timestamps", terminal.show_timestamps)}
          onDisable={() => clearField("show_timestamps")}
        >
          <Switch
            checked={value.show_timestamps ?? terminal.show_timestamps}
            onCheckedChange={(next) => setField("show_timestamps", next)}
          />
        </OverrideField>
      </SettingSection>

      <SettingSection
        title={t("connectionOverrides.performanceSection")}
        desc={t("connectionOverrides.performanceSectionDesc")}
        contentClassName="space-y-3"
      >
        <OverrideField
          field="hardware_acceleration"
          label={t("settings.hardwareAcceleration")}
          desc={t("connectionOverrides.hardwareAccelerationDesc")}
          overridden={value.hardware_acceleration !== undefined}
          globalSummary={
            terminal.hardware_acceleration ? t("connectionOverrides.stateOn") : t("connectionOverrides.stateOff")
          }
          onEnable={() => enableField("hardware_acceleration", terminal.hardware_acceleration)}
          onDisable={() => clearField("hardware_acceleration")}
        >
          <Switch
            checked={value.hardware_acceleration ?? terminal.hardware_acceleration}
            onCheckedChange={(next) => setField("hardware_acceleration", next)}
          />
        </OverrideField>

        <OverrideField
          field="frame_batched_output"
          label={t("settings.frameBatchedOutput")}
          overridden={value.frame_batched_output !== undefined}
          globalSummary={
            terminal.frame_batched_output ? t("connectionOverrides.stateOn") : t("connectionOverrides.stateOff")
          }
          onEnable={() => enableField("frame_batched_output", terminal.frame_batched_output)}
          onDisable={() => clearField("frame_batched_output")}
        >
          <Switch
            checked={value.frame_batched_output ?? terminal.frame_batched_output}
            onCheckedChange={(next) => setField("frame_batched_output", next)}
          />
        </OverrideField>

        <OverrideField
          field="render_frame_limit_enabled"
          label={t("settings.renderFrameLimit")}
          overridden={value.render_frame_limit_enabled !== undefined}
          globalSummary={
            terminal.render_frame_limit_enabled ? t("connectionOverrides.stateOn") : t("connectionOverrides.stateOff")
          }
          onEnable={() =>
            setField("render_frame_limit_enabled", terminal.render_frame_limit_enabled)
          }
          onDisable={() => clearField("render_frame_limit_enabled")}
        >
          <div className="flex items-center gap-3">
            <Switch
              checked={
                value.render_frame_limit_enabled ?? terminal.render_frame_limit_enabled
              }
              onCheckedChange={(next) => setField("render_frame_limit_enabled", next)}
            />
            <SettingNumberInput
              label={t("settings.renderMaxFps")}
              value={value.render_max_fps ?? terminal.render_max_fps ?? 30}
              min={1}
              max={60}
              step={1}
              onChange={(next) => setField("render_max_fps", next)}
              fieldClassName="max-w-[12rem]"
            />
          </div>
        </OverrideField>

        <OverrideField
          field="background_render_policy"
          label={t("settings.backgroundRenderPolicy")}
          overridden={value.background_render_policy !== undefined}
          globalSummary={terminal.background_render_policy ?? "none"}
          onEnable={() =>
            setField("background_render_policy", terminal.background_render_policy ?? "none")
          }
          onDisable={() => clearField("background_render_policy")}
        >
          <SettingSelect
            label={t("settings.backgroundRenderPolicy")}
            value={
              value.background_render_policy ?? terminal.background_render_policy ?? "none"
            }
            onValueChange={(next) =>
              setField(
                "background_render_policy",
                next as (typeof BACKGROUND_RENDER_POLICIES)[number],
              )
            }
          >
            <SelectItem value="none">{t("settings.backgroundRenderNone")}</SelectItem>
            <SelectItem value="cap">{t("settings.backgroundRenderCap")}</SelectItem>
            <SelectItem value="pause">{t("settings.backgroundRenderPause")}</SelectItem>
          </SettingSelect>
        </OverrideField>

        <OverrideField
          field="tui_frame_limit_enabled"
          label={t("settings.tuiFrameLimit")}
          overridden={value.tui_frame_limit_enabled !== undefined}
          globalSummary={
            terminal.tui_frame_limit_enabled ? t("connectionOverrides.stateOn") : t("connectionOverrides.stateOff")
          }
          onEnable={() =>
            setField("tui_frame_limit_enabled", terminal.tui_frame_limit_enabled)
          }
          onDisable={() => clearField("tui_frame_limit_enabled")}
        >
          <Switch
            checked={value.tui_frame_limit_enabled ?? terminal.tui_frame_limit_enabled}
            onCheckedChange={(next) => setField("tui_frame_limit_enabled", next)}
          />
        </OverrideField>
      </SettingSection>

      {showConnectionSettings ? (
      <SettingSection
        title={t("connectionOverrides.connectionSection")}
        desc={t("connectionOverrides.connectionSectionDesc")}
        contentClassName="space-y-3"
      >
        <OverrideField
          field="keep_alive_mode"
          label={t("settings.keepAliveMode")}
          desc={t("connectionOverrides.keepAliveNote", { summary: keepAliveSummary })}
          overridden={value.keep_alive_mode !== undefined}
          globalSummary={terminal.keep_alive_mode}
          onEnable={() => enableField("keep_alive_mode", terminal.keep_alive_mode)}
          onDisable={() => clearField("keep_alive_mode")}
        >
          <SettingSelect
            label={t("settings.keepAliveMode")}
            value={value.keep_alive_mode ?? terminal.keep_alive_mode}
            onValueChange={(next) => setField("keep_alive_mode", next as SshKeepAliveMode)}
          >
            {KEEP_ALIVE_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {keepAliveModeLabel(mode, t)}
              </SelectItem>
            ))}
          </SettingSelect>
        </OverrideField>

        <OverrideField
          field="keep_alive_interval"
          label={t("settings.keepAliveInterval")}
          overridden={value.keep_alive_interval !== undefined}
          globalSummary={`${terminal.keep_alive_interval}s`}
          onEnable={() => enableField("keep_alive_interval", terminal.keep_alive_interval)}
          onDisable={() => clearField("keep_alive_interval")}
        >
          <SettingNumberInput
            label={t("settings.keepAliveInterval")}
            value={value.keep_alive_interval ?? terminal.keep_alive_interval}
            min={0}
            max={3600}
            step={5}
            onChange={(next) => setField("keep_alive_interval", next)}
            fieldClassName="max-w-md"
          />
        </OverrideField>
      </SettingSection>
      ) : null}

      <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
        {t("connectionOverrides.notOverridableNote")}
      </p>
    </div>
  );
}

/** Small summary line for the connection editor footer / tooltips. */
export function summarizeOverrides(
  value: Overrides,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const fields = Object.entries(value).filter(([, entry]) => entry !== undefined);
  if (fields.length === 0) return null;
  return t("connectionOverrides.footerSummary", { count: fields.length });
}
