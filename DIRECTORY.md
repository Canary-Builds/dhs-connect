# Directory submission

Submit through the [DSH Directory issue form](https://github.com/alexchenzl/dsh-plugin-directory/issues/new?template=plugin-submission.yml) after verifying the released install command. This is a community directory; listing does not mean DeepSeek endorsement. This repository has not automatically submitted an issue.

Use these fields:

- Title: `[Plugin]: DSH Connect`
- Plugin package URL: `https://github.com/Canary-Builds/dhs-connect`
- Primary category: **Models & Providers (models)**
- One-line description: Connects DeepSeek Harness to ChatGPT models using OAuth sign-in through the official Codex app-server, without requiring an OpenAI API key.
- Install command (also in README.md):

```sh
dsh plugin --profile web add @canary-builds/dsh-connect
```

The package is public, declares `dsh.bundle.patch`, and includes its patch and prebuilt client. Those are the directory's structural eligibility requirements; its checks do not execute or audit the plugin. npm publication is not a prerequisite.

Read the [directory contribution rules](https://github.com/alexchenzl/dsh-plugin-directory/blob/master/CONTRIBUTING.md) before submitting. The upstream [Harness contribution guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.md) also recommends the `dsh-plugin` GitHub topic for discovery.
