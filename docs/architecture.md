# Architecture

Community Cakes Dashboard has two independent phases:

1. CI or a local operator collects repository health data.
2. A static frontend reads the generated data and renders a dashboard.

There is no backend service in the published dashboard. The generated JSONL and log files are the API.

## Data Flow

```text
repos.csv
  -> deno run -A main.ts repos-from-csv
  -> resources/repos.yaml
  -> deno run -A main.ts stat
  -> data/community/<os>/data.jsonl
  -> data/community/<os>/logs/*.log
  -> deno task bundle
  -> index.html + web.js
```

`repos.csv` is only a bootstrap input. Once `resources/repos.yaml` exists, CI reads only YAML.

## Runtime Pieces

| File                                    | Responsibility                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `main.ts`                               | CLI parsing and command dispatch.                                                                  |
| `lib/community_types.ts`                | Zod schemas and TypeScript types for config, tasks, metadata, and result records.                  |
| `lib/community_config.ts`               | GitHub URL normalization, CSV parsing, YAML loading, matrix expansion, command template expansion. |
| `lib/community_health.ts`               | Repository cloning, command execution, timeout handling, result/log writing.                       |
| `lib/moon.ts`                           | MoonBit toolchain version discovery.                                                               |
| `lib/utils.ts`                          | Bounded concurrency helper.                                                                        |
| `web.ts`                                | Preact static dashboard.                                                                           |
| `.github/workflows/community-cakes.yml` | Scheduled nightly collection and GitHub Pages publish.                                             |
| `Dockerfile.linux-x64`                  | Custom Linux collection image.                                                                     |

## Collection Model

The collector expands `resources/repos.yaml` into tasks by:

1. Applying defaults.
2. Applying repository-level matrix and command overrides.
3. Expanding `modules` or falling back to `working_directory`.
4. Applying module-level matrix and command overrides.
5. Applying ordered `overrides` for matching `os + backend` pairs.
6. Emitting one `check` and one conditional `test` record for each `repo + module + os + backend`.

Tests run only after the matching check passes. If check is `Error` or `Skipped`, test is written as `Skipped`.

## Result Files

Each `data/community/<os>/data.jsonl` file contains:

- line 1: metadata with GitHub run id, generation time, and `moon version --all` output
- line 2 onward: `CommunityResultRecord` objects

Logs are written separately and referenced by `stdout_path` and `stderr_path`. The frontend fetches logs only when a
cell is opened.

## OS Mapping

The public OS ids are the stable dashboard and config identifiers:

| OS id         | Intended environment                                       |
| ------------- | ---------------------------------------------------------- |
| `linux-x64`   | Linux x64 inside `Dockerfile.linux-x64`.                   |
| `macos-arm64` | Apple Silicon macOS runner with nightly MoonBit installed. |
| `windows-x64` | Windows x64 runner with nightly MoonBit installed.         |

The GitHub workflow currently expects custom runners named `moonbit-nightly-macos-arm64` and
`moonbit-nightly-windows-x64`.
