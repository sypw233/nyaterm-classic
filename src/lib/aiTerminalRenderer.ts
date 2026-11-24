import type { AiCaptureEvent } from "@/types/global";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ACCENT = "\x1b[38;5;141m"; // purple/violet frame
const LABEL = "\x1b[38;5;110m"; // sky blue section labels
const GREEN = "\x1b[38;5;78m";
const RED = "\x1b[38;5;203m";
const YELLOW = "\x1b[38;5;214m";

const RULE_WIDTH = 36;

function sanitizeCommandForTerminal(command: string): string {
  return command
    .replace(/\r\n|\r|\n/gu, " ; ")
    .replace(/\x1b/gu, "^[")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, " ");
}

function sanitizeOutputLine(line: string): string {
  return line
    .replace(/\r/gu, "")
    .replace(/\x1b/gu, "^[")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, " ");
}

function rule(label: string): string {
  const fill = Math.max(2, RULE_WIDTH - label.length - 2);
  return `${DIM}${ACCENT}${"─".repeat(fill)}${RESET}`;
}

const rail = `${DIM}${ACCENT}│${RESET}`;

/**
 * Open a clearly-labelled command block. The command itself is written inside
 * the block as INPUT, so input and output read top-to-bottom in one frame
 * instead of the command floating above an unlabelled box.
 */
export function renderAiCommandStart(
  event: Extract<AiCaptureEvent, { type: "commandStart" }>,
): string {
  const step = event.stepIndex + 1;
  const command = sanitizeCommandForTerminal(event.command);
  const source = event.source === "MCP" ? "MCP" : "AI";
  const title = `${source} #${step}`;

  return [
    `${DIM}${ACCENT}┌─ ${title} ${rule(title)}${RESET}`,
    `${rail} ${LABEL}INPUT${RESET}`,
    `${rail}   ${BOLD}$ ${command}${RESET}`,
  ].join("\r\n") + "\r\n";
}

/** Append the captured OUTPUT section and a status footer to the open block. */
export function renderAiCommandEnd(event: Extract<AiCaptureEvent, { type: "commandEnd" }>): string {
  const parts: string[] = [
    `${DIM}${ACCENT}├─ ${LABEL}OUTPUT${RESET} ${rule("OUTPUT")}${RESET}`,
  ];

  const lines = event.output ? event.output.split("\n") : [];
  if (lines.length === 0) {
    parts.push(`${rail}   ${DIM}(no output)${RESET}`);
  } else {
    for (const line of lines) {
      parts.push(`${rail}   ${DIM}${sanitizeOutputLine(line)}${RESET}`);
    }
    if (event.truncated) {
      parts.push(`${rail}   ${YELLOW}… output truncated${RESET}`);
    }
  }

  const exitCode = event.exitCode;
  const ok = exitCode === 0;
  const statusColor = ok ? GREEN : exitCode != null ? RED : DIM;
  const statusText =
    ok ? "✓ success" : exitCode != null ? `✗ exit ${exitCode}` : "? no exit code";
  const duration =
    event.durationMs >= 1000
      ? `${(event.durationMs / 1000).toFixed(1)}s`
      : `${event.durationMs}ms`;
  parts.push(
    `${DIM}${ACCENT}└─${RESET} ${statusColor}${statusText}${RESET}${DIM} · ${duration} ${"─".repeat(8)}${RESET}`,
  );

  return `${parts.join("\r\n")}\r\n`;
}
