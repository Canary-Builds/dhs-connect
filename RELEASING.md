# Releases

GitHub release packages work without an npm account. The package uses `@canary-builds/dsh-connect`; the GitHub repository is intentionally spelled `Canary-Builds/dhs-connect`.

## GitHub

1. Update `package.json` version, CHANGELOG.md, RELEASE_NOTES.md and the pinned install URLs in README.md and DIRECTORY.md. Runtime version comes from package.json.
2. Run `npm test` and `npm run test:package`. Commit generated files and push main. Wait for both CI Node versions to pass.
3. Tag that tested commit, for example `git tag -a v0.3.1 -m 'DSH Connect v0.3.1'`, then `git push origin v0.3.1`.
4. The Release workflow checks the tag, tests and packs the project, then creates the release with a `.tgz` and SHA256SUMS. Check the workflow and install the published URL in an isolated DSH home before announcing it.

Do not move published tags or replace a released version's package. Fixes get a new version. GitHub release checksums provide integrity checking, not a separate signature.

## npm publication

The npm scope must belong to your npm user or organization; owning the GitHub organization does not grant the npm scope. Confirm access to `@canary-builds` before publishing. If unavailable, change the scope consistently in metadata and regenerate/test the client and patch before cutting a new release.

Version 0.3.1 was published to npm on 2026-09-06 using a temporary vault-backed publishing credential. No token was stored in GitHub Actions. The npm-side trusted publisher must still be configured before automated releases can publish.

For subsequent releases, configure a GitHub Actions trusted publisher in the npm package settings:

- Organization/user: `Canary-Builds`
- Repository: `dhs-connect`
- Workflow filename: `publish.yml`
- Environment: `npm` (matches the GitHub environment, as in dsh-splash)
- Permit direct `npm publish` if the settings offer allowed actions.

The **Publish to npm** workflow runs on `v*` tag pushes, with a manual retry available on a tag. It checks the package version, tests and packed contents, then publishes using OIDC with provenance; no npm token secret is required. Configure the npm-side trust before pushing the next release tag. It is deliberately separate from the GitHub Release workflow so an unconfigured npm account cannot break GitHub releases.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for current account requirements. The workflow installs npm 11 to satisfy the documented minimum of npm 11.5.1.
