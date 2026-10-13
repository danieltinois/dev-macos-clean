// The trusted side of cleanup in the Electron main process: it applies the
// engine's policy (core/policy.ts), captures identities at scan time, issues
// report tokens and revalidates every target right before moving it to the Trash.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {nodeHost} from '../core/node';
import * as policy from '../core/policy';
import type {Finding, Report} from '../core';
import type {PolicyInput} from '../core/policy';

// The cleanup policy the main process decided for a finding.
interface CleanupFields {
  cleanup_allowed: boolean;
  cleanup_review: boolean;
  cleanup_reason: string;
  auto_clean: boolean;
}
export interface CleanupFinding extends Finding, CleanupFields {}
export interface CleanupReport extends Omit<Report, 'findings'> {findings: CleanupFinding[]; cleanup_token: string}
// Path -> identity captured by prepare(); a target must still match it when trashed.
export type Manifest = Map<string, string>;
export interface CleanupOutcome {moved: {path: string; size_bytes: number}[]; errors: {path: string; message: string}[]}

async function identity(target: string) {
  const resolved = path.resolve(target);
  if (resolved !== target) throw new Error('Caminho não canônico.');
  let current = resolved;
  while (true) {
    const info = await fs.lstat(current);
    if (info.isSymbolicLink()) throw new Error('Links simbólicos não podem ser limpos.');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() && !stat.isFile()) throw new Error('O alvo não é um arquivo nem um diretório.');
  return `${await fs.realpath(resolved)}:${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}`;
}
// Annotate every finding of `report` (a scanner report, or any object with findings) with its cleanup policy.
export async function prepare<R extends {findings: PolicyInput[]}>(report: R, home: string, appRoot: string, now = Date.now()):
  Promise<{report: Omit<R, 'findings'> & {findings: (R['findings'][number] & CleanupFields)[]; cleanup_token: string}; manifest: Manifest}> {
  const manifest: Manifest = new Map();
  const findings = await Promise.all(report.findings.map(async f => {
    let {allowed, review, reason} = policy.policy(nodeHost, f, home, appRoot);
    if (allowed) {
      try {manifest.set(f.path, await identity(f.path)); return {...f, cleanup_allowed:true, cleanup_review:review, cleanup_reason:'', auto_clean:!review && policy.isAutomatic(f, now)};}
      catch {reason = 'Caminho indisponível ou contém link simbólico. Analise novamente.';}
    }
    return {...f, cleanup_allowed:false, cleanup_review:false, cleanup_reason:reason!, auto_clean:false};
  }));
  return {report:{...report, findings, cleanup_token:crypto.randomUUID()}, manifest};
}
type Prepared = {path: string; size_bytes: number; cleanup_allowed: boolean};
export function select<F extends Prepared>(report: {findings: F[]; cleanup_token: string} | null, indices: unknown, token: unknown): F[] {
  if (!report || token !== report.cleanup_token) throw new Error('Relatório desatualizado. Analise novamente.');
  return policy.select(report.findings, indices);
}
export async function validate(selected: {path: string}[], manifest: Manifest) {
  for (const f of selected) {
    if (!manifest.has(f.path) || await identity(f.path) !== manifest.get(f.path)) throw new Error(`O diretório mudou desde a análise: ${f.path}. Analise novamente.`);
  }
}
export async function moveToTrash(selected: (PolicyInput & {size_bytes: number})[], manifest: Manifest, trashItem: (target: string) => Promise<unknown>): Promise<CleanupOutcome> {
  await validate(selected, manifest);
  const moved: CleanupOutcome['moved'] = [], errors: CleanupOutcome['errors'] = [];
  for (const f of selected) {
    try {
      await validate([f], manifest);
      const extra = policy.companions(nodeHost, f);
      await trashItem(f.path);
      manifest.delete(f.path);
      for (const file of extra) await trashItem(file).catch(() => {});
      moved.push({path:f.path, size_bytes:f.size_bytes});
    } catch (error) {errors.push({path:f.path, message:(error as Error).message});}
  }
  return {moved, errors};
}
export function remainingReport<R extends {findings: Pick<Finding, 'path' | 'severity' | 'category' | 'size_bytes'>[]}>(report: R, moved: {path: string}[]) {
  return {...policy.withoutMoved(report, moved), cleanup_token:crypto.randomUUID()};
}
