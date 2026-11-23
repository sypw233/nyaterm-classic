import { listen } from "@/lib/backend/api";
import { supports } from "@/lib/backend/runtime";
import type { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  normalizeCommandSuggestionMaxChars,
  normalizeCommandSuggestionMinChars,
} from "@/lib/interactionSettings";
import { invoke } from "@/lib/invoke";
import {
  COMMAND_SUGGESTION_LIMIT,
  mergeCommandSuggestions,
} from "@/lib/commandSuggestionMerge";
import { shouldQueryPathCompletion } from "@/lib/pathCompletionInput";
import { getTrackedCommand, type TerminalInputState } from "@/lib/terminalInputTracker";
import type { SuggestionCursorPosition } from "@/lib/terminalSuggestionPosition";
import {
  collectKnownWords,
  isWordCompletionCandidate,
  tokenAtCursor,
} from "@/lib/wordCompletion";
import type { FuzzyResult, QuickCommandsConfig } from "@/types/global";

/** One path-completion row, already expressed as a complete replacement line. */
interface PathCandidate {
  command: string;
  display: string;
  indices: number[];
  score: number;
  is_dir: boolean;
}

interface XTermCoreWithRenderDimensions {
  _core?: {
    _renderService?: {
      dimensions?: {
        css: {
          cell: {
            height: number;
            width: number;
          };
        };
      };
    };
  };
}

interface CommandHistorySearchOptions {
  manual?: boolean;
}

const EMPTY_MANUAL_HISTORY_LIMIT = 8;
const EMPTY_MANUAL_QUICK_COMMAND_LIMIT = 8;
/** Path rows shown at once; enough for a directory without crowding the list. */
const PATH_CANDIDATE_LIMIT = 12;
/** Word rows shown at once. */
const WORD_CANDIDATE_LIMIT = 8;
/** How many history lines are scanned for known words. */
const WORD_SOURCE_COMMAND_LIMIT = 2000;

/** Cached word vocabulary, rebuilt only when the history changes. */
interface WordVocabulary {
  words: string[];
  builtFor: string[] | null;
}

/**
 * Build word-completion rows for the token under the caret.
 *
 * Candidates are the words the user has actually typed in previous commands,
 * so `conda deactivate` makes `conda` and `deactivate` available for later
 * lines. Only a prefix match is offered, and the row records the token span so
 * selecting it edits that token instead of replacing the whole line.
 *
 * Note: the caller only reaches this while the caret is at the end of the line
 * (see `canSuggestFromTracker`). Completing mid-line is therefore supported by
 * the text helpers but not yet reachable from the popup; enabling it would mean
 * relaxing that gate and confirming every shell in scope accepts cursor moves.
 */
export async function buildWordSuggestions(
  hit: ReturnType<typeof tokenAtCursor>,
  minChars: number,
  getVocabulary: () => Promise<string[]>,
): Promise<FuzzyResult[]> {
  if (!hit) return [];
  const prefix = hit.prefix.trim();
  if (prefix.length < minChars) return [];

  const words = await getVocabulary();
  const matches: FuzzyResult[] = [];

  for (const word of words) {
    if (!isWordCompletionCandidate(word, prefix, minChars)) continue;
    // Shorter completions first, then alphabetical: `activate` should not be
    // buried under a long argument that merely shares the prefix.
    matches.push({
      command: word,
      display: word,
      indices: [],
      score: 4_000 - word.length,
      source: "word",
      wordRange: { start: hit.token.start, end: hit.token.end },
    });
  }

  matches.sort((left, right) => right.score - left.score || left.command.localeCompare(right.command));
  return matches.slice(0, WORD_CANDIDATE_LIMIT);
}

function isWithinCommandLengthLimits(command: string, minLength: number, maxLength: number) {
  const length = command.trim().length;
  return length >= minLength && length <= maxLength;
}

function quickCommandRank(command: QuickCommandsConfig["commands"][number]) {
  const useCount = command.use_count ?? 0;
  const updatedAt = command.updated_at ?? command.created_at ?? 0;
  return (command.pinned ? 1_000_000_000 : 0) + useCount * 1_000_000 + updatedAt;
}

export function useCommandHistory(
  terminalRef: React.RefObject<Terminal | null>,
  inputStateRef: React.RefObject<TerminalInputState>,
  applySuggestion: (
    command: string,
    execute: boolean,
    wordEdit?: { start: number; end: number },
  ) => void,
  canShowSuggestions: (options?: { allowEmpty?: boolean }) => boolean,
  enabled: boolean,
  minCommandLength: number,
  maxCommandLength: number,
  sessionId: string,
  wordCompletionEnabled = true,
) {
  const suggestionsEnabled = enabled && supports("commandSuggestions");
  const [suggestions, setSuggestions] = useState<FuzzyResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cursorPosition, setCursorPosition] = useState<SuggestionCursorPosition>({
    top: 0,
    left: 0,
  });

  const suggestionsRef = useRef<FuzzyResult[]>([]);
  const selectedIndexRef = useRef(-1);
  const showSuggestionsRef = useRef(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reading getBoundingClientRect() forces a synchronous layout. One search
  // publishes twice (known results + path completion), so cache the screen
  // rect briefly to collapse those into one layout read.
  const screenRectCacheRef = useRef<{
    element: Element | null;
    at: number;
    rect: DOMRect;
  } | null>(null);
  const enabledRef = useRef(suggestionsEnabled);
  // Gate for the word provider. Disabling it restores the pre-existing
  // whole-line-only behaviour without touching the other providers.
  const wordCompletionEnabledRef = useRef(wordCompletionEnabled);
  wordCompletionEnabledRef.current = wordCompletionEnabled;
  const minCommandLengthRef = useRef(normalizeCommandSuggestionMinChars(minCommandLength));
  const maxCommandLengthRef = useRef(normalizeCommandSuggestionMaxChars(maxCommandLength));
  const searchRequestIdRef = useRef(0);
  const sessionIdRef = useRef(sessionId);
  const deletedHistoryCommandsRef = useRef(new Set<string>());
  const deletedHistoryCommandTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Word vocabulary derived from history. Rebuilding it on every keystroke would
  // mean an IPC call plus tokenising 2000 lines per character, so it is cached
  // and only refreshed when the history listener fires.
  const wordVocabularyRef = useRef<WordVocabulary>({ words: [], builtFor: null });

  const getWordVocabulary = useCallback(async (): Promise<string[]> => {
    const cached = wordVocabularyRef.current;
    if (cached.builtFor !== null) return cached.words;

    try {
      const history = await invoke<string[]>("get_command_history");
      const words = collectKnownWords(history, WORD_SOURCE_COMMAND_LIMIT);
      wordVocabularyRef.current = { words, builtFor: history };
      return words;
    } catch {
      // A failed read must not retry on every keystroke; cache the empty result.
      wordVocabularyRef.current = { words: [], builtFor: [] };
      return [];
    }
  }, []);

  const invalidateWordVocabulary = useCallback(() => {
    wordVocabularyRef.current = { words: [], builtFor: null };
  }, []);

  useEffect(() => {
    enabledRef.current = suggestionsEnabled;
  }, [suggestionsEnabled]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const getCursorViewportPosition = useCallback((): SuggestionCursorPosition => {
    try {
      const terminal = terminalRef.current;
      if (!terminal) return { top: 0, left: 0 };
      const core = (terminal as Terminal & XTermCoreWithRenderDimensions)._core;
      const dims = core?._renderService?.dimensions;
      if (!dims) return { top: 0, left: 0 };
      const cellHeight: number = dims.css.cell.height;
      const cellWidth: number = dims.css.cell.width;

      const cursorY = terminal.buffer.active.cursorY;
      const cursorX = terminal.buffer.active.cursorX;

      const screenEl = terminal.element?.querySelector(".xterm-screen");
      if (!screenEl) return { top: 0, left: 0 };

      const now = Date.now();
      let cached = screenRectCacheRef.current;
      let screenRect: DOMRect;
      if (
        cached &&
        cached.element === screenEl &&
        now - cached.at < 250
      ) {
        screenRect = cached.rect;
      } else {
        screenRect = screenEl.getBoundingClientRect();
        screenRectCacheRef.current = { element: screenEl, at: now, rect: screenRect };
      }

      return {
        top: screenRect.top + (cursorY + 1) * cellHeight,
        left: screenRect.left + cursorX * cellWidth,
        lineTop: screenRect.top + cursorY * cellHeight,
      };
    } catch {
      return { top: 0, left: 0 };
    }
  }, [terminalRef]);

  const dismissSuggestions = useCallback(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    searchRequestIdRef.current += 1;
    if (
      !showSuggestionsRef.current &&
      suggestionsRef.current.length === 0 &&
      selectedIndexRef.current === -1
    ) {
      return;
    }
    showSuggestionsRef.current = false;
    suggestionsRef.current = [];
    selectedIndexRef.current = -1;
    setSuggestions([]);
    setSelectedIndex(-1);
    setShowSuggestions(false);
  }, []);

  useEffect(() => {
    if (!suggestionsEnabled) {
      dismissSuggestions();
    }
  }, [suggestionsEnabled, dismissSuggestions]);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
      for (const timer of deletedHistoryCommandTimersRef.current.values()) {
        clearTimeout(timer);
      }
      deletedHistoryCommandTimersRef.current.clear();
    };
  }, []);

  const runSearch = useCallback(
    async (requestId: number, options: CommandHistorySearchOptions = {}) => {
      if (requestId !== searchRequestIdRef.current) {
        return;
      }

      if (!enabledRef.current) {
        dismissSuggestions();
        return;
      }

      const pattern = getTrackedCommand(inputStateRef.current);
      // Path completion needs the raw line: a trailing space is meaningful
      // (`cd ` lists the cwd, `cd` is still being typed) and the tracked
      // command used for fuzzy matching is trimmed.
      const rawInput = inputStateRef.current.value;
      if (!pattern.trim() && options.manual) {
        try {
          const [history, quickCommands] = await Promise.all([
            invoke<string[]>("get_command_history"),
            invoke<QuickCommandsConfig>("get_quick_commands"),
          ]);
          if (requestId !== searchRequestIdRef.current || !enabledRef.current) {
            return;
          }

          const historyResults: FuzzyResult[] = history
            .filter((command) =>
              isWithinCommandLengthLimits(
                command,
                minCommandLengthRef.current,
                maxCommandLengthRef.current,
              ),
            )
            .filter((command) => !deletedHistoryCommandsRef.current.has(command))
            .slice(0, EMPTY_MANUAL_HISTORY_LIMIT)
            .map((command, index) => ({
              command,
              display: command,
              indices: [],
              score: 2_000 - index,
              source: "history",
            }));

          const quickCommandResults: FuzzyResult[] = quickCommands.commands
            .filter((command) => command.command.trim())
            .sort((left, right) => quickCommandRank(right) - quickCommandRank(left))
            .slice(0, EMPTY_MANUAL_QUICK_COMMAND_LIMIT)
            .map((quickCommand, index) => ({
              command: quickCommand.command,
              display: quickCommand.label || quickCommand.command,
              indices: [],
              score: 1_000 - index,
              source: "quickCommand",
            }));

          const merged = [...historyResults, ...quickCommandResults].slice(0, 12);
          suggestionsRef.current = merged;
          selectedIndexRef.current = -1;
          showSuggestionsRef.current = merged.length > 0;
          setSuggestions(merged);
          setSelectedIndex(-1);
          setShowSuggestions(merged.length > 0);

          if (merged.length > 0) {
            setCursorPosition(getCursorViewportPosition());
          }
        } catch {
          // Ignore errors
        }
        return;
      }

      if (!pattern.trim() || !canShowSuggestions()) {
        dismissSuggestions();
        return;
      }
      try {
        // Word completion needs the token under the caret, which the tracked
        // command has already been trimmed of; recompute from the raw line.
        const caret = inputStateRef.current.cursor;
        const wordHit = tokenAtCursor(rawInput, caret);
        // Path completion may list a remote directory, so it is published as a
        // separate, later update. Waiting for it would delay history and
        // quick-command rows that are already available locally.
        const pathCompletion =
          supports("pathCompletion") && shouldQueryPathCompletion(rawInput)
            ? invoke<PathCandidate[]>("path_completion_candidates", {
                sessionId: sessionIdRef.current,
                input: rawInput,
                limit: PATH_CANDIDATE_LIMIT,
              }).catch(() => [] as PathCandidate[])
            : Promise.resolve([] as PathCandidate[]);
        const [historyResults, commandResults, knownWordResults] = await Promise.all([
          invoke<FuzzyResult[]>("fuzzy_search_history", {
            pattern,
            limit: 8,
            minCommandLength: minCommandLengthRef.current,
            maxCommandLength: maxCommandLengthRef.current,
          }),
          invoke<FuzzyResult[]>("fuzzy_search_commands", { pattern, limit: 8 }),
          // With word completion off, the popup keeps the original behaviour of
          // whole-line rows only.
          wordCompletionEnabledRef.current
            ? buildWordSuggestions(wordHit, minCommandLengthRef.current, getWordVocabulary)
            : Promise.resolve([] as FuzzyResult[]),
        ]);
        if (requestId !== searchRequestIdRef.current) {
          return;
        }

        // With the caret inside the line, a whole-line row would discard the
        // text after the caret when applied. Only token-scoped providers make
        // sense there, so history and catalog rows are dropped.
        const caretAtEnd = inputStateRef.current.cursor >= rawInput.length;
        const wholeLineHistory = caretAtEnd ? historyResults : [];
        const wholeLineCommands = caretAtEnd ? commandResults : [];

        // History rows the user just deleted are dropped before the cap so
        // they cannot take a slot from a live provider.
        const publish = (pathResults: PathCandidate[]) => {
          if (requestId !== searchRequestIdRef.current || !enabledRef.current) {
            return;
          }
          // Path rows carry the whole replacement line, so they need no extra
          // fill step; history and catalog rows follow when the user typed a
          // directory part.
          const pathSuggestions: FuzzyResult[] = pathResults.map((candidate) => ({
            command: candidate.command,
            display: candidate.display,
            indices: candidate.indices,
            score: candidate.score,
            source: "path",
          }));
          const merged = mergeCommandSuggestions(
            [
              // Word matches rank above whole-line matches: when the user is
              // completing the middle of a command, the whole stored line is
              // the wrong thing to insert.
              knownWordResults,
              pathSuggestions,
              wholeLineHistory.filter(
                (result) => !deletedHistoryCommandsRef.current.has(result.command),
              ),
              wholeLineCommands,
            ],
            COMMAND_SUGGESTION_LIMIT,
          );

          // A word row and a whole-line row can describe the same text (typing
          // `cond` matches both the word `conda` and the line `conda activate`).
          // They are not duplicates — one completes a word, the other replaces
          // the line — but showing the bare word twice wastes a slot, so drop a
          // whole-line row whose command is exactly a word already offered.
          const offeredWords = new Set(knownWordResults.map((result) => result.command));
          const deduped = merged.filter(
            (result) => result.wordRange || !offeredWords.has(result.command),
          );

          suggestionsRef.current = deduped;
          selectedIndexRef.current = -1;
          showSuggestionsRef.current = deduped.length > 0;
          setSuggestions(deduped);
          setSelectedIndex(-1);
          setShowSuggestions(deduped.length > 0);

          if (deduped.length > 0) {
            setCursorPosition(getCursorViewportPosition());
          }
        };

        publish([]);
        void pathCompletion.then(publish);
      } catch {
        // Ignore errors
      }
    },
    [canShowSuggestions, dismissSuggestions, getCursorViewportPosition, getWordVocabulary, inputStateRef],
  );

  const triggerSearch = useCallback(
    (options: CommandHistorySearchOptions = {}) => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
      const requestId = ++searchRequestIdRef.current;

      if (!enabledRef.current) {
        dismissSuggestions();
        return;
      }

      if (!canShowSuggestions({ allowEmpty: options.manual })) {
        dismissSuggestions();
        return;
      }

      if (options.manual) {
        void runSearch(requestId, options);
        return;
      }

      searchTimerRef.current = setTimeout(() => {
        void runSearch(requestId, options);
      }, 80);
    },
    [canShowSuggestions, dismissSuggestions, runSearch],
  );

  useEffect(() => {
    minCommandLengthRef.current = normalizeCommandSuggestionMinChars(
      minCommandLength,
      maxCommandLength,
    );
    maxCommandLengthRef.current = normalizeCommandSuggestionMaxChars(
      maxCommandLength,
      minCommandLengthRef.current,
    );

    if (!enabledRef.current) return;
    if (!canShowSuggestions()) {
      dismissSuggestions();
      return;
    }

    triggerSearch();
  }, [canShowSuggestions, dismissSuggestions, maxCommandLength, minCommandLength, triggerSearch]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: inputStateRef is a stable ref object; .current is read inside the event callback.
  useEffect(() => {
    const refreshSuggestions = () => {
      // New history means new words; drop the cached vocabulary so the next
      // search rebuilds it.
      invalidateWordVocabulary();
      if (!enabledRef.current) return;
      const tracked = getTrackedCommand(inputStateRef.current).trim();
      if (!showSuggestionsRef.current && !tracked) return;
      if (!canShowSuggestions()) return;
      triggerSearch();
    };

    const historyListener = listen("command-history-changed", refreshSuggestions);
    const quickCommandsListener = listen("quick-commands-changed", refreshSuggestions);

    return () => {
      historyListener.then((unlisten) => unlisten());
      quickCommandsListener.then((unlisten) => unlisten());
    };
  }, [canShowSuggestions, invalidateWordVocabulary, triggerSearch]);

  const handleSelectSuggestion = useCallback(
    (result: FuzzyResult) => {
      applySuggestion(result.command, false, result.wordRange);
      dismissSuggestions();
      terminalRef.current?.focus();
    },
    [applySuggestion, dismissSuggestions, terminalRef],
  );

  const handleDeleteSuggestion = useCallback(
    (command: string) => {
      deletedHistoryCommandsRef.current.add(command);
      const existingTimer = deletedHistoryCommandTimersRef.current.get(command);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      const cleanupTimer = setTimeout(() => {
        deletedHistoryCommandsRef.current.delete(command);
        deletedHistoryCommandTimersRef.current.delete(command);
      }, 5000);
      deletedHistoryCommandTimersRef.current.set(command, cleanupTimer);

      const nextSuggestions = suggestionsRef.current.filter(
        (suggestion) => suggestion.source !== "history" || suggestion.command !== command,
      );
      suggestionsRef.current = nextSuggestions;

      const nextSelectedIndex =
        selectedIndexRef.current >= nextSuggestions.length
          ? nextSuggestions.length - 1
          : selectedIndexRef.current;
      selectedIndexRef.current = Math.max(-1, nextSelectedIndex);

      showSuggestionsRef.current = nextSuggestions.length > 0;
      setSuggestions(nextSuggestions);
      setSelectedIndex(selectedIndexRef.current);
      setShowSuggestions(nextSuggestions.length > 0);

      void invoke("delete_command_history", { command }).catch(() => {});
      terminalRef.current?.focus();
    },
    [terminalRef],
  );

  return {
    suggestions,
    selectedIndex,
    setSelectedIndex,
    showSuggestions,
    cursorPosition,
    suggestionsRef,
    selectedIndexRef,
    showSuggestionsRef,
    searchTimerRef,
    triggerSearch,
    dismissSuggestions,
    handleSelectSuggestion,
    handleDeleteSuggestion,
  };
}
