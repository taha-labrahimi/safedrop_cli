// index.js — library entry point.
//
// Exposes the auditable building blocks so the CLI's behaviour can be reused or
// tested programmatically. No secrets are ever logged by these functions.

export {
  generateKeyHex,
  encryptBuffer,
  decryptBuffer,
  encryptString,
  decryptString,
} from './crypto.js';

export {
  encodeCombinedCode,
  encodeShareLink,
  extractCombinedCode,
  decodeCombinedCode,
} from './code.js';

export { generateSAS } from './sas.js';
export { sanitizeFilename, resolveOutputPath, dedupePath } from './paths.js';
export { SafeDropApi, SafeDropApiError, DEFAULT_API_BASE } from './api.js';
export { runSend } from './send.js';
export { runReceive } from './receive.js';
