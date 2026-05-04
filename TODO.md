# TODO

## Add Repository Clone Cache

Current collection uses fresh shallow clones:

```sh
git clone --depth 1 -b <branch> <repo> <tmp>/repo
```

This is simple and correct, but every CI run and every OS job downloads the same repositories again.

Planned cache work:

1. Add `--single-branch` to the current clone command as the low-risk first step.
2. Introduce a configurable cache directory, for example `COMMUNITY_CAKES_REPO_CACHE` or `--repo-cache-dir`.
3. Store each repository as a bare mirror keyed by normalized repo URL.
4. On each run, update the mirror with:

   ```sh
   git fetch --depth 1 origin <branch>
   ```

5. Materialize the working copy from the cached mirror into the per-run temp directory.
6. Record whether each repo came from a fresh clone or cache update in collector logs.
7. Wire GitHub Actions cache around the cache directory, with a key that includes OS and a repos config hash.
8. Measure before/after CI time before raising `--max-concurrent-repos`.

Important constraints:

- Keep fresh temp working directories for command execution.
- Do not share mutable working trees across concurrently checked repositories.
- Do not enable sparse checkout by default; MoonBit modules may depend on files outside listed module paths.
