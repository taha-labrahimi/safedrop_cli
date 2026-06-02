# safedrop-cli

Zero-knowledge, end-to-end encrypted file transfer from your terminal — fully
compatible with the [SafeDrop](https://safedrop.ma) web app.

Files are **encrypted on your machine before upload** and **decrypted on the
receiver's machine after download**. The SafeDrop server only ever sees
ciphertext: it never receives your plaintext files, your real filenames, or
your encryption keys.

A file sent from the CLI can be received in the browser, and a file sent from
the browser can be received by the CLI — they use the identical encryption and
code format.

---

## Install

```bash
npm install -g safedrop-cli
```

Or run without installing:

```bash
npx safedrop-cli send ./report.pdf
```

Requires **Node.js 18+** (uses the built-in `fetch` and `crypto`). The package
has **zero runtime dependencies**, so it is small and easy to audit.

---

## Quick start

### Send a file

```bash
safedrop send ./report.pdf
```

The CLI encrypts the file locally, uploads the ciphertext, and prints a **share
code** (and a share link if you point it at a hosted SafeDrop). Give that code
to your receiver. Then the receiver runs `receive`, reads you back a short
**handshake code**, you paste it in, and the transfer is authorized.

### Receive a file

```bash
safedrop receive eyJ1cGxvYWRDb2RlIjoi...
```

The CLI parses the code, shows you a handshake code to read to the sender, waits
for them to authorize, then downloads and decrypts the file to your current
directory.

---

## Commands

```
safedrop send <file> [options]
safedrop receive <code-or-link> [options]
```

### `send` options

| Option | Description |
|---|---|
| `--ttl <minutes>` | How long the transfer stays available before it expires. Default `15`, max `1440` (24h). |
| `--secure` | Enable full-security mode: both sides compare an out-of-band 3-word safety code to detect interception. |
| `--api <base-url>` | SafeDrop API base URL. Defaults to `http://localhost:4000`, or the `SAFEDROP_API` env var. |

### `receive` options

| Option | Description |
|---|---|
| `--output`, `-o <path>` | Where to save the file. A directory (saves under the sender's filename) or a full file path. |
| `--api <base-url>` | SafeDrop API base URL. Defaults to `http://localhost:4000`, or the `SAFEDROP_API` env var. |

### Pointing at a hosted SafeDrop

The production web app serves its API under `/api`:

```bash
safedrop send ./report.pdf --api https://safedrop.ma/api
# or set it once:
export SAFEDROP_API=https://safedrop.ma/api
safedrop send ./report.pdf
```

---

## Examples

```bash
# Send with a 1-hour expiry and full-security verification
safedrop send ./contract.pdf --ttl 60 --secure

# Receive from a full browser link into your Downloads folder
safedrop receive "https://safedrop.ma/#code=eyJ1cGxv..." -o ~/Downloads/

# Receive and save under a specific name
safedrop receive eyJ1cGxv... -o ./received-contract.pdf
```

See [`examples/transcript-sender.txt`](examples/transcript-sender.txt) and
[`examples/transcript-receiver.txt`](examples/transcript-receiver.txt) for full
end-to-end terminal walkthroughs.

---

## How a transfer works

```
SENDER                          SAFEDROP SERVER                    RECEIVER
------                          ---------------                    --------
encrypt file + name locally
generate AES-256 key
   │ POST /initiate-upload ───────────▶ uploadCode, presigned URL,
   │                                    senderToken
   │ PUT ciphertext ──────────────────▶ (stores ciphertext only)
   │ POST /upload/:code/finalize ─────▶ (stores encrypted filename)
print share code  ◀────────────────────────────────────────────  paste code
                                                                   POST /handshake/initiate
                                    handshakeCode ◀──────────────  (gets handshake code)
read handshake code  ◀──────────────────────────────────────────  read it aloud
   │ POST /handshake/authorize ───────▶ issues download token
                                                  poll /handshake/token/:code ◀──
                                    downloadToken ─────────────────────────────▶
                                                  GET /upload/:code ◀───────────
                                    ciphertext ────────────────────────────────▶
                                    (server deletes its copy)      decrypt locally,
                                                                   save to disk
```

The **key never leaves the client**. The server stores only the encrypted bytes
and the encrypted filename, and deletes both the moment the download completes.

---

## Using it as a library

The encryption and code helpers are exported so you can build your own tools:

```js
import {
  encryptBuffer, decryptBuffer,
  encodeCombinedCode, decodeCombinedCode,
  SafeDropApi,
} from 'safedrop-cli';
```

These are the same building blocks the CLI uses. See [`API.md`](API.md) for the
HTTP contract and [`SECURITY.md`](SECURITY.md) for the threat model.

---

## Security at a glance

- **AES-256-GCM** authenticated encryption, done entirely client-side.
- The server is **zero-knowledge**: no keys, no plaintext, no real filenames.
- Share **codes/links carry the key in the URL fragment** (`#code=...`), which
  browsers never send to servers.
- The CLI **never logs** file contents or keys; the share code is the only
  secret it prints, and only because sharing it is the entire purpose.
- Downloaded filenames are **sanitized** — path traversal is refused and local
  files are **never overwritten without confirmation**.

Full details in [`SECURITY.md`](SECURITY.md).

---

## Development

```bash
npm test        # runs the cross-compatibility, code-parsing, and path tests
```

The crypto tests encrypt with the CLI and decrypt using the **actual Web Crypto
API** (and vice versa) to guarantee browser ⇄ CLI compatibility.

## License

MIT
