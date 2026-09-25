Add Grok as an optional account next to ChatGPT. Connect either one, or both. Grok does not require the Codex CLI.

- Sign in with the official Grok CLI from Settings or `dsh-connect-grok-login`.
- ChatGPT still uses the Codex app-server. It is registered only when `codex` is installed.
- Install into the DSH profile (`dsh plugin --profile web add @canary-builds/dsh-connect`). A home-directory `npm install` does not register the plugin.
- Remote ChatGPT sign-in needs SSH forwards for the web port and `1455`. Grok device login does not.

Install or update:

```sh
dsh plugin --profile web add @canary-builds/dsh-connect
```

Restart Harness and refresh your browser after updating. The package includes the prebuilt client; no build step is required.