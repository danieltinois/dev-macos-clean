// Everything the engine needs from the machine. core/ never touches the disk
// itself: core/node.ts implements this for the CLI and Electron, and the Swift
// apps implement it natively when they run the bundled engine.
export type EntryKind = 'file' | 'dir' | 'symlink' | 'other';
export interface Entry {name: string; kind: EntryKind}
export interface Info {kind: EntryKind; size: number; mtimeMs: number}
export interface Measurement {bytes: number; errors: number; truncated: boolean}
export interface SizeOptions {maxEntries?: number; maxDepth?: number}

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
}
