// code.js
//
// Combined-code and share-link handling. Byte-for-byte compatible with the
// browser client:
//
//   combinedCode = base64( JSON.stringify({ uploadCode, key, fullSecurity }) )
//   shareLink    = `${origin}/#code=${combinedCode}`
//
// The browser puts the code in the URL *fragment* (#...), never the query
// string, so the secret key is never sent to any server during navigation.

const UPLOAD_CODE_LENGTH = 16;

/**
 * Build the combined share code from its parts.
 * @returns {string} base64 JSON code
 */
export function encodeCombinedCode({ uploadCode, key, fullSecurity = false }) {
  if (!uploadCode || !key) {
    throw new Error('uploadCode and key are required to build a share code.');
  }
  const json = JSON.stringify({ uploadCode, key, fullSecurity: !!fullSecurity });
  return Buffer.from(json, 'utf8').toString('base64');
}

/**
 * Build the browser share link, with the code in the URL fragment.
 * @param {string} combinedCode
 * @param {string} origin e.g. "https://safedrop.ma"
 */
export function encodeShareLink(combinedCode, origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}/#code=${combinedCode}`;
}

/**
 * Extract the raw combined code from arbitrary user input: a bare combined
 * code, a full SafeDrop link (fragment or query form), or a code with
 * surrounding whitespace.
 *
 * Mirrors the browser's hash/query handling:
 *   new URLSearchParams(hash).get('code') || query.get('code')
 *
 * @param {string} input
 * @returns {string} the bare combined (base64) code
 */
export function extractCombinedCode(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('No code or link provided.');
  }
  const raw = input.trim();

  // Looks like a URL? Pull `code` from the fragment first, then the query.
  if (/^https?:\/\//i.test(raw) || raw.includes('#code=') || raw.includes('?code=')) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      // Not a parseable URL but may contain a #code= / ?code= chunk.
      const m = raw.match(/[#?&]code=([^&\s]+)/);
      if (m) return decodeURIComponent(m[1]);
      throw new Error('Could not parse the SafeDrop link.');
    }
    const fragment = url.hash.replace(/^#/, '');
    const fromFragment = new URLSearchParams(fragment).get('code');
    const fromQuery = url.searchParams.get('code');
    const code = fromFragment || fromQuery;
    if (!code) throw new Error('Link does not contain a SafeDrop code.');
    return code;
  }

  // Otherwise treat the whole thing as a bare combined code.
  return raw;
}

/**
 * Decode a combined code (or link) into its parts.
 * @param {string} input bare code or full link
 * @returns {{ uploadCode: string, key: string, fullSecurity: boolean }}
 */
export function decodeCombinedCode(input) {
  const combined = extractCombinedCode(input);

  let data;
  try {
    const json = Buffer.from(combined, 'base64').toString('utf8');
    data = JSON.parse(json);
  } catch {
    throw new Error('Invalid SafeDrop code: could not decode.');
  }

  const { uploadCode, key } = data;
  // Browser defaults fullSecurity to true when the field is absent.
  const fullSecurity = data.fullSecurity ?? true;

  if (typeof uploadCode !== 'string' || uploadCode.length !== UPLOAD_CODE_LENGTH) {
    throw new Error('Invalid SafeDrop code: bad upload code.');
  }
  if (typeof key !== 'string' || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('Invalid SafeDrop code: bad encryption key.');
  }

  return { uploadCode, key, fullSecurity: !!fullSecurity };
}
