# Releases

GitHub release packages work without an npm account. The package uses `@canary-builds/dsh-connect`; the GitHub repository is intentionally spelled `Canary-Builds/dhs-connect`.

## GitHub

1. Update `package.json` version, CHANGELOG.md, RELEASE_NOTES.md and the pinned install URLs in README.md and DIRECTORY.md. Runtime version comes from package.json.
2. Run `npm test` and `npm run test:package`. Commit generated files and push main. Wait for both CI Node versions to pass.
3. Tag that tested commit, for example `git tag -a v0.3.1 -m 'DSH Connect v0.3.1'`, then `git push origin v0.3.1`.
4. The Release workflow checks the tag, tests and packs the project, then creates the release with a `.tgz` and SHA256SUMS. Check the workflow and install the published URL in an isolated DSH home before announcing it.

Do not move published tags or replace a released version's package. Fixes get a new version. GitHub release checksums provide integrity checking, not a separate signature.

## Optional npm publication

The npm scope must belong to your npm user or organization; owning the GitHub organization does not grant the npm scope. Confirm access to `@canary-builds` before publishing. If unavailable, change the scope consistently in metadata and regenerate/test the client and patch before cutting a new release.

For the first publication, check out the release tag and use interactive `npm login`, then `npm publish --access public`. Complete npm's browser/2FA flow yourself; do not put tokens in repository files or chat. This is separate from creating a GitHub release.

For subsequent releases, configure a GitHub Actions trusted publisher in the npm package settings:

- Organization/user: `Canary-Builds`
- Repository: `dhs-connect`
- Workflow filename: `publish.yml`
- Environment: leave empty (this workflow declares none)
- Permit direct `npm publish` if the settings offer allowed actions.

Run the **Publish to npm** workflow manually on an existing release tag. It only publishes tag refs and uses OIDC with provenance; no npm token secret is required. It is deliberately separate from the GitHub Release workflow so an unconfigured npm account cannot break GitHub releases.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for current account requirements. The workflow installs npm 11 to satisfy the documented minimum of npm 11.5.1.
