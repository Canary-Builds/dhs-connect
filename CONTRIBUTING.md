# Contributing

Open an issue describing the behavior or propose a focused pull request. Include the DSH, Codex and Node versions when reporting a bug. Remove credentials and conversation content from diagnostics.

Run `npm test` and `npm run test:package` before submitting changes. No dependency installation is needed. Edit `src/client.js`; `npm run build` regenerates `lib/client.js` and the Profile Bundle patch. Commit generated files so source installs have a usable client.

Live checks (`npm run test:live`) send requests through an existing ChatGPT login. Use a separate DSH profile for integration work. Keep credentials and machine configuration outside this repository.

Preserve DSH ownership of tools and permissions, cancellation behavior, client module registration and history recovery when adding connectors. Document supported content types and configuration explicitly.

See RELEASING.md for maintainer release steps.
