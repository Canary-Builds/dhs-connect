# Changelog

## 0.3.2 — 2026-09-06

- Publish new stable versions automatically from main through npm OIDC trusted publishing.
- Skip already-published versions and serialize publishing runs.
- Document the direct npm install command and OAuth sign-in without an OpenAI API key.

## 0.3.1 — 2026-09-06

First packaged GitHub release.

- Provide a prebuilt installable Profile Bundle and SHA-256 checksum.
- Derive runtime version from package metadata to prevent release drift.
- Validate packed contents and installed entry points in CI.
- Add tag-driven GitHub releases, optional npm trusted publishing, and submission documentation.

## 0.3.0 — DSH Connect

- Rename the package, client module, Settings panel, HTTP route and CLI commands.
- Establish `Canary-Builds/dhs-connect` as the source repository.
- Discover Codex on PATH or through explicit configuration.
- Make deployment-specific proxy exceptions opt-in.
- Keep the existing `openai-codex` provider route and compatible sign-in location.
- Preserve streaming, tool bridging, recovery and the automated test suite from the earlier local adapter.

This is a development checkpoint, not a published npm release.
