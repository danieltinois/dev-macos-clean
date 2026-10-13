<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/floco-dark.png" />
    <img src="assets/floco-light.png" width="220" alt="Floco, the DevClean cat" />
  </picture>
</p>

<h1 align="center">DevClean</h1>

<p align="center">
  <em>Floco, the mascot, sweeps up after your dev tools and guides you through the app on first launch.</em>
</p>

Analyze macOS developer storage: **what** is using space, **which tool** created
it, **how much** it uses, **whether** it can be recreated, **how risky** it is to
remove, and **how** to recreate it afterwards.

DevClean is not another generic macOS cleaner. It understands development
environments — Xcode DerivedData, iOS simulators, Android SDK images and AVDs,
Gradle caches, `node_modules`, package manager caches, and (in later phases)
Docker, Flutter, Python, Rust, Homebrew and JetBrains artifacts.

> **Status: scanner + native Swift apps (macOS and iPhone) with recoverable cleanup.**
> The engine is written in TypeScript and developed with Bun — no Python, no runtime
> dependencies. The CLI only analyzes. The Mac app can move selected, known
> regenerable caches to the macOS Trash after confirmation; it never empties Trash.

## Philosophy

- **Scan broadly, delete narrowly.** The scanner may look in many places; any
  future destructive operation will be extremely restricted.
- **Declarative rules first.** Most scanners are just data: a JSON file
  describing where to look, the risk, and how the artifact can be recreated.
  Specialized code is the exception, registered per rule id.
- **Core independent of UI.** `core/` is pure domain logic with no UI or
  terminal code. The CLI and the Swift apps consume the same core and the
  same stable report contract.
- **Bytes are the only truth.** All sizes are stored in bytes; human formatting
  happens only at the presentation layer.

## Safety model

Every finding is classified:

| Severity | Meaning | Examples |
| --- | --- | --- |
| `SAFE` | Known regenerable artifact/cache, low removal risk | `node_modules`, DerivedData, Gradle cache, package manager caches |
| `REVIEW` | SDK, runtime, simulator, image or environment that may still be needed | Android system images, AVDs (contain user app data) |
| `DANGER` | Potentially contains important user data, or unknown impact | (reserved; nothing is classified here yet) |

In this phase the declarative `severity` in each rule is authoritative. The
analyzer's `classify()` hook exists to escalate severity based on environment
context (e.g. an SDK another tool depends on) without touching rule files.

## Architecture

```
dev-macos-clean/
├── package.json            # scripts (build, scan, test, typecheck, test:apple), `devclean` bin
├── tsconfig.json           # strict TypeScript, type-checked with `tsc --noEmit`
├── scripts/build.ts        # bundles the engine into dist/ for the Swift apps
├── scripts/engine.ts       # bundles core/ + rules/ into dist/engine/ for the Swift apps
├── rules/                  # one declarative rule per JSON file (data, not code)
│   ├── node-modules.json
│   ├── xcode-derived-data.json
│   └── ...
├── core/                   # the engine: no UI, never deletes, no disk access of its own
│   ├── index.ts            # public API on this machine: loadRules, scan, formatBytes, formatAgo
│   ├── engine.ts           # portable entry point (no Node APIs), for JavaScriptCore
│   ├── host.ts             # Host: the disk operations the engine asks for
│   ├── node.ts             # the Node host (fs) used by the CLI and tests
│   ├── jsc.ts              # JavaScriptCore entry for the Swift apps (rules embedded)
│   ├── paths.ts            # POSIX path helpers (node:path semantics)
│   ├── rules.ts            # JSON -> rules + strict validation
│   ├── filesystem.ts       # dirSize, bounded walk, glob/fnmatch, excludes, symlink safety
│   ├── scanner.ts          # discovery -> measurement -> classification -> report
│   ├── analyzer.ts         # per-rule enrichers + totals
│   ├── policy.ts           # cleanup policy: allowlist, review, automatic cleanup
│   ├── format.ts           # human formatting (bytes, relative time)
│   ├── types.ts            # Rule, Finding and Report types (the JSON contract)
│   ├── test-support.ts     # temp trees for tests
│   └── *.test.ts
├── cli/
│   ├── devclean.ts         # `devclean scan` (human text or --json)
│   └── devclean.test.ts
└── apple/                  # Swift apps for macOS and iPhone (see below)
    ├── DevClean/           # the SwiftUI interface, Floco, Mac and iPhone actions
    └── DevCleanKit/        # engine bridge, native host, cleanup, photos, Files folders, UI logic
```

Bun runs the CLI and the tests straight from the `.ts` sources. `bun run build`
bundles the engine (with the rules embedded) for JavaScriptCore in `dist/`; an
Xcode build phase copies it into the app.

How a scan flows through the Mac app:

1. The SwiftUI interface asks `AppModel` to scan, which calls `MacActions`.
2. It runs the bundled engine in JavaScriptCore off the main thread, with
   `NativeHost` doing the disk access: `scan(rules, {globalScan: true})`.
3. `Cleanup.prepare` marks each finding `cleanup_allowed` / `cleanup_review` /
   `auto_clean` from `core/policy.ts` and records the identity (realpath, device,
   inode, mtime, ctime) of every cleanable path.
4. On cleanup, the selection is checked again (token, allowlist, identity,
   no symlinks), confirmed in a native dialog, and moved to the Trash.

The scanner (`rules/` + `core/`) decides **what exists**; `core/policy.ts`
decides **what may be moved**. The two are separate on purpose: a broad or
mistaken rule can make the scanner show more, but never makes the app delete more.

### Rule schema

```json
{
  "id": "xcode-derived-data",
  "name": "Xcode Derived Data",
  "category": "xcode",
  "severity": "SAFE",
  "reclaimable": true,
  "description": "Build products, module caches and build logs generated by Xcode at build time.",
  "paths": ["~/Library/Developer/Xcode/DerivedData"],
  "rebuild": {
    "description": "Xcode regenerates this automatically the next time a project is built.",
    "commands": []
  }
}
```

- `id`, `category` — slugs `[a-z0-9-]`; `category` groups rules and filters `--category`.
- `severity` — `SAFE` | `REVIEW` | `DANGER` (see safety model).
- `reclaimable` — can the content be recreated?
- `rebuild` — how to recreate it. Informational only, commands are never executed.

Discovery primitives:

- `paths` — probed directly, no walking. Supports `~`, `$ENV`, and globs
  (e.g. `~/.android/avd/*.avd` yields one finding per AVD).
- `patterns` — discovered by a bounded walk for templates like `**/node_modules`.
- `markers` — optional, for `patterns` only: the match counts only when its
  parent directory contains one of these files (e.g. `target` next to `Cargo.toml`).

Rule files are strictly validated (unknown keys are rejected, ids must be
unique slugs, severity must be one of the three values, at least one of
`paths`/`patterns` required). **Contributors add scanners by dropping in a JSON
file** — no code changes needed. Specialized logic registers by rule id in
`core/analyzer.ts` (see `ENRICHERS`, e.g. `node-modules`).

## Installation (development)

Requires [Bun](https://bun.sh) 1.2+, and Xcode for the Swift apps.

```bash
bun install
bun test
bun run typecheck
```

## Usage

`bun run scan` runs the CLI from the checkout (`bun link` installs a global
`devclean` command if you prefer).

```bash
devclean scan                          # scan the home directory
devclean scan ~/Developer              # scan extra directories too
devclean scan --category node          # only node rules
devclean scan --category android
devclean scan --category xcode
devclean scan --exclude '*/vendor/*'   # skip paths matching a glob
devclean scan --global                 # whole local disk, like the app
devclean scan --json                   # stable machine-readable contract
```

Example output:

```
 ____  _______     ______ _     _____    _    _   _
|  _ \| ____\ \   / / ___| |   | ____|  / \  | \ | |
| | | |  _|  \ \ / / |   | |   |  _|   / _ \ |  \| |
| |_| | |___  \ V /| |___| |___| |___ / ___ \| |\  |
|____/|_____|  \_/  \____|_____|_____/_/   \_\_| \_|

developer storage analyzer · macOS

Node.js ────────────────────────────────────────────

Node.js dependencies — /Users/me/Developer/project-a/node_modules
  Size:      ██░░░░░░░░░░░░░░  2.4 GB
  Modified:  3 months ago
  Risk:      SAFE
  Rebuild:   Run the project's install command (npm install, pnpm install, yarn install, bun install).
  project:         /Users/me/Developer/project-a
  package.json:    yes
  lockfile:        package-lock.json
  package_manager: npm

Xcode ──────────────────────────────────────────────

Xcode Derived Data — /Users/me/Library/Developer/Xcode/DerivedData
  Size:      ██████████░░░░░░  18.7 GB
  Modified:  1 day ago
  Risk:      SAFE
  Rebuild:   Xcode regenerates this automatically the next time a project is built.

By category ────────────────────────────────────────
  Android  ████████████████████████  31.2 GB
  Node.js  ██░░░░░░░░░░░░░░░░░░░░░░  2.4 GB
  Xcode    ██████████████░░░░░░░░░░  18.7 GB

By risk ────────────────────────────────────────────
  SAFE:    ████████████████░░░░░░░░  21.1 GB
  REVIEW:  ████████████████████████  31.2 GB
  DANGER:  ░░░░░░░░░░░░░░░░░░░░░░░░  0 B

────────────────────────────────────────────────────
Detected: 52.3 GB (12 finding(s))

DevClean only analyzes storage. Nothing was deleted.
```

### JSON contract (`devclean scan --json`)

Stable shape, also what the apps receive (`schema_version: 1`):

```json
{
  "schema_version": 1,
  "scanned_at": "2026-09-24T12:00:00Z",
  "roots": ["/Users/me"],
  "options": {"max_depth": 6, "max_findings": 500, "excludes": [], "categories": []},
  "totals": {
    "findings": 12,
    "bytes": 56119758848,
    "by_severity": {"SAFE": 22649274368, "REVIEW": 33470484480, "DANGER": 0},
    "by_category": {"node": 5461336064, "xcode": 20078739456, "android": 30583271424}
  },
  "findings": [
    {
      "rule_id": "node-modules",
      "name": "Node.js dependencies",
      "category": "node",
      "severity": "SAFE",
      "reclaimable": true,
      "description": "Installed dependency trees of Node.js projects...",
      "path": "/Users/me/Developer/project-a/node_modules",
      "size_bytes": 2576980377,
      "size_complete": true,
      "last_modified": "2026-06-24T10:00:00Z",
      "rebuild": {"description": "Run the project's install command...", "commands": []},
      "metadata": {"project": "/Users/me/Developer/project-a", "package.json": "yes", "lockfile": "package-lock.json", "package_manager": "npm"}
    }
  ],
  "warnings": []
}
```

## Performance decisions (documented)

- **Explicit paths are probed, not walked.** Pattern discovery is the only
  thing that walks, and it is a bounded BFS: `max_depth` (default 6) from the
  home directory, with caps on visited directories (25,000) and findings (500).
- **Never enters**: hidden dirs (`.git` included), symlinks (loop-proof),
  `Library`, `Applications`, `Music`, `Movies`, `Pictures`, `node_modules`,
  `Pods`, `DerivedData`, `build`, `target`.
- **`node_modules` is matched and then not re-entered** — nested copies are
  intentionally invisible.
- **Size**: `dirSize` walks with `readdir`, never follows symlinks, counts
  per-entry permission errors and continues, and caps entries per directory
  (500,000). A capped measurement is reported as `size_complete: false`.
  Each file counts the smaller of its size and its allocated blocks, so sparse
  files (a VM disk image such as `Docker.raw`, which declares hundreds of GB)
  count what they really take on disk, while small files keep their exact size.
- **`last_modified`** is the mtime of the directory itself (a cheap proxy for
  "last used") — computing the newest mtime inside would be much slower.
- **One problematic directory never aborts a scan**: permission and IO errors
  are logged and collected in `report.warnings`, when meaningful.
- Scans are synchronous and sequential on a background task, so the app stays
  responsive. Parallelism is deliberately deferred — the walk caps already bound
  the work.

## Roadmap

- **Phase 1 (complete)** — Core scanner + CLI. Rules for Node.js, Xcode (DerivedData)
  and Android (Gradle cache, system images, AVDs). Analysis only, no deletion.
- **Phase 2 (complete)** — Selected known regenerable caches moved to Trash
  after native confirmation, with path and identity validation.
- **Phase 3 (complete)** — Desktop interface, first in Electron, now in native
  Swift apps for macOS and iPhone that run the same TypeScript engine. Python
  scanner ported to Node, then to TypeScript on Bun.
- **Phase 4** — Advanced scanners: Docker, Flutter, Python (venvs, pip cache),
  Rust `target`, Maven, Homebrew, JetBrains, VSCode.
- **Phase 5** — Developer Storage Intelligence: old project detection,
  regenerable artifact identification, stale SDKs/runtimes, duplicate versions,
  recoverable-space estimates and per-item consequences of cleanup.

## Limitations

- Global discovery covers supported artifact categories on the local disk; it is
  bounded and excludes protected system directories and external volumes.
- Measurements are scans: close to `du`, but small files count their exact size
  rather than whole blocks, and hard links or APFS clones count once per path.
- CLI is analysis only. The Mac app's cleanup uses the Trash for authorized
  artifacts; no permanent deletion, symlink following or parallel scanning.

## macOS app

A local interface in Brazilian Portuguese that runs the `core/` scanner inside
the native Swift app. It offers search, filters by tool and risk, sorting,
rebuild details, Show in Finder, JSON export and cleanup of known caches through
the Trash.

### Quick start

```bash
bun install
open apple/DevClean.xcodeproj   # pick "My Mac" and run; the app scans as it opens
```

On first launch, Floco (the cat mascot) gives a guided tour of the app and only
then runs the first scan; to see the tour again, use **Tutorial** at the top. On
later launches, the app scans the Mac as soon as it opens. Then:

- **Limpeza automática** (automatic cleanup) — one click (plus the macOS
  confirmation) moves to the Trash only what recreates itself, with no manual
  step and no local work: DerivedData, Simulator caches, CocoaPods, Homebrew, pip,
  npm, pnpm, Yarn, Bun, Go build, Gradle, Gradle Wrapper, pub cache, and
  `node_modules`/`target` of projects untouched for 90+ days.
- **Selecionar tudo** (select all) — marks everything that may go to the Trash:
  the low-risk items outside automatic cleanup (active projects, IDE caches,
  Device Support, Playwright, Go modules, Cargo registry) and the **Revisar**
  (review) items that can be moved safely (app caches and logs, Android system
  images, AVDs, Xcode Archives, Maven repository). The confirmation lists the
  review items separately. Items inside an already selected folder are skipped.
- Still blocked, with the reason on the row itself: the whole Downloads folder,
  the Docker disk, Simulators (use the commands in Details), global packages,
  folders macOS didn't let it read completely, and DevClean's own files.

Then empty the Trash to free the space.

Without the interface: `bun run scan` (or `bun run scan --category xcode`).

## Native Swift apps (macOS and iPhone)

`apple/` holds a native Swift version, a single project for Mac and iPhone. It
runs the **same TypeScript engine** from `core/` inside JavaScriptCore, with the
rules from `rules/` embedded: Swift handles disk access and moving items to the
Trash, and TypeScript decides what each item is and what may be cleaned.

- **Mac** — a native SwiftUI interface (Floco, tutorial, animations), shared
  with the iPhone. It scans the disk and cleans
  through the Trash with the same rules: a confirmation that defaults to
  **Cancelar**, revalidation of every path before moving it, and no permanent
  deletion.
- **iPhone** — the same interface, adapted to the phone screen. iOS gives no
  access to the disk or to other apps' data, so the iPhone app scans the **whole
  photo library**: videos of 50 MB or more, photos of 15 MB or more (ProRAW,
  panoramas), byte-identical copies (checked by content hash), **similar photos**
  (retakes of the same moment, compared on the device with Apple's Vision;
  favorites or the best-rated one stay), screenshots, screen recordings and extra
  burst frames.
  Like other cleaner apps it lists items whose original is **only in iCloud**
  too, since deleting them frees iCloud space, but marks them with ☁, counts
  them apart ("No iPhone" vs "só no iCloud") and leaves them out of the disk
  panel; **Só o que ocupa o iPhone** in the filters hides them. iOS has no public
  flag for this, so the app reads the start of each original with downloads off
  to tell. For items both on the iPhone and in iCloud, it points to **Optimize
  iPhone Storage**, which removes the original from the iPhone without deleting it.
  **Revisar fotos** (review photos) lists each set (copies, burst extras, similar
  photos, big videos, screenshots…) and opens it full screen: a grid of
  thumbnails, with copies and similar photos grouped around the one that stays,
  or a quick mode that shows one photo at a time (swipe left to delete, right to
  keep). Copies, burst extras and similar photos start selected; nothing is
  cleaned automatically. Whatever is picked goes in one go: iOS asks for its own
  confirmation, and items go to **Photos › Recently Deleted** for 30 days. With
  limited photo access, the app only sees the photos you allowed.
  **Abrir para conferir** (open to check) in the details opens the item in Quick Look.
  The slow steps (measuring items, comparing similar photos, hashing possible
  copies) run on every core, and what they learn about each photo is kept between
  scans, so later scans only work on new or edited photos.
  With **+ Pasta do Arquivos** (add a Files folder) you pick one or more folders
  from the Files app; picking **On My iPhone** and **iCloud Drive** covers
  everything iOS lets an app see, including the folders other apps share there.
  It looks for files of 50 MB or more, duplicate files (same content hash,
  whatever the name), caches and temporary files of apps, installers and archives
  (`.zip`, `.ipa`, `.dmg`…), log files and downloads older than 30 days. These are
  always for review and go to **Recently Deleted** in the Files app, after a
  confirmation that defaults to Cancelar. iOS doesn't let any app see other apps'
  private data, their caches or System Data.
- **Mac and iPhone** — a panel shows the disk space: what is in use, what
  DevClean found, what the system frees by itself (Swift app only), and how much
  is free now and after cleanup. The CLI also shows free space.

```bash
open apple/DevClean.xcodeproj          # pick "My Mac" or an iPhone and run
bun run test:apple                     # builds the engine and runs the Swift tests
```

Building in Xcode needs Bun installed: a build phase builds `devclean-engine.js`
(`core/`) and copies it into the app. To
run on a real iPhone, select your team in *Signing & Capabilities*.
The Mac app doesn't use App Sandbox (it needs to read the whole disk) and needs
**Full Disk Access** to measure some folders.

### What is detected

| Tool | One-click cleanup (low risk) | Review only |
| --- | --- | --- |
| Xcode / iOS | DerivedData, Device Support, Simulator caches, CocoaPods | Simulators (`xcrun simctl delete unavailable`), Archives |
| Node.js | `node_modules`, npm, pnpm, Yarn, Bun, Playwright browsers | |
| Android / Java | Gradle caches, Gradle Wrapper | System images, AVDs, Maven repository |
| Rust / Go / Python / Dart | `target/` of Cargo projects, Cargo registry, Go build and modules, pip, pub cache | |
| IDEs / other | JetBrains and Android Studio caches, Homebrew | Docker (`docker system prune`), app caches, logs, Downloads |
| iPhone (photos and Files) | | Identical photo copies, extra burst frames, large videos and photos, similar photos, screenshots, screen recordings, large and duplicate files, app caches, installers, logs, old downloads |

To add a new tool, add a JSON file in `rules/` and, if its cleanup is low risk,
its fixed path in `core/policy.ts`.

The app scans the local disk globally: user folders, projects and known caches,
plus Downloads and logs for review. There is no folder picker on the Mac. The
scanner stays bounded in depth, directories and results; system areas
(`/System`, `/usr`, `/private`, `/bin`, `/sbin`, `/dev`) and external volumes are
not walked. Hidden folders and heavy directories follow the discovery excludes,
with known hidden caches checked through explicit paths. Access depends on macOS
permissions, and warnings point out partial results. The CLI offers
`devclean scan --global` for the same discovery.

Select regenerable items and use **Enviar à Lixeira** (move to Trash). The native
confirmation lists the paths and the size. App caches, logs, SDKs and AVDs can be
selected by hand but never join automatic cleanup. DevClean's own files are
protected. Paths and directory identities are revalidated before cleanup;
symlinks, stale reports and unauthorized targets are rejected. Close builds and
tools before cleaning their dependencies.

**Moving to the Trash doesn't free disk space right away.** Restore from the
Finder if needed; emptying the Trash is up to the user. Partial failures are
shown, and the items that failed stay in the report.

The interface is native SwiftUI with no web content. It hands the trusted side
only indices into the last report plus its token, never paths; paths sent to the
Finder come only from that report. There is no HTTP server and nothing remote.

This version is built from the checkout with Xcode; it doesn't ship a `.dmg`
installer, signing or notarization yet.

Validation: `bun test` (core and CLI), `bun run typecheck` and
`bun run test:apple` (Swift).

Mascot: ASCII cat generated by `scripts/cat-art.ts` from the photo
["Domestic Cat White"](https://commons.wikimedia.org/wiki/File:Domestic_Cat_White.JPG)
by JMG2JMG, in the public domain (Wikimedia Commons).
