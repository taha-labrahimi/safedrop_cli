// ui.js
//
// Minimal terminal helpers: colored status lines, an interactive prompt, and a
// lightweight spinner. No dependencies. Colors auto-disable when stdout is not
// a TTY or NO_COLOR is set, so piped/CI output stays clean.

import readline from 'node:readline';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const style = {
  bold: (s) => c('1', s),
  dim: (s) => c('2', s),
  green: (s) => c('32', s),
  red: (s) => c('31', s),
  yellow: (s) => c('33', s),
  cyan: (s) => c('36', s),
  gray: (s) => c('90', s),
};

export const log = {
  info: (msg) => console.error(`${style.cyan('•')} ${msg}`),
  ok: (msg) => console.error(`${style.green('✓')} ${msg}`),
  warn: (msg) => console.error(`${style.yellow('!')} ${msg}`),
  error: (msg) => console.error(`${style.red('✗')} ${msg}`),
  plain: (msg = '') => console.error(msg),
};

/** Print a value to stdout (the "result" channel; logs go to stderr). */
export function output(value) {
  process.stdout.write(`${value}\n`);
}

/** Ask a free-text question. Returns the trimmed answer. */
export function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Ask a yes/no question. Returns boolean. */
export async function confirm(question, defaultYes = false) {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = (await ask(`${question} ${hint} `)).toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

/** Simple braille spinner. Returns a handle with .stop(). */
export function spinner(label) {
  if (!process.stderr.isTTY) {
    console.error(`${style.dim('…')} ${label}`);
    return { stop: () => {}, setLabel: () => {} };
  }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let current = label;
  const timer = setInterval(() => {
    process.stderr.write(`\r${style.cyan(frames[i++ % frames.length])} ${current}   `);
  }, 80);
  return {
    setLabel: (l) => { current = l; },
    stop: (finalLine) => {
      clearInterval(timer);
      process.stderr.write('\r\x1b[K');
      if (finalLine) console.error(finalLine);
    },
  };
}

/** Format a byte count as a human-readable size. */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return `${n.toFixed(n < 10 && u > 0 ? 2 : 0)} ${units[u]}`;
}

/** Format seconds as "Xm Ys". */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
