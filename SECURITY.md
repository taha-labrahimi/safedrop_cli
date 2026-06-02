# SafeDrop CLI security model

SafeDrop is **zero-knowledge**: the server stores and relays data it cannot
read. This document explains the guarantees the CLI provides, how it provides
them, and what is explicitly out of scope.

---

## The core guarantee

> The SafeDrop server never receives plaintext file contents, plaintext
> filenames, or encryption keys.

Everything sensitive is encrypted and decrypted **on the client**. The CLI is
just another zero-knowledge client, identical in behavior to the browser app.

| Data | Where it is in plaintext | What the server sees |
|---|---|---|
| File contents | Sender's & receiver's machines only | AES-256-GCM ciphertext |
| Real filename | Sender's & receiver's machines only | Encrypted, base64 blob |
| Encryption key | Sender's machine, then the share code | Never |

---

## Cryptography

- **AES-256-GCM** authenticated encryption (confidentiality + integrity). A
  tampered or truncated payload fails decryption rather than producing garbage.
- Keys are **256-bit**, generated with the OS CSPRNG (`crypto.randomBytes`).
- A fresh **96-bit IV** is generated per encryption (`crypto.randomBytes(12)`)
  and prepended to the payload.
- Wire format: `IV (12B) || ciphertext || GCM tag (16B)` — byte-for-byte
  identical to the browser's Web Crypto output, so files cross between the two
  clients transparently. This is enforced by tests that decrypt CLI output with
  the real Web Crypto API and vice versa.
- Filenames are encrypted with the same scheme; their plaintext is UTF-16LE so
  the bytes match the browser exactly.

The CLI does **not** invent its own protocol — it reuses the established
SafeDrop client format. No backend logic is reimplemented; the CLI only calls
the documented HTTP API ([`API.md`](API.md)).

---

## Key distribution and links

- The encryption key travels **only inside the share code**, which the sender
  hands to the receiver out-of-band (chat, in person, etc.).
- The combined code is `base64(JSON{ uploadCode, key, fullSecurity })`.
- The browser share link places the code in the **URL fragment**
  (`https://host/#code=...`). Fragments are never sent to the server in an HTTP
  request, so navigating to a link does not leak the key to the host.
- The CLI prints the share code to **stdout** and all status/log output to
  **stderr**, so you can capture the code cleanly (e.g. `safedrop send f >
  code.txt`) without log noise, and logs never carry the secret by accident.

---

## Optional MITM protection: full-security mode (`--secure`)

When enabled, both sides derive a **3-word Short Authentication String (SAS)**
from `SHA-256(key)` and compare it over a trusted channel (e.g. read it aloud on
a call). If the words differ, the key was tampered with in transit and the
transfer is aborted. The wordlist and derivation match the browser exactly, so a
browser sender and CLI receiver (or vice versa) compute the same words.

---

## What the CLI does and does not log

- **Never logged:** file contents, encryption keys, sender/recipient/download
  tokens.
- **Printed once, intentionally:** the share code (sender) and the handshake
  code (receiver). These are the secrets you are meant to share — that is the
  entire purpose of the command. The share code is written to stdout; with
  `--secure` the safety code is shown so you can verify it.
- Secrets are not written to any cache, history, or temp file by the CLI.

---

## Safe handling of downloaded files

The decrypted filename comes from the sender and is therefore **untrusted
input** after decryption. The CLI:

- **Strips directory components** from the sender's filename (`../`, absolute
  paths, drive letters, Windows separators) — a malicious name can only ever
  resolve to a basename inside the chosen output directory.
- **Refuses path traversal**: the resolved path is verified to stay within its
  parent directory, otherwise the write is rejected.
- **Neutralizes dangerous names**: control characters and Windows-illegal
  characters are removed; reserved device names (`CON`, `NUL`, `COM1`, …) are
  prefixed.
- **Never overwrites without confirmation**: if the target exists you are asked;
  declining writes to `name (1).ext`, `name (2).ext`, … instead.

See [`test/paths.test.js`](test/paths.test.js) for the enforced behaviors.

---

## Availability, expiry, and cancellation

- Transfers **expire** server-side after their TTL; the CLI reports expiry
  cleanly on both sides rather than hanging.
- **Either side can cancel.** The sender's `Ctrl-C` (or empty handshake input)
  calls `DELETE /upload/:code`; the receiver's `Ctrl-C` calls
  `DELETE /handshake/:code`. Both delete the encrypted server copy.
- The server deletes the stored ciphertext the instant the download completes,
  so each code is **single-use**.

---

## Validation and limits

- File size is checked against the server limit (1024 MB) **before** upload, and
  the server re-checks on finalize.
- Network errors are translated into actionable messages (connection refused,
  DNS failure, TLS problems, timeouts) instead of raw stack traces.

---

## Threat model — out of scope

SafeDrop does **not** defend against:

- A **compromised endpoint** (malware on the sender's or receiver's machine).
  Plaintext exists there by necessity.
- The sender **sending the code to the wrong person**, or an attacker who
  obtains the code before the legitimate receiver (use `--secure` to detect a
  key swap; protect the channel you share the code over).
- **Traffic analysis** (the server learns file size and timing).
- **Denial of service** against the server.

Because the share code contains the key, **anyone who obtains the code can
decrypt the file** until the transfer is downloaded, cancelled, or expires.
Treat the code like a password and prefer ephemeral, trusted channels.

---

## Reporting

This CLI is open source and dependency-free for auditability. Please report
suspected vulnerabilities privately to the SafeDrop maintainers rather than
opening a public issue.
