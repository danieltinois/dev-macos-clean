# AGENTS.md

Guide for AI coding agents working on DevClean, a macOS developer-storage
analyzer: a scanner/CLI (`core/`, `cli/`) and native Swift apps for macOS and
iPhone (`apple/`) that run the same engine with a native SwiftUI interface, and
move known regenerable caches (or, on the iPhone, photos and files) to the Trash. The README covers product details;
this file covers how to work on the code.

## Commands

Bun 1.2+ is the package manager, runtime and test runner. Don't use npm/npx/node.

```bash
bun install            # dev dependencies (TypeScript, Bun types)
bun test               # all tests (bun:test); `bun test core/scanner.test.ts` for one file
bun run typecheck      # tsc --noEmit, strict; must pass, tests don't type-check
bun run scan --json    # run the CLI from source (analysis only, safe to run)
bun run build          # bundle the engine into dist/engine/ for the Swift apps
bun run build:engine   # bundle core/ + rules/ for JavaScriptCore: dist/engine/devclean-engine.js
```

Before finishing a change, run `bun test` and `bun run typecheck`. If you touch
`scripts/`, also run `bun run build`.

The Swift apps under `apple/` need Xcode and Bun (an Xcode build phase runs
`apple/bundle-resources.sh`, which builds the UI and the engine). Prefix commands with
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` if `xcode-select`
points at the Command Line Tools:

```bash
bun run test:apple     # builds the engine, then DevCleanKit tests (swift-testing)
xcodebuild -project apple/DevClean.xcodeproj -scheme DevClean -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project apple/DevClean.xcodeproj -scheme DevClean -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

If you touch `core/`, `rules/` or `apple/`, also run `bun run test:apple` and
both builds: the Swift apps run the same engine.

## Layout

- `rules/*.json`: one declarative rule per file (`id`, `category`, `severity`,
  `paths` and/or `patterns`, optional `markers` and `rebuild`). `core/rules.ts`
  validates them strictly: unknown keys, bad slugs or duplicate ids fail loading.
- `core/`: the engine. Pure domain logic, no UI, **never deletes**, and
  no disk access of its own: everything goes through a `Host` (`host.ts`).
  `scanner.ts` orchestrates, `filesystem.ts` walks and measures, `analyzer.ts`
  holds per-rule enrichers and totals, `policy.ts` decides what cleanup may
  move, `types.ts` defines the report contract, `paths.ts` replaces
  `node:path`. `engine.ts` is the portable entry point (for JavaScriptCore).
  `node.ts` is the Node host (`nodeHost`, `loadRules`, `scan`), and `index.ts`
  is the Node-bound public API used by the CLI and tests. `jsc.ts` is the
  JavaScriptCore entry (`globalThis.DevCleanEngine`, JSON in and out, rules
  embedded at build time by `scripts/engine.ts`).
- `cli/devclean.ts`: `devclean scan`, human text or `--json`. Analysis only.
- `scripts/build.ts`: writes the engine to `dist/engine/`. `dist/` is
  generated, so don't edit or commit it.
- `apple/`: the native Swift app. It runs the TypeScript engine in
  JavaScriptCore, so Swift holds no rules or policy. The interface is SwiftUI,
  shared by macOS and iPhone (`DevClean/`): `AppModel.swift` (state and flows),
  `MainView.swift`, `OverviewViews.swift`, `ResultsViews.swift`,
  `DetailsView.swift` and `TourView.swift` (the screens), `Mascot.swift` (Floco),
  `Ascii.swift` (ASCII art and its motion; the art itself comes from the engine,
  `core/cat.ts` and `core/ascii.ts`) and `Theme.swift` (colors, type, sizes and
  breakpoints). `MacActions.swift` (disk and Trash) and `PhoneActions.swift`
  (photo library, Files folders, Recently Deleted) are each platform's `Actions`.
  `DevCleanKit/` has `Presentation.swift` (texts per platform, labels, filters
  and selection, disk parts, the tour; no views), `Engine.swift` (the
  JavaScriptCore bridge), `NativeHost.swift` (the Host: POSIX calls plus a
  native `measure`, the hot loop, `storage`, and optional `photos` and `files`),
  `PhotoLibrary.swift` (PhotoKit: list, identity, delete, similar-photo analysis),
  `SimilarPhotos.swift` (Vision feature prints and scores, testable on the Mac),
  `PickedFolders.swift`
  (folders picked in the Files app, kept as bookmarks), `Cleanup.swift` (the trusted side:
  identities, tokens, Trash), `Confirmation.swift` (the Mac's cleanup alert) and
  `Report.swift`. The project uses a
  synchronized folder, so new files in `apple/DevClean/` need no project edits.
- Photo rules (`rules/*.json` with `photos` instead of `paths`) match items the
  host lists (`Host.photos()`, iPhone only) and report them as
  `photos://<localIdentifier>`, with the file name in `metadata.label`. File rules
  (`files`) do the same for files in folders picked in the Files app
  (`Host.files()`), with real paths. `report.storage` is the volume's space
  (`Host.storage()`), shown in the disk panel (`DiskParts` in `Presentation.swift`).

## Safety invariants (do not weaken)

This tool deletes things on users' machines. Treat these as hard rules:

1. The scanner decides **what exists**, and `core/policy.ts` decides **what may
   be moved**. A rule never grants cleanup. Cleanup needs an explicit,
   home-relative entry in `targets`/`reviewTargets` (or `projectOutputs` with a
   marker file) in `policy.ts`; photo and Files items need their rule in
   `photoTargets`/`fileTargets` and are REVIEW (Files: regular files only),
   except the SAFE photo rules in `photoAutomatic` (byte-identical copies and
   burst extras: one item always stays). The trusted side
   (`apple/DevCleanKit/.../Cleanup.swift` and the `Actions` in `apple/DevClean/`) applies that policy and does the move. Identity checks and the move itself never run in
   the engine.
2. Cleanup only ever uses `FileManager.trashItem`. Never add permanent
   deletion (`removeItem`, `rm`, `unlink`) of user paths, and
   never empty the Trash. Photos only go through `PHAssetChangeRequest.deleteAssets`,
   which the system confirms and which keeps them in Recently Deleted; never
   empty that album.
3. Before trashing, each target is revalidated against the identity captured at
   scan time (realpath, dev, inode, mtime, ctime), and symlinks anywhere in the
   path are rejected. Keep `prepare` → `select` → `validate` → `moveToTrash`.
4. The interface never hands paths to the trusted side. `Actions` take only
   indices into the last report plus its `cleanup_token`, and the trusted side
   re-selects them through the engine. Picked folders come only from the system
   picker (`addFolder`), and the iPhone only trashes files inside them.
5. No web content: the app shows no web view and loads nothing remote.
6. Only the user's own clicks start cleanup. The confirmation dialog defaults to
   **Cancelar** (on the iPhone too, for Files items; photos get the system's own
   confirmation, automatic or not), and REVIEW items are never `auto_clean`. On
   the iPhone, automatic cleanup only takes photos from `photoAutomatic`, never
   files, and copies only count when the content hashes (SHA-256) match.

## Gotchas

- **`bun build` inlines `__dirname`, `__filename` and `import.meta.dirname` as
  the build machine's absolute paths.** `import.meta.dirname` is fine only in
  code that runs from source under Bun (CLI, tests, `core` defaults).
- `core/` must run in JavaScriptCore, so it
  uses no `node:` modules, `process` or `Bun.*` at all, except in `node.ts`
  and `index.ts`. `core/engine.test.ts` enforces this.
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
   `targets` in `core/policy.ts`. Add it to `automatic` only if the tool
   recreates it with no manual step. Add a label in `Presentation.swift` `Labels.categories` for a
   new category.
3. Cover it in `core/scanner.test.ts` (detection) and, if cleanable,
   `core/policy.test.ts` (policy).

## Code style

- Strict TypeScript and ES modules. Use extensionless relative imports and
  `import type` for types (`verbatimModuleSyntax` is on).
- Match the existing compact style: 2-space indent, single quotes, semicolons,
  `{a, b}` without inner spaces, short one-line helpers. Comments explain *why*
  and stay sparse.
- Code, comments, CLI output and commit messages are in English. The app UI
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
  `feat(ui): …`, `fix(scanner): …`, `refactor: …`.
- The user is the sole author. Don't add `Co-Authored-By` trailers or "Generated
  with" lines to commits or PRs.
- Don't push to `main` or `develop` directly, and don't delete branches without
  asking.
