// POSIX path helpers with node:path semantics, so the engine needs no Node
// modules and can run inside JavaScriptCore (the Swift apps).
export const sep = '/';

export function isAbsolute(value: string): boolean {return value.startsWith('/');}

// path.normalize: collapse `//`, `.` and `..`; keep a leading and a trailing `/`.
export function normalize(value: string): string {
  if (!value) return '.';
  const absolute = isAbsolute(value), trailing = value.endsWith('/');
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!absolute) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  let result = (absolute ? '/' : '') + parts.join('/');
  if (!result) return absolute ? '/' : '.';
  if (trailing && result !== '/') result += '/';
  return result;
}

export function join(...parts: string[]): string {
  const joined = parts.filter(Boolean).join('/');
  return joined ? normalize(joined) : '.';
}

// path.resolve against `cwd`, without a trailing `/`.
export function resolve(cwd: string, ...parts: string[]): string {
  let result = '';
  for (const part of [cwd, ...parts]) {
    if (!part) continue;
    result = isAbsolute(part) ? part : `${result}/${part}`;
  }
  const normalized = normalize(result || '/');
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function trimTrailing(value: string) {
  let end = value.length;
  while (end > 1 && value[end - 1] === '/') end--;
  return value.slice(0, end);
}

export function basename(value: string): string {
  const trimmed = trimTrailing(value);
  if (trimmed === '/') return '';
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

export function dirname(value: string): string {
  const trimmed = trimTrailing(value);
  const slash = trimmed.lastIndexOf('/');
  if (slash === -1) return '.';
  return slash === 0 ? '/' : trimmed.slice(0, slash);
}
