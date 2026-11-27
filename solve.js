// A fast drop-in for makefun-diff 1.0.0: run(input) returns make.fun's own patch of
// { old, new } as one JSON string, byte for byte what the reference returns.
//
// The patch rule, in short: cut each text into lines after every "\n" (a last line
// with no "\n" is a line too); keep the common prefix of lines, then the common
// suffix of what is left; between them run Myers's greedy search (deletion wins a
// tie, no diagonal is pruned, every run of equal lines is followed to its end) and
// take the first path that reaches both ends. Change runs list deletions before
// insertions, show up to 3 kept lines around each run, and runs at most 6 kept
// lines apart share a hunk.
//
// Speed comes from three places, none of which changes the answer:
//   1. Lines are numbered once (one shared Map) and the search compares small
//      integers instead of strings.
//   2. The search keeps, per depth d, one flat Int32Array of the furthest old
//      position reached on each diagonal, and rebuilds the script afterwards by
//      walking those arrays back down with the same tie-break the forward pass
//      used. The reference instead builds a linked list of path objects, one
//      allocation per step, and walks it at the end.
//   3. The snake walk stays on one diagonal, so its two bounds collapse into
//      one; and two of the candidate checks are the diagonal's own geometry
//      (see myersRuns), so the inner loop skips them where they cannot fail.

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** Cut a text into lines: after every "\n"; a last line without one is a line too. */
function linesOf(text) {
  const out = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) break;
    out.push(text.slice(start, nl + 1));
    start = nl + 1;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/**
 * The edit script of A into B as runs [{ kind, count }], in order, following the
 * reference's greedy search exactly: same depth order, same diagonal order, same
 * deletion-wins tie-break, same end conditions. A and B hold integer line ids.
 *
 * The search's history lives in one flat Int32Array: depth d's segment starts
 * at d*d + 4*d and holds logical diagonal indices -2..2d+2 (index i at start +
 * 2 + i), the outer slots being -1 pads, so a predecessor read never leaves the
 * buffer and -1 always means "no path on that diagonal".
 *
 * Two candidate checks are dropped where the diagonal's position settles them.
 * A deletion predecessor on diagonal k - 1 has consumed the whole old text only
 * when k is right of the main diagonal (k > n - m): its new count would
 * otherwise be past the new text's end. So left of (and on) the main diagonal
 * an existing deletion predecessor is always usable. Mirror-wise, an insertion
 * predecessor on diagonal k + 1 has consumed the whole new text only when k is
 * left of the main diagonal, so right of it an existing insertion predecessor
 * is always usable. Every other check stays. Depths past min(n, m) — never
 * reached on inputs like the contest's — run with every check in place anyway.
 */
function myersRuns(A, B) {
  const n = A.length;
  const m = B.length;
  if (n === 0 && m === 0) return [];

  // Depth 0: the opening snake from (0, 0); on diagonal 0 the two counts agree,
  // so one bound covers both.
  let x = 0;
  const firstLim = n < m ? n : m;
  while (x < firstLim && A[x] === B[x]) x++;
  if (x >= n && x >= m) return [];

  let cap = 1 << 24;
  let V = new Int32Array(cap);
  // Depth 0's segment (at 0): logical 0 holds the opening snake's reach; the
  // pads around it read -1.
  V[0] = -1;
  V[1] = -1;
  V[2] = x;
  V[3] = -1;
  V[4] = -1;

  const nmD = n - m;
  const inner = n < m ? n : m;
  const maxEdit = n + m;
  let depth = -1;
  for (let d = 1; d <= maxEdit && depth < 0; d++) {
    const start = d * d + 4 * d;
    if (start + 2 * d + 5 > cap) {
      let next = cap;
      while (start + 2 * d + 5 > next) next *= 2;
      const grown = new Int32Array(next);
      grown.set(V.subarray(0, start));
      V = grown;
      cap = next;
    }
    V[start] = -1;
    V[start + 1] = -1;
    V[start + 2 * d + 3] = -1;
    V[start + 2 * d + 4] = -1;
    const pBase = d * d + 2 * d - 1; // logical 0 of depth d - 1
    const cBase = start + 2;
    const kEnd1 = d < nmD ? d : nmD;
    let xd = V[pBase - 2];
    let idx = 0;
    let k = -d;
    if (d <= inner) {
      // Left of (and on) the main diagonal: the deletion bound cannot fail.
      for (; k <= kEnd1; idx += 2, k += 2) {
        const xi = V[pBase + idx];
        let xx = -1;
        if (xd >= 0) {
          xx = xi < 0 || xi - k - 1 >= m || xd + 1 >= xi ? xd + 1 : xi;
        } else if (xi >= 0 && xi - k - 1 < m) {
          xx = xi;
        }
        if (xx >= 0) {
          const lim = m + k;
          while (xx < lim && A[xx] === B[xx - k]) xx++;
        }
        V[cBase + idx] = xx;
        xd = xi;
        if (xx >= n && xx - k >= m) {
          depth = d;
          break;
        }
      }
      if (depth >= 0) break;
      // Right of the main diagonal: the insertion bound cannot fail, and no
      // path here reaches both ends (its new count stays short of m).
      for (; k <= d; idx += 2, k += 2) {
        const xi = V[pBase + idx];
        let xx = -1;
        if (xi >= 0) {
          xx = xd < 0 || xd >= n || xd + 1 < xi ? xi : xd + 1;
        } else if (xd >= 0 && xd < n) {
          xx = xd + 1;
        }
        if (xx >= 0) {
          while (xx < n && A[xx] === B[xx - k]) xx++;
        }
        V[cBase + idx] = xx;
        xd = xi;
      }
    } else {
      // Depths past min(n, m): every check in place.
      for (; k <= kEnd1; idx += 2, k += 2) {
        const xi = V[pBase + idx];
        const canDel = xd >= 0 && xd < n;
        const canIns = xi >= 0 && xi - k - 1 < m;
        if (!canDel && !canIns) {
          V[cBase + idx] = -1;
          xd = xi;
          continue;
        }
        let xx = canDel && (!canIns || xd + 1 >= xi) ? xd + 1 : xi;
        const lim = m + k;
        while (xx < lim && A[xx] === B[xx - k]) xx++;
        V[cBase + idx] = xx;
        xd = xi;
        if (xx >= n && xx - k >= m) {
          depth = d;
          break;
        }
      }
      if (depth >= 0) break;
      for (; k <= d; idx += 2, k += 2) {
        const xi = V[pBase + idx];
        const canDel = xd >= 0 && xd < n;
        const canIns = xi >= 0 && xi - k - 1 < m;
        if (!canDel && !canIns) {
          V[cBase + idx] = -1;
          xd = xi;
          continue;
        }
        let xx = canDel && (!canIns || xd + 1 >= xi) ? xd + 1 : xi;
        while (xx < n && A[xx] === B[xx - k]) xx++;
        V[cBase + idx] = xx;
        xd = xi;
        if (xx >= n && xx - k >= m) {
          depth = d;
          break;
        }
      }
    }
  }

  // Walk the stored depths back down. The choice at each step is recomputed
  // from the same two numbers the forward pass compared, so this rebuilds the
  // exact path the search took, snake by snake.
  let xx = n;
  let yy = m;
  const parts = [];
  for (let d = depth; d >= 1; d--) {
    const k = xx - yy;
    const pBase = d * d + 2 * d - 1; // logical 0 of depth d - 1
    const idx = k + d;
    const xd = V[pBase + idx - 2];
    const xi = V[pBase + idx];
    const canDel = xd >= 0 && xd < n;
    const canIns = xi >= 0 && xi - k - 1 < m;
    const del = canDel && (!canIns || xd + 1 >= xi);
    let xs;
    let ys;
    if (del) {
      xs = xd + 1;
      ys = xs - k;
    } else {
      xs = xi;
      ys = xs - k;
    }
    const snake = xx - xs;
    if (snake > 0) parts.push({ kind: KEEP, count: snake });
    parts.push({ kind: del ? DELETE : INSERT, count: 1 });
    if (del) {
      xx = xs - 1;
      yy = ys;
    } else {
      xx = xs;
      yy = ys - 1;
    }
  }
  if (xx > 0) parts.push({ kind: KEEP, count: xx });
  parts.reverse();
  const runs = [];
  for (const r of parts) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === r.kind) last.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  return runs;
}

/** makefun-diff 1.0.0's answer for one case's input: { old, new }, two strings. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const oldLines = linesOf(input.old);
  const newLines = linesOf(input.new);

  // Number every distinct line once, shared across both texts, so equal lines
  // (same code units, newline or its absence included) share one id.
  const table = new Map();
  const A = new Int32Array(oldLines.length);
  for (let i = 0; i < oldLines.length; i++) {
    const line = oldLines[i];
    let id = table.get(line);
    if (id === undefined) {
      id = table.size;
      table.set(line, id);
    }
    A[i] = id;
  }
  const B = new Int32Array(newLines.length);
  for (let i = 0; i < newLines.length; i++) {
    const line = newLines[i];
    let id = table.get(line);
    if (id === undefined) {
      id = table.size;
      table.set(line, id);
    }
    B[i] = id;
  }

  const n = A.length;
  const m = B.length;
  let prefix = 0;
  while (prefix < n && prefix < m && A[prefix] === B[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && A[n - 1 - suffix] === B[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...myersRuns(A.subarray(prefix, n - suffix), B.subarray(prefix, m - suffix)));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between kept
  // lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 6 kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 6) h.push(c);
    else hunks.push([c]);
  }

  // Covered lines go into `out` as (op, line) pairs for the final join to
  // concatenate — the same bytes as one string per line, without building
  // them. Only a text's last line can lack its "\n" (every other line was cut
  // after one), and such a line is followed by a "%" line of its own.
  const tailOld = n > 0 && !input.old.endsWith('\n') ? n - 1 : -1;
  const tailNew = m > 0 && !input.new.endsWith('\n') ? m - 1 : -1;
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) {
        out.push('=', oldLines[at]);
        if (at === tailOld) out.push('\n%\n');
      }
      for (let i = 0; i < c.dels; i++) {
        const idx = c.o + i;
        out.push('-', oldLines[idx]);
        if (idx === tailOld) out.push('\n%\n');
      }
      for (let i = 0; i < c.ins; i++) {
        const idx = c.p + i;
        out.push('+', newLines[idx]);
        if (idx === tailNew) out.push('\n%\n');
      }
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) {
      out.push('=', oldLines[at]);
      if (at === tailOld) out.push('\n%\n');
    }
  }
  return out.join('');
}
