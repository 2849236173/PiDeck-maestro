# pi-desktop

[中文文档](README.zh-CN.md)

A desktop workbench for running and managing multiple [pi](https://pi.dev) coding-agent sessions across project folders.

`pi-desktop` is not a fork of pi and does not reimplement the agent. It is a lightweight Electron shell that orchestrates multiple `pi --mode rpc` processes and provides a desktop UI for projects, sessions, files, history, model state, and conversation navigation.

![Status](https://img.shields.io/badge/status-experimental-orange)
![License](https://img.shields.io/badge/license-MIT-blue)
![Electron](https://img.shields.io/badge/Electron-38-47848f)
![React](https://img.shields.io/badge/React-19-61dafb)

## Features

- **Multi-project workspace**
  - Add and switch between local project folders.
  - Keep multiple pi agents open at the same time.
  - Remember the active agent per project.

- **Multi-agent session management**
  - Start a new agent for a project.
  - Restore historical pi sessions.
  - View previous conversation messages after restoring a session.
  - Close running agents from the sidebar.

- **pi RPC integration**
  - Runs pi in RPC mode via `pi --mode rpc`.
  - Uses pi itself for agent loop, tools, sessions, model selection, context, compaction, and provider auth.
  - Supports slash commands through the pi RPC prompt path.

- **Conversation UI**
  - Markdown rendering with GFM support.
  - Streaming assistant text display.
  - Per-message timestamp.
  - Copy individual messages.
  - Expand tool-call details.
  - Floating conversation outline for quickly jumping between key messages.

- **Files and history**
  - File drawer with collapsible directories.
  - `@` file suggestions from project files.
  - Right-click file actions:
    - Add file reference to prompt.
    - Open with system default app.
    - Reveal in file manager.
  - Historical session drawer.
  - Export opened sessions to HTML through pi RPC.

- **Model and context status**
  - Current model display.
  - Thinking level display.
  - Context usage display.
  - Cache usage display.
  - Cycle model.
  - Switch model from available pi models.
  - Cycle thinking level.

- **Git awareness**
  - Show current Git branch when the project is a Git repository.
  - Switch between local branches.

- **Desktop-focused UX**
  - WeChat-like three-pane layout.
  - Resizable project/session list and side drawers.
  - Configurable send shortcut.
  - Browser preview fallback for UI development without Electron preload.

## Screenshots

### Workspace Overview

![Workspace overview](docs/images/overview.png)

### Session History Drawer

![Session history drawer](docs/images/history.png)

### File Drawer and Context Menu

![File drawer and context menu](docs/images/files.png)

### Conversation, Tool Details, and Runtime Status

![Conversation and runtime status](docs/images/conversation.png)

## Architecture

```txt
pi-desktop
├─ Electron main process
│  ├─ manages project records
│  ├─ spawns pi --mode rpc processes
│  ├─ bridges file/session/git operations
│  └─ exposes safe IPC APIs
│
├─ Electron preload
│  └─ exposes window.piDesktop to the renderer
│
├─ React renderer
│  ├─ project and agent list
│  ├─ chat timeline
│  ├─ file/history drawers
│  ├─ model/context status
│  └─ settings UI
│
└─ pi runtime
   ├─ one pi RPC process per opened agent
   ├─ project cwd isolation
   └─ native pi sessions/tools/models/context
```

A key design rule is:

```txt
One Agent Tab = One pi RPC Process
```

This keeps sessions isolated, makes crashes local to one agent, and lets pi keep ownership of its native behavior.

## Requirements

- Node.js 20+ recommended.
- npm.
- A working `pi` command in your system `PATH`.
- pi authentication configured separately, for example through `pi` / `/login` or API keys.

Check pi is available:

```bash
pi --version
pi --mode rpc
```

## Getting Started

```bash
git clone https://github.com/ayuayue/pi-desktop.git
cd pi-desktop
npm install
npm run make-icon
npm run dev
```

The app expects `pi` to be available in `PATH` because it starts agents using:

```bash
pi --mode rpc
```

## Development

### Start dev mode

```bash
npm run dev
```

### Type-check

```bash
npm run typecheck
```

### Build renderer/main bundles

```bash
npm run build
```

### Generate icon asset

```bash
npm run make-icon
```

This writes:

```txt
build/icon.svg
```

## Browser Preview Mode

You can open the Vite renderer URL directly in a browser for layout checks:

```txt
http://localhost:5173/
```

When opened outside Electron, `window.piDesktop` is not available. The renderer falls back to a mock preview API so the UI does not crash.

Browser preview is useful for:

- layout checks
- responsive design checks
- chat rendering checks
- markdown rendering checks

Browser preview does **not** validate real Electron IPC behavior such as:

- starting pi agents
- reading local sessions
- opening files
- exporting HTML

Use the Electron app for those flows.

## Project Structure

```txt
src/
├─ main/
│  ├─ fs/                 # file tree service
│  ├─ git/                # git branch service
│  ├─ pi/                 # pi process and RPC manager
│  ├─ projects/           # project persistence
│  ├─ sessions/           # pi session scanning
│  ├─ settings/           # app settings persistence
│  └─ index.ts            # Electron main entry
│
├─ preload/
│  └─ index.ts            # safe IPC bridge
│
├─ renderer/
│  └─ src/
│     ├─ App.tsx          # main UI
│     ├─ previewApi.ts    # browser preview fallback
│     ├─ styles.css       # app styling
│     └─ main.tsx         # React entry
│
└─ shared/
   ├─ ipc.ts              # channel names
   └─ types.ts            # shared DTOs
```

## Important Implementation Notes

### Session ownership

`pi-desktop` reads pi session files for listing and summaries, but it does not directly mutate pi session JSONL files. Restoring and exporting sessions is done through pi RPC.

### Process isolation

Each opened agent owns a separate `pi --mode rpc` child process. This provides clean cwd isolation and avoids shared runtime state between agents.

### File operations

File operations use Electron `shell` APIs where possible:

- `shell.openPath`
- `shell.showItemInFolder`

This keeps behavior cross-platform and delegates file opening to the operating system.

### Model and thinking controls

The model and thinking controls call pi RPC commands:

- `get_state`
- `get_session_stats`
- `get_available_models`
- `set_model`
- `cycle_model`
- `set_thinking_level`
- `cycle_thinking_level`

## Current Limitations

- Packaging is not configured yet. The current repository builds Electron/Vite output but does not produce installers.
- The icon is currently generated as SVG only. Windows/macOS release packaging will need `.ico` / `.icns` generation.
- Browser preview mode uses mock data and does not test Electron IPC.
- File context menu is implemented in the renderer. More native menu behavior can be added later.
- Session parsing is best-effort and designed to tolerate pi session format evolution.

## Roadmap

- Add installer packaging with `electron-builder` or Forge.
- Add CI for type-check and build.
- Add screenshots and demo GIFs.
- Add native app icons for Windows/macOS/Linux.
- Add model search and provider grouping.
- Add richer tool-call rendering.
- Add file multi-select and attachment tray.
- Add session export open/reveal actions.
- Add automated Electron UI tests.

## Security

This app starts local `pi` processes and exposes file operations through Electron IPC. Only run the app from trusted source code.

It does not send telemetry or upload files by itself. Any model/provider network behavior is handled by pi and your configured providers.

## License

MIT
