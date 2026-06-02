// paths.test.js — safe output-path handling (path traversal, no clobber).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { sanitizeFilename, resolveOutputPath, dedupePath } from '../src/paths.js';

test('sanitizeFilename strips directory components', () => {
  assert.equal(sanitizeFilename('report.pdf'), 'report.pdf');
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('..\\..\\windows\\system32\\evil.dll'), 'evil.dll');
  assert.equal(sanitizeFilename('/absolute/path/file.txt'), 'file.txt');
});

test('sanitizeFilename neutralizes dot-only and empty names', () => {
  assert.equal(sanitizeFilename('..'), 'safedrop-file');
  assert.equal(sanitizeFilename('.'), 'safedrop-file');
  assert.equal(sanitizeFilename(''), 'safedrop-file');
  assert.equal(sanitizeFilename('   '), 'safedrop-file');
});

test('sanitizeFilename removes control and illegal characters', () => {
  assert.equal(sanitizeFilename('a\x00b<c>d.txt'), 'abcd.txt');
  assert.equal(sanitizeFilename('na:me?.txt'), 'name.txt');
});

test('sanitizeFilename guards Windows reserved device names', () => {
  assert.equal(sanitizeFilename('CON'), '_CON');
  assert.equal(sanitizeFilename('nul.txt'), '_nul.txt');
  assert.equal(sanitizeFilename('COM1.dat'), '_COM1.dat');
});

test('resolveOutputPath defaults to cwd with the sanitized name', () => {
  const cwd = path.resolve('/tmp/work');
  const out = resolveOutputPath('report.pdf', undefined, { cwd, isDirectory: () => false });
  assert.equal(out, path.join(cwd, 'report.pdf'));
});

test('resolveOutputPath refuses path traversal from the sender name', () => {
  const cwd = path.resolve('/tmp/work');
  // Even a malicious sender name resolves to a basename inside cwd.
  const out = resolveOutputPath('../../../../etc/passwd', undefined, { cwd, isDirectory: () => false });
  assert.equal(out, path.join(cwd, 'passwd'));
  assert.ok(out.startsWith(cwd));
});

test('resolveOutputPath places file inside an --output directory', () => {
  const cwd = path.resolve('/tmp/work');
  const out = resolveOutputPath('a.txt', '/tmp/dest', {
    cwd,
    isDirectory: (p) => p === path.resolve('/tmp/dest'),
  });
  assert.equal(out, path.join(path.resolve('/tmp/dest'), 'a.txt'));
});

test('resolveOutputPath honors a trailing-slash directory hint', () => {
  const cwd = path.resolve('/tmp/work');
  const out = resolveOutputPath('a.txt', 'subdir/', { cwd, isDirectory: () => false });
  assert.equal(out, path.join(cwd, 'subdir', 'a.txt'));
});

test('resolveOutputPath treats a file --output as the exact target', () => {
  const cwd = path.resolve('/tmp/work');
  const out = resolveOutputPath('ignored.txt', '/tmp/dest/named.bin', {
    cwd,
    isDirectory: () => false,
  });
  assert.equal(out, path.resolve('/tmp/dest/named.bin'));
});

test('resolveOutputPath sanitizes a malicious basename in --output', () => {
  const cwd = path.resolve('/tmp/work');
  // The user-provided basename still gets sanitized.
  const out = resolveOutputPath('x', '/tmp/dest/CON', { cwd, isDirectory: () => false });
  assert.equal(out, path.join(path.resolve('/tmp/dest'), '_CON'));
});

test('dedupePath appends a counter when the target exists', () => {
  const existing = new Set([path.resolve('/tmp/a.txt'), path.resolve('/tmp/a (1).txt')]);
  const out = dedupePath(path.resolve('/tmp/a.txt'), (p) => existing.has(p));
  assert.equal(out, path.resolve('/tmp/a (2).txt'));
});

test('dedupePath returns the original when nothing exists', () => {
  const out = dedupePath(path.resolve('/tmp/free.txt'), () => false);
  assert.equal(out, path.resolve('/tmp/free.txt'));
});
