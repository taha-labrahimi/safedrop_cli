// code.test.js — combined-code and link parsing compatibility.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeCombinedCode,
  encodeShareLink,
  extractCombinedCode,
  decodeCombinedCode,
} from '../src/code.js';

const UPLOAD = 'abcdef0123456789'; // 16 chars
const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

// Reference: how the browser builds the combined code (UploadFlow.tsx).
function browserCombinedCode({ uploadCode, key, fullSecurity }) {
  return Buffer.from(JSON.stringify({ uploadCode, key, fullSecurity }), 'utf8').toString('base64');
}

test('encodeCombinedCode matches the browser format', () => {
  const ours = encodeCombinedCode({ uploadCode: UPLOAD, key: KEY, fullSecurity: false });
  const theirs = browserCombinedCode({ uploadCode: UPLOAD, key: KEY, fullSecurity: false });
  assert.equal(ours, theirs);
});

test('round-trips its own combined code', () => {
  const code = encodeCombinedCode({ uploadCode: UPLOAD, key: KEY, fullSecurity: true });
  const decoded = decodeCombinedCode(code);
  assert.deepEqual(decoded, { uploadCode: UPLOAD, key: KEY, fullSecurity: true });
});

test('decodes a code produced by the browser', () => {
  const code = browserCombinedCode({ uploadCode: UPLOAD, key: KEY, fullSecurity: false });
  assert.deepEqual(decodeCombinedCode(code), { uploadCode: UPLOAD, key: KEY, fullSecurity: false });
});

test('encodeShareLink puts the code in the URL fragment', () => {
  const code = encodeCombinedCode({ uploadCode: UPLOAD, key: KEY });
  const link = encodeShareLink(code, 'https://safedrop.ma');
  assert.equal(link, `https://safedrop.ma/#code=${code}`);
  // The code must be in the fragment, never the query string.
  assert.ok(link.includes('#code='));
  assert.ok(!link.includes('?code='));
});

test('extractCombinedCode handles a fragment link', () => {
  const code = encodeCombinedCode({ uploadCode: UPLOAD, key: KEY });
  assert.equal(extractCombinedCode(`https://safedrop.ma/#code=${code}`), code);
});

test('extractCombinedCode handles a query-string link', () => {
  const code = encodeCombinedCode({ uploadCode: UPLOAD, key: KEY });
  assert.equal(extractCombinedCode(`https://safedrop.ma/?code=${code}`), code);
});

test('extractCombinedCode handles a bare code with whitespace', () => {
  const code = encodeCombinedCode({ uploadCode: UPLOAD, key: KEY });
  assert.equal(extractCombinedCode(`  ${code}\n`), code);
});

test('decodeCombinedCode accepts a full link directly', () => {
  const code = encodeCombinedCode({ uploadCode: UPLOAD, key: KEY, fullSecurity: true });
  const decoded = decodeCombinedCode(`https://safedrop.ma/#code=${code}`);
  assert.equal(decoded.uploadCode, UPLOAD);
  assert.equal(decoded.key, KEY);
});

test('fullSecurity defaults to true when absent (matches browser)', () => {
  const code = Buffer.from(JSON.stringify({ uploadCode: UPLOAD, key: KEY }), 'utf8').toString('base64');
  assert.equal(decodeCombinedCode(code).fullSecurity, true);
});

test('rejects an invalid base64 code', () => {
  assert.throws(() => decodeCombinedCode('!!!not base64!!!'), /Invalid SafeDrop code/);
});

test('rejects a code with a bad upload code length', () => {
  const code = Buffer.from(JSON.stringify({ uploadCode: 'short', key: KEY }), 'utf8').toString('base64');
  assert.throws(() => decodeCombinedCode(code), /bad upload code/);
});

test('rejects a code with a malformed key', () => {
  const code = Buffer.from(JSON.stringify({ uploadCode: UPLOAD, key: 'xyz' }), 'utf8').toString('base64');
  assert.throws(() => decodeCombinedCode(code), /bad encryption key/);
});

test('rejects empty input', () => {
  assert.throws(() => extractCombinedCode(''), /No code or link/);
});
