// Shared test helpers. No test depends on the real machine home.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Create a file of exactly `size` bytes (sparse, fast).
function makeFile(target, size) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, '');
  fs.truncateSync(target, size);
  return target;
}

// Build a tree from {relativePath: sizeBytes}; null means an empty directory.
function buildTree(base, spec) {
  for (const [rel, size] of Object.entries(spec)) {
    const target = path.join(base, rel);
    if (size === null) fs.mkdirSync(target, {recursive: true});
    else makeFile(target, size);
  }
}

// A fresh temporary directory, removed when the test ends.
function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devclean-test-')));
  t.after(() => {
    // Restore permissions a test may have removed, so cleanup can't fail.
    const restore = target => {
      try {fs.chmodSync(target, 0o755);} catch {return;}
      for (const entry of fs.readdirSync(target, {withFileTypes: true})) if (entry.isDirectory()) restore(path.join(target, entry.name));
    };
    restore(dir);
    fs.rmSync(dir, {recursive: true, force: true});
  });
  return dir;
}

// Make `dir` (inside a tempDir) unreadable for the rest of the test; skips when running as root.
function block(t, dir) {
  if (process.getuid?.() === 0) return t.skip('root ignores directory permissions'), false;
  fs.chmodSync(dir, 0o000); // tempDir's cleanup restores it
  return true;
}

module.exports = {makeFile, buildTree, tempDir, block};
