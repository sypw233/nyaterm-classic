import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ROW_BYTES = 16;
const ROW_HEIGHT = 20;

interface HexViewerProps {
  bytes: Uint8Array;
  /** Full file size, used to warn when the view is truncated. */
  totalSize?: number;
  /** Offset of the first displayed byte within the file. */
  baseOffset?: number;
}

function formatOffset(value: number, width: number) {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

function formatByte(value: number) {
  return value.toString(16).toUpperCase().padStart(2, "0");
}

function asciiFor(value: number) {
  return value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : ".";
}

/** Read-only virtualized hexadecimal viewer for file bytes. */
export function HexViewer({
  bytes,
  totalSize,
  baseOffset = 0,
}: HexViewerProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState("");
  const rowCount = Math.ceil(bytes.length / ROW_BYTES);
  const offsetWidth = Math.max(
    6,
    formatOffset(baseOffset + bytes.length, 8).length,
  );

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 24,
  });

  const truncated =
    typeof totalSize === "number" && totalSize > bytes.length + baseOffset;
  const rows = virtualizer.getVirtualItems();

  const jumpToOffset = () => {
    const cleaned = jump.trim().replace(/^0x/i, "");
    if (!/^[0-9a-f]+$/i.test(cleaned)) return;
    const target = Number.parseInt(cleaned, 16);
    if (!Number.isFinite(target)) return;
    const row = Math.floor((target - baseOffset) / ROW_BYTES);
    if (row >= 0 && row < rowCount) {
      virtualizer.scrollToIndex(row, { align: "start" });
    }
  };

  const rowData = useMemo(() => rows.map((row) => row.index), [rows]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-2 py-1.5">
        <span className="text-[11px] text-muted-foreground">
          {t("filePreview.hexOffset")}
        </span>
        <Input
          value={jump}
          onChange={(event) => setJump(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") jumpToOffset();
          }}
          placeholder="00000000"
          className="h-7 w-28 rounded-md font-mono text-xs"
          aria-label={t("filePreview.hexOffset")}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={jumpToOffset}
        >
          {t("filePreview.hexGo")}
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {t("filePreview.hexByteCount", { count: bytes.length })}
        </span>
        {truncated ? (
          <span className="text-[11px] text-destructive">
            {t("filePreview.hexTruncated")}
          </span>
        ) : null}
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-5"
        role="region"
        aria-label={t("filePreview.hexViewer")}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {rowData.map((rowIndex) => {
            const row = rows.find((item) => item.index === rowIndex);
            if (!row) return null;
            const start = rowIndex * ROW_BYTES;
            const slice = bytes.subarray(
              start,
              Math.min(start + ROW_BYTES, bytes.length),
            );
            const hexParts: string[] = [];
            let ascii = "";
            for (let i = 0; i < ROW_BYTES; i += 1) {
              const byte = slice[i];
              hexParts.push(byte === undefined ? "  " : formatByte(byte));
              ascii += byte === undefined ? " " : asciiFor(byte);
            }
            return (
              <div
                key={row.key}
                className="absolute left-0 top-0 flex w-full gap-3 whitespace-pre px-2 text-muted-foreground"
                style={{
                  height: `${ROW_HEIGHT}px`,
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <span className="shrink-0 text-muted-foreground/70">
                  {formatOffset(baseOffset + start, offsetWidth)}
                </span>
                <span className="shrink-0">{hexParts.join(" ")}</span>
                <span className="shrink-0 text-foreground/80">{ascii}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
