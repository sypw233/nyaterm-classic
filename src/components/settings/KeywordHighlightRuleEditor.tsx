import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MdAdd, MdDelete, MdExpandLess, MdExpandMore, MdFileUpload } from "react-icons/md";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { KeywordHighlightImportDialog } from "@/components/dialog/terminal/KeywordHighlightImportDialog";
import type { KeywordHighlightRule } from "@/types/global";

interface KeywordHighlightRuleEditorProps {
  rules: KeywordHighlightRule[];
  onChange: (rules: KeywordHighlightRule[]) => void;
  /** Dims the list while highlighting itself is off. */
  disabled?: boolean;
  /** Whether the terminal background is dark, for the swatch preview. */
  isDark: boolean;
  /** Ring colour matching the surface behind the swatches. */
  ringClass: string;
  /** Hide the import button where importing makes no sense. */
  allowImport?: boolean;
}

/**
 * Add, edit and delete custom keyword-highlight rules.
 *
 * Shared by the global terminal settings and the per-connection override panel,
 * so a connection's rule snapshot can be edited in place instead of only being
 * viewed. The two callers own the storage; this component only edits the array
 * it is given.
 */
export function KeywordHighlightRuleEditor({
  rules,
  onChange,
  disabled = false,
  isDark,
  ringClass,
  allowImport = true,
}: KeywordHighlightRuleEditorProps) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);

  const addRule = () => {
    const id = `kh-${Date.now()}`;
    const next: KeywordHighlightRule = {
      id,
      name: t("settings.keywordHighlightNewRule"),
      patterns: [],
      color_dark: "#79c0ff",
      color_light: "#0969da",
      enabled: true,
    };
    onChange([...rules, next]);
    setExpandedId(id);
  };

  const deleteRule = (id: string) => {
    onChange(rules.filter((rule) => rule.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const patchRule = (id: string, patch: Partial<KeywordHighlightRule>) => {
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };

  return (
    <>
      <div className={`space-y-3 transition-opacity ${disabled ? "pointer-events-none opacity-50" : ""}`}>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{t("settings.keywordHighlightRules")}</Label>
          <div className="flex items-center gap-1">
            {allowImport ? (
              <Button
                variant="ghost"
                size="xs"
                className="text-primary"
                onClick={() => setShowImportDialog(true)}
              >
                <MdFileUpload className="text-[0.875rem]" />
                {t("settings.keywordHighlightImport")}
              </Button>
            ) : null}
            <Button variant="ghost" size="xs" className="text-primary" onClick={addRule}>
              <MdAdd className="text-[0.875rem]" />
              {t("common.add")}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {rules.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-4 py-8 text-center text-sm text-muted-foreground">
              {t("settings.keywordHighlightNoRules")}
            </div>
          )}

          {rules.map((rule) => {
            const isOpen = expandedId === rule.id;
            const patternCount = rule.patterns.filter((pattern) => pattern.trim()).length;

            return (
              <div
                key={rule.id}
                className="overflow-hidden rounded-xl border border-border/70 bg-background/75"
              >
                <div
                  className="cursor-pointer select-none px-4 py-3 transition-colors hover:bg-accent/40"
                  onClick={() => setExpandedId(isOpen ? null : rule.id)}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className={`h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ${ringClass}`}
                        style={{ backgroundColor: isDark ? rule.color_dark : rule.color_light }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {rule.name}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t("settings.keywordHighlightPatternCount", { count: patternCount })}
                      </span>

                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(value) => patchRule(rule.id, { enabled: value })}
                        onClick={(event) => event.stopPropagation()}
                      />

                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-destructive hover:bg-destructive/10"
                        title={t("common.delete")}
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteRule(rule.id);
                        }}
                      >
                        <MdDelete className="text-[1rem]" />
                      </Button>

                      {isOpen ? (
                        <MdExpandLess className="shrink-0 text-base text-muted-foreground" />
                      ) : (
                        <MdExpandMore className="shrink-0 text-base text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div
                    className="space-y-4 border-t border-border/70 bg-accent/15 px-4 pb-4 pt-3"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
                      <div className="min-w-0 flex-1 space-y-2 xl:max-w-[16rem]">
                        <Label className="text-xs text-muted-foreground">
                          {t("settings.keywordHighlightRuleName")}
                        </Label>
                        <Input
                          className="h-8 text-sm"
                          value={rule.name}
                          placeholder={t("settings.keywordHighlightRuleNamePlaceholder")}
                          onChange={(event) => patchRule(rule.id, { name: event.target.value })}
                        />
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:flex">
                        {[
                          {
                            field: "color_dark" as const,
                            labelKey: "keywordHighlightDarkPalette",
                            swatchRing: "ring-white/20",
                          },
                          {
                            field: "color_light" as const,
                            labelKey: "keywordHighlightLightPalette",
                            swatchRing: "ring-black/20",
                          },
                        ].map(({ field, labelKey, swatchRing }) => (
                          <div key={field} className="min-w-0 space-y-2">
                            <Label className="block text-xs text-muted-foreground">
                              {t(`settings.${labelKey}`)}
                            </Label>
                            <div className="flex items-center gap-2">
                              <div
                                className={`relative h-8 w-8 shrink-0 overflow-hidden rounded-md border ring-1 ring-inset ${swatchRing}`}
                                style={{ backgroundColor: rule[field] }}
                              >
                                <input
                                  type="color"
                                  className="absolute inset-[-10px] h-[200%] w-[200%] cursor-pointer opacity-0"
                                  value={
                                    rule[field] && rule[field].length === 7
                                      ? rule[field]
                                      : "#000000"
                                  }
                                  onChange={(event) =>
                                    patchRule(rule.id, { [field]: event.target.value })
                                  }
                                />
                              </div>
                              <Input
                                className="h-8 w-full font-mono text-xs sm:w-[7.5rem]"
                                value={rule[field]}
                                maxLength={7}
                                placeholder="#rrggbb"
                                onChange={(event) => {
                                  const value = event.target.value;
                                  if (/^#[0-9a-fA-F]{0,6}$/.test(value)) {
                                    patchRule(rule.id, { [field]: value });
                                  }
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        {t("settings.keywordHighlightRulePatterns")}
                      </Label>
                      <Textarea
                        className="min-h-[80px] max-h-[160px] resize-y overflow-y-auto font-mono text-sm"
                        value={rule.patterns.join("\n")}
                        placeholder={t("settings.keywordHighlightRulePatternsPlaceholder")}
                        onChange={(event) =>
                          patchRule(rule.id, { patterns: event.target.value.split("\n") })
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {allowImport ? (
        <KeywordHighlightImportDialog
          open={showImportDialog}
          onClose={() => setShowImportDialog(false)}
          onImportedRules={onChange}
        />
      ) : null}
    </>
  );
}
