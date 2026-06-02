# SafeDrop public API contract

This document describes **only the public HTTP endpoints the CLI consumes**. It
is the contract between any SafeDrop client (browser or CLI) and the SafeDrop
backend. It deliberately documents nothing about the server's internals
(storage, Redis keys, token signing, rate-limit internals).

All request/response bodies are JSON unless noted. The `--api` base URL is
prefixed to every path below. For the hosted app that base is
`https://safedrop.ma/api`; for local development it is `http://localhost:4000`.

Throughout, **`uploadCode`** is a 16-character identifier and **`handshakeCode`**
is a 16-character identifier.

---

## Sender endpoints

### `POST /initiate-upload`

Reserve an upload slot and obtain a presigned storage URL.

**Request body** (all optional):

```json
{ "customExpirationSeconds": 3600 }
```

`customExpirationSeconds` clamps to the server's allowed range (max 24h); omit it
for the default TTL (15 minutes).

**Response `200`:**

```json
{
  "uploadCode": "abcdef0123456789",
  "url": "https://.../presigned-put-url",
  "sseToken": "…",
  "senderToken": "…",
  "maxFileSizeMB": 1024,
  "uploadTTLSeconds": 900
}
```

- `url` — presigned `PUT` URL for the encrypted bytes.
- `senderToken` — secret proving you are the sender; required to finalize,
  authorize, and cancel. Never share it.

### `PUT <presigned url>`

Upload the **encrypted** file bytes directly to storage.

- Header: `Content-Type: application/octet-stream`
- Body: the raw ciphertext payload (`IV || ciphertext || GCM tag`).
- Success: HTTP `2xx`.

### `POST /upload/:uploadCode/finalize`

Attach the encrypted filename and commit the upload.

**Request body:**

```json
{ "encryptedFilename": "<base64>", "senderToken": "…" }
```

**Response `200`:** `{ "message": "Upload finalized successfully." }`

Errors: `400` missing filename, `401` missing sender token, `403` bad sender
token, `404` bytes not uploaded, `413` file exceeds size limit.

### `DELETE /upload/:uploadCode`  (sender cancellation)

**Request body:** `{ "senderToken": "…" }`

Terminates the session and deletes the encrypted copy. `403` on bad token.

---

## Receiver endpoints

### `POST /handshake/initiate`

Begin a receive handshake for an upload.

**Request body:** `{ "uploadCode": "abcdef0123456789" }`

**Response `200`:**

```json
{ "handshakeCode": "…", "recipientToken": "…", "sseToken": "…" }
```

- `handshakeCode` — read this to the sender so they can authorize you.
- `recipientToken` — secret used to poll for the download token and to cancel.

Errors: `404` invalid or expired upload code.

### `GET /handshake/token/:uploadCode`

Poll for the download token. Returns it once the sender has authorized.

- Header: `Authorization: Bearer <recipientToken>`

**Response `200`:** `{ "downloadToken": "<jwt>" }`

**Response `404`:** `{ "error": "Token not found or expired." }` — not yet
authorized; keep polling.

**Response `403`:** the recipient token is invalid or the session was cancelled.

> The download token is single-issue: once returned, the recipient token is
> consumed.

### `GET /upload/:uploadCode`  (download)

Download the encrypted file.

- Header: `Authorization: Bearer <downloadToken>`

**Response `200`:**

- Body: the raw ciphertext payload.
- Header `X-Encrypted-Filename`: the base64 encrypted filename to decrypt
  locally.

The server **deletes its stored copy** as soon as the response finishes
streaming. Errors: `401`/`403` bad token, `404` metadata missing/expired.

### `DELETE /handshake/:uploadCode`  (recipient cancellation)

- Header: `Authorization: Bearer <recipientToken>` (a valid download token is
  also accepted).

Terminates the session.

---

## Authorization (sender side)

### `POST /handshake/authorize`

The sender calls this with the handshake code the receiver gave them.

**Request body:**

```json
{ "uploadCode": "abcdef0123456789", "handshakeCode": "…" }
```

**Response `200`:** `{ "message": "Download authorized" }`

Errors: `403` wrong handshake code, `404` session terminated/expired, `429` too
many failed attempts (the session is terminated for safety).

---

## Real-time events (optional)

The server exposes Server-Sent Events at `GET /session-events/:sseToken`
carrying `status-authorized` and `session-terminated` messages. The CLI does
**not** require SSE — it polls `GET /handshake/token/:uploadCode` instead, which
the browser also does as a fallback. SSE is documented here only for
completeness.

---

## Client-side payload formats

These are computed entirely on the client; the server treats them as opaque.

### Encryption payload

```
payload = IV (12 bytes) || ciphertext || GCM auth tag (16 bytes)
```

- Algorithm: **AES-256-GCM**.
- Key: 256-bit, shared as 64 lowercase hex characters.
- The filename is encrypted the same way, but its plaintext is encoded as
  **UTF-16LE** before encryption, then base64-encoded for the
  `X-Encrypted-Filename` header / `encryptedFilename` field.

### Combined share code

```
combinedCode = base64( JSON.stringify({ uploadCode, key, fullSecurity }) )
```

### Share link

```
https://<host>/#code=<combinedCode>
```

The code lives in the **URL fragment** (`#`), which browsers never transmit to a
server.
