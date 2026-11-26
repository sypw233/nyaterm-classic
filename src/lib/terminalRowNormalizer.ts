/**
 * Normalize captured command output for plain-text display by emulating a
 * single editable terminal row.
 *
 * Windows tools such as Get-ComputerInfo redraw progress in place with bare
 * carriage returns instead of newlines. Splitting on `\r` shows every
 * intermediate fragment scattered across the output; a real terminal instead
 * moves the cursor to column zero and overwrites the row, leaving only the
 * final rendering visible. This module reproduces that behaviour.
 *
 * Ported from the 2.x `RecordingSanitizer` + `RecordingLineEditor` model.
 * Vertical cursor moves are intentionally ignored: a plain-text transcript
 * has no viewport, only the current row.
 */

const MAX_CURSOR_COLUMN = 64 * 1024;
const TAB_WIDTH = 8;

function clampColumn(value: number): number {
  return Math.max(0, Math.min(value, MAX_CURSOR_COLUMN));
}

function isControlCode(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * Normalize one physical line (no `\n`) into the text that would remain on a
 * terminal row after all in-place edits are applied.
 */
export function normalizeTerminalRow(raw: string): string {
  const cells: string[] = [];
  let cursor = 0;

  function write(text: string): void {
    for (const ch of text) {
      while (cells.length < cursor) cells.push(" ");
      cells[cursor] = ch;
      cursor = clampColumn(cursor + 1);
    }
  }

  function eraseFrom(start: number): void {
    for (let index = start; index < cells.length; index += 1) cells[index] = " ";
  }

  function eraseTo(end: number): void {
    for (let index = 0; index < Math.min(end, cells.length); index += 1) {
      cells[index] = " ";
    }
  }

  function applyCsi(final: string, params: string): void {
    // Private or malformed forms (e.g. CSI ?25l) are not safe row edits.
    if (/[?<> ]/.test(params)) return;
    const first = params.split(";", 1)[0] ?? "";
    const parsed = first === "" ? 0 : Number.parseInt(first, 10);
    if (!Number.isFinite(parsed)) return;
    const count = Math.min(parsed, MAX_CURSOR_COLUMN);
    switch (final) {
      case "D":
        cursor = clampColumn(cursor - Math.max(count, 1));
        break;
      case "C":
        cursor = clampColumn(cursor + Math.max(count, 1));
        break;
      case "G":
      case "`":
        cursor = clampColumn(Math.max(count, 1) - 1);
        break;
      case "K":
        if (count === 0) eraseFrom(cursor);
        else if (count === 1) eraseTo(cursor + 1);
        else if (count === 2) {
          cells.length = 0;
          cursor = 0;
        }
        break;
      case "P":
        cells.splice(cursor, Math.max(count, 1));
        break;
      case "@": {
        const blanks = " ".repeat(Math.max(count, 1)).split("");
        cells.splice(cursor, 0, ...blanks);
        cursor = clampColumn(cursor + blanks.length);
        break;
      }
      default:
        break;
    }
  }

  let index = 0;
  while (index < raw.length) {
    const code = raw.codePointAt(index) ?? 0;
    const ch = String.fromCodePoint(code);
    index += ch.length;

    if (code === 0x1b) {
      const next = raw[index];
      if (next === "[") {
        index += 1;
        let params = "";
        while (index < raw.length) {
          const byte = raw.charCodeAt(index);
          if (byte < 0x30 || byte > 0x3f) break;
          params += raw[index];
          index += 1;
        }
        const final = raw[index];
        if (final !== undefined) {
          const finalCode = final.charCodeAt(0);
          if (finalCode >= 0x40 && finalCode <= 0x7e) {
            index += 1;
            applyCsi(final, params);
          }
        }
      } else if (next === "]" || next === "P" || next === "X" || next === "^" || next === "_") {
        // OSC / DCS / SOS / PM / APC: skip the whole control string.
        index += 1;
        while (index < raw.length) {
          if (next === "]" && raw[index] === "\x07") {
            index += 1;
            break;
          }
          if (raw[index] === "\x1b" && raw[index + 1] === "\\") {
            index += 2;
            break;
          }
          index += 1;
        }
      } else if (next !== undefined) {
        index += 1;
      }
      continue;
    }

    if (code === 0x009b) {
      // 8-bit CSI (same handling as ESC [).
      let params = "";
      while (index < raw.length) {
        const byte = raw.charCodeAt(index);
        if (byte < 0x30 || byte > 0x3f) break;
        params += raw[index];
        index += 1;
      }
      const final = raw[index];
      if (final !== undefined) {
        const finalCode = final.charCodeAt(0);
        if (finalCode >= 0x40 && finalCode <= 0x7e) {
          index += 1;
          applyCsi(final, params);
        }
      }
      continue;
    }

    if (code === 0x009d) {
      // 8-bit OSC: skip to ST.
      while (index < raw.length) {
        if (raw[index] === "\x9c") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (ch === "\r") {
      cursor = 0;
      continue;
    }
    if (ch === "\b") {
      cursor = clampColumn(cursor - 1);
      continue;
    }
    if (ch === "\t") {
      cursor = clampColumn(Math.floor(cursor / TAB_WIDTH + 1) * TAB_WIDTH);
      continue;
    }
    if (ch === "\n" || ch === "\f" || ch === "\v") continue;
    if (isControlCode(code)) continue;
    write(ch);
  }

  while (cells.length > 0 && cells[cells.length - 1] === " ") cells.pop();
  return cells.join("");
}

/**
 * Normalize multi-line captured output, collapsing in-place redraws on each
 * physical line. Blank rows are dropped, matching the inline output frame.
 */
export function normalizeTerminalOutput(output: string): string[] {
  return output
    .split("\n")
    .map((line) => normalizeTerminalRow(line))
    .filter((line) => line.length > 0);
}
