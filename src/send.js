// send.js — the sender workflow.
//
// 1. read file               5. initiate upload
// 2. generate AES-256 key    6. PUT encrypted bytes to presigned URL
// 3. encrypt file locally    7. finalize with encrypted filename + senderToken
// 4. encrypt filename        8. print share code/link, wait for handshake,
//                               authorize, report status.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { encryptBuffer, encryptString } from './crypto.js';
import { encodeCombinedCode, encodeShareLink } from './code.js';
import { generateSAS } from './sas.js';
import { SafeDropApi, SafeDropApiError } from './api.js';
import { log, style, output, ask, spinner, formatBytes, formatDuration } from './ui.js';

const MAX_FILE_SIZE_MB = 1024; // mirrors backend store.ts MAX_FILE_SIZE_MB

/**
 * Derive a browser origin from the API base so links open the web app.
 * "https://safedrop.ma/api" -> "https://safedrop.ma".
 * Local dev backends have no web origin, so we omit the link there.
 */
function webOriginFromApi(apiBase) {
  try {
    const u = new URL(apiBase);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export async function runSend(filePath, opts = {}) {
  const api = new SafeDropApi(opts.api);

  // --- 1. Read and validate the file -------------------------------------
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    log.error(`File not found: ${filePath}`);
    process.exitCode = 1;
    return;
  }
  if (!stat.isFile()) {
    log.error(`Not a regular file: ${filePath}`);
    process.exitCode = 1;
    return;
  }
  const sizeMb = stat.size / 1024 / 1024;
  if (sizeMb > MAX_FILE_SIZE_MB) {
    log.error(`File is ${formatBytes(stat.size)} — exceeds the ${MAX_FILE_SIZE_MB} MB limit.`);
    process.exitCode = 1;
    return;
  }

  const filename = path.basename(filePath);
  log.info(`Sending ${style.bold(filename)} ${style.dim(`(${formatBytes(stat.size)})`)}`);

  const fullSecurity = !!opts.fullSecurity;

  // --- 2-4. Encrypt locally ----------------------------------------------
  const spin = spinner('Encrypting locally…');
  let payload, keyHex, encryptedFilename;
  try {
    const plain = await fs.readFile(filePath);
    ({ payload, keyHex } = encryptBuffer(plain));
    encryptedFilename = encryptString(filename, keyHex);
  } catch (err) {
    spin.stop();
    log.error(`Encryption failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  // --- 5-7. Initiate, upload, finalize -----------------------------------
  let uploadCode, presignedUrl, senderToken, uploadTTLSeconds;
  try {
    spin.setLabel('Requesting upload slot…');
    const customExpirationSeconds = opts.ttlMinutes ? Math.floor(opts.ttlMinutes * 60) : undefined;
    const init = await api.initiateUpload({ customExpirationSeconds });
    ({ uploadCode, url: presignedUrl, senderToken, uploadTTLSeconds } = init);

    spin.setLabel('Uploading encrypted bytes…');
    await api.uploadBytes(presignedUrl, payload);

    spin.setLabel('Finalizing…');
    await api.finalizeUpload(uploadCode, encryptedFilename, senderToken);
  } catch (err) {
    spin.stop();
    log.error(err instanceof SafeDropApiError ? err.message : `Upload failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  spin.stop(`${style.green('✓')} Encrypted and uploaded. The server holds only ciphertext.`);

  // --- 8. Share details ---------------------------------------------------
  const combinedCode = encodeCombinedCode({ uploadCode, key: keyHex, fullSecurity });
  const origin = webOriginFromApi(opts.api);
  const ttl = uploadTTLSeconds || 15 * 60;

  log.plain();
  log.plain(style.bold('  Share this code with the receiver:'));
  log.plain();
  output(combinedCode); // the only secret printed — it is the whole point
  log.plain();
  if (origin) {
    log.plain(style.dim('  Or this link (key stays in the URL fragment, never sent to the server):'));
    log.plain(`  ${style.cyan(encodeShareLink(combinedCode, origin))}`);
    log.plain();
  }
  if (fullSecurity) {
    const sas = generateSAS(keyHex);
    log.plain(`  ${style.yellow('Safety code')} (read aloud to verify, must match the receiver's): ${style.bold(sas)}`);
    log.plain();
  }
  log.info(`This transfer expires in ${style.bold(formatDuration(ttl))}.`);

  // --- Wait for the receiver handshake, then authorize -------------------
  const expiresAt = Date.now() + ttl * 1000;
  let cancelled = false;

  const cleanup = async (reason) => {
    if (cancelled) return;
    cancelled = true;
    try {
      await api.cancelUpload(uploadCode, senderToken);
      log.ok(`Transfer cancelled — the encrypted server copy was deleted (${reason}).`);
    } catch {
      log.warn('Transfer cancelled locally (server copy may already be gone).');
    }
  };

  // Ctrl-C cancels the transfer cleanly from the sender side.
  const onSigint = () => { cleanup('you pressed Ctrl-C').then(() => process.exit(130)); };
  process.on('SIGINT', onSigint);

  try {
    log.plain();
    log.info('Waiting for the receiver. They will give you a handshake code.');
    if (Date.now() > expiresAt) { log.warn('Transfer already expired.'); return; }

    const remainingMin = Math.max(1, Math.round((expiresAt - Date.now()) / 60000));
    const handshakeCode = await ask(
      `${style.bold('Paste the receiver handshake code')} ${style.dim(`(≤ ${remainingMin}m left, or press Enter to cancel)`)}: `,
    );

    if (!handshakeCode) {
      await cleanup('no code entered');
      return;
    }
    if (Date.now() > expiresAt) {
      log.warn('Transfer expired before authorization. The server copy is gone.');
      return;
    }

    const spin2 = spinner('Authorizing the receiver…');
    try {
      await api.authorizeHandshake(uploadCode, handshakeCode);
      spin2.stop(`${style.green('✓')} Receiver authorized.`);
    } catch (err) {
      spin2.stop();
      if (err instanceof SafeDropApiError && err.statusCode === 403) {
        log.error('That handshake code did not match. Ask the receiver to re-check it and try again.');
      } else if (err instanceof SafeDropApiError && err.statusCode === 429) {
        log.error('Too many failed attempts — the session was terminated for safety.');
      } else {
        log.error(err.message);
      }
      process.exitCode = 1;
      return;
    }

    log.plain();
    log.ok('The receiver can now download and decrypt the file.');
    log.info('The server deletes its encrypted copy the moment the download completes.');
  } finally {
    process.off('SIGINT', onSigint);
  }
}
