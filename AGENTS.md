# AGENTS.md

Guide for AI coding agents working on DevClean, a macOS developer-storage
analyzer: a scanner/CLI (`core/`, `cli/`) and native Swift apps for macOS and
iPhone (`apple/`) that run the same engine and a shared web UI (`desktop/`), and
move known regenerable caches (or, on the iPhone, photos and files) to the Trash. The README covers product details;
this file covers how to work on the code.

## Commands

Bun 1.2+ is the package manager, runtime and test runner. Don't use npm/npx/node.

```bash
bun install            # dev dependencies (TypeScript, Bun types)
bun test               # all tests (bun:test); `bun test core/scanner.test.ts` for one file
bun run typecheck      # tsc --noEmit, strict; must pass, tests don't type-check
bun run scan --json    # run the CLI from source (analysis only, safe to run)
bun run build          # bundle the UI (desktop/) and the engine into dist/ for the Swift apps
bun run build:engine   # bundle core/ + rules/ for JavaScriptCore: dist/engine/devclean-engine.js
```

Before finishing a change, run `bun test` and `bun run typecheck`. If you touch
`desktop/` or `scripts/build.ts`, also run `bun run build`.

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
- `desktop/`: the web UI the Swift apps show (the name is historical).
  `index.html`, `style.css` and `renderer.ts` (sandboxed page), `bridge.ts`
  (the `window.devclean` contract and the report the shell hands over),
  `platform.ts` (Mac vs iPhone texts), plus `selection.ts`, `disk.ts`,
  `tutorial.ts`, `mascot.ts` and `motion.ts`.
- `scripts/build.ts`: bundles the renderer as a browser script and copies the
  HTML and CSS to `dist/desktop/`, and writes the engine to `dist/engine/`.
  `dist/` is generated, so don't edit or commit it.
- `apple/`: the native Swift app. It runs the TypeScript engine in
  JavaScriptCore and, on macOS and iPhone, the web UI (`desktop/index.html`,
  `renderer.ts`, `style.css`) in a WKWebView, so Swift holds no rules, policy
  or UI of its own. `DevClean/WebShell.swift` is the shared shell
  (`window.devclean` over script messages, plus `platform`; long scans push `devclean-progress`
  events to the page). `DesktopWindow.swift` (`MacActions`:
  disk and Trash) and `PhoneWindow.swift` (`PhoneActions`: photo library and
  Recently Deleted) answer its calls. `desktop/platform.ts` holds the texts
  and buttons that differ per platform. `DevCleanKit/` has `Engine.swift` (the
  JavaScriptCore bridge), `NativeHost.swift` (the Host: POSIX calls plus a
  native `measure`, the hot loop, `storage`, and optional `photos` and `files`),
  `PhotoLibrary.swift` (PhotoKit: list, identity, delete, similar-photo analysis),
  `SimilarPhotos.swift` (Vision feature prints and scores, testable on the Mac),
  `PickedFolders.swift`
  (folders picked in the Files app, kept as bookmarks), `Cleanup.swift` (the trusted side:
  identities, tokens, Trash), `Bridge.swift` (validates page requests, builds
  replies and the confirmation) and `Report.swift`. The project uses a
  synchronized folder, so new files in `apple/DevClean/` need no project edits.
- Photo rules (`rules/*.json` with `photos` instead of `paths`) match items the
  host lists (`Host.photos()`, iPhone only) and report them as
  `photos://<localIdentifier>`, with the file name in `metadata.label`. File rules
  (`files`) do the same for files in folders picked in the Files app
  (`Host.files()`), with real paths. `report.storage` is the volume's space
  (`Host.storage()`), shown in the disk panel (`desktop/disk.ts`).

## Safety invariants (do not weaken)

This tool deletes things on users' machines. Treat these as hard rules:

1. The scanner decides **what exists**, and `core/policy.ts` decides **what may
   be moved**. A rule never grants cleanup. Cleanup needs an explicit,
   home-relative entry in `targets`/`reviewTargets` (or `projectOutputs` with a
   marker file) in `policy.ts`; photo and Files items need their rule in
   `photoTargets`/`fileTargets` and are always REVIEW (Files: regular files
   only). The trusted side (`apple/DevCleanKit/.../Cleanup.swift` and the
   `ShellActions` in `apple/DevClean/`) applies that policy and does the move. Identity checks and the move itself never run in
   the engine.
2. Cleanup only ever uses `FileManager.trashItem`. Never add permanent
   deletion (`removeItem`, `rm`, `unlink`) of user paths, and
   never empty the Trash. Photos only go through `PHAssetChangeRequest.deleteAssets`,
   which the system confirms and which keeps them in Recently Deleted; never
   empty that album.
3. Before trashing, each target is revalidated against the identity captured at
   scan time (realpath, dev, inode, mtime, ctime), and symlinks anywhere in the
   path are rejected. Keep `prepare` → `select` → `validate` → `moveToTrash`.
4. The page never sends paths. `WebShell.swift` only answers our page's main
   frame, and `BridgeRequest` accepts nothing but indices into the last report,
   its `cleanup_token` and `automatic === true`. Picked folders come only from the system
   picker (`addFolder`), and the iPhone only trashes files inside them.
5. The page stays sandboxed: a strict CSP and no remote content. It is served
   from the `devclean://` scheme (only the three UI files), can't navigate
   elsewhere and can't open windows.
6. Only the user's own clicks start cleanup. The confirmation dialog defaults to
   **Cancelar** (on the iPhone too, for Files items; photos get the system's own
   confirmation), and REVIEW items are never `auto_clean`. The iPhone has no
   automatic cleanup at all.

## Gotchas

- **`bun build` inlines `__dirname`, `__filename` and `import.meta.dirname` as
  the build machine's absolute paths.** `import.meta.dirname` is fine only in
  code that runs from source under Bun (CLI, tests, `core` defaults).
- The UI (`desktop/`, besides tests) runs in WKWebView: browser APIs only, no
  `node:` modules or `Bun.*`. `core/` must also run in JavaScriptCore, so it
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
   recreates it with no manual step. Add a label in `renderer.ts` `names` for a
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
  `feat(desktop): …`, `fix(scanner): …`, `refactor: …`.
- The user is the sole author. Don't add `Co-Authored-By` trailers or "Generated
  with" lines to commits or PRs.
- Don't push to `main` or `develop` directly, and don't delete branches without
  asking.
