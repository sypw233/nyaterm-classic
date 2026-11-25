import {
  buildTerminalCommandInput,
  sendSessionInput,
  type SendSessionInputOptions,
} from "@/lib/sessionInput";
import type { QuickCommandSegmentedSend } from "@/types/global";
import {
  normalizeSegmentIntervalMs,
  planSegmentedUnits,
  segmentDelays,
} from "./segmentedSend";

export interface SegmentedSendTarget {
  sessionId: string;
  peerSessionIds: string[];
}

function deliver(
  target: SegmentedSendTarget,
  data: string,
  options: SendSessionInputOptions,
): Promise<void> {
  const { sessionId, peerSessionIds } = target;
  return peerSessionIds.length > 0
    ? import("@/lib/sessionInput").then(({ sendSessionInputWithSync }) =>
        sendSessionInputWithSync(sessionId, data, peerSessionIds, options),
      )
    : sendSessionInput(sessionId, data, options);
}

/**
 * Send a quick command to a session, optionally in timed segments.
 *
 * Without `segmented_send` the whole command is delivered as before (with the
 * usual execute/append handling). Segmented mode is a literal send: each line
 * or character is written as-is, waiting the configured interval between
 * units so an interactive wizard can read one answer at a time. Line endings
 * already present in the command are preserved; none are invented.
 */
export async function sendQuickCommand(
  target: SegmentedSendTarget,
  command: string,
  execute: boolean,
  segmented: QuickCommandSegmentedSend | undefined,
  options: SendSessionInputOptions,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => window.setTimeout(resolve, ms)),
): Promise<void> {
  if (!segmented) {
    await deliver(target, buildTerminalCommandInput(command, execute), options);
    return;
  }

  const units = planSegmentedUnits(command, segmented);
  if (units.length === 0) return;
  const interval = normalizeSegmentIntervalMs(segmented.interval_ms ?? 0);
  const delays = segmentDelays(units.length, interval);

  for (let index = 0; index < units.length; index += 1) {
    if (delays[index] > 0) await sleep(delays[index]);
    await deliver(target, units[index], {
      ...options,
      preview: index === 0 ? options.preview : null,
    });
  }
}
