First packaged release of DSH Connect, the Canary Builds connector plugin for DeepSeek Harness.

- ChatGPT sign-in through the official Codex app-server, account model discovery and a Settings panel.
- Streaming, reasoning summaries, dynamic tool calls, cancellation and history recovery.
- Prebuilt Profile Bundle with no runtime npm dependencies or installation build step.
- Package validation, automated GitHub releases and optional npm trusted publishing.

Install:

```sh
dsh plugin --profile web add https://github.com/Canary-Builds/dhs-connect/releases/download/v0.3.1/canary-builds-dsh-connect-0.3.1.tgz
```

Requires Node.js 22.19+ and the official Codex CLI. Tested on Linux with DSH 0.1.1-rc.2 and Codex 0.153.4. Restart Harness after installation. Supports text and text tool results; images and per-turn sampling/output limits are not supported. npm publication and directory listing are separate from this GitHub release.

The `.tgz` asset is the installable package; GitHub's automatic source archives are development snapshots. `SHA256SUMS` contains the package's SHA-256 checksum.
