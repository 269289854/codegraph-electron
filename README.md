# CodeGraph Electron

Desktop management client for [CodeGraph](https://github.com/colbymchenry/codegraph).

## Features

- Detect whether `codegraph` is installed from PATH or the standalone Windows bundle.
- Install CodeGraph through the official PowerShell installer when it is missing.
- Select local project folders and persist recent projects.
- Build, rebuild, delete, and refresh CodeGraph indexes through the CLI.
- Detect and inject the CodeGraph MCP server into the global Codex configuration.
- Read `.codegraph/codegraph.db` in read-only mode and render a filtered graph view.
- Explore overview, search, file-focused, and node-focused graph snapshots with pan/zoom and node details.
- Uses a Japanese anime-inspired app icon for the window, taskbar, shortcuts, and installer.
- Runs as a single-instance desktop app; launching it again focuses the existing window.

## Development

```powershell
npm install
npm run dev
```

The dev command starts the Vite renderer. Electron loads `http://127.0.0.1:5173` in development after the main process is compiled by TypeScript during build/package flows.

## Scripts

- `npm run lint` - lint TypeScript and React source.
- `npm run typecheck` - run TypeScript checks for Electron, Vite, and tests.
- `npm run test` - run core module tests.
- `npm run build` - build renderer and Electron main/preload output.
- `npm run package:dir` - create an unpacked Electron build.
- `npm run package:win` - create a Windows x64 NSIS installer at `release/CodeGraph Manager-Setup-<version>-x64.exe`.

The Windows installer supports choosing the installation directory and creates desktop/start-menu shortcuts.

## CodeGraph Commands

The app intentionally shells out to the installed CLI instead of mutating `.codegraph` directly:

- Build graph: `codegraph init <projectPath>`
- Rebuild graph: `codegraph index <projectPath>`
- Delete graph: `codegraph uninit <projectPath> --force`
- Status: `codegraph status <projectPath> --json`

Codex MCP detection runs automatically when the app starts. Injection stays disabled until CodeGraph is installed, the Codex configuration is readable, and no valid CodeGraph MCP entry exists. The injection action delegates to the official command:

```powershell
codegraph install --target=codex --location=global --yes
```

Graph visualization reads `<projectPath>/.codegraph/codegraph.db` with `sql.js` from the Electron main process. Renderer code only talks through the preload IPC bridge.
