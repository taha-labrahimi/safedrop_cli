// receive.js — the receiver workflow.
//
// 1. parse code/link              7. download encrypted bytes
// 2. extract uploadCode + key     8. decrypt filename
// 3. initiate handshake           9. decrypt file
// 4. print handshake code        10. save safely to disk
// 5. (optional) verify SAS       11. confirm; server copy is deleted
// 6. poll until sender authorizes

import { promises as fs, existsSync, statSync } from 'node:fs';

import { decryptBuffer, decryptString } from './crypto.js';
import { decodeCombinedCode } from './code.js';
import { generateSAS } from './sas.js';
import { SafeDropApi, SafeDropApiError } from './api.js';
import { resolveOutputPath, dedupePath } from './paths.js';
import { log, style, ask, confirm, spinner, formatBytes } from './ui.js';

const HANDSHAKE_TTL_SECONDS = 5 * 60; // mirrors backend HANDSHAKE_TTL
const POLL_INTERVAL_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runReceive(codeOrLink, opts = {}) {
  const api = new SafeDropApi(opts.api);

  // --- 1-2. Parse the code/link -----------------------------------------
  let uploadCode, key, fullSecurity;
  try {
    ({ uploadCode, key, fullSecurity } = decodeCombinedCode(codeOrLink));
  } catch (err) {
    log.error(err.message);
    process.exitCode = 1;
    return;
  }
  log.ok('Code parsed. The encryption key stays on this machine.');

  // --- (optional) SAS verification ---------------------------------------
  if (fullSecurity) {
    const sas = generateSAS(key);
    log.plain();
    log.plain(`  ${style.yellow('Safety code')}: ${style.bold(sas)}`);
    log.plain(style.dim('  This must match the code the sender reads to you. If it differs, STOP.'));
    log.plain();
    const matches = await confirm('Does the safety code match the sender\'s?', false);
    if (!matches) {
      log.error('Safety code mismatch — aborting to avoid a possible interception.');
      process.exitCode = 1;
      return;
    }
  }

  // --- 3-4. Initiate handshake -------------------------------------------
  let handshakeCode, recipientToken;
  try {
    const spin = spinner('Initiating handshake…');
    const hs = await api.initiateHandshake(uploadCode);
    ({ handshakeCode, recipientToken } = hs);
    spin.stop(`${style.green('✓')} Handshake ready.`);
  } catch (err) {
    if (err instanceof SafeDropApiError && err.statusCode === 404) {
      log.error('This transfer was not found. It may have expired, been downloaded, or been cancelled.');
    } else {
      log.error(err instanceof SafeDropApiError ? err.message : `Handshake failed: ${err.message}`);
    }
    process.exitCode = 1;
    return;
  }

  log.plain();
  log.plain(style.bold('  Give this handshake code to the sender:'));
  log.plain();
  log.plain(`  ${style.cyan(style.bold(handshakeCode))}`);
  log.plain();

  // Ctrl-C cancels the recipient session cleanly.
  let stopped = false;
  const cancelRemote = async () => {
    try { await api.cancelHandshake(uploadCode, recipientToken); } catch { /* best effort */ }
  };
  const onSigint = () => { stopped = true; cancelRemote().then(() => process.exit(130)); };
  process.on('SIGINT', onSigint);

  // --- 6. Poll until the sender authorizes -------------------------------
  let downloadToken;
  const spin = spinner('Waiting for the sender to authorize…');
  const deadline = Date.now() + HANDSHAKE_TTL_SECONDS * 1000;
  try {
    while (!stopped) {
      if (Date.now() > deadline) {
        spin.stop();
        log.error('The handshake expired before the sender authorized. Ask them to restart and try again.');
        process.exitCode = 1;
        return;
      }
      try {
        const { downloadToken: token } = await api.getDownloadToken(uploadCode, recipientToken);
        if (token) { downloadToken = token; break; }
      } catch (err) {
        if (err instanceof SafeDropApiError && err.statusCode === 404) {
          // Still pending — keep polling.
        } else if (err instanceof SafeDropApiError && err.statusCode === 403) {
          spin.stop();
          log.error('The session is no longer available (it may have been cancelled).');
          process.exitCode = 1;
          return;
        } else {
          throw err;
        }
      }
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      spin.setLabel(`Waiting for the sender to authorize… ${style.dim(`(${left}s left)`)}`);
      await sleep(POLL_INTERVAL_MS);
    }
  } catch (err) {
    spin.stop();
    log.error(err instanceof SafeDropApiError ? err.message : `Error while waiting: ${err.message}`);
    process.exitCode = 1;
    return;
  } finally {
    process.off('SIGINT', onSigint);
  }
  if (!downloadToken) return; // stopped via SIGINT
  spin.stop(`${style.green('✓')} Authorized by the sender.`);

  // --- 7. Download --------------------------------------------------------
  let bytes, encryptedFilename;
  try {
    const dl = spinner('Downloading encrypted file…');
    ({ bytes, encryptedFilename } = await api.downloadFile(uploadCode, downloadToken));
    dl.stop(`${style.green('✓')} Downloaded ${formatBytes(bytes.length)} of ciphertext.`);
  } catch (err) {
    log.error(err instanceof SafeDropApiError ? err.message : `Download failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  // --- 8-9. Decrypt filename and contents --------------------------------
  let senderFilename = 'safedrop-file';
  if (encryptedFilename) {
    try {
      senderFilename = decryptString(encryptedFilename, key);
    } catch {
      log.warn('Could not decrypt the original filename; using a default name.');
    }
  }

  let plain;
  try {
    plain = decryptBuffer(bytes, key);
  } catch {
    log.error('Decryption failed. The key may be wrong, or the data was corrupted in transit.');
    process.exitCode = 1;
    return;
  }

  // --- 10. Save safely ----------------------------------------------------
  let target;
  try {
    target = resolveOutputPath(senderFilename, opts.output, {
      isDirectory: (p) => existsSync(p) && statSync(p).isDirectory(),
    });
  } catch (err) {
    log.error(err.message);
    process.exitCode = 1;
    return;
  }

  if (existsSync(target)) {
    const overwrite = await confirm(`File ${style.bold(target)} already exists. Overwrite?`, false);
    if (!overwrite) {
      target = dedupePath(target, (p) => existsSync(p));
      log.info(`Saving as ${style.bold(target)} instead.`);
    }
  }

  try {
    await fs.writeFile(target, plain);
  } catch (err) {
    log.error(`Could not write file: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  // --- 11. Confirm --------------------------------------------------------
  log.plain();
  log.ok(`Saved ${style.bold(target)} ${style.dim(`(${formatBytes(plain.length)})`)}`);
  log.info('Decryption happened entirely on this machine.');
  log.warn('The server has now deleted its encrypted copy — this code cannot be used again.');
}
