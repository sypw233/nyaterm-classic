# Changelog

All notable changes to this project will be documented in this file.

This changelog is inferred from release bump commits in git history (for example `chore: bump version to vX.Y.Z`) and grouped by Conventional Commit type.

## [1.3.10] - 2026-11-25

A release syncing the latest 2.x capabilities into this Tauri/React codebase.
Each was reimplemented here rather than copied, so the implementation differs
while the behaviour matches. It also hardens credential handling and fixes a
test-environment issue exposed by the newer toolchain.

### Added

- **credentials:** *(from 2.x `f26e8a976`)* Password prompts now offer only credentials whose own prompt pattern matches. An unmatched prompt offers nothing instead of listing the whole vault, closing a way for remote output to enumerate saved accounts.
- **credentials:** *(from 2.x `af724014d`)* OTP entries carry an optional prompt pattern and can be suggested when a terminal prompt matches. The code itself is never stored in the suggestion; it is generated at selection time through the sensitive input path.
- **desktop:** *(from 2.x `08d70101a`)* The UI theme can follow the system light/dark appearance, either manually or by picking separate light and dark themes. The OS preference is device-local and never synchronized.
- **terminal:** *(from 2.x `969899b92`)* Quick commands can be sent in segments, by line or by character with a configurable interval, for interactive wizards that read one answer at a time. Delivery is bounded and cancellable.
- **terminal:** *(from 2.x `485213a48`)* Keyword highlight rules can be scoped to a session, overlaying global rules by id without affecting other sessions.
- **terminal:** *(from 2.x `092527f5c`)* A setting controls whether the mouse wheel sends arrow keys while a full-screen program such as tmux or screen is active.
- **terminal:** *(from 2.x `1c0861c18`)* Kitty graphics are enabled in the terminal image addon, so programs that draw inline images (yazi previews, opencode) no longer garble the terminal with raw escape sequences.
- **terminal:** *(from 2.x `7eb4b139d`)* AI chat messages show a local timestamp and a copy action, and fenced code blocks get their own copy button.
- **desktop:** *(from 2.x `17565c46a`)* Pressing Tab in the file browser path input completes the last segment against the parent directory's subdirectories.
- **desktop:** *(from 2.x `18614c4ed`)* Connection types in the new-connection editor can be hidden and reordered.
- **settings:** *(from 2.x `5573a834e`)* An opt-in setting opens a newly created connection as soon as it is saved. Editing an existing connection is unaffected.
- **terminal:** *(from 2.x `daedb5856`)* A failed connection pane can be retried by pressing Enter.
- **serial:** *(from 2.x `c41a8be79`)* A successfully reopened serial session can send one Enter to wake a console that prints its prompt only after input. The wake is opt-in and cancelled if the user types first.

### Changed

- **terminal:** *(from 2.x `dbae079ce`)* Command block starts are inferred from wrapped terminal rows with bounded caches, so multi-row commands register their true start and stale boundaries are revoked when the buffer changes.
- **terminal:** *(from 2.x `77e64b2f2`)* Command suggestions stay available while input is synchronized; fills become append-only and unsafe rewrites are refused instead of corrupting peer sessions.
- **terminal:** *(from 2.x `4a6f4d827`, `076c29e0c`)* Credential-prompt detection and input protection no longer depend on a non-empty vault, so manually typed passwords stay protected even with no saved credentials.

### Fixed

- **security:** *(from 2.x `f62f904f1`)* Editing an existing SSH key now requires the master-password unlock that viewing a private key already required.
- **ai:** *(from 2.x `07b7dfae8`, `005088a97`)* Persisted assistant projections are deduplicated by id, so agent runs that re-persist an evolving message no longer render it multiple times. Copy controls remain keyboard accessible.
- **mcp:** `tools/list` results include `ttlMs` and `cacheScope` as required by the current protocol revision, fixing strict clients that rejected the response.
- **quick-commands:** *(from 2.x `ebe293a41`)* Character-mode segmented sends preserve a literal LF instead of translating it to CRLF.
- **config:** *(from 2.x `dff61c118`)* Saving settings no longer rewrites a UI language the binary does not recognise, so a locale shipped by a newer build is not silently reset to English.
- **files:** *(from 2.x `d05715ec3`)* Text opens re-check the byte count on the data actually read, so an under-reported size or a file that grows between stat and read cannot bypass the limit.
- **test:** Provide a `PointerEvent` polyfill in the Vitest setup; jsdom in this toolchain omitted it, which broke Radix menus, drag handlers and pointer mapping tests.

## [1.3.9] - 2026-11-25

A release for the MCP loopback HTTP transport and a polish pass on the inline
command blocks that AI and MCP commands print into the terminal. Not a 2.x sync.

### Added

- **mcp:** External MCP can serve its forwarder over Streamable HTTP on
  `127.0.0.1` instead of stdio. NyaTerm owns the sidecar while HTTP is enabled,
  and generated client configs switch to an HTTP URL. The capability token is
  the first URL path segment (`/<token>/mcp`), reusing the bridge token so only
  a client with the private discovery document can reach the service.
- **mcp:** The HTTP URL is stable across restarts. `http_port` (0 = auto-pick)
  and `http_token` are stored in settings with serde defaults for backward
  compatibility; auto-generated values are persisted on first enable. Settings
  offers a fixed-port field and a regenerate action that rotates the token.

### Changed

- **ai:** Command blocks now open with a titled frame (`source #step`) and show
  an explicit `INPUT` section containing the command, followed by a labelled
  `OUTPUT` section and a status footer with success/exit code and a readable
  duration. Previously the command floated above an unlabelled box, which made
  input and output hard to tell apart.
- **ai:** Captured output that uses bare carriage returns for progress (for
  example `systeminfo` on Windows) is split into separate lines, and lines wider
  than 100 characters are wrapped, so the box rail and footer stay aligned.

## [1.3.8] - 2026-11-24

A feature release for AI command approval and update delivery on the 1.x line.
Both capabilities are implemented on the Tauri/React stack and are not 2.x syncs.

### Added

- **ai:** The chat panel's execution-policy menu now adjusts the Smart-mode
  auto-run risk threshold directly (Low/Medium/High/Critical), without opening
  Settings.
- **ai:** New optional `AiSettings.agent_auto_allow_command_prefixes` lets users
  list command prefixes that auto-run in Smart mode. Matching is case-insensitive
  on the leading command text, and a Critical local assessment always still
  requires confirmation.
- **ai:** New optional `AiSettings.agent_risk_reference` chooses how the model
  and local risk assessments are combined in Smart mode: `strict` (the default,
  higher of the two), `ai`, or `local`.
- **updater:** Opt-in background auto-download. When enabled, the silent startup
  check downloads an available update without installing it and shows a
  persistent toast offering to restart once ready. Silent failures are logged
  only. The check-for-updates dialog reuses the shared download state, offers a
  "Download in background" action, and asks before restarting to install.

### Changed

- **ai:** Agent messages now render the streamed reasoning as the opening
  thought of the Agent block, followed by steps ordered by `stepIndex`. Each
  step shows its thought then command, producing thought -> command ->
  thought -> command order instead of commands above a bottom-stacked thought
  blob.
- **ai:** The reasoning box reveals a collapse/expand button on the left on
  hover while keeping its header trigger.
- **updater:** Download and install are now separate operations with a
  process-wide generation guard, so a new check or a closed/reopened dialog
  cannot be overwritten by stale results. Portable builds keep their staged
  check/download/apply flow.

## [1.3.7] - 2026-11-23

A performance release for the terminal on the 1.x line. It reduces IPC round
trips, output-copying, React re-render work and encoding overhead; all changes
are reimplemented on the Tauri/React stack and are not 2.x syncs.

### Performance

- **terminal:** Coalesce rapid keyboard input fragments into one IPC round trip
  on Desktop. A short microtask window merges consecutive `onData` events, while
  Enter, Ctrl+C, Ctrl+D, ESC and other control bytes still flush immediately so
  interactive latency and terminal responses are unchanged. Web keeps its
  per-fragment WebSocket path.
- **terminal:** Reuse a module-level constant for the global shortcuts swallowed
  by the terminal key handler instead of rebuilding the array on every keydown.
- **terminal:** Move the recent-output ANSI scan/strip work out of the output
  emit critical section, and avoid copying the common single-chunk output batch
  by moving its buffer into the payload. Batch input now holds the session map
  lock once for all fragments instead of once per fragment.
- **terminal:** Avoid per-render object allocations in the terminal component
  (lazy refs, memoized search options) and stabilize pane callbacks so memoized
  terminal panes no longer re-render on unrelated context updates.
- **terminal:** Cache the suggestion popup's screen rectangle for a short window
  to collapse two forced layout reads per search, and count snapshot UTF-8 sizes
  without allocating an encoded copy.
- **telnet:** Avoid one heap allocation per character in the force-character-at-a-time
  write path; pass UTF-8 character slices directly to the writer.
- **encoding:** Return the owned input buffer unchanged for UTF-8 sessions instead
  of allocating a full copy during terminal write preparation.

## [1.3.6] - 2026-11-20

A feature release that brings per-connection configuration to the 1.x line and
teaches the AI Agent to read output from serial/device CLI sessions. Most of
these capabilities were first developed on the 2.x line and were reimplemented
here on the Tauri/React stack.

### Added

- **connections:** Per-connection terminal overrides. A connection can now own
  individual appearance/behaviour/rendering settings instead of inheriting the
  global ones; fields left unset keep tracking future global changes. The
  connection editor gains a "terminal appearance" category with
  use-global/customize pairs for each field, a customized count in the header
  and save footer, and an editable snapshot of keyword highlight rules. Global
  terminal pages show which connections override a field. RDP/VNC are excluded
  because they are not terminals, and keep-alive is SSH-only. The merge is
  applied in both the frontend and the Rust backend so what a session reads
  matches what the editor shows.

- **connections:** A per-connection AI system prompt, stored separately from
  the human-facing description, so environment facts ("Alpine with BusyBox",
  "no sudo for the deploy user") reach the model as instructions. Connection
  facts (session type, host, port, user, OS, architecture, kernel, hostname,
  shell, serial port/baud rate, cwd) are now composed into the system prompt,
  not just the first user turn. Multi-target requests print each target's own
  instructions beside its snapshot. Unknown values are omitted rather than
  printed as a placeholder, and all injected values are JSON-escaped.

- **ai:** @-mentioned sessions in the picker and the AI panel are now
  disambiguated by tab position (`#N`, or `#N.M` for split panes) ordered like
  the tab strip, falling back to a short session id only when names still
  collide. The @ picker also uses username@host and tags in its labels.

- **ai / serial:** A per-connection **AI capture command echo** option for
  serial connections (on by default). When enabled, the AI Agent sends commands
  verbatim and reads the result by detecting the device prompt, instead of
  reporting that output cannot be captured. Prompt detection recognizes common
  device prompts (Huawei/H3C, Cisco, embedded `console:/` style) while rejecting
  shell prompts; completion handles pagers/confirmations, idle waits, timeouts
  and a capture cap. Turning the option off keeps the previous send-only
  behaviour.

- **terminal:** Word-level completions from command history: the token under
  the caret is completed from words used in previous commands, ranked above
  whole-line suggestions, with quoted spans kept intact and shell operators
  treated as token boundaries. Suggestions now also work with the caret inside
  the line; whole-line providers are only queried at end of line so a history
  row cannot discard the rest of the command. Both behaviours are on by
  default and independently switchable (`command_suggestion_word_completion`,
  `command_suggestion_caret_midline`).

- **shortcuts:** Bindings can be unbound (Clear button, or Delete/Backspace while
  recording) and display an "Unbound" placeholder. A `special.freezeDemo`
  shortcut (unbound by default) blocks the UI thread for a configurable
  duration, guarded by the easter-egg master switch. Easter-egg assets load
  from a GitHub raw URL instead of being bundled into the app binary.

### Changed

- **command history:** Right-click an entry in the History panel to copy the
  full command text (including text truncated in the list), jump the terminal
  scrollback to where that command was executed, or send it again. Jumping
  reuses the terminal's command-location markers and briefly highlights the
  target line.

### Fixed

- **command history:** Ignore bare device-style CLI prompts such as `console:/ #`
  when recording history. Pressing Enter on an idle prompt no longer learns the
  prompt as a command; a real command typed after it is still recorded.

- **command history:** UI-sent commands (history panel, quick commands) are now
  recorded in completion history immediately instead of waiting for a shell
  echo that may never match exactly.

- **ai:** Terminal error detection no longer fires on bare words inside file
  names, paths, counts or full-screen redraws. Unambiguous phrases match
  anywhere; weak words only count at a line start or after a tool delimiter.
  Alternate-screen output is skipped, notices expire on the next command, and
  detection can be disabled with `interaction.ai_error_detection_enabled`.

- **ai:** Word completion no longer inserts a space after only one of two
  equally good matches when that would change the command (`git ch --all`), and
  the caret lands right after the inserted word.

- **update:** `latest.json` now records download URLs built from the release tag
  and asset name, instead of `browser_download_url`. Draft releases report
  temporary `untagged-*` asset URLs that 404 after publishing; this had affected
  v1.3.3–v1.3.5.

- **connections:** Override switches now name the real action ("Customize")
  and show their current state; switching back to global deletes the key rather
  than freezing the current global value.

## [1.3.5] - 2026-11-20

Another terminal-rendering performance pass on the same no-GPU virtual machine.
Where 1.3.4 made the expensive paths measurable and gave them opt-in caps, this
release removes work that was being done unconditionally, and extends frame
capping to the output shapes that were previously unthrottled.

### Added

- **terminal:** Add a **Limit overall repaint rate** setting (off by default,
  1–60 fps, default 30). Every existing cap applied only while the alternate
  screen was active, so plain scrolling output (`cat`, `tail -f`, build logs)
  still repainted once per animation frame. On a host without GPU acceleration
  each repaint costs the same regardless of how many rows changed, so those
  frames dominated CPU with nothing limiting them. The cap is consulted
  alongside the alternate-screen and unfocused-window caps, and the slowest of
  the three wins.

### Changed

- **monitoring:** Poll remote resource stats every 30 seconds instead of every
  3 seconds when nothing on screen consumes them. Previously any active SSH
  session triggered a full shell round trip on a 3-second timer even with the
  header showing the session name and no monitor panel open. The poll is slowed
  rather than stopped because the same samples populate the hardware metadata
  written back to saved connections.

### Performance

- **core:** Skip ANSI stripping for terminal output that contains no escape
  sequence or carriage return. The recent-output store ran every chunk through
  a `vte` parser plus an extra allocation under a mutex, for output that the
  stripper would return unchanged.
- **terminal:** Cut per-batch regex work in the output hot path.
  `stripTerminalControlSequences` now returns its input unchanged when there is
  no ESC/CSI byte; a shared tail check rejects credential-prompt candidates
  without a trailing colon before running four regexes; and error-keyword
  scanning uses literal pre-checks and a bounded tail before the regex.
- **ui:** Stop app-level state changes from re-rendering every terminal. `App`
  passed its header, activity bar, workspace and empty-workspace props as inline
  object literals, so those identities changed on every render and defeated
  `memo(TabWindowsWorkspace)`. The bundles are now memoised, and `XTerminal` /
  `PaneXTerminal` are memoised as well.
- **ui:** Stop building debug log payloads when debug logging is off, pause
  decorative infinite CSS animations while the window is in the background, and
  cache terminal gutter timestamp formatting within a pass (a single write
  stamps many rows with the same timestamp).

## [1.3.4] - 2026-11-19

This release is primarily a terminal-rendering performance pass, driven by
measurements taken on a virtual machine without GPU acceleration.

### Added

- **terminal:** Add an opt-in render statistics log. Every five seconds it
  records the renderer actually in use, the number of frames, rows repainted
  per second, and how many frames repainted the whole viewport. The renderer is
  identified by structure (a WebGL context, or the DOM row container) rather
  than by class name, because production builds are minified and report
  mangled names.
- **terminal:** Add a **Limit full-screen TUI frame rate** setting (off by
  default, 10/15/20/30/60 fps). It caps how often full-screen programs such as
  vim, htop and btop repaint, and only applies while such a program is active,
  so ordinary shell output is never throttled.
- **terminal:** Add a **Batch terminal output per frame** setting. It defers
  every output write to the next animation frame instead of flushing from a
  microtask, collapsing a burst of output into a single write and repaint. This
  markedly reduces CPU when output arrives in many small pieces.

### Changed

- **window:** Only create a transparent main window when the appearance settings
  actually ask for a translucent one. The window was previously transparent
  unconditionally, which forced the compositor to alpha-blend the whole surface
  against the desktop on every frame — a pure-CPU cost on hosts without GPU
  acceleration. The flag is read at startup because it cannot change at runtime,
  matching the existing "requires restart" note.

### Fixed

- **window:** Remove two backdrop blurs that covered most of the window. The
  modal child-window scrim blurred the entire main window behind it, which made
  the Settings window feel frozen; a flat dim gives the same separation for
  free. The lock screen blurred a background that was already 85% opaque.
- **logging:** Stop emitting two debug entries for every Tauri command. Opening
  the Settings window issues hundreds of calls, which filled the frontend log
  queue and flushed multi-megabyte batches over IPC, stalling the UI. Command
  tracing is now an independent switch, off by default; errors are still always
  logged.
- **terminal:** Make the alternate-screen repaint cap actually engage. It
  previously only triggered once the output queue exceeded 32 KiB, but a typical
  TUI frame is far smaller, so the cap never ran. It now applies whenever a cap
  is configured.

### Tooling

- Add `scripts/terminal-load-test.py`, a synthetic terminal load generator with
  five output shapes (spinner, progress, stream, fullscreen, dashboard) and
  configurable frame rate and colour density, plus
  `scripts/windows-sample-cpu.ps1` and
  `scripts/windows-check-render-process.ps1` for measuring CPU on Windows.
  Rendering happens in WebView2 child processes, so the scripts measure the
  whole process tree and break the total down by process type. See
  `docs/terminal-performance-testing.md`.

## [1.3.3] - 2026-11-18

This release syncs several capabilities from the 2.x line into this
Tauri/React codebase. Each one was reimplemented here rather than copied, so
the implementation differs while the behaviour matches.

### Added

- **import:** _(from 2.0.6)_ Import WindTerm local shells and one-key accounts alongside SSH sessions. `Shell` sessions become Local Terminal connections (shell path, arguments and working directory, with `$(HomeDir)` expanded), and `onekeys.config` entries become saved accounts that sessions referencing `session.oneKey` share instead of embedding duplicate passwords.
- **file-explorer:** _(from 2.0.6)_ Bind `F3` to upload into the current directory and `F4` to download the current selection, reusing the same handlers as the context-menu actions. Both bindings are contextual and configurable from the shortcut settings.
- **transfer:** _(from 2.0.6)_ Reveal a completed download in the OS file manager from the transfer row's context menu. The action goes through the existing opener wrapper, so the Web build never touches native APIs.
- **terminal:** _(from 2.x)_ Complete file-system paths in the command-suggestion popup. The token under the cursor is parsed into a directory and a partial name, the directory is listed over SFTP for SSH sessions or from the local file system for Local sessions, and each row inserts the whole replacement line with shell metacharacters escaped. Escaped separators keep their byte ranges, only the current token may use `~`, quoted tokens and expansions are skipped, and names containing control or invisible/reordering Unicode characters are hidden. Bare names starting with `~`, `=` or `-` are anchored to `./`. Listings are cached for two seconds per session, published progressively so history and quick commands appear first, and skipped on Windows consoles and Telnet/Serial sessions.
- **terminal:** _(from 2.x)_ Skip command and path suggestions inside a nested remote shell. `ssh`, `docker exec -it`, `kubectl exec -it`, `lxc exec`, `nsenter`, `chroot`, `wsl` and `adb shell` open a shell whose file system is not this session's, so the popup offered the outer host's paths. A per-session depth unwinds on `exit`/`logout`/Ctrl+D, resets on reconnect, and also releases when the outermost prompt reappears (a failed `ssh` announces nothing). Same-host switches such as `su` and `sudo -i` are unaffected.
- **ai:** _(from 2.0.0)_ Per-credential custom HTTP request headers (name/value, up to 32 per provider). Values are encrypted at rest, masked in the settings API, and applied to chat, agent, and model-discovery requests; managed transport headers such as `Host` and `Content-Length` are rejected.
- **themes:** _(from 2.x preview.7)_ Import Windows Terminal color schemes, including JSONC files with comments and trailing commas. Every scheme in the file becomes a custom NyaTerm theme.
- **files:** _(from 2.x preview.5)_ Add a read-only, virtualized HEX viewer for binary files, reachable from the preview's "View as HEX" action; it supports offset jump and warns when the file is truncated.
- **themes:** _(from 2.0.2)_ Add the missing Dracula Light, WindTerm Dark, and WindTerm Light built-in themes.
- **monitoring:** _(from 2.0.2)_ Show logged-in users (account plus session count) on the remote resource panel. The `who` probe is time-bounded, runs on its own 30-second cadence, and reports "unavailable"/"failed" instead of silently showing an empty list.
- **connections:** _(from 2.x)_ Save default session settings per connection kind. New connections of a kind start from the saved template (proxy, terminal behavior, SSH algorithms, SFTP, post-login, recording); name, group, description, tags and icon stay per-connection. Templates live in a new additive `settings/doc/default-session` document, and unknown kinds are preserved for forward compatibility.
- **search:** _(from 2.0.5)_ Rank saved-connection results by text relevance (exact > prefix > substring, name/host > type > description > id, with tag and group hits promoted) while searching the start page; the chosen sort order still applies when no query is active.

### Changed

- **terminal:** _(from 2.0.4)_ Stop using `/dev/null` as the zsh injection history file. Zsh creates a lock beside the history file, so an unprivileged user with `HISTSIZE`/`SAVEHIST` set got `locking failed` and the injection leaked into saved history. Push an anonymous in-memory list instead and pop it only when the push succeeded.
- **ui:** _(from 2.0.5)_ Label 1024-based byte sizes with IEC units (`KiB`, `MiB`, `GiB`, …) instead of the decimal `KB`/`MB`/`GB` names across the resource monitor, header status, transfer panel, process manager, recording panel, update dialog, and asset list. Every one of them paired decimal labels with a 1024 divisor. The remaining copies were closed out too: `lib/utils.ts::formatSize` (used by five file-explorer surfaces), the `PropertiesDialog` helper, the AI max-file-size label, and the SFTP buffer-size label and description in every locale.
- **branding:** Rename the application to `nyaterm-classic` (display name "NyaTerm Classic", Tauri identifier `com.kang.nyaterm.classic`) so the 1.x line can coexist with the 2.x GPUI build.
- **storage:** Move the Desktop data directory to `~/.nyaterm-classic` (previously `~/.nyaterm`) so classic does not contend for the same `nyaterm.redb` file lock as other NyaTerm builds. Existing `~/.nyaterm` data is left untouched; migrate it manually if needed. Internal crate names, MCP sidecar name, and `nyaterm://` deep-link scheme are unchanged.
- **build:** Add the `custom-protocol` Cargo feature (standard Tauri template entry) so release builds embed the frontend assets instead of falling back to the `localhost:1420` dev URL. Required when building with plain `cargo build` rather than `tauri build`.

### Fixed

- **storage:** _(from 2.0.6)_ Classify database failures and offer a confirmed rebuild. A missing or corrupt `nyaterm.redb` used to abort startup with a generic error. Detection now separates missing, corrupt, newer-schema, in-use, undecodable and unavailable states; only missing/corrupt is rebuildable. A rebuild is confirmed against the exact file digest, stages and validates the replacement first, archives the damaged file as `nyaterm.redb.corrupt-*`, and restores the original if publishing fails. Credentials, known hosts and other files in the data directory are never touched.
- **backup:** Import configuration backups written by the 2.x line. The 2.x writer switched to an `NYASNAP` v2 envelope keyed by Argon2id with the header as AES-GCM associated data; this branch only read the legacy `nonce || ciphertext` SHA-256 form, so every 2.x export failed with `aead::Error`. Read both envelopes, keep writing the current one, and accept the 2.x default `"default"` activity-bar layout string when restoring settings.
- **backup:** Restore imports of original 1.x backups when the master password contains surrounding whitespace or is a single space. The Argon2id envelope reader trimmed the password before deriving its key; legacy backups derive from the raw password bytes, so a whitespace-only password was rejected with "master password must not be empty" before decryption. Legacy envelopes now use the unmodified password bytes, matching the original writer.
- **monitoring:** _(from 2.x)_ Report network rate sample validity instead of a silently clamped zero. A reset counter, a reboot, or a sysinfo read returning zero used to produce `0 B/s`; a long sampling gap produced a spike. Rates now carry `available` / `counter_reset` / `interrupted` / `unavailable` / `warming_up`.
- **mcp:** _(from 2.x)_ Re-read the discovery document on every reconnect. A restarted NyaTerm republishes it with a new port and token, and the forwarder used to keep retrying the dead endpoint, leaving every external MCP client offline until it was restarted too.
- **connections:** Delete a multi-connection selection in one rewrite. It previously called the single-delete command per connection, rewriting the whole sessions table each time.
- **history:** Bound the persisted command-history table. `append_command_history` never removed rows, so the redb table grew without limit for a long-lived install even though the in-memory list was trimmed. It now keeps the 5000 most recently used rows and copies the whole database to a verified `nyaterm-history-backup-*.redb` first; a backup that cannot be read back keeps the rows.
- **terminal:** Do not learn a Tab echo line that is not a completion. The post-Tab resync accepted any candidate derived from the echo line, so a redrawn prompt or unrelated output could be recorded as a command the user ran. A recovered command now has to extend the text typed before Tab.
- **terminal:** `git log` and other pager-backed commands no longer open the command-suggestion popup when pager keys such as `d`, `f`, `j` or `k` are pressed.
- **build:** `scripts/sync-version.mjs` still looked for the pre-rebrand `nyaterm` package name in Cargo.lock and aborted before writing it, so a version bump left the lockfile out of sync. It now resolves the app package name from Cargo.toml.
- **packaging:** Place the MCP sidecar as `nyaterm-mcp.exe` beside the executable, which is where the portable layout resolves it; previously only the target-triple-suffixed name was shipped, so MCP reported "sidecar is not installed".

## [1.2.12] - 2026-09-29

### Added

- **pane-focus:** Add focused-pane mode and native fullscreen shortcuts while keeping inactive panes mounted for fast restoration.
- **conpty:** Bundle Microsoft ConPTY for Windows, verify it during packaging, expose its status/version in support information, and preserve it across portable updates.
- **terminal:** Add command navigation and clear shortcuts, including fallback handling for SSH sessions and common interactive-shell quit commands.
- **terminal:** Route raw binary input through terminal sessions and synchronized peers, including Telnet IAC escaping for application data.
- **file-explorer:** Add terminal-oriented context actions for paths and directories, including opening a directory in a new terminal.
- **import:** Add confirmation for backup restore and clarify source handling in the import dialog.
- **ai:** Refactor provider and model settings to improve provider configuration, model discovery, and reasoning-effort metadata.
- **terminal-gutter:** Track gutter layout per session and dynamically size the line-number column.
- **terminal:** Add a shortcut for opening the new-session menu.

### Changed

- **rdp-clipboard:** Negotiate file-transfer capability before advertising file clipboard formats and refine clipboard format handling.
- **sftp:** Detect whether an interactive shell is available and prevent shell-command execution in SFTP-only sessions.
- **terminal:** Track timestamps against lines actually written by the terminal so gutter timestamps stay aligned with output.
- **ui:** Hide the empty-workspace logo when a custom background is active.
- **quick-commands:** Parent categories now show only commands assigned directly to that category instead of including child-category commands.

### Fixed

- **terminal:** Make Clear All clear scrollback while preserving the active shell cursor/redraw behavior.
- **zmodem:** Honor negotiated control-character escaping during uploads, improving transfers through nested SSH sessions and other control-sensitive paths.
- **ai:** Allow keyless local provider discovery and preserve provider-default reasoning effort settings.
- **terminal:** Restore SSH fallback command navigation and improve fallback detection for commands such as `psql \q` and `sqlite3 .quit`.
- **local-terminal:** Use the platform default shell when opening a local terminal.
- **windows-7:** Prepare bundled ConPTY before the Win7 Cargo build so release builds can resolve the packaged backend correctly.

### Performance

- **terminal:** Add output-pressure tracking and more efficient logical-line handling to reduce work during heavy output, long lines, and wrapped-line bursts.

## [1.2.11] - 2026-09-22

### Added

- **serial:** Add drag-and-drop uploads for XMODEM, YMODEM, and ZMODEM transfers.
- **auth:** Add reusable saved accounts with an independent password source for connection authentication.
- **file-explorer:** Add an optional lazy-loading directory tree for large remote filesystems.
- **ssh:** Add a host-fingerprint / known-hosts management interface.
- **keys:** Allow copying the public key derived from a saved private key.
- **sftp:** Add compatibility mode for servers that require more conservative SFTP session handling.
- **file-explorer:** Add “upload folder contents” and rework SFTP copy, cut, and paste workflows.
- **ui:** Add an OpenWrt connection icon.

### Changed

- **assets:** Replace OS/accelerator filtering with tag-based asset filtering.
- **tabs:** Keep file-document tabs grouped with their related session and choose a related tab more predictably when a document closes.
- **cloud-sync:** Increase the default sync debounce to 60 seconds and avoid unnecessary remote validation when sync settings have not meaningfully changed.
- **terminal:** Respect application lock state across terminal focus, refresh, keyboard input, and context-menu interactions.

### Fixed

- **security-auth:** Invalidate cached plaintext credentials after saving or deleting secrets.
- **terminal:** Fix local-terminal Ctrl+U behavior under IME input and allow WebAssembly/image-addon size reporting required by terminal image decoding.
- **file-explorer:** Preserve tree focus while virtualizing large directory trees.
- **updater:** Include the MCP sidecar in portable builds and avoid stale MCP backup collisions during updates.
- **importer:** Tolerate unreadable WindTerm auto-login data instead of aborting the import.
- **docker:** Support standalone Docker Compose v2 installations.
- **known-hosts:** Stabilize known-hosts management actions.
- **windows:** Guard local terminal creation on older Windows versions that do not support the required backend.
- **ai:** Avoid UTF-8 truncation panics, prevent Agent commands from waiting indefinitely for interactive input, and restore the default Claude model when a request leaves it blank.
- **telnet:** Cancel pending connection creation when a Telnet attempt is aborted.
- **settings:** Fix production builds requiring two confirmation clicks before the settings window closes.
- **activity-bar:** Hide the empty side area after all activity-bar items on that side are hidden.

## [1.2.10] - 2026-09-13

### Added

- **notes:** Add note export to a local folder, including UI integration, tests, and localized copy.
- **terminal:** Add an optional foreground-intense color for bold default text so themes can highlight bold output independently.
- **ai:** Show Codex foreground command execution and output in the terminal using the configured terminal presentation limit.
- **terminal-search:** Add configurable wrap-around navigation when moving between search matches.
- **file-explorer:** Show file and directory details on hover.
- **sftp:** Add an explicit SFTP-only SSH runtime and support file-browser sessions for servers that do not provide an interactive shell.

### Changed

- **rdp:** Remove the hover operation bar and improve transparent-window behavior on macOS.

### Fixed

- **linux:** Prefer native Wayland for AppImage webviews to improve input-method compatibility.
- **terminal:** Fix Linux IME stale composition cleanup, duplicate Backspace handling, and macOS modifier-first IME input loss.
- **terminal:** Preserve text selection and copy behavior when terminal mouse tracking is enabled, keep custom-copy Ctrl+C interrupt behavior, and prevent right-click paste from leaking terminal mouse input.
- **terminal:** Fix wide-character drag-selection boundaries.
- **terminal:** Restore input focus after terminal rebuilds without stealing focus from inactive panes, preserve foreground focus, and keep the viewport at the bottom after switching terminals.
- **ssh:** Import `IdentityFile` keys from SSH config more safely while preserving authentication semantics.
- **ssh:** Fix recursive zsh shell-integration hooks and preserve percent-escaped working directories across reconnects.
- **sftp:** Retry transient directory-list failures, distinguish recoverable directory-upload errors from fatal failures, preserve partial-upload results, and keep permit waits outside setup timeouts.
- **cloud-sync:** Create nested WebDAV sync directories level by level.
- **ai:** Fix Codex CLI launcher resolution on Windows and prevent active or reconnected AI streams from being incorrectly rebound or reported as occupied.
- **docker:** Allow restarting containers to be stopped instead of leaving them stuck in an unactionable state.
- **window:** Avoid the Linux X11 modal topmost pulse that could crash affected desktop environments.
- **updater:** Target the correct Linux DEB artifact in update manifests.
- **assets:** Combine asset filters by dimension so multiple selections within one dimension are aggregated while different dimensions still intersect.
- **ui:** Avoid duplicate native password reveal buttons on Windows.
- **settings:** Apply theme-designer changes immediately and preserve settings drag interactions while restoring terminal focus correctly.

### Performance

- **terminal:** Bound logical-line scans used by keyword highlighting and line-boundary detection to avoid excessive work on very long output.

## [1.2.9] - 2026-09-07

### Added

- **resource-monitor:** Add recent upload/download traffic history with per-session network-interface selection.
- **terminal:** Add an optional setting to restore the last known working directory after SSH reconnects; the option is disabled by default.
- **suggestions:** Show the full command in a tooltip when a command suggestion is truncated, including hover and keyboard-selection support.
- **header:** Keep custom window controls from taking terminal focus on mouse down.

### Changed

- **saved-connections:** Redesign search as an expandable control with automatic focus, keyboard navigation, Escape handling, and clear/collapse actions.
- **tabbar:** Refine active and inactive tab background contrast.
- **terminal:** Reorganize dynamic-title controls while preserving their existing behavior.

### Fixed

- **ssh:** Prevent startup shell-integration injection from swallowing user output, cancel pending integration before capture commands, and shorten stalled injection handling with improved diagnostics.
- **terminal:** Refresh terminal rendering when the window regains focus while preserving the active terminal input focus.
- **terminal:** Harden last-working-directory restoration across SSH reconnects.
- **file-explorer:** Fix Windows local-terminal working-directory synchronization, including drive-letter case and trailing-separator differences.
- **terminal:** Prevent Windows middle-click paste from being forwarded as Vim mouse input.
- **zmodem:** Use a non-blocking file picker so file selection does not block the terminal event flow.
- **settings:** Restore the committed language when discarding a preview and preserve the expected cancel-and-close flow.
- **notes:** Keep rename input focus when renaming from the context menu.
- **monitoring:** Detect primary NICs more reliably on LXC, VM, bond, and bridge-based hosts while continuing to filter derived virtual interfaces.
- **ui:** Align icons and reserved checkmark space in checkable menu items.
- **suggestions:** Keep truncated-command tooltips above the command-suggestion popup.

### Performance

- **resource-monitor:** Avoid top-level application rerenders while collecting network traffic history.

## [1.2.8] - 2026-09-03

### Added

- **ssh:** Prune NyaTerm's Bash shell-integration injection commands from remote command history, including shells with `cmdhist` disabled.

### Changed

- **editor:** Restyle the built-in editor's search panel with theme-aware controls, focus rings, and checkbox accents.
- **ssh:** Keep shell-integration injection lines within remote Linux PTY canonical-input limits.

## [1.2.7] - 2026-09-02

### Added

- **editor:** Add Ctrl+mouse-wheel font zoom in the built-in file editor.
- **quick-commands:** Add a terminal context-menu action to save the current selection as a quick command.
- **terminal:** Add dynamic terminal tab titles.
- **sftp:** Add shared helpers for directory listing and file-stat commands.
- **ai:** Improve AI stream control event handling and add localized MCP error messages.

### Fixed

- **file-drop:** Only accept the topmost eligible element as the drop target, improving nested drop-zone detection.
- **quick-commands:** Preserve the terminal selection while saving it as a quick command.
- **terminal:** Scroll to the cursor when typing with a selection and restore focus after switching tabs.
- **terminal:** Restore tab titles when waking a hibernated session fails.
- **rdp:** Preserve the configured jump host when editing an RDP connection.

## [1.2.6] - 2026-09-01

### Added

- **mcp:** Add the NyaTerm MCP sidecar, active-session reporting, session-open requests, permission modes, and Windows ACL-based discovery support.
- **security:** Split screen locking into independent startup-lock and idle-lock settings.
- **ssh:** Add SSH config import with `ProxyJump` and multi-hop connection support.
- **sftp:** Add configurable pipeline depth and symlink-target management in file properties.
- **terminal:** Add configurable right-click actions and an action to save selected text as a quick command.
- **asset-monitoring:** Improve incremental asset patches and session validation.

### Changed

- **terminal:** Streamline tab context-menu behavior and improve terminal refresh and keyword-highlighting effects.
- **dependencies:** Update Tauri and Rust dependencies and add the Windows security features required by MCP discovery.
- **network:** Refresh tunnel row and runtime badge layout and styling.
- **i18n:** Add translations for MCP permissions, SFTP pipeline depth, terminal actions, symlink targets, and lock settings.

### Fixed

- **clipboard:** Support paste from Windows clipboard history in the terminal.
- **serial-send:** Preserve panel input when the serial send panel is hidden and shown again.
- **editor:** Reuse the terminal selection color in the built-in file editor.
- **ai:** Prevent IME composition Enter from submitting an AI prompt.

### Performance

- **terminal:** Add output acknowledgement coordination, snapshot restoration, and more reliable refresh behavior.

### Documentation

- **development:** Document all four locale files used by the project.

## [1.2.5] - 2026-08-24

### Added

- **terminal:** Add session hibernation and output control, image rendering, foreground-frame fallback, and improved background draining.
- **credential-autofill:** Detect credential prompts and offer saved credential completion.
- **file-explorer:** Automatically synchronize the file browser with the terminal working directory.
- **zmodem:** Improve upload conflict handling and surface remote upload refusals.
- **send-command-panel:** Add an all-windows target and an option to clear serial input after sending.
- **settings:** Add drag-and-drop ordering for terminal font stacks.
- **windows-7:** Add fixed WebView2 runtime support and dedicated Windows 7 build workflows.
- **ai-settings:** Add selectable API formats, improve model handling, and update the default Ollama URL.
- **remote-desktop:** Add proxy and jump-host selection for RDP and VNC connections and improve RDP error reporting.
- **custom-icons:** Add custom connection icon management.
- **ssh:** Add SSH runtime modes for external invocation and protocol-link handling.
- **activity-bar:** Add visibility management and reset actions.
- **floating-panels:** Add floating mode and persisted floating-panel state.
- **quick-commands:** Add command-variable parsing and interactive value resolution.
- **editor:** Add configurable internal/external file-open modes.
- **session:** Add external local-session invocation with working-directory validation.

### Changed

- **terminal:** Improve transparent background handling and event-listener lifecycle management.
- **app:** Improve child-window lifecycle handling on macOS and consolidate overlay dialogs.
- **ai:** Improve session-history request tracking and error handling.
- **i18n:** Add and update localized text for the new settings and workflows across all supported languages.

### Fixed

- **terminal:** Reset the running-command state when OSC 133 reports command boundaries.
- **webview:** Add guarded hard-reload shortcut handling.
- **ai:** Prevent IME composition Enter from triggering prompt submission.

### Documentation

- **ssh:** Document local terminal invocation, connection link formats, and RDP/VNC proxy and jump-host support.

## [1.2.4] - 2026-08-17

### Added

- **file-editor:** Add text document editing with unsaved-change protection and safe close handling.
- **sftp:** Classify text files for editor opening while preserving underlying SFTP errors.
- **ssh:** Add configurable SSH Agent forwarding.
- **file-explorer:** Add a move dialog with validation and tests.
- **terminal-session:** Improve working-directory handling for local and WSL commands.
- **child-window:** Add a drag-only macOS header region and recoverable child-window command queues.

### Fixed

- **saved-connections:** Prevent duplicate folder submissions.
- **context-menu:** Prevent right-click from activating menu items.
- **local-terminal:** Improve shell-path input behavior and localization.
- **macos:** Align child-window traffic-light controls more consistently.

### Performance

- **terminal:** Add alternate-screen tracking, output scheduling, and the DEC 2026 frame gate.
- **window:** Reduce child-window startup work and loading time.

### Documentation

- **ssh:** Document external invocation and supported protocol links.

## [1.2.3] - 2026-08-13

### Added

- **vnc:** Add VNC sessions with saved-connection support, workspace integration, authentication handling, clipboard support, input forwarding, and framebuffer rendering.
- **remote-desktop:** Add shared remote desktop frame, viewport, renderer, and surface utilities used by VNC and RDP panes.
- **terminal:** Add session recording and transcript management flows.
- **asset-management:** Add connection time tracking, display formatting, asset sorting, and persisted sort state.
- **cloud-sync:** Add a cloud snapshot decoding helper and integrate it into the main sync flow.

### Changed

- **rdp:** Enhance RDP behavior through shared remote desktop rendering and viewport handling.
- **settings:** Normalize settings tab handling and update terminal context menu behavior.
- **process-manager:** Optimize process display settings and remove unused process-management code.
- **ui:** Remove unnecessary transparent background styling from the wallpaper surface.
- **tuning:** Change release panic behavior from unwind to abort.
- **i18n:** Add and update localization strings for VNC, recording, and connection time across supported languages.

### Fixed

- **cloud-sync:** Validate source hashes while decoding snapshots to improve sync data integrity.
- **temporary-session:** Complete temporary session recreation flows and fix context-menu actions for temporary SSH links.

### Documentation

- **readme:** Update README content for RDP and VNC support.
- **docs-site:** Update session type documentation with RDP and VNC support.

## [1.2.2] - 2026-08-12

### Added

- **build:** Add Windows MSI packaging support to the release workflow.
- **quick-commands:** Add drag-and-drop sorting for quick command categories.
- **rdp:** Enhance RDP resizing and dynamic display behavior.
- **header:** Add predefined macOS edit menu items.

### Changed

- **terminal-gutter:** Improve gutter layout constants for better readability.
- **i18n:** Add quick command labels for category creation and custom sorting.

### Fixed

- **rdp:** Improve physical key capture, lock-key routing, right Shift handling, and UPN username preservation during authentication.
- **terminal:** Reset timestamps to terminal startup time when Clear All is used.
- **release:** Prevent release crashes when remote metadata is corrupt.

### Documentation

- **readme:** Update Discord and WeChat group links.

## [1.2.1] - 2026-08-11

### Added

- **rdp:** Add RDP sessions with workspace integration, certificate verification, text clipboard support, fit-window/fixed display modes, bounded reconnects, and improved keyboard/IME handling.
- **ssh:** Add SSH Agent authentication and forwarding, including platform-aware endpoint selection, hardware-key approval prompts, retry handling, and device-local sync behavior.
- **ssh:** Add SSH connection profiles and terminal type selection so network devices can disable Linux-shell-only helpers without changing saved SFTP preferences.
- **cloud-sync:** Add current-remote-snapshot metadata, automatic pull of remote-only changes, conflict recovery actions, snapshot management, migration, and garbage collection for legacy snapshot objects.
- **terminal:** Add a high-volume terminal output drain, gutter refresh support, timestamp restoration, command suggestion shortcuts, new tab/view commands, and session quick switcher scrolling.
- **recording:** Add per-connection recording settings and expand recording capture, formatting, search, and test support.
- **quick-commands:** Add category management improvements, category movement and sorting, export support, and merge behavior that preserves imported categories.
- **saved-connections:** Add expand/collapse-all folder actions with persisted expansion state.
- **file-explorer:** Add footer statistics for selected and total file sizes.
- **macos-menu:** Add native macOS menu handling and window-management commands.
- **serial-send:** Enhance the serial send panel with dedicated state management.
- **about:** Add support information and community entry points.

### Changed

- **settings:** Introduce shared draft-state handling for settings pages so manual sync actions and unsaved changes are coordinated more consistently.
- **layout:** Improve resize handle styling/interactions and align ActivityBar background styling.
- **claude:** Refactor Claude Code invocation handling for agent execution flows.
- **saved-connections:** Simplify saved-connection expansion state handling and remove stale last-opened connection state.
- **quick-commands:** Optimize command suffix stripping and category validation behavior.
- **i18n:** Add and refresh localization strings for RDP, SSH Agent/profile settings, cloud-sync recovery, recording, terminal suggestions, file selection totals, macOS menu actions, and quick-command export.

### Fixed

- **rdp:** Improve cursor handling, viewport resizing, and keyboard input behavior.
- **ssh:** Increase command injection timeout to improve reliability on slower shells.
- **app-context:** Restrict screen locking to the primary main window.
- **about:** Improve support information handling and display.

### Performance

- **terminal:** Improve responsiveness during large output bursts by batching and draining terminal output more efficiently.

### Documentation

- **readme:** Add Discord and WeChat group badges for community engagement.

## [1.2.0] - 2026-08-04

### Added

- **gpu-npu-monitor:** Add remote GPU and NPU overviews to the application header/status area, with shared overview hooks and compact hardware cards for active SSH sessions.
- **ui:** Add a Notes panel toggle to settings and include Notes in the default workspace configuration.
- **file-explorer:** Support selecting multiple directories for uploads.
- **terminal:** Show the saved-connection group path in TabBar tooltips.

### Changed

- **monitoring:** Integrate remote GPU/NPU overview data with the existing GPU and Ascend NPU monitor panels.
- **i18n:** Add localization strings for GPU/NPU overviews, Notes, and saved-connection group labels across supported languages.

## [1.1.19] - 2026-08-04

### Added

- **notes:** Add a Notes panel and note editor with autosave, toolbar/status UI, tree navigation, context menus, persistent storage, migrations, and sync/backup snapshot support.
- **asset-monitoring:** Add an asset monitoring workspace with grouped connection views, breadcrumb navigation, table/card layouts, formatters, and resource/GPU monitor integration.
- **sftp:** Enhance directory downloads and transfer handling, including improved pipeline behavior and SCP original-property handling.
- **zmodem:** Add local path tracking for Zmodem transfers and reveal-in-file-manager support.
- **quick-commands:** Add import preservation options for merging quick commands.
- **ai:** Add native tool-call mode with error handling for agent workflows.
- **import:** Improve WindTerm session import, including master-password prompts and merge handling.
- **external-open:** Enhance SSH URL parsing and external connection handling.
- **capabilities:** Allow hidden files in the temporary directory capability.

### Changed

- **monitoring:** Improve system information collection in the remote stats script.
- **ui:** Simplify the Asset toolbar by removing unused title/count display.
- **i18n:** Add and update localization for notes, asset monitoring, WindTerm master-password prompts, CPU sampling, and external inline-password guidance.

### Fixed

- **monitoring:** Handle `null` values in CPU usage and percentage formatting.
- **terminal:** Refocus the search input when Find is triggered while the search bar is already open.

### Performance

- **notes:** Refactor the Notes panel and tree components for better performance and usability.

### Documentation

- **ssh:** Clarify SSH connection guidance around inline password usage.

## [1.1.18] - 2026-07-29

### Added

- **external-open:** Add external connection handling, URL parsing, saved-connection matching, and confirmation dialogs for opening connection links from outside NyaTerm.
- **terminal:** Add `TerminalFitScheduler` with tests, improve search lifecycle hooks, add external file-drop handling, and refresh terminal layout/output more reliably after reconnect and visibility changes.
- **session:** Add session attachment support and hibernation logging.
- **sftp:** Add remote file copy operations with controller support, and preserve permissions during remote file write operations.
- **file-explorer:** Add an editable path button, search entry, active session targeting, and improved file-window target handling.
- **header:** Add header status visibility controls, confirmation dialogs, and refreshed header actions/icons.
- **security-auth:** Add credential, private key, and OTP management dialogs, plus improved key-management UI and backend handling.
- **network:** Add Proxy and Tunnel management pages.
- **quick-commands:** Add command preview, copy support, and category selection state management.
- **ai-settings:** Add AI model refresh and improve model discovery.
- **updater:** Add automatic updates for Windows portable builds.

### Changed

- **sftp:** Modularize the SFTP backend and improve upload cancellation handling.
- **importer:** Unify secret encryption logic across importers.
- **updater:** Unify portable updates on Cloudflare R2.
- **docker:** Update Docker command paths.
- **settings:** Improve close handling and unsaved-change confirmation.
- **i18n:** Update credential, SSH key, proxy/tunnel, terminal display, header status, and external-connection localization.

### Fixed

- **terminal:** Improve terminal snapshot serialization and reconnect handling, refresh timestamps on Enter and suggestion execution, and improve reconnect/session handling for synchronized input.
- **sync:** Use session input peer IDs for sync peer selection.
- **window:** Avoid child-window loading flashes and improve child-window logging/conflict warnings.
- **sftp:** Improve directory removal logic with raw path matching.
- **file-explorer:** Improve resize handling in the path bar.
- **ssh:** Increase command injection timeout from 5 to 30 seconds.
- **redaction:** Add marker-value redaction for sensitive data.
- **ui:** Improve responsive class names in SSH and new-session forms.

### CI

- **updater:** Add signed portable target verification for `latest.json`.
- **gitee:** Improve Python dependency installation in the release workflow.

### Documentation

- **readme:** Update badge links and formatting in the Chinese README.

## [1.1.17] - 2026-07-22

### Fixed

- **csp:** Allow `blob:` image URLs in the content security policy so generated or previewed image assets can render correctly.
- **terminal:** Improve hibernation logic in the XTerminal component.
- **zmodem:** Improve conflict resolution handling during Zmodem uploads.

### Documentation

- **readme:** Add macOS installation instructions to the README files.
- **i18n:** Clarify Zmodem conflict resolution messages.

## [1.1.16] - 2026-07-21

### Added

- **temporary-link:** Consolidate temporary connection handling and extend protocol support for one-off sessions.
- **file-explorer:** Add file copy operations, backend file-operation support, raw path-token handling, directory navigation caching, and file preview flows.
- **quick-commands:** Add a script editor for quick commands and support copying commands.
- **terminal:** Add customizable timestamp formats, SSH keep-alive mode settings, disconnected output flushing, improved command-suggestion keyboard navigation, and disconnected tab indicators.
- **settings:** Add app-language saving so language changes persist through the backend.
- **icons:** Add Kubernetes, macOS, and Android icon assets, and improve remote system icon auto-detection after session start.
- **zmodem:** Add upload timestamp preservation and safer conflict prompts for unverified destinations.
- **saved-connections:** Add keyboard navigation, connection element registration, and move-to-group actions.
- **ai:** Add Codex and Claude Code integration, run-mode selection, model filtering, custom provider settings, command target context, and dynamic tool-call tracking.
- **clipboard:** Improve clipboard writing on Windows and fallback behavior.
- **cloud-sync:** Add connection success handling and improve portable snapshot handling for sync and backup modes.
- **theme:** Add a theme designer dialog and enhanced theme management.
- **i18n:** Add Traditional Chinese localization and language handling.
- **session-targets:** Enhance Send Command target structure and compatibility.
- **tunnel:** Add tunnel runtime state management and connection tracking.
- **tray:** Add macOS tray icon support.
- **monitoring:** Add an Ascend NPU monitoring panel and settings.
- **header:** Add remote stats support and header status mode.

### Changed

- **header:** Streamline session icon handling.
- **ssh:** Rename and update suppressed output handling helpers.
- **terminal:** Update local PTY environment configuration for cross-platform compatibility.
- **sftp:** Normalize remote directory paths and improve path joining.
- **settings:** Rename macOS IME compatibility to a general IME compatibility setting.
- **ai:** Remove redundant Markdown rendering from the agent step view.

### Fixed

- **clipboard:** Keep the arboard clipboard alive and enable Wayland support.
- **context:** Refactor startup restore logic for tab sessions.
- **panel:** Improve pointer-event handling in saved connection items and group nodes.
- **cloud-sync:** Initialize OpenDAL transport for all providers and upgrade OpenDAL to 0.58.
- **build:** Use `ring` instead of `aws-lc-rs` for the russh crypto backend.
- **terminal:** Fix GBK encoding support and duplicate input with Fcitx IME on Linux.
- **icons:** Improve remote system distribution matching.

### Performance

- **terminal:** Improve terminal output handling, performance mode behavior, and WebGL resource management.

### Documentation

- **i18n:** Add SSH keep-alive descriptions and update localization for new workflows.
- **images:** Update product images for dark and light themes.

## [1.1.15] - 2026-07-14

### Fixed

- **app:** Remove macOS-specific tab close handling and streamline effect dependencies.

### CI

- **gitee:** Improve the release workflow trigger and tag resolution.

## [1.1.14] - 2026-07-14

### Added

- **telnet:** Add auto-login and startup command support.
- **tabs:** Add tab locking to prevent accidental closure.
- **terminal:** Add a remote color OSC guard for serial sessions, terminal zoom settings, enhanced theming and layout adjustments, and standardized input behavior.
- **remote-stats:** Integrate remote system statistics and connection icon auto-detection.
- **ai:** Add reasoning-effort selection to model controls.
- **connections:** Add multi-select delete support and restore the last opened connection and expanded group state.
- **webview:** Prevent reserved shortcuts from being intercepted by webview content.
- **fonts:** Add JetBrainsMono Nerd Font Mono and update font defaults.
- **xterm:** Isolate the xterm WebGL texture atlas for NyaTerm.
- **build:** Add unlock rescue scripts and a post-install xterm WebGL patch.
- **docker:** Add Docker sudo password handling.
- **security-auth:** Add saved-password authentication support, credential unlock actions, credential reordering, Tab-key credential selection, and active-session-aware OTP management.
- **appearance:** Add window transparency controls and improved font handling.
- **i18n:** Add Korean localization.
- **sftp:** Add SFTP settings and a remote file browser.
- **header:** Add an unsplit action.

### Fixed

- **terminal:** Improve clipboard behavior in the terminal context menu, prevent stale macOS trackpad selection, and support Ctrl printable terminal keys.
- **stats:** Ensure disk data files are created and populated correctly.
- **panel:** Fix progress calculation for multiple units.
- **network:** Limit connection options to SSH connections.
- **ssh:** Ensure the post-login timer only arms during the normal phase.

### Performance

- **terminal:** Improve output handling and flow control.
- **zmodem:** Add upload and download drain mechanisms.

### Documentation

- **readme:** Update contributor image links.
- **installation:** Add direct Windows portable download links.
- **images:** Add monitoring and import images for the docs site.
- **changelog:** Update changelog entries through `1.1.13`.

## [1.1.13] - 2026-07-06

### Added

- **gpu:** Add a GPU monitoring panel for SSH hosts, showing driver/CUDA versions, per-GPU utilization, memory, temperature, power, fan, and a searchable per-process GPU usage list, with a `Show GPU Monitor` toggle and configurable poll interval.
- **docker:** Add a Docker management panel for SSH hosts covering containers, images, volumes, networks, and Compose projects, with container details, logs, exec/enter, lifecycle actions, and confirmed destructive operations such as remove, kill, compose down, and `system prune`.
- **process:** Add a process management panel for SSH hosts with a live, sortable, searchable process list, per-process detail, `renice`, and signal sending (TERM/HUP/STOP/CONT and confirmed KILL).
- **app:** Track live session state so monitor panels bind only to a genuinely active SSH session, and gate activity-panel visibility so toggled-off panels are not auto-opened.
- **ssh:** Add per-connection SSH algorithm preferences with Compatible / Secure / Custom modes, reorderable key-exchange, cipher, MAC, and host-key lists, and Modern/Legacy/Insecure risk labels.
- **connections:** Add a temporary SSH link dialog that opens a one-off session from a pasted `ssh://` URL or `ssh` command string without saving a connection.
- **terminal:** Add session input synchronization via named sync groups, mirroring keystrokes to grouped peers, plus a Send Command target selector for current session, all sessions, or a specific group.
- **file-transfer:** Surface Zmodem (rz/sz) transfers in the transfer list with progress and Zmodem-appropriate controls.
- **terminal:** Add Unicode grapheme support for correct rendering and cursor width of emoji, combining marks, and ZWJ sequences.
- **terminal:** Add a Clear Input action (Ctrl/Cmd+L) available from the context menu and keyboard shortcut.
- **terminal:** Add a Close All Sessions confirmation dialog before closing all tabs.
- **ai:** Add a background execution setting for the AI Assistant.
- **app-lock:** Add window close confirmation and control to the lock screen.
- **window:** Enhance main window state management and positioning.
- **importer:** Extract user and host from WindTerm session imports.

### Changed

- **terminal:** Expand built-in keyword highlight presets with more error and success phrases.
- **ai:** Improve model name handling for the Deepseek provider.
- **serial:** Refine the serial session form layout for better responsiveness.

### Fixed

- **russh:** Improve name-list parsing to handle trailing commas and reject invalid entries.
- **ssh:** Improve X11 channel handling in the SSH handler.
- **ssh:** Suppress the flashing console window when running local system shell commands on Windows.
- **hooks:** Add reload handling for forced credential loading.

### Performance

- **sftp:** Add channel-concurrency limiting and automatic retry with backoff for transient SFTP channel-open failures.
- **watcher:** Use content fingerprinting so auto-upload triggers only on real content changes, not editor metadata-only saves.
- **hooks:** Add a forced-reload option to credential loading.

## [1.1.12] - 2026-06-30

### Added

- **connections:** Enhance jump host configuration with clearer chain handling and validation for ProxyJump-style setups.

### Fixed

- **connections:** Prevent cycles in jump host relationships so saved connections cannot reference each other recursively.

### Documentation

- **i18n:** Add localization strings for the updated jump host workflow.

## [1.1.11] - 2026-06-30

### Added

- **header:** Add a Command Palette entry for quickly finding app actions and session workflows.
- **ai:** Introduce command-execution and final-answer tools for Agent interactions while preserving approval gates.
- **app-lock:** Implement app lock state management with idle locking support.
- **terminal-layout:** Restore terminal window layout state and add related settings for persistent workspaces.
- **appearance:** Add terminal font weight options for normal and bold text rendering.
- **app:** Add minimize-to-tray and hide-main-window behavior for background workflows.

### Changed

- **window-management:** Improve child-window state persistence and modal focus handling.
- **themes:** Refresh terminal and app theme colors, including high-contrast variants.

### Fixed

- **saved-connections:** Improve pointer-event handling for connection interactions and drag behavior.
- **terminal:** Improve terminal zoom handling across nested workspace roots.

## [1.1.10] - 2026-06-25

### Added

- **ssh-auth:** Add a dedicated SSH authentication request dialog for interactive login flows.
- **proxy:** Add ProxyCommand support to proxy configuration, including OpenSSH-style placeholders.
- **transfer-dialog:** Add duplicate target handling options for uploads and downloads.
- **terminal:** Improve terminal search with persistent query state, result navigation, and clearer feedback.
- **cloud-sync:** Add more detailed cloud sync status updates and cleanup timeout handling.

### Changed

- **ai:** Streamline AI model client service-target configuration.
- **cloud-sync:** Adjust cloud-sync history and log handling for clearer diagnostics.

### Fixed

- **terminal:** Improve search focus handling and selection clearing.
- **settings:** Fix saved connection sort order on the new session page.

### Performance

- **serial:** Streamline serial session management and timeout handling.

## [1.1.9] - 2026-06-21

### Added

- **terminal:** Add startup commands for duplicated and multiplexed sessions.
- **terminal:** Add image path pasting behavior in terminal settings.
- **terminal:** Add workspace padding settings for terminal layout spacing.
- **interaction:** Add a macOS IME compatibility setting.
- **telnet:** Add local line editing for Telnet sessions.
- **terminal:** Enhance Windows Terminal support and shell selection.

### Changed

- **terminal:** Suppress command suggestions in interactive programs where inline suggestions are more likely to interfere.
- **sync-backup:** Streamline sync backup history and cloud sync manager behavior.

### Fixed

- **tabbar:** Prevent pointer event propagation issues in tab interactions.
- **terminal:** Improve reconnect content management and connection error handling.

## [1.1.8] - 2026-06-21

### Added

- **terminal:** Add tab splitting with drag-and-drop docking support.
- **ssh:** Add X11 forwarding support for SSH connections.
- **russh-sftp:** Introduce a new SFTP subsystem with client and server support.
- **file-explorer:** Add remote file editor flows and dedicated remote-file handling dialogs.
- **sftp:** Add OpenSSH-compatible symlink support.
- **file-transfer:** Show transfer speed in the transfer UI.
- **cloud-sync:** Enhance cloud sync and GitHub Gist startup/error handling.
- **saved-connections:** Add copy shortcuts and improve drag-and-drop behavior for selected connections.

### Fixed

- **scp:** Add compatibility checks for GNU `-printf` and `-c` support in remote commands.
- **file-explorer:** Improve directory loading, download handling, and error feedback.

### Performance

- **russh-sftp:** Improve SFTP upload throughput and transfer tracking.
- **sftp:** Use asynchronous downloads when file sizes are known.

### Documentation

- **ssh:** Document X11 forwarding in the SSH connection guide.
- **cloud-sync:** Update cloud sync terminology and GitHub Gist authorization guidance.

## [1.1.7] - 2026-06-15

### Added

- **panel:** Add multi-open panel behavior for opening multiple tools without losing context.
- **terminal:** Add backend output pause/resume controls.
- **session:** Add a session quick switcher dialog for faster navigation between active sessions and saved connections.
- **icons:** Add server icons and improve saved connection icon resolution.
- **network:** Add group management for proxies and tunnels.
- **sync:** Add v3 snapshot decoding and payload hash calculation.

### Changed

- **file-explorer:** Define a shared `FileProperties` interface and clean up the Properties dialog.
- **terminal:** Improve tab tooltips, tab management, and scrolling behavior.

### Fixed

- **command-history:** Correct suggestion application behavior.
- **app:** Improve Windows folder opening when permission errors occur.
- **file-explorer:** Fix opening the target directory after remote-file downloads.

## [1.1.6] - 2026-06-12

### Added

- **session:** Add a searchable session quick switcher to jump between saved connections and local sessions from the keyboard or mouse, including a shortcut entry for creating a new SSH session.
- **recording:** Add an auto-start recording option that begins recording automatically when a session opens.
- **terminal:** Serialize terminal text so reconnecting sessions restore their previous on-screen output.
- **terminal:** Allow disconnected panes to be closed.
- **terminal:** Add a command to delete individual command history entries.
- **file-explorer:** Enhance file attribute management in the Properties dialog.
- **clipboard:** Implement asynchronous clipboard reading with a timeout.
- **action-links:** Support RAR archives in the archive action-link matcher.
- **ai:** Enhance model management with manual model addition and credential grouping.
- **transfer:** Implement background transfer concurrency adjustment.
- **session:** Implement session creation request ID handling.
- **stats:** Enhance `SYSINFO_SCRIPT` for improved system information gathering.

### Changed

- **quick-commands:** Introduce a sorting mode and update view mode defaults.
- **sftp:** Enhance directory and symlink handling in the SFTP backend.
- **password-management:** Enhance unlock logic and footer visibility in the password panel.

### Fixed

- **connection:** Improve the password management editing flow.
- **macos:** Support drag reordering of connections on macOS.
- **file-explorer:** Reset horizontal scroll position and improve file item interaction.
- **terminal:** Streamline right-click paste in the terminal context menu.
- **ssh:** Reorganize imports and adjust preferred algorithms.

### Performance

- Compress portable snapshots before encryption.

### Documentation

- **README:** Add Arch Linux installation instructions.

## [1.1.5] - 2026-06-09

### Added

- **terminal:** Add multiplexed SSH session support so a single connection can power multiple terminals.
- **ai:** Introduce a dedicated AI Assistant panel and related components.
- **ai:** Add command risk levels for execution control.
- **ai:** Add request User-Agent configuration with sensible default handling.
- **cloud-sync:** Add a Gitee snippet cloud sync provider.
- **terminal:** Enhance multi-line paste handling with a dedicated dialog and input state management.
- **terminal:** Implement local backspace handling in terminal input.
- **terminal:** Add new icons to the tab context menu.
- **terminal:** Add support for timestamp milliseconds in the terminal display.
- **quick-commands:** Add a compact view mode and a view mode toggle, plus a confirmation dialog for command deletion.
- **file-explorer:** Implement a favorites feature for directories.
- **key-management:** Add certificate file handling in the key editor.
- **search:** Improve search engine management with dynamic key generation.
- **local-terminal:** Add shell arguments support and file selection for the shell path.
- **pty:** Add a local startup script for shell integration, with output suppression during startup.
- **themes:** Add the Nya High Contrast theme and refresh the color palette.

### Changed

- **app:** Update the window title to reflect the active tab name.
- **window:** Implement owner window label handling for child windows and expand window capability patterns.
- **ssh:** Enhance prompt-injection handling and OSC processing.
- **ssh:** Enhance password prompt handling in keyboard-interactive authentication.
- **ai:** Make AI output follow the app language via locale-based prompt selection.
- **api:** Enhance URL handling and normalization utilities.
- **credential-management:** Improve regex validation and prompt handling.

### Fixed

- **deps:** Update xterm dependencies to beta versions.
- **macos:** Normalize the packaged macOS PTY environment.
- **terminal:** Initialize disconnect and reconnect states in XTerminal.

## [1.1.4] - 2026-06-03

### Added

- **ssh:** Implement post-login command support in the SSH form and new session page.
- **ssh:** Add a required-field indicator for the password field in the SSH form.
- **saved-connections:** Enhance search with expanded group management.
- **serial:** Enhance serial session handling with improved error logging and Zmodem detection.
- **panel:** Enhance the send-command panel with hex data handling and refactored state management.
- **recording:** Add a timestamp inclusion option for recordings.
- **terminal:** Enhance the terminal gutter with dynamic cell dimensions and layout adjustments, and improve the overall input experience.

### Changed

- **zmodem:** Improve Zmodem event handling and detection logic.
- **terminal:** Unify cursor position handling for command and credential suggestions.
- **terminal:** Improve multi-line paste dialog focus handling.

### Fixed

- **header:** Respect the minimize-to-tray setting when closing the window.

## [1.1.3] - 2026-06-02

### Added

- **terminal:** Implement a multi-line paste dialog and enhance paste handling.
- **terminal:** Enhance input handling with logical line snapshots and selection range tracking.
- **terminal:** Implement credential prompt detection and input handling.
- **panel:** Enhance the send-command panel with shell command functionality.
- **recording:** Implement session recording, including start/stop, transcript saving, and memory limit settings.
- **file-explorer:** Add session-scoped directory history in the path bar.
- **import:** Support importing sessions from NyaTerm JSON format in the import dialog.
- **security:** Enhance master password management with improved validation and UI updates.
- **quick-commands:** Add dialogs for deleting and renaming quick command categories.
- **storage:** Add password hydration for connections within a transaction.
- **docs-site:** Add offline local search.

### Changed

- **cloud-sync:** Implement operation timeouts and enhance error handling for storage operations.
- **cloud-sync:** Add WebDAV Digest authentication support.
- **cloud-sync:** Implement an automatic retry mechanism for cloud sync operations.
- **backup:** Update the backup file extension from `.dgfy` to `.nya`.
- **header:** Rename the menu label from `New SSH Connection` to `New Session`.

### Fixed

- **settings:** Ensure the settings window closes after saving by managing saving state.
- **app:** Improve `safeRecordingName` normalization to allow a wider range of valid characters.
- **docs-site:** Improve navbar responsiveness and the floating search box.

## [1.1.2] - 2026-05-30

### Added

- **window-state:** Implement main window state management to persist window size and position.
- **quick-commands:** Add support for importing Xshell quick buttons.

### Changed

- **app:** Centralize child window size and position handling.

### Documentation

- Add a contributors section and star history chart to the README.

## [1.1.1] - 2026-05-29

### Fixed

- Remove unused child window preload logic and background color handling.

## [1.1.0] - 2026-05-29

### Added

- **serial:** Implement a baud rate picker for selecting and validating serial baud rates.
- **file-transfer:** Add download functionality and enhance transfer management with enqueued downloads.
- **file-transfer:** Add a `queued` status and improve transfer UI interactions.
- **file-explorer:** Auto-sync the current working directory based on the active connection.
- **transfer:** Implement concurrency clamping and rename download/upload thread settings to concurrent tasks.
- **errors:** Add new authentication failure messages and enhance validation in the new session page.

### Changed

- **file-explorer:** Add a refreshed FileExplorer component and dialogs for file operations, including path bar and toolbar.
- **ui:** Standardize dialog footers with `ActionButton` and `ActionFooter`, and move the Toaster into the main layout.

### Fixed

- **modal:** Prevent the modal overlay from remaining after a child window closes.
- **child-windows:** Reduce startup flicker with window preloading.
- **build-release:** Correct the package name for Ubuntu ARM installation.

### Performance

- **sftp:** Enhance the SFTP backend with configurable client settings and performance logging.

## [1.0.9] - 2026-05-27

### Added

- **ssh:** Introduce a `none` authentication mode in the SSH form for enhanced connection options.
- **runtime:** Implement portable mode support and add a Windows portable zip release.
- **quick-commands:** Add an import dialog for quick commands supporting WindTerm and NyaTerm formats.
- **terminal:** Add disconnect session functionality.
- **file-explorer:** Implement inline renaming for file entries.
- **file-transfer:** Enhance progress tracking and add a clear-all action.

### Changed

- **file-transfer:** Update transfer row status icons and simplify status handling.
- **dialogs:** Improve responsive width handling and Markdown rendering in the update dialog.

### Fixed

- **session-input:** Fix a quick command issue caused by newline conversion.
- **telnet:** Integrate the recording manager for session input/output handling.
- **shortcuts:** Validate and support custom tab switching keybindings.
- **saved-connections:** Update the empty state to check both saved connections and groups.
- **workflows:** Update the Ubuntu version from 24.04 to 22.04 in the release workflow.

## [1.0.8] - 2026-05-24

### Added

- **quick-commands:** Implement sorting and usage tracking for quick commands.
- **readme:** Add a GitHub downloads badge.

### Changed

- **settings:** Update app settings management and introduce UI settings saving.
- **storage:** Restructure the storage module and migrate to typed settings documents.
- **security:** Update master password handling in the security tab.
- **scrollbar:** Hide scrollbar buttons and improve scrollbar appearance.

### Fixed

- **errors:** Improve error handling in the new session and quick command pages.

## [1.0.7] - 2026-05-21

### Changed

- **appearance:** Improve font selection UI and show a `Loading system fonts...` state while system fonts are being discovered.
- **otp:** Improve OTP input slot layout and OTP code panel responsiveness on narrower screens.
- **profiles:** Add multiple Cargo build profiles for debugging and release workflows.

### Fixed

- **csp:** Correct CSP asset protocol handling so local assets such as background images load reliably.

### Performance

- **appearance:** Load system fonts asynchronously to keep the Appearance tab responsive.

## [1.0.6] - 2026-05-21

### Added

- **appearance:** Add `Background Image` customization for the main window, including `Image Sizing`, `Image Opacity`, and `Background Content Opacity` controls.
- **sessions:** Add `Backspace Mode` selection for Telnet and Serial sessions with `Ctrl+H (BS)` and `DEL (0x7F)` options.

### Changed

- **resource-monitor:** Refresh the resource monitor with clearer cards and improved visual hierarchy.

### Fixed

- **shortcuts:** Prevent Shift-modified terminal input from being mistaken for application shortcuts, restoring uppercase input such as `Shift+C`, `Shift+V`, and `Shift+X`.

## [1.0.5] - 2026-05-19

### Added

- **ai:** Capture AI command execution events and render inline terminal output during agent-driven workflows.
- **ai:** Add the `Terminal Output Lines` setting to control how many inline output lines are shown for AI-executed commands.
- **terminal:** Add AI Execution Profile selection to terminal session forms.
- **window:** Improve main-window modal management so child windows keep the workspace in a clearer modal state.

## [1.0.4] - 2026-05-19

### Added

- **cloud_sync:** Implement cloud synchronization features with encryption and logging.
- **ai:** Introduce AgentApprovalManager and refactor AI command handling.
- **session-management:** Enhance session management by adding initialGroupId support.

### Changed

- **ai:** Remove risk assessment features and AiRiskLevel from AI components and configuration.
- **i18n:** Update localization files for agent command execution and approval messages.
- **window:** Improve always-on-top logic for modal windows.
- **file-explorer:** Optimize file drop handling.
- **sftp:** Consolidate SFTP handling by removing SSH namespace and introducing new backend structure.
- **ssh-form:** Update SshForm and NewSessionPage for improved password handling and connection management.
- **cleanup:** Remove unused components and functions from AiTab and XTerminal.

## [1.0.3] - 2026-05-18

### Added

- **terminal:** Implement tab movement and unsplit functionality in terminal management.
- **zmodem:** Implement Zmodem file transfer commands, detection, and event handling.
- **shortcuts:** Implement customizable keyboard shortcuts and settings management.
- **window:** Enhance modal child window handling.
- **ai:** Enhance AI Assistant Panel with improved empty state handling.

### Changed

- **appearance:** Refactor font management and update default font settings.
- **i18n:** Add Zmodem transfer messages, terminal font family settings, keybindings, and AI setup instructions to localization files.
- **accessibility:** Add DialogDescription component to various dialogs.
- **theme:** Update color values in githubDark theme for improved consistency.

## [1.0.2] - 2026-05-17

### Added

- **credentials:** Implement credential management features with dialog and terminal autofill support.
- **security:** Enhance Password Management with Secret Unlocking Functionality and password reveal functionality.
- **terminal:** Add keyword highlighting settings and functionality in TerminalTab component.
- **clipboard:** Add CopyButton component for clipboard functionality.
- **tabbar:** Enhance TabBar component with dynamic tab visibility management and overflow handling.
- **templates:** Add issue templates for bug reports and feature requests.

### Changed

- **theme:** Update theme colors and CSS variables for improved consistency.
- **i18n:** Add localization entries for password management, search functionality, and hidden sessions.
- **ui:** Add required field indicators and improve label styling in session forms.
- **terminal:** Enhance ActionLinksAddon and KeywordHighlighter with improved timer management and refresh logic.
- **docs:** Enhance AI Assistant and security features in documentation.

## [1.0.1] - 2026-05-16

### Added

- **highlighting:** Add prompt highlighting support in keywordHighlightPresets.
- **app:** Integrate single instance support in Tauri application.
- **docs:** Add Umami analytics plugin to Docusaurus configuration.
- **ci:** Add GitHub Actions workflow for R2 asset publishing.

### Changed

- **file-explorer:** Clean up FileExplorer component by removing unused code and optimizing state management.
- **upload:** Simplify file upload handling in AutoUploadPage.
- **highlighting:** Update operator colors and regex pattern for keyword highlighting.
- **docs:** Update changelog with new releases and enhancements.
- **ci:** Update Docusaurus dependencies and remove optional Umami config.

## [1.0.0] - 2026-05-06

## [0.9.0] - 2026-04-30

## [0.8.5] - 2026-04-28

## [0.8.4] - 2026-04-27

## [0.8.3] - 2026-04-27

## [0.8.2] - 2026-04-23

### Added

- **tauri:** Add Windows configuration file and remove unused dragDropEnabled property.
- **file-transfer:** Enhance file transfer handling to support directories, including progress tracking and UI updates for directory transfers.
- **session-management:** Implement session-specific command history management, including fetching, listening, and clearing command history for improved user experience.

### Changed

- **i18n:** Add new file transfer messages for progress tracking and completion in English and Chinese locales.
- **header:** Update window control buttons with new icons and improved styling for better user experience.

### Fixed

- **saved-connections:** Implement drag-and-drop support for connection and group items, enhancing user interaction and organization.

### Performance

- **file-explorer:** Enhance FileExplorer component with memoization and scroll handling for improved performance and user experience.

### Documentation

- Update README and guides to include new features such as Windows drag-and-drop support, enhanced file transfer capabilities, and diagnostics settings for improved user experience.
- **file-transfer:** Refine drag-and-drop upload section for clarity and consistency across languages.

## [0.8.1] - 2026-04-23

### Added

- **interaction:** Add command suggestion min character limit settings and normalization logic for enhanced user control.
- **file-explorer:** Implement external file drop support on Windows using WebView2 for enhanced drag-and-drop functionality.

### Changed

- **i18n:** Add command suggestions min character limit settings to English and Chinese locales for enhanced user control.
- **file-transfer:** Optimize visibleTransfers calculation using useMemo for improved performance and sorting.
- **terminal:** Replace useApp with useTerminalAppSettings for improved settings management and consistency across terminal components.
- **sync-backup:** Update button size from icon-xs to icon-sm for improved UI consistency.
- **i18n:** Add external drop support messages for English and Chinese locales to improve user guidance during file uploads.

### Documentation

- Enhance documentation with new features including session import/export, diagnostics, and tray support for improved user experience and clarity.

## [0.8.0] - 2026-04-22

### Added

- **interaction:** Add command suggestion max character limit settings and normalization logic for improved user control over command suggestions.
- **quit_confirmation:** Implement QuitConfirmDialog for user confirmation before application exit, enhancing user experience and preventing accidental closures.
- **tray:** Implement tray functionality with window management and application quit command for enhanced user experience.

### Changed

- **i18n:** Add command suggestions max character limit settings to English and Chinese locales for improved user control.
- **syncbackup:** Enhance SyncBackupHistoryPanel with new UI components, improved history summary logic, and additional filtering options for better user experience.
- **i18n:** Add new history-related terms to English and Chinese locales for improved user experience and clarity.
- **scrollbar:** Add transparent background for scrollbar corner to improve UI consistency.
- **saved-connections:** Update layout and styling for improved responsiveness and visual consistency.
- **settings:** Remove emit calls for settings changes in ChildAppProvider and SettingsPage to streamline event handling.

## [0.7.9] - 2026-04-21

### Added

- **terminal:** Enhance terminal input handling by synchronizing input state from rendered lines and improving command processing logic.
- **syncbackup:** Implement SyncBackup functionality with UI components for managing cloud sync settings and history, enhancing user experience for backup management.
- **security:** Add master password management with dynamic state handling and improve input components for better user experience.
- **syncbackup:** Add validation for S3 endpoint requirement and improve UI feedback for draft settings, enhancing user experience in cloud sync management.
- **otp:** Integrate input-otp component for enhanced OTP input handling in OtpDialog, improving user experience with dynamic code length management.
- **cloud_sync:** Enhance error handling for WebDAV authentication by adding specific messaging for 401 errors and improving storage error mapping.
- **syncbackup:** Enhance SyncBackupHistoryPanel with filtering capabilities, improved state management, and UI updates for better user experience.

### Changed

- **terminal:** Remove unused input synchronization logic and streamline command sanitization process.
- **terminal:** Rename command tracking function and enhance command registration logic for improved input handling.
- **i18n:** Update English and Chinese locale files with new strings for sync and backup features, enhancing user interface and experience.
- **settings:** Restructure settings page with categorized groups, improved scroll handling, and dynamic tab management for enhanced user experience.
- **i18n:** Update zh-CN locale with new sync and backup history terms, enhance filtering options, and improve user prompts.

### Fixed

- **file-explorer:** Implement session caching for file explorer to maintain state across unmounts, enhancing user experience during navigation.

### Documentation

- Enhance documentation and UI for Sync & Backup features, including detailed guides, settings integration, and improved user experience for cross-device configuration and backup management.

## [0.7.8] - 2026-04-21

### Added

- **shell:** Implement command sanitization for terminal input and add terminal command utility functions.
- **session:** Refactor session input handling by introducing sendSessionInput function for improved command submission and preview management across components.
- **logging:** Introduce console usage linting and enhance error logging structure across components for improved diagnostics.
- **keywordhighlight:** Expand error and control flow patterns in keyword highlighting for enhanced diagnostics.
- **quickcommands:** Implement QuickCommandsStore for managing quick commands with in-memory caching and persistence, enhancing command upsert and retrieval functionality.

### Changed

- **observability, watcher, auth:** Apply consistent formatting and indentation across multiple functions for improved code readability.

### Performance

- Optimize context providers by utilizing useMemo for context values in AppContext, ChildAppProvider, and TransferProvider.

## [0.7.7] - 2026-04-15

### Added

- Implement import/export configuration functionality with UI updates in ImportDialog and Header components.
- **backup:** Add import/export functionality for configuration with encryption and rotation.
- **connections:** Add OpenGroupConnectionsDialog component and enhance connection item interactions with selection and context menu options.
- **panel:** Enhance QuickCommands component with improved search and category filtering UI.

### Changed

- **i18n:** Update English and Chinese translations for configuration import/export features and add new UI strings.
- **panel:** Update ActiveSessions component with improved styling for search input and icon.
- **panel:** Adjust width of dropdown menu in SavedConnections component for better UI consistency.

## [0.7.6] - 2026-04-15

### Added

- **ssh:** Improve SSH authentication logging and add known host key verification.
- **ssh:** Enhance SSH I/O loop with detailed exit status and signal logging.

### Changed

- Add 'des' crate dependency to Cargo.toml and update Cargo.lock.

### Fixed

- Restore import of SessionOutputCoalescer in pty.rs for proper session output handling.

### Documentation

- Update README with new features and enhancements including online search, translation, and improved SFTP file explorer.
- Enhance documentation with updates on terminal features, file transfer capabilities, and security enhancements including translation support and improved session management.

## [0.7.5] - 2026-04-14

### Added

- **connection:** Enhance session connection handling with improved error recovery and connection editing prompts.
- **ssh:** Enhance SSH form with password management and localization updates.

## [0.7.4] - 2026-04-14

### Added

- **updater:** Implement update dialog and background update check functionality.
- **header:** Enhance header component with update check functionality and new icons.
- **terminal:** Add suspended state handling to terminal components and output coalescing for improved performance under load.

### Changed

- Add @tauri-apps/plugin-process and @tauri-apps/plugin-updater dependencies to package.json and pnpm-lock.yaml.
- Clean up imports and improve formatting across multiple components for better readability.
- **i18n:** Add updater localization for English and Chinese, including update status messages.
- **i18n:** Add localization for large output protection messages in English and Chinese.

## [0.7.3] - 2026-04-14

### Added

- **keywordhighlightpresets:** Expand success patterns to include additional keywords for improved matching.
- **connection-management:** Implement error handling for connection failures, adding support for marking tabs and panes as failed while maintaining layout integrity.
- **file-explorer:** Implement directory history management and enhance selection handling.
- **file-transfer:** Add pause, resume, and cancel functionality for file transfers with updated context and UI components.

### Changed

- **i18n:** Add connection failure messages in English and Chinese localization.
- **file-explorer:** Update selection handling methods and improve context menu interactions.
- **i18n:** Update English and Chinese localization for file transfer actions including cancel, pause, resume, and delete.

## [0.7.2] - 2026-04-14

### Added

- **interaction-settings:** Add command suggestions toggle to InteractionTab and integrate with app settings.
- **logging:** Implement persistent logging for warn and error levels, add Tauri command to handle log writing.
- **file-explorer:** Enhance keyboard interaction by adding delete functionality and focus management for the file list.
- **sftp:** Enhance remote file operations with detailed logging and permission handling.

### Changed

- **file-explorer:** Replace invoke import with local library and add autoFocus to delete button for improved accessibility.
- **file-explorer:** Replace invoke import with local library across multiple dialog components for consistency.
- **i18n:** Add command suggestions localization in English and Chinese.

### Fixed

- **keywordhighlightpresets:** Update duration regex to include shorthand units for better matching.

### Documentation

- Update CLAUDE.md and README.md to clarify commands for building and serving the docs site, including locale-specific hot reload options.

## [0.7.1] - 2026-04-13

### Added

- **clipboard:** Implement readClipboardText function and update terminal components to use it for clipboard access.
- **demos:** Add various demo scripts for showcasing NyaTerm's terminal features, including action links, file watching, keyword highlighting, and structured output.
- **activesessions:** Enhance ActiveSessions component with search functionality, session reconnect/disconnect actions, and improved UI for session display.
- **file-explorer:** Refactor DeleteDialog to handle multiple file deletions and improve UI; update FileExplorer to support batch delete actions.
- **resource-monitor:** Implement refresh button and improve stats fetching with async/await; add loading state management.
- **modal-management:** Refactor modal child window handling to improve focus enforcement and state tracking; add reconnect and disconnect session functionality in ActiveSessions component.
- **activesessions:** Simplify PanelHeader actions by removing unnecessary wrapper div for session count display.
- **resource-monitor:** Enhance refresh button with tooltip and rename state variable for clarity.

### Changed

- **i18n:** Update zh-CN and en.json for activeSessions and file deletion messages.

### Documentation

- Update README and user guides to enhance clarity on NyaTerm's features, session types, and terminal capabilities; add new sections for workspace layout, security, and network configurations.
- **sidebars:** Update guide sections to include new topics on session types, layout, and authentication while reorganizing existing items for better clarity.

## [0.7.0] - 2026-04-12

### Added

- Enhance terminal workspace with new tab management and pane functionality.
- **crypto:** Implement master password wrapping key cryptosystem.
- **app:** Restore cryptographic master password state on app startup.
- **config:** Introduce proxy_jump_id field and circular-dependency validation.
- **ssh:** Implement multi-hop proxy jump routing via direct-tcpip channel.
- **ui:** Integrate jump host configuration into SSH session dialog.
- **shell:** Upgrade serial sender into unified shell command broadcaster.
- **explorer:** Restrict file explorer to SSH sessions and show unsupported message.
- **tabbar:** Add unread indicator with breathing animation and extend TabBarProps.
- **unreadtracking:** Implement unread session output tracking and update TabWindowsWorkspace to display unread tab IDs.
- **terminal:** Add TerminalGutter component for displaying line numbers and timestamps; update settings to disable action links by default.

### Changed

- **window:** Enable transparent window background in tauri config.
- **ssh:** Reduce default keepalive interval from 60s to 3s.
- **config:** Format ui configuration tuple structures.
- **security:** Migrate lock_password to unified master_password definitions.
- **ssh:** Decouple single session handle into multi-tiered SshConnectionHandles.
- **panel:** Migrate QuickCommands and SerialSendPanel to panel module.
- **ui:** Remove legacy fullscreen shortcuts and redundant menu entries.
- **panel:** Adjust active sessions count indicator formatting.
- Commit remaining changes.
- **keywordhighlight:** Update token boundary handling to remove conflicts.
- **i18n:** Add line numbers and timestamps options to terminal settings.

### Fixed

- **otp:** Properly decode multi-byte utf-8 characters in url encoding.
- **ssh:** Prevent prompt injection scripts from polluting shell history.
- **session:** Silently ignore not-found error during session close.
- **terminal:** Suppress errors when attaching to terminating sessions.
- **terminal:** Prevent dismissing suggestions when there are no active suggestions or selection.
- **settings:** Disable keyword highlights and action links by default in terminal settings.

### Performance

- Only remove workspace tabs from UI after successful close.
- Make split-window session placement explicit.
- Reduce unnecessary re-renders in terminal workspace.

### Documentation

- Add CLAUDE.md for development guidance and architecture overview.

## [0.6.1] - 2026-04-11

### Changed

- Update version synchronization in sync-version script.
- Update nyaterm dependency version to 0.6.0.

## [0.6.0] - 2026-04-11

### Added

- **proxy:** Standalone proxy and tunnel management.
- **sftp:** Enhance file transfer with concurrency, retries, and timestamps.
- **ui:** Implement network panel and settings restructuring.
- Implement Tauri commands for secure app settings management and password verification.
- **network:** Enhance tunnel configuration UI.
- Add session recording and custom transfer preferences.
- **ui:** Add OtpDialog for two-factor authentication support.
- **core:** Implement OTP interaction with PendingAuthManager and commands.
- **ui:** Implement OSC7 CWD tracking support and UI disabled states.
- **ui:** Integrate OtpDialog into main app layout with i18n support.
- **transfer:** Open download path from transfer footer.
- **security:** Add tab count display and update Key/Password management tabs to report counts.
- **ssh-form:** Enhance SSH form with proxy and OTP configuration options.
- **otp:** Implement OTP management and integration with UI components.
- **prettier:** Add Prettier configuration for JSON sorting and update package scripts for i18n checks.
- **search:** Add show_in_menu property to SearchEngine and enhance SearchTab with collapsible UI for custom engines.
- **session:** Launch local, telnet, and serial connections by type.
- **serial:** Show detected serial ports in the session editor.
- **serial:** Add bottom serial send panel.

### Changed

- **ui:** Introduce shadcn UI components.
- **i18n:** Update translations for network and transfer features.
- **translate:** Minor module dependency updates for translate API.
- Format session proxy imports.
- Adjust panel header actions layout.
- **deps:** Bump russh to 0.60.
- **ui:** Rename saved-connections dialog directory to connections.
- **core:** Reorganize module structure for ssh, runtime, and import.
- Update internal imports and finalize ssh module extraction.
- **core:** Adopt new ssh and runtime module structures.
- **ui:** Update import path in Header for new connections directory.
- Restructure command modules and update import paths for improved organization.
- **config:** Rename storage modules and split settings config.
- **runtime:** Extract tauri bootstrap and command adapters.
- **core:** Extract history store and unify error imports.
- **session-dialog:** Make new session forms responsive.
- **dialog:** Improve quick command and auto upload layouts.
- **settings:** Introduce responsive settings shell.
- **settings-search:** Reflow custom search engine editor.
- **settings-terminal:** Reflow action link and highlight editors.
- **panel:** Polish mobile panels and auth tabs.
- **core:** Export watcher module.
- **rust:** Normalize backend formatting.
- **i18n:** Normalize english sort labels.
- **otp:** Vendor local hotp and totp crate.
- **format:** Remove trailing whitespace artifacts.
- **format:** Trim trailing blank line in translate core.
- **quick-commands:** Clean up formatting and improve tooltip component structure.
- **resource-monitor:** Improve code formatting and structure for better readability.
- **settings:** Restructure settings components to use SettingSection for better organization and readability.
- Reorganize file explorer, auth and save-connections components.
- **connection:** Normalize saved connection schema into typed config blocks.
- **saved-connections:** Extract tooltip-backed header action button.
- **file-explorer:** Reuse tooltip icon buttons in the toolbar.
- **i18n:** Remove deprecated default local shell labels.
- **frontend:** Normalize panel imports and minor cleanup.
- **rust:** Isolate import reordering and line-wrap churn.
- **file-explorer:** Wrap dialog import for consistency.
- Introduce FileUploadPage and update routing to replace AutoUploadPage.

### Fixed

- **ssh:** Resolve concurrent SshHandler access using Mutex.
- **security:** Add app scope to temp dir capabilities.
- **ui:** Handle xterm buffer trimming in keyword highlighter cache.
- **i18n:** Correct Chinese translations for various UI strings.
- **explorer:** Normalize cwd paths before syncing directories.
- **panel:** Update default tab in SecurityAuthPanel from passwords to keys.
- **ssh:** Use character escapes for PowerShell OSC integration.
- **select:** Allow trigger content to shrink and truncate in narrow layouts.
- **session-ui:** Restrict SSH-only panels and clarify path-sync messaging.
- **session-editor:** Reset local terminal defaults when clearing the form.
- **i18n:** Update serial port messages and reintroduce serial send localization.

## [0.5.0] - 2026-04-07

### Added

- **window:** Implement child window modal management and overlay.
- **auth:** Add managed password store for SSH sessions.
- **stats:** Add remote resource monitor for SSH sessions.
- **sftp:** Add recursive directory transfer commands.

### Changed

- Update styling for tab borders and shadows.
- **ui:** Adopt activity bar layout and custom window chrome.

### Fixed

- **i18n:** Refine experimental keyword highlighting description in Chinese locale.
- **terminal:** Reconnect SSH tabs after disconnect.

## [0.4.0] - 2026-04-03

### Added

- Implement ChildWindowRouter and enhance window management with i18n support.
- Enhance keyword highlighting settings and functionality.
- Update word separators in interaction settings for improved parsing.
- Enhance file transfer functionality and loading state management.
- Add keyword highlight setting for wrapped lines in TerminalTab.
- **session:** Add multi-protocol tabs to new session form.
- **file-explorer:** Open auto-upload prompts in child windows.
- **appearance:** Support dedicated terminal themes and font scaling.
- **terminal:** Add actionable links and hover menus.

### Changed

- Update project URLs and enhance build script.
- **i18n:** Add 'Built-in' font label to English and Chinese translations.
- **ui:** Polish tab chrome and refresh connection icons.

### Fixed

- **app:** Stabilize active tab state and terminal defaults.
- **keywordhighlight:** Improve built-in matching and cell mapping.
- **build:** Align Vite typing and path alias settings.

### Documentation

- Add Docusaurus documentation site with bilingual support.
- Redesign homepage and fix i18n issues.

## [0.3.5] - 2026-03-09

### Fixed

- **keywordhighlight:** Enhance datetime and number patterns for better matching accuracy.

## [0.3.4] - 2026-03-09

### Changed

- **terminal:** Replace kbd elements with Kbd component for consistency in CommandSuggestions and ContextMenu.

## [0.3.3] - 2026-03-09

### Added

- **terminal:** Add keyword highlighting feature.
- **connections:** Add edit option to connection item context menu.
- **settings:** Support navigating to specific settings tab and auto-refresh ssh keys on focus.
- **shortcuts:** Implement global keyboard shortcuts for terminal and UI actions.

### Changed

- Sync version in Cargo.lock and update commit files list.
- **terminal:** Improve TabBar close button UI and hover states.
- **terminal:** Use React.RefObject instead of MutableRefObject for terminal refs.
- **theme:** Update terminal cursor colors for githubLight and nordLight themes.

### Fixed

- **terminal:** Re-initialize WebGL addon on hardware acceleration toggle.
- **ssh:** Prevent OSC 7 injection from polluting bash history.

## [0.2.1] - 2026-03-06

### Added

- **session-management:** Enhance session handling with auto-connect feature.
- **types:** Add comprehensive global types for session management and UI configuration.
- **file-explorer:** Add dialogs for creating new files, folders, and symlinks.
- **translate:** Implement dynamic TKK generation for Google Translate.
- **file-explorer:** Implement terminal path synchronization feature.

### Changed

- Relocate themes and types to lib directory.
- Update `.gitignore` to include additional file patterns.
- Update import paths and enhance translation settings.
- Update import paths to global types.
- **icons:** Consolidate file icon logic and enhance icon imports.

## [0.1.5] - 2026-03-06

### Added

- **ui:** Implement zoom level persistence and view settings.
- **ui:** Add clickable homepage and issues links to about dialog.
- **ui:** Enhance header menu with icons and new Help options for documentation and logs.
- **logging:** Enhance tracing initialization with rolling file appender and update log permissions.
- **window:** Show application window on startup and update tauri configuration to allow window visibility.
- **connections:** Add the SavedConnections panel for grouped SSH connection management.
- **watcher:** Add file watcher support and chunked file transfer progress tracking.
- **file-explorer:** Integrate custom dialogs and context menu support.
- **settings:** Implement global settings dialog and localization.
- **terminal:** Add terminal context menu utilities and search bar.
- **security:** Add lock screen and lock password encryption.
- **quick-commands:** Redesign quick commands UI with icons and variables support.
- **file-transfer:** Add file properties dialog and transfer progress bar.
- **settings:** Add translation settings and a tabbed settings/about experience.
- **translate:** Add TranslationTab and multi-provider translation service.
- **terminal:** Enhance XTerminal with URL opening and better command history handling.
- **app:** Introduce global application context and broader i18n support.
- **search:** Add search engine icons and improve search tab configuration UI.
- **import:** Add session import from Xshell, MobaXterm, and WindTerm.
- **ui:** Add command palette, popover, and draggable panel components.
- **icons:** Expand the icon system and update type definitions.
- **connections:** Enhance connection handling, feedback, sorting, and drag-and-drop.
- **config:** Add screen lock and connection sort mode settings.
- **security:** Implement screen lock toggle and idle detection.
- **suggestions:** Enhance command suggestions with multi-provider support.
- **event-listeners:** Replace polling with event listeners for session and command history updates.

### Changed

- Add MIT License file.
- **assets:** Update app icons, logo assets, and remove unused SVGs.
- **cleanup:** Update tauri config and remove unused assets.
- **i18n:** Integrate i18next across the application.
- **ui:** Update page title from `NyaTerm Terminal` to `NyaTerm`.
- Update scrollbar styling.
- Update global UI, layout visibility, and theme configuration.
- Adopt shadcn/ui components.
- Migrate toast notifications to sonner and use shadcn context menus.
- Update settings dialog to use switches and a tabbed interface.
- **i18n:** Update localizations for new components and features.
- Update typography, CSS variables, theme colors, and section headers.
- Update dependencies, shared utils, types, UI components, and panels.
- **backend:** Modularize config and commands into submodules.
- **theme:** Overhaul the theme system with CSS variables and preset themes.
- **dialog:** Reorganize dialogs into domain-specific subdirectories.
- **settings:** Update settings tabs for the new config structure.
- **app:** Refresh App, contexts, layout, and panel components.
- **i18n:** Add locale keys for newly introduced settings and UI flows.
- **window:** Migrate dialogs to independent child windows.
- **file-explorer:** Modularize the file tree and replace native dialogs.
- **terminal:** Clean up formatting and whitespace issues.
- **tracing:** Improve local time formatting and remove inline key migration.
- **dialogs:** Remove NewSessionDialog, SettingsDialog, and QuickCommandDialog.
- **components:** Extract settings components and standardize import paths.
- Delete generated build output from the repository.
- Bump version to `0.1.5` and add version synchronization script.

### Fixed

- Resolve dialog accessibility warnings.
- Update translation key usage in SearchTab for clearer settings descriptions.
- Improve session handling and UI responsiveness.
- **settings:** Update default interaction settings for copy and paste.
- **translations:** Remove fallback values from translation keys in dialogs and components.

### Performance

- **sftp,ssh:** Optimize transfer speeds and add symlink support.

### Documentation

- Update README with key features and usage instructions.
- Remove the trailing period from the README tagline.
