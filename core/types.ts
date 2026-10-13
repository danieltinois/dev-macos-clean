// Shared data shapes: the rule schema and the report contract (schema_version 1).
import type {Storage} from './host';

export type Severity = 'SAFE' | 'REVIEW' | 'DANGER';

export interface Rebuild {
  description: string;
  commands: string[];
}

// Criteria a photo library item must meet (all given ones). See rules.ts.
export interface PhotoMatch {
  media?: 'image' | 'video';
  subtype?: 'screenshot' | 'screen-recording';
  // `extra`: a burst frame that is neither the key photo nor picked.
  burst?: 'extra';
  // `extra`: an exact copy of an older item (same kind, pixel size, duration and bytes).
  duplicate?: 'extra';
  // `extra`: a photo that looks like a better one taken at the same moment.
  similar?: 'extra';
  min_bytes?: number;
  min_age_days?: number;
}

// Criteria a file from a picked folder must meet (all given ones). See rules.ts.
export interface FileMatch {
  // A folder with this name anywhere in the file's path, e.g. Downloads.
  folder?: string;
  min_bytes?: number;
  min_age_days?: number;
}

export interface Rule {
  id: string;
  name: string;
  category: string;
  severity: Severity;
  reclaimable: boolean;
  description: string;
  paths: string[];
  patterns: string[];
  markers: string[];
  // Photo library rules match items the host lists instead of paths.
  photos: PhotoMatch | null;
  // File rules match files in folders the user picked (iPhone).
  files: FileMatch | null;
  rebuild: Rebuild | null;
}

export interface Finding {
  rule_id: string;
  name: string;
  category: string;
  severity: Severity;
  reclaimable: boolean;
  description: string;
  path: string;
  size_bytes: number;
  size_complete: boolean;
  last_modified: string | null;
  rebuild: Rebuild | null;
  metadata: Record<string, string>;
}

export interface Totals {
  findings: number;
  bytes: number;
  by_severity: Record<Severity, number>;
  by_category: Record<string, number>;
}

export interface Report {
  schema_version: number;
  scanned_at: string;
  roots: string[];
  options: {global_scan: boolean; max_depth: number; max_findings: number; excludes: string[]; categories: string[]};
  totals: Totals;
  findings: Finding[];
  warnings: string[];
  // Space on the scanned volume, when the host can tell.
  storage: Storage | null;
}
