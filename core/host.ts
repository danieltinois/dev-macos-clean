// Everything the engine needs from the machine. core/ never touches the disk
// itself: core/node.ts implements this for the CLI and tests, and the Swift
// apps implement it natively when they run the bundled engine.
export type EntryKind = 'file' | 'dir' | 'symlink' | 'other';
export interface Entry {name: string; kind: EntryKind}
// `size` is what the file says it holds; `allocated` is what it takes on disk
// (st_blocks * 512), when the host knows. Sparse files (a VM disk image) hold far
// less than their size, and compressed ones too.
export interface Info {kind: EntryKind; size: number; mtimeMs: number; allocated?: number}
export interface Measurement {bytes: number; errors: number; truncated: boolean}
export interface SizeOptions {maxEntries?: number; maxDepth?: number}

// One photo library item, as the host lists it (core/scanner.ts matches rules).
export interface PhotoAsset {
  id: string;
  // File name shown to the user, e.g. IMG_0042.MOV.
  name: string;
  media: 'image' | 'video' | 'other';
  subtypes: ('screenshot' | 'screen-recording')[];
  // `key`: the burst's representative or a picked frame; `extra`: any other frame.
  burst: 'none' | 'key' | 'extra';
  // null when the platform can't tell.
  bytes: number | null;
  created_ms: number;
  // Whether the original is stored on this device (false: only in iCloud, the
  // device keeps a light version) and whether it is in iCloud Photos. null: unknown.
  local: boolean | null;
  cloud: boolean | null;
  // Pixel size and duration (0 for photos), to spot exact copies.
  width: number;
  height: number;
  duration_ms: number;
  // Image analysis, on hosts that do it (the iPhone): photos that look alike and
  // were taken together share a `similar` group; `score` rates how good a photo
  // is (higher is better). Favorites are never offered as similar photos.
  favorite?: boolean;
  similar?: string | null;
  score?: number | null;
  // SHA-256 of the content, on hosts that hash possible copies (the iPhone does
  // it for items that match another in kind, size and bytes). null: not readable.
  digest?: string | null;
}

// One file in a folder the user picked in the Files app (iPhone).
export interface FileItem {
  // Canonical absolute path.
  path: string;
  // Where it is, as the Files app shows it, e.g. iCloud Drive › Downloads › a.zip.
  label: string;
  bytes: number;
  modified_ms: number;
  // Whether the content is on this device (false: only in iCloud Drive) and
  // whether it is in iCloud Drive. null: unknown.
  local: boolean | null;
  cloud: boolean | null;
  // SHA-256 of the content, for files that share their size with another one. null: not readable.
  digest?: string | null;
}

// Space on the volume that holds the home folder. `purgeable_bytes` is what the
// system can free by itself (caches, iCloud originals); null when unknown.
export interface Storage {total_bytes: number; free_bytes: number; purgeable_bytes: number | null}

export interface Host {
  // Entries of a directory, in any order, without following them. `path` itself
  // is followed if it is a symlink. Throws an Error whose message ends up in warnings.
  readdir(path: string): Entry[];
  // Info of the path itself (symlinks not followed), or null if it can't be read.
  lstat(path: string): Info | null;
  // Info following symlinks, or null.
  stat(path: string): Info | null;
  realpath(path: string): string | null;
  env(name: string): string | undefined;
  home(): string;
  cwd(): string;
  // Optional native fast path with the semantics of filesystem.measure().
  measure?(path: string, options: SizeOptions): Measurement;
  // The photo library, on hosts that have one (the iPhone app). Throws an
  // Error whose message ends up in warnings, e.g. when access was denied.
  photos?(): PhotoAsset[];
  // Files in the folders the user picked, on hosts that have them (the iPhone app).
  files?(): FileItem[];
  // Space on the volume that holds `path`.
  storage?(path: string): Storage;
}
