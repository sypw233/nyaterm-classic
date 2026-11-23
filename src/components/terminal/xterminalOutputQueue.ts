import type { SerializeAddon } from "@xterm/addon-serialize";
import type { Terminal } from "@xterm/xterm";
import { XTERM_PERFORMANCE_CONFIG } from "@/lib/xtermPerformance";

export interface QueuedOutputChunk {
  data: string;
  bytes: number;
}

export interface OutputQueue {
  chunks: Array<QueuedOutputChunk | undefined>;
  headIndex: number;
  bytes: number;
}

export interface OutputQueueDebugSnapshot {
  totalSlots: number;
  liveSlots: number;
  consumedSlots: number;
  headIndex: number;
  bytes: number;
}

interface SerializedTerminalSnapshot {
  content: string;
  captureStartLine: number;
  captureEndLine: number;
}

/**
 * Count UTF-8 bytes without allocating an encoded copy. The old
 * `encoder.encode(text).length` allocated a full Uint8Array for every retry
 * while probing snapshot size (up to 2 MB × ~12 halvings).
 */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4; // valid surrogate pair
        i += 1;
      } else {
        bytes += 3; // unpaired high surrogate (replacement char)
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 3; // unpaired low surrogate
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function createOutputQueue(): OutputQueue {
  return { chunks: [], headIndex: 0, bytes: 0 };
}

function utf8BytesForCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

export function serializeTerminalSnapshot(
  terminal: Terminal,
  serializeAddon?: SerializeAddon | null,
): SerializedTerminalSnapshot {
  const limits = XTERM_PERFORMANCE_CONFIG.lifecycle;
  const buffer = terminal.buffer.active;
  const lastLine = Math.min(buffer.length - 1, buffer.baseY + buffer.cursorY);

  if (lastLine < 0) {
    return {
      content: "",
      captureStartLine: 0,
      captureEndLine: 0,
    };
  }

  if (serializeAddon) {
    let scrollback = Math.min(limits.snapshotMaxLines, buffer.length);
    while (scrollback >= 0) {
      const snapshot = serializeAddon.serialize({
        scrollback,
        excludeAltBuffer: true,
      });
      if (utf8ByteLength(snapshot) <= limits.snapshotMaxBytes || scrollback === 0) {
        const capturedLines = Math.max(1, Math.min(scrollback || terminal.rows, buffer.length));
        return {
          content: snapshot,
          captureStartLine: Math.max(0, lastLine - capturedLines + 1),
          captureEndLine: lastLine,
        };
      }
      scrollback = Math.floor(scrollback / 2);
    }
  }

  const lines: string[] = [];
  let bytes = 0;
  let includedFirstLine = lastLine;
  const firstLine = Math.max(0, lastLine - limits.snapshotMaxLines + 1);
  for (let lineIndex = lastLine; lineIndex >= firstLine; lineIndex -= 1) {
    const line = buffer.getLine(lineIndex);
    const text = line?.translateToString(true) ?? "";
    const lineBytes = utf8ByteLength(text) + 2;
    if (lines.length > 0 && bytes + lineBytes > limits.snapshotMaxBytes) break;
    lines.push(text);
    bytes += lineBytes;
    includedFirstLine = lineIndex;
  }

  return {
    content: lines.reverse().join("\r\n"),
    captureStartLine: includedFirstLine,
    captureEndLine: lastLine,
  };
}

export function splitOutputChunk(chunk: QueuedOutputChunk, maxBytes: number): QueuedOutputChunk[] {
  if (chunk.bytes <= maxBytes) {
    return [chunk, { data: "", bytes: 0 }];
  }

  if (chunk.data.length === chunk.bytes) {
    const index = Math.max(1, Math.min(maxBytes, chunk.data.length));
    return [
      { data: chunk.data.slice(0, index), bytes: index },
      { data: chunk.data.slice(index), bytes: chunk.bytes - index },
    ];
  }

  let index = 0;
  let bytes = 0;
  for (let offset = 0; offset < chunk.data.length; ) {
    const codePoint = chunk.data.codePointAt(offset) ?? 0;
    const charLength = codePoint > 0xffff ? 2 : 1;
    const charBytes = utf8BytesForCodePoint(codePoint);
    if (bytes > 0 && bytes + charBytes > maxBytes) break;
    index += charLength;
    bytes += charBytes;
    offset += charLength;
    if (bytes >= maxBytes) break;
  }

  if (index <= 0) {
    const codePoint = chunk.data.codePointAt(0) ?? 0;
    index = codePoint > 0xffff ? 2 : 1;
    bytes = utf8BytesForCodePoint(codePoint);
  }

  return [
    { data: chunk.data.slice(0, index), bytes },
    {
      data: chunk.data.slice(index),
      bytes: Math.max(0, chunk.bytes - bytes),
    },
  ];
}

function compactOutputQueue(queue: OutputQueue) {
  if (queue.headIndex <= 1024 || queue.headIndex <= queue.chunks.length / 2) return;
  queue.chunks = queue.chunks.slice(queue.headIndex);
  queue.headIndex = 0;
}

export function pushOutputQueue(queue: OutputQueue, chunk: QueuedOutputChunk) {
  queue.chunks.push(chunk);
  queue.bytes += chunk.bytes;
}

export function shiftOutputQueue(queue: OutputQueue): QueuedOutputChunk | null {
  const chunk = queue.chunks[queue.headIndex];
  if (!chunk) return null;
  queue.chunks[queue.headIndex] = undefined;
  queue.headIndex += 1;
  queue.bytes = Math.max(0, queue.bytes - chunk.bytes);
  compactOutputQueue(queue);
  return chunk;
}

export function peekOutputQueue(queue: OutputQueue): QueuedOutputChunk | null {
  return queue.chunks[queue.headIndex] ?? null;
}

export function replaceOutputQueueHead(queue: OutputQueue, chunk: QueuedOutputChunk) {
  if (queue.headIndex < queue.chunks.length) {
    queue.chunks[queue.headIndex] = chunk;
  }
}

export function hasOutputQueueItems(queue: OutputQueue) {
  return queue.headIndex < queue.chunks.length;
}

export function getOutputQueueDebugSnapshot(queue: OutputQueue): OutputQueueDebugSnapshot {
  let liveSlots = 0;
  let consumedSlots = 0;
  for (let i = 0; i < queue.chunks.length; i += 1) {
    if (queue.chunks[i]) {
      liveSlots += 1;
    } else if (i < queue.headIndex) {
      consumedSlots += 1;
    }
  }

  return {
    totalSlots: queue.chunks.length,
    liveSlots,
    consumedSlots,
    headIndex: queue.headIndex,
    bytes: queue.bytes,
  };
}

export function outputQueueToBoundedString(queue: OutputQueue) {
  const maxBytes = XTERM_PERFORMANCE_CONFIG.lifecycle.snapshotMaxBytes;
  const parts: string[] = [];
  let bytes = 0;

  for (let i = queue.chunks.length - 1; i >= queue.headIndex; i -= 1) {
    const chunk = queue.chunks[i];
    if (!chunk) continue;
    if (bytes + chunk.bytes <= maxBytes) {
      parts.push(chunk.data);
      bytes += chunk.bytes;
      continue;
    }

    const remaining = maxBytes - bytes;
    if (remaining > 0) {
      const [, tail] = splitOutputChunk(chunk, Math.max(0, chunk.bytes - remaining));
      if (tail.data) parts.push(tail.data);
    }
    break;
  }

  return parts.reverse().join("");
}

export function writeTextInFrames(terminal: Terminal, text: string): Promise<void> {
  if (!text) return Promise.resolve();

  const maxBytes = XTERM_PERFORMANCE_CONFIG.output.writeChunkBytes;
  let remaining: QueuedOutputChunk = { data: text, bytes: utf8ByteLength(text) };

  return new Promise((resolve) => {
    const writeOne = (): boolean => {
      if (!remaining.data) return false;
      const [head, tail] = splitOutputChunk(remaining, maxBytes);
      remaining = tail;
      terminal.write(head.data);
      return true;
    };

    // Write the first chunk synchronously so snapshot replay starts immediately
    // instead of waiting one animation frame before showing anything.
    writeOne();

    const writeFrame = () => {
      if (!remaining.data) {
        resolve();
        return;
      }
      // Drain several chunks per frame within a short budget. One RAF per
      // 32 KB chunk made a 2 MB snapshot take ~64 frames (~1 s at 60 fps).
      const deadline = performance.now() + 8;
      do {
        if (!writeOne()) break;
      } while (remaining.data && performance.now() < deadline);
      requestAnimationFrame(writeFrame);
    };

    if (remaining.data) {
      requestAnimationFrame(writeFrame);
    } else {
      resolve();
    }
  });
}
