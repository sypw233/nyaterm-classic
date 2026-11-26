import type { AiCaptureEvent } from "@/types/global";
import { normalizeTerminalOutput } from "./terminalRowNormalizer";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ACCENT = "\x1b[38;5;141m"; // purple/violet frame
const LABEL = "\x1b[38;5;110m"; // sky blue section labels
const GREEN = "\x1b[38;5;78m";
const RED = "\x1b[38;5;203m";
const YELLOW = "\x1b[38;5;214m";

const RULE_WIDTH = 36;
/** Wrap output lines wider than this so they never overrun the │ rail. */
const MAX_OUTPUT_WIDTH = 100;

function sanitizeCommandForTerminal(command: string): string {
  return command
    .replace(/\r\n|\r|\n/gu, " ; ")
    .replace(/\x1b/gu, "^[")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, " ");
}

/**
 * Normalize one captured output line for display inside the │ rail.
 *
 * Windows tools such as Get-ComputerInfo redraw progress in place with bare
 * `\r` (no `\n`). Splitting on `\r` would show every intermediate fragment;
 * `normalizeTerminalOutput` instead emulates a terminal row so only the final
 * rendering is kept. Long lines are wrapped so the closing box stays aligned.
 *
 * Internal capture markers can leak into the output when ConPTY wraps or
 * splits them; strip those before display.
 */
function normalizeOutputLines(output: string): string[] {
  const result: string[] = [];
  for (const segment of normalizeTerminalOutput(output)) {
    const clean = segment
      .replace(/__NT_[SE]_[A-Za-z0-9_-]+__[A-Za-z0-9]*/gu, "")
      .replace(/__DF_CMD_(?:START|END)_[A-Za-z0-9_-]+(?:_-?\d+)?__[A-Za-z0-9]*/gu, "")
      .replace(/\x1b/gu, "^[")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, "")
      .trimEnd();
    if (clean.trim().length === 0) continue;
    // Wrap wide lines on character boundaries so the rail stays aligned.
    for (let start = 0; start < clean.length; start += MAX_OUTPUT_WIDTH) {
      result.push(clean.slice(start, start + MAX_OUTPUT_WIDTH));
    }
  }
  return result;
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
    // Ensure the frame never starts on an unterminated prompt line.
    "",
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

  // Backend truncates by \n lines; normalize here too (handles \r progress).
  const lines = event.output ? normalizeOutputLines(event.output) : [];
  if (lines.length === 0) {
    parts.push(`${rail}   ${DIM}(no output)${RESET}`);
  } else {
    for (const line of lines) {
      parts.push(`${rail}   ${DIM}${line}${RESET}`);
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
