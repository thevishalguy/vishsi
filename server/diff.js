import { createTwoFilesPatch, diffLines } from 'diff';

/** Unified diff text, used in tool results sent back to the model. */
export function buildUnifiedDiff(before, after, filename = 'file') {
  if (before === after) return `(no change to ${filename})`;
  const patch = createTwoFilesPatch(
    `a/${filename}`,
    `b/${filename}`,
    before ?? '',
    after ?? '',
    '',
    '',
    { context: 3 }
  );
  return patch.length > 20_000 ? `${patch.slice(0, 20_000)}\n… diff truncated` : patch;
}

/**
 * Structured line-level diff for the UI's red/green gutter.
 * Returns [{ type: 'add'|'del'|'ctx', text, oldNo, newNo }]
 */
export function buildLineDiff(before, after, { contextLines = 3 } = {}) {
  const parts = diffLines(before ?? '', after ?? '');
  const rows = [];
  let oldNo = 1;
  let newNo = 1;
  for (const part of parts) {
    const lines = part.value.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const text of lines) {
      if (part.added) {
        rows.push({ type: 'add', text, oldNo: null, newNo: newNo++ });
      } else if (part.removed) {
        rows.push({ type: 'del', text, oldNo: oldNo++, newNo: null });
      } else {
        rows.push({ type: 'ctx', text, oldNo: oldNo++, newNo: newNo++ });
      }
    }
  }
  // Collapse long runs of unchanged context.
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => {
    if (r.type === 'add' || r.type === 'del') {
      for (let j = Math.max(0, i - contextLines); j <= Math.min(rows.length - 1, i + contextLines); j += 1) {
        keep[j] = true;
      }
    }
  });
  const out = [];
  let skipping = false;
  rows.forEach((r, i) => {
    if (keep[i]) {
      skipping = false;
      out.push(r);
    } else if (!skipping) {
      skipping = true;
      out.push({ type: 'gap', text: '⋯', oldNo: null, newNo: null });
    }
  });
  const stats = {
    added: rows.filter((r) => r.type === 'add').length,
    removed: rows.filter((r) => r.type === 'del').length,
  };
  return { rows: out, stats };
}
