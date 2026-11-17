import { spawn } from 'node:child_process';
import { IS_WINDOWS } from './config.js';
import { getRoot } from './workspace.js';

const MAX_OUTPUT = 60_000; // chars returned to the model

/**
 * Run a shell command in the workspace root and capture stdout/stderr.
 * Streams chunks through `onChunk` so the UI can show live output.
 * This is a captured (non-interactive) run: it has a real exit code, unlike
 * typing into the user's PTY. For interactive programs, use the terminal tab.
 */
export function runCommand(
  command,
  { cwd = getRoot(), timeoutMs = 120_000, onChunk } = {}
) {
  return new Promise((resolve) => {
    const file = IS_WINDOWS ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
    const args = IS_WINDOWS
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
      : ['-lc', command];

    let child;
    try {
      child = spawn(file, args, {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        windowsHide: true,
      });
    } catch (err) {
      resolve({
        command,
        cwd,
        exitCode: -1,
        stdout: '',
        stderr: String(err.message || err),
        timedOut: false,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const push = (stream, text) => {
      if (stream === 'stdout') {
        stdout = (stdout + text).slice(-MAX_OUTPUT);
      } else {
        stderr = (stderr + text).slice(-MAX_OUTPUT);
      }
      if (onChunk) onChunk(stream, text);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => push('stdout', d));
    child.stderr.on('data', (d) => push('stderr', d));

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ command, cwd, exitCode, stdout, stderr, timedOut });
    };

    child.on('error', (err) => {
      push('stderr', `\n[spawn error] ${err.message}\n`);
      finish(-1);
    });
    child.on('close', (code) => finish(code === null ? -1 : code));
  });
}
