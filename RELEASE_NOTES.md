DSH Connect now publishes new stable package versions automatically from GitHub main using npm OIDC trusted publishing, with provenance. Already-published versions are skipped and publishing runs are serialized.

This release also documents OAuth sign-in without an OpenAI API key and the direct npm installation command:

```sh
dsh plugin --profile web add @canary-builds/dsh-connect
```

Requires Node.js 22.19+ and the official Codex CLI. Tested on Linux with DSH 0.1.1-rc.2 and Codex 0.153.4. Restart Harness after installation. Supports text and text tool results; images and per-turn sampling/output limits are not supported.

The `.tgz` asset is the installable package. `SHA256SUMS` contains its SHA-256 checksum.
