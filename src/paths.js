// paths.js
//
// Safe handling of the decrypted output path. The filename comes from an
// encrypted blob the *sender* controls, so after decryption it is untrusted
// input. We must:
//   - strip any directory components from the sender-supplied name
//   - refuse names that try to escape the chosen output directory
//   - never silently overwrite an existing local file

import path from 'node:path';

/**
 * Reduce a sender-supplied filename to a safe basename.
 * Removes directory separators, drive letters, leading dots-only names, and
 * control characters. Falls back to a default when nothing usable remains.
 */
export function sanitizeFilename(name, fallback = 'safedrop-file') {
  if (typeof name !== 'string') return fallback;

  // Take the last path segment under both POSIX and Windows separators.
  let base = name.split(/[\\/]/).pop() || '';

  // Drop NUL and control characters, and Windows-illegal characters.
  // eslint-disable-next-line no-control-regex
  base = base.replace(/[\x00-\x1f<>:"|?*]/g, '').trim();

  // Reject pure-dot names (".", "..") and empties.
  if (!base || /^\.+$/.test(base)) return fallback;

  // Avoid Windows reserved device names (CON, PRN, NUL, COM1, ...).
  const stem = base.replace(/\.[^.]*$/, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
    return `_${base}`;
  }
  return base;
}

/**
 * Resolve the final absolute output path from the user's --output option and
 * the (sanitized) sender filename, then verify it does not escape its parent
 * directory.
 *
 * Rules:
 *   - no --output  -> sanitized filename in the current working directory
 *   - --output dir/  (or existing directory) -> sanitized filename inside it
 *   - --output file  -> that exact path (its basename is still sanitized)
 *
 * @returns {string} absolute, validated output path
 */
export function resolveOutputPath(senderFilename, outputOption, { cwd = process.cwd(), isDirectory } = {}) {
  const safeName = sanitizeFilename(senderFilename);

  let target;
  if (!outputOption) {
    target = path.resolve(cwd, safeName);
  } else {
    const resolvedOpt = path.resolve(cwd, outputOption);
    // A trailing separator is an explicit "this is a directory" intent and wins
    // even if the directory does not exist yet. Otherwise probe the filesystem.
    const endsWithSep = /[\\/]$/.test(outputOption);
    const looksLikeDir =
      endsWithSep || (typeof isDirectory === 'function' && isDirectory(resolvedOpt));
    if (looksLikeDir) {
      target = path.join(resolvedOpt, safeName);
    } else {
      // Treat as a file path, but sanitize the basename the user gave.
      target = path.join(path.dirname(resolvedOpt), sanitizeFilename(path.basename(resolvedOpt)));
    }
  }

  // Containment check: the final basename must stay within its parent dir.
  const parent = path.dirname(target);
  const rel = path.relative(parent, target);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) {
    throw new Error(`Refusing to write outside the target directory: ${senderFilename}`);
  }

  return target;
}

/**
 * Pick a non-clobbering path by appending " (1)", " (2)", ... before the
 * extension. Used when the user declines to overwrite.
 */
export function dedupePath(target, exists) {
  if (!exists(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const stem = path.basename(target, ext);
  for (let i = 1; i < 10000; i++) {
    const candidate = path.join(dir, `${stem} (${i})${ext}`);
    if (!exists(candidate)) return candidate;
  }
  throw new Error('Could not find an available filename.');
}
