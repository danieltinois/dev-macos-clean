// Shared data shapes: the rule schema and the report contract (schema_version 1).
export type Severity = 'SAFE' | 'REVIEW' | 'DANGER';

export interface Rebuild {
  description: string;
  commands: string[];
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
}
