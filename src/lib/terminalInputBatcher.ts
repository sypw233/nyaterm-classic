import { invoke } from "./invoke";
import { runtime } from "./backend/runtime";
import {
  emitSessionInputPreview,
  inferSessionInputPreview,
  registerSessionCommandSubmission,
  sendSessionInput,
  sendSessionInputWithSync,
  type InputOrigin,
  type InputSensitivity,
  type SendSessionInputOptions,
} from "./sessionInput";

/** Maximum number of fragments kept in one keyboard batch. */
const MAX_BATCH_INPUTS = 256;

/**
 * Control bytes that must never be coalesced behind a microtask: delaying
 * these breaks interactive latency (Enter, Ctrl+C, Ctrl+D) or can split a
 * terminal response / bracketed paste marker in half.
 */
function requiresImmediateFlush(data: string): boolean {
  for (let i = 0; i < data.length; i += 1) {
    const code = data.charCodeAt(i);
    if (
      code === 0x0d || // CR / Enter
      code === 0x0a || // LF
      code === 0x03 || // Ctrl+C
      code === 0x04 || // Ctrl+D
      code === 0x1a || // Ctrl+Z
      code === 0x1b || // ESC (also bracketed-paste markers)
      code === 0x7f || // DEL / Backspace
      code === 0x00 // NUL
    ) {
      return true;
    }
  }
  return false;
}

interface QueuedFragment {
  data: string;
  origin: InputOrigin;
  sensitivity?: InputSensitivity;
  registerSubmission?: string | null;
}

interface BatchedFragmentPayload {
  data: string;
  origin: InputOrigin;
  sensitivity?: InputSensitivity;
  registerSubmission?: string | null;
}

export interface TerminalInputBatcherOptions {
  sessionId: string;
  peerSessionIds?: string[] | null;
  /** Optional live getter so sync-group changes are observed between batches. */
  getPeerSessionIds?: () => string[] | null | undefined;
}

/**
 * Coalesces rapid keyboard `onData` events into a single Tauri IPC round trip.
 *
 * Only used on Desktop and only on the interactive keyboard path. Other input
 * sources (credential autofill, OTP, startup commands, AI agent) keep calling
 * `sendSessionInput` directly so their delivery stays immediate and isolated.
 *
 * Web has no `write_to_session_batch` command (its input travels over a
 * WebSocket), so batching is a no-op there and every fragment is sent via the
 * normal path.
 */
export class TerminalInputBatcher {
  private readonly sessionId: string;
  private readonly peerSessionIds: string[];
  private readonly getPeerSessionIds: () => string[] | null | undefined;
  private readonly enabled: boolean;
  private queue: QueuedFragment[] = [];
  private scheduled = false;
  private disposed = false;

  constructor(options: TerminalInputBatcherOptions) {
    this.sessionId = options.sessionId;
    this.peerSessionIds = options.peerSessionIds ?? [];
    this.getPeerSessionIds = options.getPeerSessionIds ?? (() => this.peerSessionIds);
    this.enabled = runtime === "desktop";
  }

  private peers(): string[] {
    return this.getPeerSessionIds() ?? this.peerSessionIds;
  }

  /**
   * Enqueue one keyboard fragment. Returns a promise that resolves when the
   * fragment has actually been submitted (either immediately or with the
   * scheduled batch), so callers can still await delivery.
   */
  enqueue(data: string, options: SendSessionInputOptions = {}): Promise<void> {
    if (this.disposed || data.length === 0) {
      return Promise.resolve();
    }

    const origin = options.origin ?? "keyboard";
    const preview =
      options.preview === undefined
        ? inferSessionInputPreview(data)
        : options.preview;
    if (preview) {
      emitSessionInputPreview(this.sessionId, preview);
    }

    if (
      !this.enabled ||
      requiresImmediateFlush(data) ||
      this.queue.length >= MAX_BATCH_INPUTS
    ) {
      // Flush anything already queued first so ordering is preserved, then
      // send this fragment immediately.
      const pending = this.takeQueue();
      const immediate = this.sendOne(data, options, origin);
      const flushed = this.submitBatch(pending);
      return Promise.all([flushed, immediate]).then(() => undefined);
    }

    this.queue.push({
      data,
      origin,
      sensitivity: options.sensitivity,
      registerSubmission: options.registerSubmission,
    });
    this.schedule();
    return Promise.resolve();
  }

  /** Flush all queued fragments right away (e.g. on blur or teardown). */
  flush(): Promise<void> {
    if (this.scheduled) {
      this.scheduled = false;
    }
    return this.submitBatch(this.takeQueue());
  }

  dispose(): void {
    this.disposed = true;
    void this.flush();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.submitBatch(this.takeQueue());
    });
  }

  private takeQueue(): QueuedFragment[] {
    if (this.queue.length === 0) return [];
    const queued = this.queue;
    this.queue = [];
    return queued;
  }

  private sendOne(
    data: string,
    options: SendSessionInputOptions,
    origin: InputOrigin,
  ): Promise<void> {
    const peers = this.peers();
    if (origin === "keyboard" && peers.length > 0) {
      return sendSessionInputWithSync(
        this.sessionId,
        data,
        peers,
        {
          ...options,
          origin,
          preview: null,
          // registerSubmission is handled on the backend by write_to_session
          // via sendSessionInputWithSync -> sendSessionInput.
        },
      ).catch(() => {});
    }
    return sendSessionInput(this.sessionId, data, {
      ...options,
      origin,
      preview: null,
    }).catch(() => {});
  }

  private submitBatch(fragments: QueuedFragment[]): Promise<void> {
    if (fragments.length === 0) return Promise.resolve();
    // A single fragment uses the ordinary path so behaviour stays identical to
    // the pre-batching code (including sync peers and submission registration).
    if (fragments.length === 1) {
      const only = fragments[0];
      if (!only) return Promise.resolve();
      return this.sendOne(
        only.data,
        {
          registerSubmission: only.registerSubmission,
          sensitivity: only.sensitivity,
          origin: only.origin,
          preview: null,
        },
        only.origin,
      );
    }

    // Frontend command history is maintained here for the batched path; the
    // single/immediate paths rely on sendSessionInput to do the same.
    for (const fragment of fragments) {
      if (fragment.registerSubmission) {
        registerSessionCommandSubmission(
          this.sessionId,
          fragment.registerSubmission,
        );
      }
    }

    const batch: BatchedFragmentPayload[] = fragments.map((fragment) => ({
      data: fragment.data,
      origin: fragment.origin,
      sensitivity: fragment.sensitivity,
      registerSubmission: fragment.registerSubmission,
    }));

    const primary = invoke<void>("write_to_session_batch", {
      sessionId: this.sessionId,
      inputs: batch,
    }).catch(() => {});

    // Sync peers keep the existing per-peer semantics; batches are only used
    // for the interactive keyboard path, which rarely has peers.
    const peers: Promise<unknown>[] = [];
    const peerIds = this.peers();
    if (peerIds.length > 0) {
      for (const fragment of fragments) {
        for (const peerId of peerIds) {
          peers.push(
            invoke<void>("write_to_session", {
              sessionId: peerId,
              data: fragment.data,
              origin: "sync_input",
              sensitivity: fragment.sensitivity,
            }).catch(() => {}),
          );
        }
      }
    }
    return Promise.all([primary, ...peers]).then(() => undefined);
  }
}
