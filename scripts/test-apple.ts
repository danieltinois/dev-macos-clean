// `bun run test:apple`: builds the engine bundle, then runs the DevCleanKit
// tests. swift-testing needs Xcode, so use it when xcode-select points at the
// Command Line Tools.
import fs from 'node:fs';
import path from 'node:path';
import {writeEngine} from './engine';

const XCODE = '/Applications/Xcode.app/Contents/Developer';
await writeEngine();
const env = {...process.env};
if (!env.DEVELOPER_DIR && fs.existsSync(XCODE)) env.DEVELOPER_DIR = XCODE;
const swift = Bun.spawnSync(['swift', 'test'], {cwd: path.resolve(import.meta.dirname, '..', 'apple', 'DevCleanKit'), env, stdio: ['inherit', 'inherit', 'inherit']});
process.exit(swift.exitCode);
