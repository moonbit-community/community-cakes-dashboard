# Community Cakes Dashboard

Community Cakes Dashboard tracks the nightly-toolchain health of GitHub MoonBit repositories. CI collects `moon check`
and `moon test` results for a configured repository matrix, uploads JSONL data and logs, then a static frontend renders
the latest status.

## Documentation

- [Architecture](docs/architecture.md) explains the data flow, modules, and runtime boundaries.
- [Configuration](docs/configuration.md) documents `resources/repos.yaml`, matrix expansion, overrides, and command
  templates.
- [Operations](docs/operations.md) covers local development, CI, generated artifacts, and troubleshooting.

## Configuration

`resources/repos.yaml` is the CI source of truth. It supports repo-level and module-level matrix overrides, custom
commands, skip rules, environment overrides, and multi-module repositories.

Validate and refresh the JSON schema after changing config types:

```sh
deno task schema
```

## Collect Data

Run the collector for the current host OS or an explicit OS id:

```sh
deno run -A main.ts stat --config resources/repos.yaml --os linux-x64
```

Output is written to `data/community/<os>/data.jsonl`; logs are written under `data/community/<os>/logs/`.

## Dashboard

Build the static frontend:

```sh
deno task bundle
```

Then serve the directory with any static file server and open `index.html`.

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

## For LLM

Agents that need today's published check results should read the static JSONL files served by the dashboard:

```text
data/community/linux-x64/data.jsonl
data/community/macos-arm64/data.jsonl
data/community/windows-x64/data.jsonl
```

When the site is deployed to GitHub Pages, prepend the site base URL. For example:

```text
https://<owner>.github.io/<repo>/data/community/linux-x64/data.jsonl
```

Each file is newline-delimited JSON. The first line is metadata with `generated_at`, `runId`, `runNumber`,
`dashboard_commit_sha`, and `toolchainVersion`; every following line is one `repo + module + os + backend + step`
result. There is no separate API server and no date archive yet, so these paths represent the latest published run.
Check `generated_at` to confirm that the files are from today.

## Development

```sh
deno task fmt
deno task lint
deno task check
deno task test
deno task schema
```
