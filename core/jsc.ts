// The JavaScriptCore entry point, bundled into the Swift apps as
// dist/engine/devclean-engine.js (see scripts/build.ts). It installs
// globalThis.DevCleanEngine. Data crosses the bridge as JSON strings; the app
// passes its native Host. Rule files are embedded at build time.
import * as engine from './engine';
import type {Host} from './host';
import type {RuleFile} from './rules';
import type {Finding, Report} from './types';

declare const DEVCLEAN_RULE_FILES: RuleFile[];

let rules: ReturnType<typeof engine.parseRules> | null = null;
const loaded = () => rules ??= engine.parseRules(DEVCLEAN_RULE_FILES);

const DevCleanEngine = {
  version: 1,
  ruleCount: () => loaded().length,
  // Scan the host with the embedded rules. `options` is ScanOptions as JSON.
  scan(host: Host, options: string): string {
    return JSON.stringify(engine.scan(host, loaded(), JSON.parse(options)));
  },
  // Cleanup decision for every finding of `report`: [{allowed, review, reason, auto}].
  decide(host: Host, report: string, home: string, appRoot: string, now: number): string {
    const {findings} = JSON.parse(report) as Report;
    return JSON.stringify(findings.map(finding => {
      const {allowed, review, reason = ''} = engine.policy.policy(host, finding, home, appRoot);
      return {allowed, review, reason, auto: allowed && !review && engine.policy.isAutomatic(finding, now)};
    }));
  },
  // The selected findings (as JSON), or throws when the selection is not allowed.
  select(findings: string, indices: string): string {
    return JSON.stringify(engine.policy.select(JSON.parse(findings), JSON.parse(indices)));
  },
  companions(host: Host, finding: string): string {
    return JSON.stringify(engine.policy.companions(host, JSON.parse(finding) as Finding));
  },
  // `report` without the moved paths, with fresh totals.
  remaining(report: string, moved: string): string {
    return JSON.stringify(engine.policy.withoutMoved(JSON.parse(report), (JSON.parse(moved) as string[]).map(path => ({path}))));
  },
};

(globalThis as {DevCleanEngine?: typeof DevCleanEngine}).DevCleanEngine = DevCleanEngine;
