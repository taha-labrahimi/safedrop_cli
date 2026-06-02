// crypto.js
//
// SafeDrop encryption primitives — byte-for-byte compatible with the browser
// client (frontend/utils/crypto.ts), which uses the Web Crypto API.
//
// Wire format (identical in both directions):
//
//   payload = IV (12 bytes) || ciphertext || GCM auth tag (16 bytes)
//
// Web Crypto's `encrypt()` appends the 16-byte auth tag to the ciphertext, so
// the browser produces exactly this layout. Node's crypto exposes the tag
// separately via getAuthTag(), so we concatenate it to match.
//
// Keys are 256-bit, represented as a 64-character lowercase hex string.
//
// IMPORTANT: strings (e.g. filenames) are encoded as UTF-16LE, NOT UTF-8.
// The browser's str2ab() writes charCodeAt() values into a Uint16Array, which
// is little-endian on all common platforms. We must match that exactly or
// filenames will not round-trip across browser <-> CLI.

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

/** Generate a fresh AES-256 key, returned as a 64-char hex string. */
export function generateKeyHex() {
  return randomBytes(32).toString('hex');
}

function keyFromHex(keyHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('Invalid encryption key (expected 64 hex characters).');
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a binary buffer.
 * Returns { payload: Buffer, keyHex: string }. If keyHex is omitted, a new key
 * is generated (matching the browser's encryptBuffer behaviour).
 */
export function encryptBuffer(plain, keyHex = generateKeyHex()) {
  const key = keyFromHex(keyHex);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { payload: Buffer.concat([iv, enc, tag]), keyHex };
}

/** Decrypt a binary payload (IV || ciphertext || tag) back to a Buffer. */
export function decryptBuffer(payload, keyHex) {
  const key = keyFromHex(keyHex);
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Ciphertext is too short to be valid.');
  }
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(data.length - TAG_LENGTH);
  const ct = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Encrypt a UTF-16LE string, returning base64 (matches browser encryptString).
 * Used for filenames.
 */
export function encryptString(plainText, keyHex) {
  const ptBuf = Buffer.from(String(plainText), 'utf16le');
  const { payload } = encryptBuffer(ptBuf, keyHex);
  return payload.toString('base64');
}

/** Decrypt a base64 string payload back to a UTF-16LE string. */
export function decryptString(base64Payload, keyHex) {
  const payload = Buffer.from(base64Payload, 'base64');
  return decryptBuffer(payload, keyHex).toString('utf16le');
}
