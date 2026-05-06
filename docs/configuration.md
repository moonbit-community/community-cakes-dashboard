# Configuration

`resources/repos.yaml` is the source of truth for Community Cakes Dashboard collection.

## Top-Level Shape

```yaml
# yaml-language-server: $schema=repos.schema.json
schema_version: 1

defaults:
  matrix:
    os: [windows-x64, macos-arm64, linux-x64]
    backends: [wasm, wasm-gc, js, native]
  commands:
    check:
      argv: ['moon', 'check', '--target', '{backend}']
      timeout_seconds: 600
    test:
      argv: ['moon', 'test', '--target', '{backend}']
      timeout_seconds: 1200
      run_after: check_passed

repos:
  'https://github.com/moonbitlang/core':
    branch: main
```

## Repositories

Repository keys are GitHub page URLs:

```yaml
repos:
  'https://github.com/example/project':
    branch: main
    working_directory: '.'
```

`working_directory` is the single-module shorthand. It defaults to `"."`.

For multi-module repositories, use `modules`:

```yaml
repos:
  'https://github.com/example/project':
    branch: main
    modules:
      - path: '.'
      - path: 'examples/foo'
```

If `modules` is present, it is authoritative; repository-level `working_directory` is ignored for module expansion.

## Matrix

Matrix fields inherit from the nearest parent:

```yaml
matrix:
  os: [linux-x64, macos-arm64]
  backends: [wasm, native]
  exclude:
    - os: macos-arm64
      backend: native
```

`exclude` entries may specify only one dimension:

```yaml
exclude:
  - os: windows-x64
  - backend: native
```

Excluded matrix entries are written to the result data as `Excluded` records. The dashboard renders them as `EX` and
does not treat them as failures, skips, or missing data.

## Commands

A command uses exactly one of `argv`, `shell`, or `skip: true`.

Use `argv` for portable commands:

```yaml
commands:
  check:
    argv: ['moon', 'check', '--target', '{backend}', '--deny-warn']
    timeout_seconds: 900
```

Use `shell` only when shell behavior is required:

```yaml
commands:
  test:
    shell: 'npm ci && moon test --target {backend}'
    timeout_seconds: 1800
```

Use `skip` when the dashboard should explicitly record a skipped step:

```yaml
commands:
  test:
    skip: true
    reason: 'requires an external service'
```

Supported template variables:

- `{backend}`
- `{os}`
- `{repo}`
- `{branch}`
- `{module}`
- `{working_directory}`

## Overrides

Overrides apply after defaults, repository config, and module config. Multiple matching overrides apply in file order;
later values win.

```yaml
overrides:
  - match:
      os: [linux-x64]
      backends: [native]
    env:
      EXAMPLE_FEATURE: '1'
    commands:
      test:
        shell: './scripts/test-native.sh'
        timeout_seconds: 1800
```

`working_directory` inside an override changes the default working directory for matching commands unless a command sets
its own `working_directory`.

## Schema

Regenerate the schema after changing `lib/community_types.ts`:

```sh
deno task schema
```

The generated file is `resources/repos.schema.json`.
