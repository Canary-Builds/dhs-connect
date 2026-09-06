# DSH Connect

![DSH Connect — Connect DeepSeek Harness to ChatGPT models using OAuth sign-in](https://raw.githubusercontent.com/Canary-Builds/dhs-connect/main/assets/dsh-connect-cover.png)

Connect DeepSeek Harness to ChatGPT models using OAuth sign-in through the official Codex app-server, without requiring an OpenAI API key.

DSH Connect is a community Cordis plugin with a model-provider adapter and a web Settings panel. The first connector supports Codex/ChatGPT; it is not tied to a particular model. The provider ID is `openai-codex`.

## Install

Requires Node.js 22.19+ and an installed official Codex CLI. Tested with DSH 0.1.1-rc.2 and Codex 0.153.4 on Linux. Both upstream interfaces are evolving; other versions and operating systems need validation.

Install from npm:

```sh
dsh plugin --profile web add @canary-builds/dsh-connect
```

Use `--profile headless` instead for the CLI profile. To pin this release, use `@canary-builds/dsh-connect@0.3.3`. No npm account or plugin build step is required to install the public package.

A prebuilt tarball and `SHA256SUMS` are also available in the [v0.3.3 GitHub release](https://github.com/Canary-Builds/dhs-connect/releases/tag/v0.3.3).

Restart your running Harness instance after installation. Open **Settings → DSH Connect**, sign in with ChatGPT, and select a model from the normal model picker. Install only the profiles you use. A pnpm workspace-root profile may require its existing `ignoreWorkspaceRootCheck` setting or the package-manager workspace-root option.

Remove the earlier `dsh-plugin-codex-astra` or `dsh-openai-oauth` adapter from a profile before installing this one: both claim the same `openai-codex` provider route. Keep your existing Codex sign-in directory to preserve authentication.

## Screenshots

Select a screenshot to view it at full size.

<table>
  <tr>
    <td align="center" valign="top"><a href="https://raw.githubusercontent.com/Canary-Builds/dhs-connect/main/assets/screenshots/settings-desktop.png"><img src="https://raw.githubusercontent.com/Canary-Builds/dhs-connect/main/assets/screenshots/settings-desktop.png" width="480" alt="Desktop connection settings and model catalog"></a><br>Desktop connection settings and model catalog</td>
    <td align="center" valign="top"><a href="https://raw.githubusercontent.com/Canary-Builds/dhs-connect/main/assets/screenshots/settings-mobile.png"><img src="https://raw.githubusercontent.com/Canary-Builds/dhs-connect/main/assets/screenshots/settings-mobile.png" width="280" alt="Connection settings on a narrow screen"></a><br>Connection settings on a narrow screen</td>
  </tr>
</table>

The narrow-screen example also uses [DSH Mobile UI](https://github.com/Canary-Builds/dsh-mobile-ui). Models shown depend on your account and plugin version.

## Features

- Account model discovery merged with a curated fallback; unlisted model IDs can still be requested.
- One catalog shared by Settings and the model picker, with refresh and connection diagnostics.
- Text streaming, reasoning summaries, Harness dynamic tool calls and token accounting.
- Request cancellation, RPC timeouts, process recovery and separate auxiliary calls.
- Conversation reconstruction after restart, compaction or changed tool definitions.
- No runtime npm dependencies or automatic binary downloads.

Harness owns tool execution and permissions. The connector disables native Codex tools and delegation features, and does not silently substitute a different model.

## Configuration

By default DSH Connect finds `codex` on `PATH`, and uses `~/.deepseek-harness/codex` as its sign-in directory. Set `DSH_CODEX_HOME` to an existing Codex home if you want to reuse that login.

Environment variables:

| Variable | Purpose |
| --- | --- |
| `DSH_CODEX_BIN` | Absolute path to the official Codex executable; overrides discovery. |
| `DSH_CODEX_HOME` | Codex sign-in and configuration directory. |
| `DSH_CONNECT_CONFIG` | Override the configuration-file path. |
| `DSH_CONNECT_NO_PROXY` | Optional domains to append to the Codex child's `NO_PROXY`. |

Alternatively, create `$DSH_HOME/connect.json` (default `~/.dsh/connect.json`):

```json
{
  "codexBin": "/absolute/path/to/codex",
  "codexHome": "/absolute/path/to/codex-home"
}
```

The optional `noProxy` field contains a comma-separated domain list. Proxy routing is inherited unchanged unless explicitly configured. Do not put credentials in this file; the official Codex executable manages authentication.

For a browser on another machine, forward the callback port before signing in:

```sh
ssh -N -o ExitOnForwardFailure=yes -L 1455:127.0.0.1:1455 user@harness-host
```

Replace `user@harness-host` with your SSH destination. The bundled `dsh-connect-login` command also supports Codex's `--device-auth` option when available to your account. Run `dsh-connect-doctor` through your profile's executable environment for diagnostics.

## Development

```sh
git clone https://github.com/Canary-Builds/dhs-connect.git
cd dhs-connect
```


```sh
npm test
npm run test:package
npm run doctor
npm run test:live
```

No dependency installation is required for unit tests. `npm test` rebuilds the client and exercises transport failures, cancellation, model fallback, tool bridging, history recovery, Settings registration and request-origin checks. The build derives the client module ID from `package.json`; edit `src/client.js`, not `lib/client.js`.

`test:live` uses your configured ChatGPT login and sends a few short requests. Set `DSH_CONNECT_TEST_MODEL` to choose the test model. `scripts/verify-web.mjs` checks a running DSH server's served module using its actual module loader and a React render check; it uses `DSH_WEB_URL` and optionally `DSH_RUNTIME_PACKAGE` for the host location.

## Limits and security

This version supports text and text tool results. Image attachments and per-turn temperature, stop sequences or output-token caps are not supported. A model's presence in the catalog does not guarantee account access.

Matching continuations reuse an ephemeral Codex thread. When that state no longer matches the supplied DSH history, the connector rebuilds from a role-labeled JSON transcript. This adds prompt tokens and does not restore hidden reasoning or replay completed tool execution.

Settings controls require loopback transport and same-origin requests and reject cross-site requests. Remote access requires a trusted deployment proxy; the plugin does not create public endpoints or add authentication to a proxy. Native stderr is not forwarded to Harness logs because it can include request data. Diagnostics filter common credential patterns.

See [CONTRIBUTING.md](CONTRIBUTING.md) for changes, [RELEASING.md](RELEASING.md) for versioned releases and npm publishing, and [DIRECTORY.md](DIRECTORY.md) for a ready-to-copy directory submission.

## Upstream references

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server)
- [DSH contribution guidance](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.md)

The development history began with the community [dsh-openai-oauth](https://github.com/DGPisces/dsh-openai-oauth) integration. The connector implementation in this repository was subsequently rewritten. DSH Connect is independently maintained by Canary Builds and is not an official DeepSeek or OpenAI product.

## License

MIT. See [LICENSE](LICENSE).
