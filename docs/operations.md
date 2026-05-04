# Operations

This guide covers day-to-day operation of Community Cakes Dashboard.

## Local Setup

Requirements:

- Deno 2.x
- Git
- MoonBit toolchain in `PATH` for local collection
- Docker if you want to test the Linux collection image

Useful checks:

```sh
deno --version
git --version
moon version --all
```

## Common Commands

```sh
deno task fmt
deno task lint
deno task check
deno task test
deno task schema
deno task bundle
```

## Collect Locally

Collect one OS worth of data:

```sh
deno run -A main.ts stat \
  --config resources/repos.yaml \
  --os linux-x64 \
  --out-dir data/community/linux-x64
```

The collector writes:

- `data/community/<os>/data.jsonl`
- `data/community/<os>/logs/*.stdout.log`
- `data/community/<os>/logs/*.stderr.log`

## Preview Locally

Build the static bundle:

```sh
deno task bundle
```

If you have no collected data yet, create empty files for all three OS ids:

```sh
deno run -A main.ts stat --config resources/repos.yaml --os linux-x64 --out-dir data/community/linux-x64
deno run -A main.ts stat --config resources/repos.yaml --os macos-arm64 --out-dir data/community/macos-arm64
deno run -A main.ts stat --config resources/repos.yaml --os windows-x64 --out-dir data/community/windows-x64
```

Serve the directory:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`.

## CI

`.github/workflows/community-cakes.yml` runs on a schedule and manually via `workflow_dispatch`.

Collection jobs:

- `linux-x64`: builds and runs `Dockerfile.linux-x64` on `ubuntu-latest`
- `macos-arm64`: runs on `moonbit-nightly-macos-arm64`
- `windows-x64`: runs on `moonbit-nightly-windows-x64`

The publish job downloads artifacts, bundles `web.ts`, copies `index.html`, `web.js`, and `data/`, then deploys to
GitHub Pages.

## Troubleshooting

If a repository cannot be cloned, the check record is `Error` and the matching test record is `Skipped`.

If a command times out, the record is `Error` and `reason` contains the timeout duration.

If a test is skipped unexpectedly, inspect the matching check record first. Tests only run when check is `Pass`.

If the dashboard is blank locally, verify that `web.js` exists and that `data/community/<os>/data.jsonl` is reachable
from the static server.

If Deno cannot resolve dependencies in a sandboxed environment, rerun the command with network access or pre-populate
the Deno cache.
