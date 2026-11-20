import type { AIAction } from "@/types/global";

export const AI_OPEN_EVENT = "nyaterm:ai-open";
export const AI_ERROR_DETECTED_EVENT = "nyaterm:ai-error-detected";
/**
 * Fired when the terminal starts a new command.
 *
 * An error notice describes the previous command's output, so it must not
 * outlive the command that produced it. The terminal and the AI panel are not
 * in the same component tree, so this crosses via the window event bus like the
 * detection event itself.
 */
export const AI_ERROR_DETECTION_RESET_EVENT = "nyaterm:ai-error-detection-reset";

export interface AIOpenIntent {
  id: string;
  action: AIAction;
  userInput?: string;
  selectedText?: string;
  metadata?: Record<string, unknown>;
}

export interface AIErrorDetectedDetail {
  sessionId: string;
  output: string;
}

export function openAIAssistant(intent: Omit<AIOpenIntent, "id">) {
  window.dispatchEvent(
    new CustomEvent<AIOpenIntent>(AI_OPEN_EVENT, {
      detail: {
        id: `ai-intent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ...intent,
      },
    }),
  );
}

export function emitAIErrorDetected(detail: AIErrorDetectedDetail) {
  window.dispatchEvent(new CustomEvent<AIErrorDetectedDetail>(AI_ERROR_DETECTED_EVENT, { detail }));
}

/** Tell the AI panel that any pending error notice is stale. */
export function emitAIErrorDetectionReset() {
  window.dispatchEvent(new CustomEvent(AI_ERROR_DETECTION_RESET_EVENT));
}
