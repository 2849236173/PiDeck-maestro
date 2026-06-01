# Changelog

[中文](CHANGELOG.zh-CN.md)

All notable changes to pi-desktop are documented here.

## v0.2.1 - 2026-06-01

### Fixed
- Stripped ANSI terminal escape codes from pi output in chat messages, tool details, and conversation outline.
- Conversation outline now shows last 15 items by default with a "show all" button to expand the full list; panel is scrollable with max-height 70vh.
- Increased outline summary truncation from 34 to 48 characters for better readability.

## v0.2.0 - 2026-06-01

### Added
- Session rename: right-click a session card in the history drawer to rename inline (Enter confirms, Esc cancels). Persists via sessionName metadata in the JSONL file.
- Built-in slash command suggestions: type `/` to see 12 pi built-in commands (session, tree, clone, compact, copy, export, share, settings, reload, hotkeys, login, logout) alongside extension-registered commands.

### Improved
- Filtered redundant built-in commands (/new, /model, /resume, /fork) that already have dedicated desktop UI.
- Removed /name command in favor of the new session rename UI.

## v0.1.9 - 2026-06-01

### Added
- System tray support: closing the window now hides to the system tray by default; added a "close to tray" toggle in settings.
- Tray context menu with "Show Window" and "Exit" actions; double-click tray icon to restore (Windows).
- Restart button for agents: stops the pi RPC process and re-spawns with the same session, picking up new provider/API key configuration changes that `/reload` cannot apply.
- Manual context compaction button in the composer toolbar, visible when context usage exceeds 30%; shows live percentage and loading state.
- Custom branch dropdown replacing the native `<select>`, with hover highlights, active branch indicator, and open/close animation.

### Improved
- Refined chat header layout: tighter spacing, gradient "New Session" button, polished action group styling with transitions.
- Branch selector, session actions, and composer are hidden during agent loading to avoid showing stale UI.
- History drawer closes immediately when clicking a session instead of waiting for agent creation to finish.
- Switched to official pi wordmark logo from pi.dev for app icon, sidebar, agent avatars, boot screen, and empty state.
- Context compaction button uses yellow highlight during compaction and is disabled while streaming.

## v0.1.8 - 2026-06-01

### Improved
- Chat links now open in the system default browser instead of navigating inside the Electron window.
- All projects show their agent lists by default when switching projects; added per-project collapse/expand toggle.

## v0.1.7 - 2026-06-01

### Improved
- Reduced the default project list width to leave more room for the conversation area.
- Refined the project search bar and add button layout so the add button stays visible when the window is narrowed.

## v0.1.6 - 2026-06-01

### Improved
- Improved Markdown table rendering in chat messages with clearer borders, spacing, header styling, and safe horizontal scrolling for wide tables.
- Replaced the hard-to-discover native textarea resize handle with a visible top-edge composer resize grip.
- Composer resizing now keeps bounded heights so expanding the input area does not take over the conversation timeline.

## v0.1.5 - 2026-06-01

### Fixed
- Refined the chat header layout so long project paths and session controls fit more reliably in narrow windows.

## v0.1.4 - 2026-05-31

### Added
- Added Stop / abort controls for running agents, backed by pi RPC `abort`.
- Added an assistant waiting animation before the first streamed token arrives.
- Added grouped tool-call cards so one user question no longer floods the timeline with many tool messages.
- Tool-call groups now show a short summary by default and can be expanded for full details.

### Improved
- Tool-call details are collapsed by default and scroll independently when large.
- Running and failed tool calls now have clearer visual states.

## v0.1.3 - 2026-05-31

### Added
- Added startup pi CLI environment checks with a visible status dialog.
- Added a reusable pi command locator for packaged Electron environments.
- Added manual environment checking in Settings.
- Added app version display and a “Check for updates” action that opens GitHub Releases.
- Added a static startup screen to avoid a blank white window while the renderer loads.

### Improved
- Packaged app startup now shows the window only after it is ready to display.
- Project loading is deferred so the main UI can render sooner.
- The pi CLI detector searches common PATH, npm, pnpm, Yarn, Volta, mise, nvm, asdf, bun, deno, and local bin locations.
- Windows `.cmd` pi shims are checked through a shell to avoid false “not installed” results.
- Missing pi CLI guidance now links to the official installation guide.
- Historical sessions started from a parent folder can now appear under the matching child project when the session content references that project.

## v0.1.2 - 2026-05-31

### Fixed
- Fixed project avatars for hidden folders such as `.pi` and `.pi-desktop` by ignoring leading dots and whitespace.
- Added `downloads/` to `.gitignore` so local downloaded artifacts are not included in releases.

## v0.1.1 - 2026-05-31

### Added
- Added Electron Builder packaging configuration for Windows, macOS, and Linux targets.
- Added packaging scripts for directory builds and platform-specific distribution builds.
- Added application icon resources for packaged apps.

### Improved
- Added Linux package maintainer metadata.

## v0.1.0 - 2026-05-31

### Added
- Initial pi-desktop workbench.
- Multi-project desktop workspace for managing local folders.
- Multiple pi RPC agents running side by side.
- Session history drawer and historical session restore.
- File drawer with collapsible directories and file actions.
- Markdown conversation timeline with streaming assistant text.
- Tool-call detail display.
- Model, thinking level, context, and cache status display.
- Git branch display and branch switching.
- Configurable send shortcut and desktop-focused three-pane layout.

### Fixed
- Configured packaged application icons.
