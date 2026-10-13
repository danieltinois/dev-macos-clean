// The disk panel: how the volume's space splits, and where DevClean's findings fit in it.
import type {Storage} from '../core/host';

export interface DiskParts {
  total: number;
  // In use by everything else: system, apps and files DevClean didn't flag.
  other: number;
  // Findings that sit on this volume (items only in iCloud don't).
  found: number;
  // What the system frees by itself when it needs room; null when unknown.
  purgeable: number | null;
  free: number;
  // Free space if every finding were cleaned and the Trash emptied.
  freeAfter: number;
}

export function diskParts(storage: Storage, found: number): DiskParts {
  const {total_bytes: total, free_bytes: free} = storage, purgeable = storage.purgeable_bytes ?? null;
  const used = Math.max(0, total - free - (purgeable ?? 0)), onDisk = Math.max(0, Math.min(found, used));
  return {total, other: used - onDisk, found: onDisk, purgeable, free, freeAfter: free + onDisk};
}

// Bytes of `byCategory` on this device: everything but the iCloud-only category.
export const foundOnDevice = (byCategory: Record<string, number>) =>
  Object.entries(byCategory).reduce((sum, [category, size]) => category === 'icloud' ? sum : sum + size, 0);
