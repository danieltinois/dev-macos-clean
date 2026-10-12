# AGENTS.md

Guide for AI coding agents working on DevClean, a macOS developer-storage
analyzer: a scanner/CLI (`core/`, `cli/`) and an Electron app (`desktop/`) that
moves known regenerable caches to the Trash. The README covers product details;
this file covers how to work on the code.

## Commands

Bun 1.2+ is the package manager, runtime and test runner. Don't use npm/npx/node.

```bash
bun install            # dependencies (Electron downloads its binary on first launch)
bun test               # all tests (bun:test); `bun test core/scanner.test.ts` for one file
bun run typecheck      # tsc --noEmit, strict; must pass, tests don't type-check
bun run scan --json    # run the CLI from source (analysis only, safe to run)
bun run build          # bundle desktop/ + rules/ into dist/
bun start              # build, then open the Electron app (it scans the whole Mac on launch)
```

Before finishing a change, run `bun test` and `bun run typecheck`. If you touch
`desktop/` or `scripts/build.ts`, also run `bun run build`.

## Layout

- `rules/*.json`: one declarative rule per file (`id`, `category`, `severity`,
  `paths` and/or `patterns`, optional `markers` and `rebuild`). `core/rules.ts`
  validates them strictly: unknown keys, bad slugs or duplicate ids fail loading.
- `core/`: pure domain logic, no Electron, **never deletes**. `scanner.ts`
  orchestrates, `filesystem.ts` walks and measures, `analyzer.ts` holds
  per-rule enrichers and totals, `types.ts` defines the report contract.
- `cli/devclean.ts`: `devclean scan`, human text or `--json`. Analysis only.
- `desktop/`: Electron. `main.ts` (IPC and dialogs), `scan.ts` plus
  `scan-worker.ts` (scan off the main thread), `cleanup.ts` (cleanup policy),
  `preload.ts` (the `window.devclean` bridge), `renderer.ts` (sandboxed UI).
- `scripts/build.ts`: bundles to `dist/` (main, preload and worker as CJS; the
  renderer as a browser script). `dist/` is generated, so don't edit or commit it.

## Safety invariants (do not weaken)

This tool deletes things on users' machines. Treat these as hard rules:

1. The scanner decides **what exists**, and `desktop/cleanup.ts` decides **what
   may be moved**. A rule never grants cleanup. Cleanup needs an explicit,
   home-relative entry in `targets`/`reviewTargets` (or `projectOutputs` with a
   marker file) in `cleanup.ts`.
2. Cleanup only ever uses `shell.trashItem`. Never add permanent deletion
   (`rm`, `fs.rm`, `unlink`) of user paths, and never empty the Trash.
3. Before trashing, each target is revalidated against the identity captured at
   scan time (realpath, dev, inode, mtime, ctime), and symlinks anywhere in the
   path are rejected. Keep `prepare` → `select` → `validate` → `moveToTrash`.
4. IPC handlers in `main.ts` must call `trusted(event)`, accept only indices into
   the last report plus its `cleanup_token`, and never accept raw paths from the
   renderer.
5. The renderer stays sandboxed: `contextIsolation`, no `nodeIntegration`, a
   strict CSP, and no remote content.
6. Only the user's own clicks start cleanup. The confirmation dialog defaults to
   **Cancelar**, and REVIEW items are never `auto_clean`.

## Gotchas

- **`bun build` inlines `__dirname`, `__filename` and `import.meta.dirname` as
  the build machine's absolute paths.** Bundled desktop code must resolve files
  at runtime (`app.getAppPath()` in `main.ts`) and pass them in, as `scan()`
  does with `ScanPaths`. `import.meta.dirname` is fine in code that only runs
  from source under Bun (CLI, tests, `core` defaults).
- Electron runs its own Node, not Bun. Code under `desktop/` (besides tests)
  must not use `Bun.*` APIs. `core/` is shared, so it uses `node:` modules only.
- The JSON report (`schema_version: 1`) is a stable contract. Key order of
  findings is tested in `cli/devclean.test.ts`. Adding fields is fine;
  renaming or removing them needs a schema bump.
- The generic `user-app-caches` rule runs last on purpose, so specific cache
  rules claim their folders first.

## Adding a detector

1. Add `rules/<id>.json` (the `id` matches the file name; `category` is an
   existing slug such as `node`, `xcode`, `android`, `rust`, `go`, `python`,
   `ide`, or a new one).
2. If it's a low-risk regenerable cache, add its fixed home-relative path to
   `targets` in `desktop/cleanup.ts`. Add it to `automatic` only if the tool
   recreates it with no manual step. Add a label in `renderer.ts` `names` for a
   new category.
3. Cover it in `core/scanner.test.ts` (detection) and, if cleanable,
   `desktop/cleanup.test.ts` (policy).

## Code style

- Strict TypeScript and ES modules. Use extensionless relative imports and
  `import type` for types (`verbatimModuleSyntax` is on).
- Match the existing compact style: 2-space indent, single quotes, semicolons,
  `{a, b}` without inner spaces, short one-line helpers. Comments explain *why*
  and stay sparse.
- Code, comments, CLI output and commit messages are in English. The desktop UI
  and its error messages are in Brazilian Portuguese (`pt-BR`), and so are rule
  `name`/`description` fields.
- No runtime dependencies. Think twice before adding any devDependency.

## Tests

- Use `bun:test` for structure and `node:assert/strict` for assertions,
  consistent with the existing suites.
- Never touch the real home directory. Build fixtures with `tempDir()` and
  `buildTree()` from `core/test-support.ts`, and register
  `afterEach(removeTempDirs)` in the file. Pass `home` explicitly to `scan()`.
- Permission tests use `test.skipIf(isRoot)`.

## Git workflow

- `main` holds releases, and `develop` is the integration branch. Branch from
  `develop` (`feat/…`, `fix/…`, `refactor/…`, `docs/…`, `chore/…`) and open PRs
  into `develop`. `develop` merges into `main` for releases.
- Commits follow Conventional Commits with an optional scope:
  `feat(desktop): …`, `fix(scanner): …`, `refactor: …`.
- The user is the sole author. Don't add `Co-Authored-By` trailers or "Generated
  with" lines to commits or PRs.
- Don't push to `main` or `develop` directly, and don't delete branches without
  asking.
