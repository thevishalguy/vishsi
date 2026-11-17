import path from 'node:path';
import * as filesApi from './files.js';
import { runCommand } from './exec.js';
import * as browserApi from './browser.js';
import { safeResolve, toRel, getRoot } from './workspace.js';
import { snapshotFile } from './snapshots.js';
import { buildUnifiedDiff } from './diff.js';

/**
 * Tool catalogue. `mutating` drives the approval rules:
 *   plan mode  -> mutating tools refused outright
 *   ask mode   -> mutating tools require user approval
 *   auto mode  -> everything runs
 */
export const TOOLS = [
  {
    name: 'read_file',
    mutating: false,
    description:
      'Read a UTF-8 text file from the workspace. Returns the file content with line numbers. Large files are truncated at 512 KB.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path, e.g. src/App.jsx' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_directory',
    mutating: false,
    description:
      'List the entries of one directory in the workspace. Use "." for the workspace root. Build/vendor directories (node_modules, .git, dist) are marked but not expanded.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative directory path. Default "."' },
      },
      required: [],
    },
  },
  {
    name: 'write_file',
    mutating: true,
    description:
      'Create or overwrite a text file with full content. The previous version is snapshotted first so the change can be reverted.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string', description: 'Complete new file content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    mutating: true,
    description:
      'Make a targeted edit by exact search-and-replace. old_string must appear exactly once in the file unless replace_all is true. Snapshots the file before editing.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string', description: 'Exact text to find, including indentation' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence. Default false' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'execute_command',
    mutating: true,
    description:
      'Run a shell command in the workspace root (PowerShell on Windows, bash elsewhere) and return stdout, stderr and the exit code. Non-interactive: do not run programs that wait for keyboard input, and do not start long-running servers without a timeout.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout_ms: { type: 'number', description: 'Default 120000' },
      },
      required: ['command'],
    },
  },
  {
    name: 'browser_navigate',
    mutating: false,
    description:
      'Open a URL in the headless browser and return the page title and visible text, plus any console errors. Also shows the URL in the IDE preview pane. Use for local dev servers (http://localhost:3000) or documentation.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        screenshot: { type: 'boolean', description: 'Also capture a JPEG screenshot' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_inspect',
    mutating: false,
    description:
      'Query the currently loaded page with a CSS selector and return matching elements (tag, attributes, text, outer HTML).',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        limit: { type: 'number', description: 'Max elements, default 10' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'search_files',
    mutating: false,
    description:
      'Find files whose path matches a substring, and optionally grep their contents for a regex. Cheaper than listing directories one by one.',
    input_schema: {
      type: 'object',
      properties: {
        name_contains: { type: 'string' },
        content_regex: { type: 'string' },
        limit: { type: 'number', description: 'Max results, default 40' },
      },
      required: [],
    },
  },
];

export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
export const READ_ONLY_TOOLS = new Set(TOOLS.filter((t) => !t.mutating).map((t) => t.name));

function withLineNumbers(text, start = 1) {
  const lines = text.split('\n');
  const width = String(lines.length + start - 1).length;
  return lines
    .map((l, i) => `${String(i + start).padStart(width, ' ')}\t${l}`)
    .join('\n');
}

/**
 * Execute one tool call.
 * `ctx` carries { emit } so tools can push UI events (diffs, previews, output).
 * Returns { text, is_error, meta } — `text` is what the model sees.
 */
export async function executeTool(name, input, ctx = {}) {
  const emit = ctx.emit || (() => {});
  try {
    switch (name) {
      case 'read_file': {
        const res = await filesApi.readFile(input.path);
        if (res.binary) {
          return {
            text: `[binary file, ${res.size} bytes — not shown]`,
            meta: { path: res.path },
          };
        }
        emit({ type: 'open_file', path: res.path });
        const body = withLineNumbers(res.content);
        return {
          text: `File: ${res.path} (${res.size} bytes${res.truncated ? ', TRUNCATED' : ''})\n${body}`,
          meta: { path: res.path, size: res.size, truncated: res.truncated },
        };
      }

      case 'list_directory': {
        const res = await filesApi.listDirectory(input.path || '.');
        const lines = res.entries.map((e) =>
          e.type === 'dir'
            ? `${e.name}/${e.ignored ? '   [not expanded]' : ''}`
            : `${e.name}   ${e.size} B`
        );
        return {
          text: `Directory: ${res.path}\n${lines.join('\n') || '(empty)'}`,
          meta: { path: res.path, count: res.entries.length },
        };
      }

      case 'write_file': {
        const abs = safeResolve(input.path);
        let before = '';
        try {
          const prev = await filesApi.readFile(input.path);
          before = prev.content;
        } catch {
          before = '';
        }
        const res = await filesApi.writeFile(input.path, input.content ?? '');
        const diff = buildUnifiedDiff(before, input.content ?? '', res.path);
        emit({
          type: 'file_diff',
          path: res.path,
          diff,
          snapshotId: res.snapshot?.id || null,
        });
        emit({ type: 'fs_changed', path: res.path });
        return {
          text: `Wrote ${res.path} (${res.size} bytes). Snapshot ${res.snapshot?.id} saved for revert.`,
          meta: { path: res.path, snapshotId: res.snapshot?.id, diff },
        };
      }

      case 'edit_file': {
        const file = await filesApi.readFile(input.path);
        if (file.binary) return { text: 'Cannot edit a binary file.', is_error: true };
        const oldStr = input.old_string ?? '';
        if (!oldStr) {
          return { text: 'old_string must not be empty.', is_error: true };
        }
        const occurrences = file.content.split(oldStr).length - 1;
        if (occurrences === 0) {
          return {
            text: `old_string not found in ${file.path}. Read the file again and copy the exact text, including whitespace.`,
            is_error: true,
          };
        }
        if (occurrences > 1 && !input.replace_all) {
          return {
            text: `old_string occurs ${occurrences} times in ${file.path}. Add more surrounding context to make it unique, or pass replace_all: true.`,
            is_error: true,
          };
        }
        const next = input.replace_all
          ? file.content.split(oldStr).join(input.new_string ?? '')
          : file.content.replace(oldStr, input.new_string ?? '');
        const res = await filesApi.writeFile(input.path, next);
        const diff = buildUnifiedDiff(file.content, next, res.path);
        emit({
          type: 'file_diff',
          path: res.path,
          diff,
          snapshotId: res.snapshot?.id || null,
        });
        emit({ type: 'fs_changed', path: res.path });
        return {
          text: `Edited ${res.path} (${occurrences} replacement${occurrences === 1 ? '' : 's'}). Snapshot ${res.snapshot?.id} saved for revert.\n${diff}`,
          meta: { path: res.path, snapshotId: res.snapshot?.id, diff },
        };
      }

      case 'execute_command': {
        const command = String(input.command || '').trim();
        if (!command) return { text: 'No command given.', is_error: true };
        emit({ type: 'command_start', command });
        const res = await runCommand(command, {
          timeoutMs: Math.min(Math.max(Number(input.timeout_ms) || 120_000, 1000), 600_000),
          onChunk: (stream, text) => emit({ type: 'command_output', stream, text }),
        });
        emit({ type: 'command_end', exitCode: res.exitCode, timedOut: res.timedOut });
        const parts = [`$ ${command}`, `exit code: ${res.exitCode}${res.timedOut ? ' (timed out)' : ''}`];
        if (res.stdout) parts.push(`--- stdout ---\n${res.stdout}`);
        if (res.stderr) parts.push(`--- stderr ---\n${res.stderr}`);
        if (!res.stdout && !res.stderr) parts.push('(no output)');
        return {
          text: parts.join('\n'),
          is_error: res.exitCode !== 0,
          meta: { exitCode: res.exitCode, timedOut: res.timedOut },
        };
      }

      case 'browser_navigate': {
        const res = await browserApi.navigate(input.url, {
          screenshot: Boolean(input.screenshot),
        });
        emit({ type: 'browser_navigate', url: res.url, screenshot: res.screenshot || null });
        const errors = (res.console || []).filter((c) =>
          ['error', 'pageerror'].includes(c.type)
        );
        const lines = [
          `${res.engine} • ${res.url} • HTTP ${res.status}`,
          `title: ${res.title}`,
          res.note ? `note: ${res.note}` : null,
          errors.length
            ? `console errors:\n${errors.map((e) => `  [${e.type}] ${e.text}`).join('\n')}`
            : 'console errors: none',
          '--- page text ---',
          res.text || '(empty)',
        ].filter(Boolean);
        return { text: lines.join('\n'), meta: { url: res.url, status: res.status } };
      }

      case 'browser_inspect': {
        const res = await browserApi.inspect(input.selector, {
          limit: Math.min(Number(input.limit) || 10, 40),
        });
        if (!res.count) {
          return { text: `No elements matched ${input.selector} on ${res.url}` };
        }
        const lines = res.nodes.map(
          (n, i) =>
            `#${i + 1} <${n.tag}${n.id ? ` id="${n.id}"` : ''}${
              n.className ? ` class="${n.className}"` : ''
            }>\n  text: ${n.text}\n  html: ${n.html}`
        );
        return {
          text: `Matched ${res.count} element(s) for ${res.selector} on ${res.url}\n${lines.join('\n')}`,
          meta: { count: res.count },
        };
      }

      case 'search_files': {
        const limit = Math.min(Number(input.limit) || 40, 200);
        const all = await filesApi.walkFiles({});
        const nameNeedle = (input.name_contains || '').toLowerCase();
        let candidates = nameNeedle
          ? all.filter((p) => p.toLowerCase().includes(nameNeedle))
          : all;
        if (!input.content_regex) {
          const shown = candidates.slice(0, limit);
          return {
            text: `${candidates.length} file(s) matched${
              candidates.length > shown.length ? ` (showing ${shown.length})` : ''
            }:\n${shown.join('\n') || '(none)'}`,
            meta: { count: candidates.length },
          };
        }
        let re;
        try {
          re = new RegExp(input.content_regex, 'i');
        } catch (err) {
          return { text: `Invalid content_regex: ${err.message}`, is_error: true };
        }
        const hits = [];
        for (const rel of candidates) {
          if (hits.length >= limit) break;
          if (filesApi.isProbablyBinary(rel)) continue;
          try {
            const f = await filesApi.readFile(rel);
            const lines = f.content.split('\n');
            for (let i = 0; i < lines.length; i += 1) {
              if (re.test(lines[i])) {
                hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 240)}`);
                break;
              }
            }
          } catch {
            /* unreadable, skip */
          }
        }
        return {
          text: `${hits.length} match(es) for /${input.content_regex}/\n${hits.join('\n') || '(none)'}`,
          meta: { count: hits.length },
        };
      }

      default:
        return { text: `Unknown tool: ${name}`, is_error: true };
    }
  } catch (err) {
    return { text: `Tool ${name} failed: ${err.message}`, is_error: true };
  }
}

/** Short human label used on the tool cards in the chat stream. */
export function describeToolCall(name, input = {}) {
  switch (name) {
    case 'read_file':
      return { title: 'Read File', subtitle: input.path || '' };
    case 'list_directory':
      return { title: 'List Directory', subtitle: input.path || '.' };
    case 'write_file':
      return { title: 'Write File', subtitle: input.path || '' };
    case 'edit_file':
      return { title: 'Edit File', subtitle: input.path || '' };
    case 'execute_command':
      return { title: 'Run Terminal Command', subtitle: input.command || '' };
    case 'browser_navigate':
      return { title: 'Browse URL', subtitle: input.url || '' };
    case 'browser_inspect':
      return { title: 'Inspect DOM', subtitle: input.selector || '' };
    case 'search_files':
      return {
        title: 'Search Files',
        subtitle: input.content_regex
          ? `/${input.content_regex}/`
          : input.name_contains || 'all files',
      };
    default:
      return { title: name, subtitle: '' };
  }
}

export { snapshotFile, toRel, getRoot, path };
