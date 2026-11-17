import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_WORKSPACE } from './config.js';

let root = DEFAULT_WORKSPACE;

export function getRoot() {
  return root;
}

export function setRoot(dir) {
  const resolved = path.resolve(dir);
  const stat = fs.statSync(resolved); // throws if missing
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${resolved}`);
  root = resolved;
  return root;
}

/**
 * Resolve a workspace-relative path and refuse anything outside the root.
 * Accepts '', '.', 'a/b', 'a\\b' and absolute paths inside the root.
 */
export function safeResolve(relOrAbs = '') {
  const raw = String(relOrAbs || '').replace(/\\/g, '/');
  const target = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace root: ${relOrAbs}`);
  }
  return target;
}

export function toRel(absPath) {
  const rel = path.relative(root, absPath);
  return rel === '' ? '.' : rel.replace(/\\/g, '/');
}

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.gradle',
  'target',
]);
