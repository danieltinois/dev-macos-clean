// Pure filtering and quick-selection logic for the renderer (no DOM), so it can be tested.
import type {CleanupFinding} from './cleanup';

export interface Filters {query: string; category: string; severity: string}
export type Indexed = CleanupFinding & {index: number};

// Findings that pass the toolbar filters, each with its index in the report.
export function visible(findings: CleanupFinding[], {query, category, severity}: Filters): Indexed[] {
  const needle = query.toLowerCase();
  return findings.map((f, index) => ({...f, index})).filter(f =>
    (!category || f.category === category) && (!severity || f.severity === severity) && `${f.name} ${f.path}`.toLowerCase().includes(needle));
}

// Report indices of the cleanable `items` matching `predicate`. Shortest paths
// first: a folder already picked covers anything inside it.
export function pick(items: Indexed[], predicate: (f: CleanupFinding) => boolean): number[] {
  const picked: string[] = [], indices: number[] = [];
  for (const f of items.filter(f => f.cleanup_allowed && predicate(f)).sort((a, b) => a.path.length - b.path.length)) {
    if (picked.some(p => f.path.startsWith(p + '/'))) continue;
    picked.push(f.path); indices.push(f.index);
  }
  return indices;
}
