// The contract between the page and its native shell (apple/DevClean/WebShell.swift):
// what `window.devclean` offers and the report it hands over. The shell answers
// with the engine's report plus its own cleanup decisions and token.
import type {Finding, Report} from '../core/types';

// The cleanup decision the shell made for a finding (core/policy.ts plus identity checks).
export interface CleanupFinding extends Finding {
  cleanup_allowed: boolean;
  cleanup_review: boolean;
  cleanup_reason: string;
  auto_clean: boolean;
}
export interface CleanupReport extends Omit<Report, 'findings'> {findings: CleanupFinding[]; cleanup_token: string}
export interface CleanupOutcome {moved: {path: string; size_bytes: number}[]; errors: {path: string; message: string}[]}

// The API the page sees as `window.devclean`. It only takes indices into the last
// report plus its token, never paths.
export interface DevcleanBridge {
  // 'mac' or 'ios' (desktop/platform.ts).
  platform?: string;
  // Folders picked in the Files app, as labels (iPhone only). Adding opens the system picker.
  folders?(): Promise<string[]>;
  addFolder?(): Promise<string[]>;
  removeFolder?(index: number): Promise<string[]>;
  cleanup(indices: number[], token: string, automatic: boolean): Promise<{canceled: true} | (CleanupOutcome & {canceled?: undefined; report: CleanupReport})>;
  scan(): Promise<CleanupReport>;
  reveal(index: number): Promise<void>;
  exportReport(): Promise<boolean>;
}
