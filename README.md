# VishSi

VishSi is a local-first, web-based agentic IDE and workspace, inspired by the
Claude Code desktop/CLI experience. **Node.js + npm only — no Bun, no Bun
APIs.**

- Real agent loop with tools: read/list, write/edit with revertible snapshots,
  shell execution, headless browsing.
- A real interactive shell (ConPTY/PTY) in the browser via xterm.js.
- Three-pane layout: project explorer + sessions · agentic chat · workspace
  tools (terminal / code & diff / live preview).
- Approval gate with **Allow Once · Allow for Session · Deny**, and **Plan /
  Ask / Auto** modes.
- Sessions saved locally as `.jsonl`, with resume and fork.
- Works against the Anthropic API or **any OpenAI-compatible endpoint**
  (NVIDIA NIM, OpenRouter, Groq, Together, Ollama, OpenAI).

---

## 1. Quick start

Requires **Node.js 20 or newer** and npm. Clone the repo, `cd` into it, then:

```bash
npm install
```

Run this **inside the cloned folder**. Dependencies are not inherited from a
parent directory in any useful way — if a `node_modules` happens to exist above
the clone, Node may resolve packages from it and the app will appear to half
work until you move the folder.

npm 11 blocks package install scripts by default. esbuild (used by Vite) needs
its postinstall, so approve it once:

```bash
npm install-scripts approve esbuild
```

Create your local config files from the committed templates:

```bash
npm run setup
```

That writes `api_key.txt`, `endpoint.txt` and `.env` if they do not already
exist. It never overwrites an existing file.

### Your key and your endpoint — two text files

Everything you normally need to configure lives in two plain text files in the
project root. Both are re-read **on every request**, so you can swap a key or
switch providers with the server running — just save the file.

**`api_key.txt`** — paste your API key on the last line:

```
# ... comments ...
nvapi-xxxxxxxxxxxxxxxxxxxx
```

**`endpoint.txt`** — the base URL for that key, optionally followed by a
default model id:

```
https://integrate.api.nvidia.com/v1
nvidia/nemotron-3.5-lightning-30b-a3b
```

In both files, blank lines and lines starting with `#` are ignored. Any
OpenAI-compatible endpoint works (NVIDIA NIM, OpenAI, OpenRouter, Groq,
Together, Ollama). For Anthropic use the bare host `https://api.anthropic.com`
— VishSi detects it and switches to the Messages API instead of
`/chat/completions`.

Precedence, highest first:

| Setting | 1 | 2 | 3 |
| --- | --- | --- | --- |
| Key | `API_KEY` env | **`api_key.txt`** | `API_KEY_FILE` env (external file) |
| Endpoint | — | **`endpoint.txt`** line 1 | `BASE_URL` env |
| Model | — | **`endpoint.txt`** line 2 | `MODEL` env |

Leaving the template text in place (`Enter Your API Key here`) counts as *not
filled in* — VishSi recognises placeholder wording and falls through to the
next source instead of sending nonsense to a provider. An endpoint line is only
accepted if it actually looks like a URL.

`.env` is optional and only needed for the port, the startup workspace folder,
or the overrides above. `.env`, `api_key.txt` and `endpoint.txt` are all in
`.gitignore`; only the `.example` templates are committed, so your key can
never be pushed by accident.

`/status` in the chat shows which source the live key came from, without ever
printing the key itself.

Check the machine before launching:

```bash
npm run preflight
```

Expected output (the exact paths vary by machine):

```
[ ok ] PTY works (powershell.exe)
[ ok ] headless browser executable: C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
[ ok ] API key loaded (provider openai, base https://integrate.api.nvidia.com/v1)
```

Run it:

```bash
npm run dev
```

Then open **http://localhost:5173**. The Vite dev server proxies `/api` and
`/ws` to the Node backend on port 5174.

### If it says the port is in use

`npm run dev` starts two listeners: the backend on `PORT` (5174) and the UI on
`UI_PORT` (5173). If another copy of VishSi — or anything else — already holds
one of them, the backend stops with a message naming the port, and the UI
quietly moves to the next free port and prints its URL.

To run a second copy alongside the first, give it its own ports in `.env`:

```
PORT=5184
UI_PORT=5183
```

The dev proxy reads `PORT` from `.env` too, so the two always match. To find
what is holding a port on Windows:

```bash
Get-NetTCPConnection -LocalPort 5174 -State Listen | Select-Object OwningProcess
```

### Production (single port)

```bash
npm run build
```

```bash
npm start
```

Serves the built UI and the API together on **http://localhost:5174**.

---

## 2. Architecture

```
claude-code-ide/
├── server/                 Node + Express + ws backend (no build step)
│   ├── index.js            REST + WebSocket wiring, static serving in prod
│   ├── config.js           .env loader, key loading, model presets
│   ├── workspace.js        workspace root + path-escape guard
│   ├── files.js            read/write/create/rename/delete, walk, memory file
│   ├── snapshots.js        pre-edit snapshots and revert
│   ├── diff.js             unified diff (for the model) + row diff (for the UI)
│   ├── pty.js              terminal registry on @lydell/node-pty
│   ├── exec.js             captured command runs with real exit codes
│   ├── browser.js          headless Chromium via playwright-core
│   ├── sessions.js         .jsonl session store: create/append/resume/fork
│   ├── llm.js              streaming adapters: Anthropic + OpenAI-compatible
│   ├── tools.js            tool catalogue and executors
│   ├── agent.js            agent loop, modes, approvals, /compact
│   └── preflight.js        environment check
└── src/                    React 18 + Vite + Tailwind frontend
    ├── App.jsx             shell layout + draggable splitter
    ├── lib/store.js        zustand store + WebSocket client
    ├── lib/api.js          REST client
    └── components/         Sidebar, FileTree, ChatPane, ToolCard,
                            ApprovalBar, PromptInput, WorkspacePane,
                            TerminalTab, EditorTab, BrowserTab, DiffView
```

**Transport.** One WebSocket (`/ws`) carries terminal bytes and agent events;
plain REST handles file and session CRUD. Terminal output bypasses React state
and is written straight into xterm, so a noisy build does not re-render the UI.

**Memory.** File reads are capped at 512 KB, the tree loads one directory at a
time, terminal scrollback is bounded (200 KB server-side, 4000 lines client
side), and the browser engine reuses a single page. No SDKs for the LLM — the
provider adapters are plain `fetch` + SSE parsing.

---

## 3. The agent

### Tools

| Tool | Mutating | What it does |
| --- | --- | --- |
| `read_file` | no | Reads a text file with line numbers, 512 KB cap |
| `list_directory` | no | One directory level; marks `node_modules`, `.git`, `dist` without expanding |
| `search_files` | no | Path substring match, optional content regex |
| `write_file` | yes | Full overwrite, snapshot taken first |
| `edit_file` | yes | Exact search-and-replace, uniqueness enforced, snapshot taken first |
| `execute_command` | yes | PowerShell (Windows) / bash, in the workspace root, returns stdout+stderr+exit code |
| `browser_navigate` | no | Headless page load: title, visible text, console errors, optional screenshot |
| `browser_inspect` | no | CSS-selector DOM query on the loaded page |

### Modes

- **Plan** — read-only. Mutating tools are refused by the server before they
  run, and the model is told to produce a plan instead.
- **Ask** — every file modification and shell command raises an approval bar.
  *Allow for Session* remembers a rule: `tool:write_file`, or `cmd:npm` for
  commands (keyed on the first token, so approving `npm` does not approve
  `rm`).
- **Auto** — runs without asking.

Modes are enforced on the **server**, not just in the UI.

### Slash commands

`/help` · `/status` · `/clear` · `/compact` · `/model [id]`

`/compact` summarizes everything but the last four messages into a single note
via the current model, rewrites the session file, and the meter next to the
input shows estimated context use (chars ÷ 4 against a 128k budget).

### Project memory

If the opened workspace root contains `VISHSI.md`, it is loaded into the system
prompt on every turn and its name is shown in the title bar. `CLAUDE.md` and
`AGENTS.md` are also honoured, in that order, so a project that already has
agent rules works without renaming anything.

### Snapshots and revert

Every `write_file` / `edit_file` first copies the file into
`<workspace>/.vishsi/snapshots/`. The Code & Diff tab shows the red/green
line diff with **Accept** and **Revert**; the same buttons live on the tool card
in the chat. Reverting a file that did not exist before deletes it again.

### Sessions

`<workspace>/.vishsi/sessions/<id>.jsonl` — line 0 is metadata, every later
line is one message. Resume replays the file into a live runner; Fork copies it
into a new session id. Both are in the Sessions tab of the sidebar.

---

## 4. Configuration

`.env` (see `.env.example`):

| Variable | Meaning |
| --- | --- |
| `PORT` | Backend port (default 5174) |
| `WORKSPACE_ROOT` | Folder opened on boot; any folder can be mounted from the UI |
| `PROVIDER` | `openai` (any OpenAI-compatible endpoint) or `anthropic` |
| `BASE_URL` | e.g. `https://integrate.api.nvidia.com/v1`, `https://api.anthropic.com`, `http://localhost:11434/v1` |
| `MODEL` | Default model id |
| `API_KEY` / `API_KEY_FILE` | Key, or a file holding it |
| `BROWSER_EXECUTABLE` | Override the auto-detected Edge/Chrome path |

Model ids in the dropdown are presets only. **The ids a given key can actually
reach change over time** — list them with:

```bash
curl -s https://integrate.api.nvidia.com/v1/models -H "Authorization: Bearer $env:API_KEY" | findstr id
```

Any id can also be typed with `/model <id>`.

---

## 5. Environment notes, honestly

**`node-pty` does not build on this machine.** Node 24.22.0 is installed,
Visual Studio 18 Community is present but without the "Desktop development with
C++" workload, so `npm install node-pty@1.0.0` fails at
`gyp ERR! find VS could not find a version of Visual Studio 2017 or newer`.
`@homebridge/node-pty-prebuilt-multiarch` fails the same way (no prebuild for
Node 24's ABI). The project therefore uses **`@lydell/node-pty`**, a maintained
fork that ships prebuilt binaries for current Node versions. It installs with
no compiler and was verified spawning a real ConPTY PowerShell session that
echoes typed input. If you ever need upstream `node-pty`, install the VS
"Desktop development with C++" workload first.

**Rollup's native addon is blocked by Windows Application Control** on this
machine (`ERR_DLOPEN_FAILED: An Application Control policy has blocked this
file` for `@rollup/rollup-win32-x64-msvc`). `package.json` therefore pins an
override to the pure-WASM build:

```json
"overrides": { "rollup": "npm:@rollup/wasm-node@^4.30.1" }
```

Vite dev and `vite build` both work with it. On a machine where the native
binary is allowed you can delete the override (and `package-lock.json`) for a
slightly faster build.

**The browser tool uses an installed browser, not a downloaded one.**
`playwright-core` is driven against the Edge/Chrome already on the machine, so
there is no ~150 MB browser download. If none is found, `browser_navigate`
degrades to a plain `fetch` + tag-strip and says so in its result; screenshots
and `browser_inspect` need the real browser.

**`execute_command` is non-interactive by design.** It spawns a captured
PowerShell/bash process so the agent gets a real exit code and clean
stdout/stderr. It is *not* the xterm session. Programs that wait for keyboard
input will hang until the timeout (default 120 s, max 600 s) — use the Terminal
tab yourself for those. The agent's command output is streamed live onto its
tool card in the chat.

**The Preview tab's iframe is a plain iframe.** Sites that send
`X-Frame-Options`/`frame-ancestors` (most public sites) will refuse to render
there. Local dev servers work fine. The camera button falls back to a headless
screenshot, which works regardless, and the console viewer shows the *headless*
browser's console, not the iframe's.

---

## 6. What was tested, and how

Verified on the development machine — Windows 11 (10.0.26300), Node v24.22.0,
npm 11.19.1 — on
2026-11-17, by booting the servers and driving the UI in a browser:

- `npm install` clean, `npm run preflight` → all three checks pass.
- Dev servers start; UI loads at :5173 with **zero console errors** on a fresh
  tab.
- **Terminal**: typed `Get-Location; echo TERMINAL_INTERACTIVE_OK` directly into
  xterm — PowerShell echoed with syntax colouring, ran in the workspace root,
  printed the output.
- **Agent loop, Ask mode**: "create hello-agent.txt containing: it works" →
  approval bar appeared with the exact tool input → *Allow Once* → file written,
  diff pane auto-opened showing `+it works` (+1/−0), file tree refreshed, agent
  read the file back and confirmed. File verified on disk.
- **Agent loop, Auto mode**: `node -e "console.log('sum', 40+2)"` ran with
  `exit 0` and output `sum 42`; `browser_navigate` to localhost:5173 via
  headless Edge returned the real page title and switched the Preview
  tab to it.
- **Plan mode**: a `write_file` request was refused server-side; the card showed
  the refusal and the agent explained it needs Ask or Auto. The file was not
  touched.
- **browser_inspect**: `header` selector on the running UI returned the element
  class list and its text, which the agent reported correctly.
- **Sessions**: `.jsonl` files written under `.vishsi/sessions/`; resuming
  an older one restored its messages and its model id; **Fork** produced a new
  session marked `(fork)` carrying the parent's messages.
- **/compact**: rewrote the session into a summary note; the estimated token
  count dropped and the summary was shown in the stream. (Summary *quality*
  depends on the model — the small Nemotron model produced a terse one.)
- **Snapshots**: written under `.vishsi/snapshots/` on each edit.
- **File CRUD + path guard**: create → write → rename → read → delete all
  verified against the REST API, and
  `GET /api/fs/read?path=../manus-bun-agent/api_key.txt` was refused with
  `Path escapes workspace root` — the agent and the UI cannot read outside the
  mounted folder.
- `npm run build` succeeds (1629 modules, ~1.14 MB JS / 362 kB gzip);
  `npm start` serves UI + API on one port, `/api/status` returns 200.

Not exercised end-to-end: the **Anthropic provider path** (no Anthropic key on
this machine — the adapter is written against the Messages API with
`anthropic-version: 2023-06-01`, but it has never actually been run), and
`/compact` against a genuinely long conversation. The file tree's
rename/delete/new-file context menu and the editor's Save button were verified
at the API level (above) but not clicked through in the UI, because they go via
`window.prompt`/`confirm`, which the test browser could not drive.

One known rough edge: the context meter does not reset when you resume a
session — it refreshes on the next turn.
