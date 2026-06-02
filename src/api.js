// api.js
//
// Thin client for the public SafeDrop HTTP API. Only the endpoints the CLI
// needs are implemented here. See API.md for the full contract.
//
// `baseUrl` must include any path prefix the deployment uses (the production
// web app serves the API under ".../api"). The default points at the hosted
// SafeDrop backend; override it with --api or the SAFEDROP_API env var.

export const DEFAULT_API_BASE = 'https://safedrop.ma/api';

export class SafeDropApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'SafeDropApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** Turn raw fetch/network failures into a human-readable message. */
function describeNetworkError(err, url) {
  const code = err?.cause?.code || err?.code;
  if (code === 'ECONNREFUSED') {
    return `Could not connect to the SafeDrop server at ${url}. Is the URL correct and the server reachable?`;
  }
  if (code === 'ENOTFOUND') {
    return `Could not resolve the SafeDrop server host for ${url}.`;
  }
  if (code === 'ETIMEDOUT' || err?.name === 'TimeoutError') {
    return `The connection to ${url} timed out.`;
  }
  if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    return `TLS certificate problem connecting to ${url}: ${code}.`;
  }
  return `Network error contacting ${url}: ${err?.message || err}`;
}

export class SafeDropApi {
  constructor(baseUrl = DEFAULT_API_BASE) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
  }

  async #json(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    let res;
    try {
      res = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
    } catch (err) {
      throw new SafeDropApiError(0, describeNetworkError(err, url));
    }
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      const message = body?.error || body?.errors?.[0]?.msg || `Request failed (HTTP ${res.status}).`;
      throw new SafeDropApiError(res.status, message, body);
    }
    return body;
  }

  /** POST /initiate-upload */
  initiateUpload({ customExpirationSeconds } = {}) {
    const body = {};
    if (customExpirationSeconds && customExpirationSeconds > 0) {
      body.customExpirationSeconds = Math.floor(customExpirationSeconds);
    }
    return this.#json('/initiate-upload', { method: 'POST', body: JSON.stringify(body) });
  }

  /** PUT to the presigned storage URL with raw encrypted bytes. */
  async uploadBytes(presignedUrl, bytes) {
    let res;
    try {
      res = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      });
    } catch (err) {
      throw new SafeDropApiError(0, describeNetworkError(err, 'storage'));
    }
    if (!res.ok) {
      throw new SafeDropApiError(res.status, `Failed to upload encrypted bytes to storage (HTTP ${res.status}).`);
    }
  }

  /** POST /upload/:uploadCode/finalize */
  finalizeUpload(uploadCode, encryptedFilename, senderToken) {
    return this.#json(`/upload/${uploadCode}/finalize`, {
      method: 'POST',
      body: JSON.stringify({ encryptedFilename, senderToken }),
    });
  }

  /** DELETE /upload/:uploadCode  (sender cancellation) */
  cancelUpload(uploadCode, senderToken) {
    return this.#json(`/upload/${uploadCode}`, {
      method: 'DELETE',
      body: JSON.stringify({ senderToken }),
    });
  }

  /** POST /handshake/initiate */
  initiateHandshake(uploadCode) {
    return this.#json('/handshake/initiate', {
      method: 'POST',
      body: JSON.stringify({ uploadCode }),
    });
  }

  /** POST /handshake/authorize */
  authorizeHandshake(uploadCode, handshakeCode) {
    return this.#json('/handshake/authorize', {
      method: 'POST',
      body: JSON.stringify({ uploadCode, handshakeCode }),
    });
  }

  /**
   * GET /handshake/token/:uploadCode
   * Returns { downloadToken } once the sender authorizes; 404 until then.
   * Throws SafeDropApiError(404) while still pending — callers poll on this.
   */
  getDownloadToken(uploadCode, recipientToken) {
    return this.#json(`/handshake/token/${uploadCode}`, {
      headers: { Authorization: `Bearer ${recipientToken}` },
    });
  }

  /** DELETE /handshake/:uploadCode  (recipient cancellation) */
  cancelHandshake(uploadCode, token) {
    return this.#json(`/handshake/${uploadCode}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /**
   * GET /upload/:uploadCode  (download)
   * Returns { bytes: Buffer, encryptedFilename: string|null }.
   * The server deletes its copy as soon as the response finishes streaming.
   */
  async downloadFile(uploadCode, downloadToken) {
    const url = `${this.baseUrl}/upload/${uploadCode}`;
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${downloadToken}` } });
    } catch (err) {
      throw new SafeDropApiError(0, describeNetworkError(err, url));
    }
    if (!res.ok) {
      let message = `Download failed (HTTP ${res.status}).`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch { /* non-JSON error body */ }
      throw new SafeDropApiError(res.status, message);
    }
    const encryptedFilename = res.headers.get('x-encrypted-filename');
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, encryptedFilename };
  }
}
