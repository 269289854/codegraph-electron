# Hermes MCP 注入 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a "Hermes MCP 注入" (Hermes injection) feature to the CodeGraph Manager desktop client that wires the CodeGraph MCP server into the Hermes Agent config (`$HERMES_HOME/config.yaml`), mirroring the existing Codex injection feature.

**Architecture:** The app shells out to the official CodeGraph CLI rather than mutating config directly. Upstream CodeGraph already ships a `hermes` installer target (`src/installer/targets/hermes.ts`), so injection delegates to `codegraph install --target=hermes --location=global --yes`. Detection parses the Hermes `config.yaml` locally (line-based, no new dependency — mirroring how the Codex detection parses `~/.codex/config.toml`). Validation runs `hermes mcp list`, the Hermes analog of `codex mcp list`.

**Tech Stack:** Electron 33 + TypeScript 5.7 + React 18 + Vite 6 + Vitest 2. No new npm dependencies.

---

## Context / Assumptions (verified)

1. **Existing Codex feature** (commit `9ad1fa1`) is the template. It spans:
   - `src/shared/types.ts` — `CodexConfigState`, `CodexValidationState`, `CodexIntegrationStatus`, and `JobKind` gains `'inject'`.
   - `src/electron/services/codegraph.ts` — `codexConfigPath`, `detectCodexIntegration`, `parseCodexConfigState`, `readCodexConfigState`, `validateCodexConfig`, `codexIntegrationMessage`, `startCodexInjection`, `codexInjectionArgs = ['install','--target=codex','--location=global','--yes']`.
   - `src/electron/ipc.ts` — `codex:detect` / `codex:inject` handlers + `codexInjectionInFlight` guard.
   - `src/electron/preload.ts` — `detectCodexIntegration` / `injectCodex`.
   - `src/types/global.d.ts` — window type additions.
   - `src/renderer/ui/App.tsx` — codex state, `refreshCodex`/`injectCodex`, `codexStatusLabel`, `jobKindLabel`, and the `.codex-panel` JSX section.
   - `src/renderer/styles.css` — `.codex-panel*` styles.
   - `tests/codegraph-install.test.ts` — `createRunner`, `withMissingBundledInstall`, and Codex test cases.

2. **Upstream CodeGraph `hermes` target** (verified in `colbymchenry/codegraph` `src/installer/targets/hermes.ts`):
   - Target id is `hermes`; `supportsLocation('global') === true` (no local install).
   - Writes to `$HERMES_HOME/config.yaml` (default `~/.hermes/config.yaml`), producing:
     ```yaml
     mcp_servers:
       codegraph:
         command: codegraph
         args:
           - serve
           - --mcp
         timeout: 120
         connect_timeout: 60
         enabled: true
     ```
   - Also upserts `- mcp-codegraph` into `platform_toolsets.cli`.

3. **Hermes home on this machine is NOT `~/.hermes`.** Verified: `HERMES_HOME=C:\Users\qiusi\AppData\Local\hermes`, config at `%LOCALAPPDATA%\hermes\config.yaml` (exists; has `platform_toolsets.cli` but **no `mcp_servers` key yet**). The upstream target defaults to `os.homedir()/.hermes`, which is wrong on Windows unless `HERMES_HOME` is set. Our client must resolve the same way Hermes does: `HERMES_HOME` → `%LOCALAPPDATA%\hermes` (Windows) → `~/.hermes` (mac/linux).

4. **Validation CLI:** `hermes mcp list` (confirmed in the Hermes CLI reference) is the analog of `codex mcp list`.

---

## Step-by-step Plan

### Task 1: Add Hermes types to `src/shared/types.ts`

**Objective:** Declare the Hermes config/integration types and extend `JobKind`.

**Files:**
- Modify: `src/shared/types.ts`

**Step 1:** After the `CodexIntegrationStatus` type (currently lines 13–21), add:

```ts
export type HermesConfigState = 'missing' | 'valid' | 'conflict' | 'unreadable';

export type HermesValidationState = 'valid' | 'invalid' | 'unavailable';

export type HermesIntegrationStatus = {
  injected: boolean;
  codeGraphInstalled: boolean;
  configPath: string;
  configState: HermesConfigState;
  hermesValidation: HermesValidationState;
  canInject: boolean;
  message: string;
};
```

**Step 2:** Extend `JobKind` (currently line 50) from:

```ts
export type JobKind = 'install' | 'inject' | 'build' | 'rebuild' | 'delete';
```

to:

```ts
export type JobKind = 'install' | 'inject' | 'inject-hermes' | 'build' | 'rebuild' | 'delete';
```

**Step 3 (verification):** `npm run typecheck` — expect failure later tasks will resolve (no Hermes service yet). Commit:

```bash
git add src/shared/types.ts
git commit -m "feat: add Hermes integration types and inject-hermes job kind"
```

---

### Task 2: Add Hermes detection/parsing to `src/electron/services/codegraph.ts`

**Objective:** Implement `hermesConfigPath`, `parseHermesConfigState`, `readHermesConfigState`, `validateHermesConfig`, `hermesIntegrationMessage`, and `detectHermesIntegration`.

**Files:**
- Modify: `src/electron/services/codegraph.ts`

**Step 1:** Update the type import block (currently lines 7–14) to add the Hermes types:

```ts
import type {
  CodexConfigState,
  CodexIntegrationStatus,
  CodexValidationState,
  HermesConfigState,
  HermesIntegrationStatus,
  HermesValidationState,
  InstallStatus,
  JobLog,
  ProjectStatus,
} from '../../shared/types.js';
```

**Step 2:** After `codexInjectionArgs` (currently line 22), add the Hermes args constant:

```ts
const hermesInjectionArgs = ['install', '--target=hermes', '--location=global', '--yes'];
```

**Step 3:** After `codexConfigPath` (currently lines 41–43), add:

```ts
export function hermesConfigPath(
  homeDirectory = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const hermesHome = env.HERMES_HOME
    ?? (process.platform === 'win32' && env.LOCALAPPDATA
      ? path.join(env.LOCALAPPDATA, 'hermes')
      : path.join(homeDirectory, '.hermes'));
  return path.join(hermesHome, 'config.yaml');
}
```

**Step 4:** After `detectCodexIntegration` (currently lines 45–70), add:

```ts
export async function detectHermesIntegration(
  runner?: CommandRunner,
  configPath = hermesConfigPath(),
): Promise<HermesIntegrationStatus> {
  const run = runner ?? ((command, args, cwd) => spawnCommand(command, args, { cwd }));
  const install = await detectCodeGraphInstall(run);
  const configState = await readHermesConfigState(configPath);
  const hermesValidation = await validateHermesConfig(run);
  const injected = configState === 'valid';
  const canInject = install.installed && configState === 'missing' && hermesValidation !== 'invalid';

  return {
    injected,
    codeGraphInstalled: install.installed,
    configPath,
    configState,
    hermesValidation,
    canInject,
    message: hermesIntegrationMessage({
      configState,
      hermesValidation,
      codeGraphInstalled: install.installed,
      injected,
    }),
  };
}
```

**Step 5:** After `parseCodexConfigState` (currently lines 72–91), add the Hermes YAML parser:

```ts
export function parseHermesConfigState(content: string): HermesConfigState {
  const lines = content.split(/\r?\n/);

  const mcpServersLine = lines.findIndex((line) => /^mcp_servers:\s*(?:#.*)?$/.test(line));
  if (mcpServersLine < 0) return 'missing';

  // Find the `  codegraph:` child (2-space indent) before the next top-level key.
  let codegraphLine = -1;
  for (let i = mcpServersLine + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\S/.test(line)) break;
    if (/^  codegraph:\s*(?:#.*)?$/.test(line)) {
      codegraphLine = i;
      break;
    }
  }
  if (codegraphLine < 0) return 'missing';

  // Collect the codegraph block: lines indented deeper than the key (4+ spaces),
  // stopping at the next 2-space sibling or top-level key.
  const block: string[] = [];
  for (let i = codegraphLine + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\S/.test(line)) break;
    if (/^  \S/.test(line)) break;
    block.push(line);
  }

  const command = block
    .find((line) => /^    command:\s*/.test(line))
    ?.replace(/^    command:\s*/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  const hasServe = block.some((line) => /^      -\s*serve\s*$/.test(line));
  const hasMcp = block.some((line) => /^      -\s*--mcp\s*$/.test(line));

  return command === 'codegraph' && hasServe && hasMcp ? 'valid' : 'conflict';
}
```

**Step 6:** After `readCodexConfigState` (currently lines 93–100), add:

```ts
async function readHermesConfigState(configPath: string): Promise<HermesConfigState> {
  try {
    return parseHermesConfigState(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    if (isFileMissingError(error)) return 'missing';
    return 'unreadable';
  }
}
```

**Step 7:** After `validateCodexConfig` (currently lines 102–107), add:

```ts
async function validateHermesConfig(run: CommandRunner): Promise<HermesValidationState> {
  const commandPath = await findCommandOnPath('hermes', run);
  if (!commandPath) return 'unavailable';
  const result = await run(commandPath, ['mcp', 'list']).catch(() => null);
  return result?.exitCode === 0 ? 'valid' : 'invalid';
}
```

**Step 8:** After `codexIntegrationMessage` (currently lines 109–123), add:

```ts
function hermesIntegrationMessage({
  configState,
  hermesValidation,
  codeGraphInstalled,
  injected,
}: Pick<HermesIntegrationStatus, 'configState' | 'hermesValidation' | 'codeGraphInstalled' | 'injected'>): string {
  if (hermesValidation === 'invalid') return 'Hermes 配置无法解析，请先修复 Hermes 配置。';
  if (configState === 'unreadable') return '无法读取 Hermes 配置文件。';
  if (configState === 'conflict') return '检测到已有 CodeGraph 配置，但内容与官方配置不一致。';
  if (!codeGraphInstalled) return '未安装 CodeGraph，暂时不能注入 Hermes。';
  if (injected && hermesValidation === 'unavailable') return 'CodeGraph 已注入 Hermes，未找到 hermes 命令，跳过完整校验。';
  if (injected) return 'CodeGraph 已注入 Hermes。';
  if (hermesValidation === 'unavailable') return '尚未注入 Hermes，未找到 hermes 命令，已完成文件级检测。';
  return 'CodeGraph 已安装，可以注入 Hermes。';
}
```

**Step 9 (verification):** `npm run typecheck` should still pass (new functions are self-contained). Commit:

```bash
git add src/electron/services/codegraph.ts
git commit -m "feat: add Hermes config detection and parsing"
```

---

### Task 3: Add `startHermesInjection` to `src/electron/services/codegraph.ts`

**Objective:** Implement the injection action that delegates to the official CLI and re-verifies.

**Files:**
- Modify: `src/electron/services/codegraph.ts`

**Step 1:** After `startCodexInjection` (currently lines 213–241), add:

```ts
export async function startHermesInjection(
  jobId: string,
  sender: WebContents,
  appendLog: (stream: JobLog['stream'], text: string) => void,
  runner?: CommandRunner,
  configPath = hermesConfigPath(),
): Promise<HermesIntegrationStatus> {
  const before = await detectHermesIntegration(runner, configPath);
  if (!before.canInject) {
    throw new Error(before.message);
  }

  appendLog('system', '正在调用 CodeGraph 官方安装器注入 Hermes MCP。');
  const result = await runCodeGraphCliCommand(hermesInjectionArgs, {
    cwd: process.env.USERPROFILE ?? process.cwd(),
    sender,
    jobId,
    appendLog,
  }, runner);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Hermes 注入失败，退出码：${result.exitCode ?? 'unknown'}。`);
  }

  const after = await detectHermesIntegration(runner, configPath);
  if (!after.injected) {
    throw new Error(`注入命令已完成，但未检测到有效的 Hermes MCP 配置：${after.message}`);
  }
  return after;
}
```

**Step 2 (verification):** `npm run typecheck`. Commit:

```bash
git add src/electron/services/codegraph.ts
git commit -m "feat: add Hermes injection via official installer"
```

---

### Task 4: Wire IPC handlers in `src/electron/ipc.ts`

**Objective:** Expose `hermes:detect` and `hermes:inject` channels with an in-flight guard.

**Files:**
- Modify: `src/electron/ipc.ts`

**Step 1:** Add `detectHermesIntegration` and `startHermesInjection` to the import (currently lines 3–10):

```ts
import {
  detectCodexIntegration,
  detectCodeGraphInstall,
  detectHermesIntegration,
  readCodeGraphStatus,
  runCodeGraphCommand,
  startCodexInjection,
  startHermesInjection,
  startOfficialInstall,
} from './services/codegraph.js';
```

**Step 2:** After `let codexInjectionInFlight = false;` (line 16), add:

```ts
let hermesInjectionInFlight = false;
```

**Step 3:** After the `codex:inject` handler (currently ends at line 50), add:

```ts
ipcMain.handle('hermes:detect', async () =>
  withIpcLogging('hermes:detect', undefined, () => detectHermesIntegration()),
);

ipcMain.handle('hermes:inject', async (event) => {
  if (hermesInjectionInFlight) {
    throw new Error('Hermes 注入任务正在运行。');
  }
  hermesInjectionInFlight = true;
  try {
    return await withIpcLogging('hermes:inject', undefined, () =>
      jobRunner.run({
        kind: 'inject-hermes',
        run: ({ job, appendLog }) => startHermesInjection(job.id, event.sender, appendLog),
      }),
    );
  } finally {
    hermesInjectionInFlight = false;
  }
});
```

**Step 4 (verification):** `npm run typecheck`. Commit:

```bash
git add src/electron/ipc.ts
git commit -m "feat: expose Hermes detect/inject IPC handlers"
```

---

### Task 5: Expose bridge methods in `src/electron/preload.ts` and `src/types/global.d.ts`

**Objective:** Let the renderer call the new channels.

**Files:**
- Modify: `src/electron/preload.ts`
- Modify: `src/types/global.d.ts`

**Step 1 (preload.ts):** After `injectCodex: () => ipcRenderer.invoke('codex:inject'),` (line 8), add:

```ts
  detectHermesIntegration: () => ipcRenderer.invoke('hermes:detect'),
  injectHermes: () => ipcRenderer.invoke('hermes:inject'),
```

**Step 2 (global.d.ts):** Add `HermesIntegrationStatus` to the type import (currently lines 1–9) and add the two methods after `injectCodex` (line 19):

```ts
import type {
  GraphSnapshot,
  GraphSnapshotOptions,
  CodexIntegrationStatus,
  HermesIntegrationStatus,
  InstallStatus,
  JobSnapshot,
  ProjectInfo,
  ProjectStatus,
} from '../shared/types';
```

```ts
      detectHermesIntegration: () => Promise<HermesIntegrationStatus>;
      injectHermes: () => Promise<JobSnapshot>;
```

**Step 3 (verification):** `npm run typecheck`. Commit:

```bash
git add src/electron/preload.ts src/types/global.d.ts
git commit -m "feat: bridge Hermes integration to renderer"
```

---

### Task 6: Add UI panel in `src/renderer/ui/App.tsx`

**Objective:** Add Hermes state, refresh/inject handlers, a sidebar panel, and labels.

**Files:**
- Modify: `src/renderer/ui/App.tsx`

**Step 1:** Add `Sparkles` to the lucide-react import (line 1) and `HermesIntegrationStatus` to the type import (lines 5–12):

```ts
import { Activity, ArrowLeft, Box, FolderOpen, GitBranch, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, Wrench } from 'lucide-react';
```

```ts
import type {
  CodexIntegrationStatus,
  GraphSnapshot,
  GraphSnapshotOptions,
  HermesIntegrationStatus,
  InstallStatus,
  JobSnapshot,
  ProjectInfo,
} from '../../shared/types';
```

**Step 2:** Add state after `codexBusy` (line 41):

```ts
  const [hermes, setHermes] = useState<HermesIntegrationStatus | null>(null);
  const [hermesBusy, setHermesBusy] = useState(false);
```

**Step 3:** In the mount `useEffect` (line 57 area), add `void refreshHermes();` next to `void refreshCodex();`. In `installCodeGraph` (lines 90–93), refresh Hermes too:

```ts
    await Promise.all([refreshInstall(), refreshCodex(), refreshHermes()]);
```

**Step 4:** After `refreshCodex` (lines 86–88), add `refreshHermes`; after `injectCodex` (lines 95–105), add `injectHermes`:

```ts
  async function refreshHermes(): Promise<void> {
    setHermes(await window.codegraphClient.detectHermesIntegration());
  }
```

```ts
  async function injectHermes(): Promise<void> {
    if (!hermes?.canInject || hermesBusy) return;
    setHermesBusy(true);
    try {
      const job = await window.codegraphClient.injectHermes();
      setJobs((existing) => [job, ...existing.filter((item) => item.id !== job.id)].slice(0, 20));
      await refreshHermes();
    } finally {
      setHermesBusy(false);
    }
  }
```

**Step 5:** After the codex `<section>` (currently lines 217–237), add the Hermes panel:

```tsx
        <section className="agent-panel" aria-label="Hermes MCP">
          <div className="agent-panel-heading">
            <div>
              <strong>Hermes MCP</strong>
              <span>{hermesStatusLabel(hermes)}</span>
            </div>
            <Sparkles size={18} />
          </div>
          <p>{hermes?.message ?? '正在检测 Hermes 配置。'}</p>
          {hermes?.configPath ? <small title={hermes.configPath}>{hermes.configPath}</small> : null}
          <div className="agent-panel-actions">
            <button className="secondary" onClick={() => void refreshHermes()} disabled={hermesBusy}>
              <RefreshCw size={14} />
              检测
            </button>
            <button className="primary" onClick={() => void injectHermes()} disabled={!hermes?.canInject || hermesBusy}>
              <Sparkles size={14} />
              注入 Hermes
            </button>
          </div>
        </section>
```

**Step 6:** Update `jobKindLabel` (lines 722–730) to include the new kind, and add `hermesStatusLabel` after `codexStatusLabel` (lines 732–739):

```ts
function jobKindLabel(kind: JobSnapshot['kind']): string {
  return {
    install: '安装 CodeGraph',
    inject: '注入 Codex',
    'inject-hermes': '注入 Hermes',
    build: '构建图谱',
    rebuild: '重构图谱',
    delete: '删除图谱',
  }[kind];
}
```

```ts
function hermesStatusLabel(status: HermesIntegrationStatus | null): string {
  if (!status) return '检测中';
  if (status.hermesValidation === 'invalid') return '配置异常';
  if (status.configState === 'unreadable') return '无法读取配置';
  if (status.configState === 'conflict') return '配置冲突';
  if (!status.codeGraphInstalled) return '未安装 CodeGraph';
  return status.injected ? '已注入' : '未注入';
}
```

**Step 7 (verification):** `npm run typecheck`. Commit:

```bash
git add src/renderer/ui/App.tsx
git commit -m "feat: add Hermes MCP panel to sidebar"
```

---

### Task 7: Generalize panel CSS in `src/renderer/styles.css`

**Objective:** Rename the `.codex-panel*` classes to a shared `.agent-panel*` family (both panels are visually identical), and update the codex section in App.tsx to match.

**Files:**
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/ui/App.tsx`

**Step 1 (styles.css):** Rename the four selectors (currently in the `.codex-panel` block added by commit `9ad1fa1`):

- `.codex-panel` → `.agent-panel`
- `.codex-panel-heading` → `.agent-panel-heading` (and its `.codex-panel-heading div` / `.codex-panel-heading span` children)
- `.codex-panel p`, `.codex-panel small` → `.agent-panel p`, `.agent-panel small`
- `.codex-panel-actions` → `.agent-panel-actions` (and its `button` child)

**Step 2 (App.tsx):** In the existing codex `<section>` (lines 217–237), change `className="codex-panel"` → `"agent-panel"`, `codex-panel-heading` → `agent-panel-heading`, `codex-panel-actions` → `agent-panel-actions`. (The Hermes section from Task 6 already uses `agent-panel`.)

**Step 3 (verification):** `npm run lint && npm run build`. Manually confirm both panels render. Commit:

```bash
git add src/renderer/styles.css src/renderer/ui/App.tsx
git commit -m "refactor: share agent-panel styles between Codex and Hermes panels"
```

---

### Task 8: Add tests in `tests/codegraph-install.test.ts`

**Objective:** Cover `parseHermesConfigState`, `detectHermesIntegration`, `startHermesInjection`, and `hermesConfigPath`.

**Files:**
- Modify: `tests/codegraph-install.test.ts`

**Step 1:** Extend the import (currently lines 2–10) to pull the Hermes symbols:

```ts
import {
  detectCodexIntegration,
  detectCodeGraphInstall,
  detectHermesIntegration,
  hermesConfigPath,
  normalizeSpawnCommand,
  officialInstallCommand,
  parseCodexConfigState,
  parseHermesConfigState,
  startCodexInjection,
  startHermesInjection,
  type CommandRunner,
} from '../src/electron/services/codegraph.js';
```

**Step 2:** Add a `createHermesRunner` helper next to `createRunner`:

```ts
const hermesCommandPath = 'C:\\tools\\hermes.cmd';

function createHermesRunner(options: {
  codeGraphInstalled?: boolean;
  hermesInstalled?: boolean;
  hermesExitCode?: number;
  onInject?: () => void;
} = {}): { calls: Array<{ command: string; args: string[] }>; runner: CommandRunner } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: CommandRunner = async (command, args) => {
    calls.push({ command, args });
    if (command === pathLookupCommand && args[0] === 'codegraph') {
      return options.codeGraphInstalled === false
        ? { exitCode: 1, stdout: '', stderr: 'not found' }
        : { exitCode: 0, stdout: `${codeGraphCommandPath}\r\n`, stderr: '' };
    }
    if (command === pathLookupCommand && args[0] === 'hermes') {
      return options.hermesInstalled
        ? { exitCode: 0, stdout: `${hermesCommandPath}\r\n`, stderr: '' }
        : { exitCode: 1, stdout: '', stderr: 'not found' };
    }
    if (command === codeGraphCommandPath && args[0] === 'version') {
      return { exitCode: 0, stdout: '1.1.5\n', stderr: '' };
    }
    if (command === hermesCommandPath && args[0] === 'mcp' && args[1] === 'list') {
      return { exitCode: options.hermesExitCode ?? 0, stdout: '', stderr: options.hermesExitCode ? 'invalid config' : '' };
    }
    if (command === codeGraphCommandPath && args[0] === 'install') {
      options.onInject?.();
      return { exitCode: 0, stdout: 'installed\n', stderr: '' };
    }
    return { exitCode: 1, stdout: '', stderr: 'not found' };
  };
  return { calls, runner };
}

const validHermesConfig = [
  'mcp_servers:',
  '  codegraph:',
  '    command: codegraph',
  '    args:',
  '      - serve',
  '      - --mcp',
  '    timeout: 120',
  '    connect_timeout: 60',
  '    enabled: true',
].join('\n');
```

**Step 3:** Add a `describe('Hermes integration', ...)` block with these cases:

```ts
describe('Hermes integration', () => {
  it('resolves the Hermes config path from HERMES_HOME before LOCALAPPDATA', () => {
    expect(hermesConfigPath('/home/user', { HERMES_HOME: '/custom/hermes' }))
      .toBe(path.join('/custom/hermes', 'config.yaml'));

    const viaLocalAppData = process.platform === 'win32'
      ? path.join('C:\\Users\\test\\AppData\\Local', 'hermes', 'config.yaml')
      : path.join('/home/user', '.hermes', 'config.yaml');
    expect(hermesConfigPath('/home/user', { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' }))
      .toBe(viaLocalAppData);
  });

  it('classifies Hermes MCP configuration states', () => {
    expect(parseHermesConfigState('model: gpt-5\n')).toBe('missing');
    expect(parseHermesConfigState('mcp_servers:\n  other:\n    command: x\n')).toBe('missing');
    expect(parseHermesConfigState(validHermesConfig)).toBe('valid');
    expect(parseHermesConfigState(
      'mcp_servers:\n  codegraph:\n    command: other-server\n    args:\n      - serve\n      - --mcp\n',
    )).toBe('conflict');
  });

  it('enables Hermes injection only when CodeGraph is installed and config is missing', async () => {
    const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-hermes-')), 'config.yaml');
    const { runner } = createHermesRunner();

    const status = await withMissingBundledInstall(() => detectHermesIntegration(runner, configPath));

    expect(status.configState).toBe('missing');
    expect(status.injected).toBe(false);
    expect(status.canInject).toBe(true);
  });

  it('falls back to file-level detection when hermes is unavailable', async () => {
    const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-hermes-no-cli-')), 'config.yaml');
    fs.writeFileSync(configPath, validHermesConfig);
    const { runner } = createHermesRunner();

    const status = await withMissingBundledInstall(() => detectHermesIntegration(runner, configPath));

    expect(status.injected).toBe(true);
    expect(status.hermesValidation).toBe('unavailable');
    expect(status.canInject).toBe(false);
  });

  it('rejects Hermes injection when CodeGraph is not installed', async () => {
    const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-hermes-no-codegraph-')), 'config.yaml');
    const { runner } = createHermesRunner({ codeGraphInstalled: false });

    await expect(withMissingBundledInstall(() => startHermesInjection('inject-test', undefined as never, () => undefined, runner, configPath)))
      .rejects.toThrow('未安装 CodeGraph');
  });

  it('injects through the official CLI arguments and verifies the result', async () => {
    const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-hermes-inject-')), 'config.yaml');
    const { calls, runner } = createHermesRunner({
      onInject: () => fs.writeFileSync(configPath, validHermesConfig),
    });

    const status = await withMissingBundledInstall(() => startHermesInjection('inject-test', undefined as never, () => undefined, runner, configPath));
    const injectionCall = calls.find((call) => call.command === codeGraphCommandPath && call.args[0] === 'install');

    expect(injectionCall?.args).toEqual(['install', '--target=hermes', '--location=global', '--yes']);
    expect(status.injected).toBe(true);
    expect(status.configState).toBe('valid');
  });
});
```

**Step 4 (verification):**

```bash
npm run test
```

Expected: all existing + 6 new tests pass. Commit:

```bash
git add tests/codegraph-install.test.ts
git commit -m "test: cover Hermes integration detection and injection"
```

---

### Task 9: Update README and run full verification

**Objective:** Document the feature and confirm the whole pipeline is green.

**Files:**
- Modify: `README.md`

**Step 1:** Update the features bullet (line 11) and the "CodeGraph Commands" note (lines 46–50) to mention Hermes alongside Codex, e.g.:

- Feature bullet: "Detect and inject the CodeGraph MCP server into the global Codex or Hermes Agent configuration."
- Add to the commands section:
  ```
  Hermes MCP detection reads `$HERMES_HOME/config.yaml` (default `%LOCALAPPDATA%\hermes` on Windows).
  Injection delegates to: codegraph install --target=hermes --location=global --yes
  ```

**Step 2 (verification) — run the full pipeline:**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

All four must pass.

**Step 3:** Manual smoke test (optional but recommended):

1. `npm run dev`
2. Confirm a "Hermes MCP" panel appears below the "Codex MCP" panel, showing "未注入".
3. With CodeGraph installed, click "注入 Hermes"; the job list shows "注入 Hermes".
4. Verify `%LOCALAPPDATA%\hermes\config.yaml` now contains `mcp_servers.codegraph` and `platform_toolsets.cli` includes `- mcp-codegraph`.
5. Run `hermes mcp list` and confirm the `codegraph` server is listed.

Commit:

```bash
git add README.md
git commit -m "docs: document Hermes MCP injection"
```

---

## Files Likely to Change (summary)

| File | Change |
|---|---|
| `src/shared/types.ts` | +`HermesConfigState`, `HermesValidationState`, `HermesIntegrationStatus`; `JobKind` + `'inject-hermes'` |
| `src/electron/services/codegraph.ts` | +`hermesConfigPath`, `detectHermesIntegration`, `parseHermesConfigState`, `readHermesConfigState`, `validateHermesConfig`, `hermesIntegrationMessage`, `startHermesInjection`, `hermesInjectionArgs` |
| `src/electron/ipc.ts` | +`hermes:detect`, `hermes:inject` handlers + `hermesInjectionInFlight` guard |
| `src/electron/preload.ts` | +`detectHermesIntegration`, `injectHermes` bridge methods |
| `src/types/global.d.ts` | +`HermesIntegrationStatus` import + two window methods |
| `src/renderer/ui/App.tsx` | +Hermes state/handlers/panel, `hermesStatusLabel`, `jobKindLabel` entry; codex panel class rename |
| `src/renderer/styles.css` | `.codex-panel*` → `.agent-panel*` (shared) |
| `tests/codegraph-install.test.ts` | +`createHermesRunner` + `describe('Hermes integration')` |
| `README.md` | Document Hermes injection |

## Tests / Validation

- `npm run typecheck` — TypeScript across Electron/Vite/tests.
- `npm run lint` — ESLint.
- `npm run test` — Vitest (6 new Hermes cases + existing Codex cases).
- `npm run build` — full renderer + main/preload build.

## Risks, Tradeoffs, and Open Questions

1. **Config path resolution differs from upstream.** Upstream `hermes.ts` defaults to `~/.hermes`; we resolve `HERMES_HOME` → `%LOCALAPPDATA%\hermes` (Windows) → `~/.hermes`. This is intentional and matches what Hermes actually reads on this machine. Tradeoff: if a future Hermes changes its Windows home again, this needs a follow-up. Mitigated by honoring `HERMES_HOME` first.
2. **`HERMES_HOME` may be unset in the Electron process.** If the app is launched from a Start Menu shortcut (not a shell), `HERMES_HOME` is likely absent, but the `%LOCALAPPDATA%\hermes` fallback still resolves correctly on Windows. The injection subprocess (`codegraph install --target=hermes`) inherits the same env, so upstream's default `~/.hermes` could theoretically write to the wrong place on Windows if `HERMES_HOME` is unset. **Open question:** should `startHermesInjection` explicitly pass `env: { ...process.env, HERMES_HOME: <resolved> }` to `runCodeGraphCliCommand` so the subprocess writes to the same path our detection reads? This would require a small extension to `spawnCommand`/`runCodeGraphCliCommand` to accept `env`. Recommended follow-up if manual testing shows a mismatch.
3. **YAML parsing is line-based, not a full parser.** Mirrors the Codex TOML approach and needs no new dependency, but only recognizes the exact block shape CodeGraph writes (unquoted `command: codegraph`, 6-space `- serve`/`- --mcp` list items). Unusual-but-valid YAML (quoted scalars, flow style `args: [serve, --mcp]`) would be misclassified as `conflict`. Acceptable for now; a `js-yaml` dependency is the escape hatch if false "conflict" reports become a problem.
4. **No shared panel component yet.** The Codex and Hermes panels are two near-identical JSX sections sharing `.agent-panel` CSS. Extracting a reusable `AgentMcpPanel` component is left as YAGNI — revisit if a third agent target is added.
5. **`hermes mcp list` exit code semantics.** Assumed to exit 0 on a parseable config (matching `codex mcp list`). If Hermes's `mcp list` returns non-zero for unrelated reasons, validation will misreport `invalid`. Verify once during the manual smoke test; if needed, fall back to file-level detection only.

## Execution Handoff

Plan complete and saved. Ready to execute using subagent-driven-development — I'll dispatch a fresh subagent per task with two-stage review (spec compliance then code quality). Shall I proceed?
