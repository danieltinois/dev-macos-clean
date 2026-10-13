// Shared test helpers. No test depends on the real machine home.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created: string[] = [];

// Create a file of exactly `size` bytes (sparse, fast).
// A file holding `size` real bytes (truncating would make it sparse, and sizes
// count what files take on disk).
export function makeFile(target: string, size: number): string {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, Buffer.alloc(size, 'x'));
  return target;
}

// Build a tree from {relativePath: sizeBytes}; null means an empty directory.
export function buildTree(base: string, spec: Record<string, number | null>) {
  for (const [rel, size] of Object.entries(spec)) {
    const target = path.join(base, rel);
    if (size === null) fs.mkdirSync(target, {recursive: true});
    else makeFile(target, size);
  }
}

// A fresh temporary directory, removed by removeTempDirs (register it with afterEach).
export function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devclean-test-')));
  created.push(dir);
  return dir;
}

export function removeTempDirs() {
  // Restore permissions a test may have removed, so cleanup can't fail.
  const restore = (target: string) => {
    try {fs.chmodSync(target, 0o755);} catch {return;}
    for (const entry of fs.readdirSync(target, {withFileTypes: true})) if (entry.isDirectory()) restore(path.join(target, entry.name));
  };
  for (const dir of created.splice(0)) {
    restore(dir);
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

// Root ignores directory permissions, so permission tests can't run as root.
export const isRoot = process.getuid?.() === 0;

// Make `dir` (inside a tempDir) unreadable for the rest of the test; removeTempDirs restores it.
export function block(dir: string) {
  fs.chmodSync(dir, 0o000);
}
