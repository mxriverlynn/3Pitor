// Keys: workspace-relative, "/"-separated paths. Every file-system method checks its keys against one strict grammar,
// the same for every backend, so no backend can be handed a path that climbs out of the workspace.
import { posix } from 'node:path';
import { FileSystemError } from './file-system-error';

// A key is "" (the root) or segments joined by "/". A segment is not empty, not "." or "..", and holds no "/", "\",
// or NUL. The root is accepted only where allowRoot is set. Keys are never rewritten here.
export function checkKey(key: string, options: { allowRoot?: boolean } = {}): void {
  if (key === '' && options.allowRoot) return;
  const valid = key.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && !/[\\\0]/.test(s));
  if (!valid) throw new FileSystemError('invalid', `${JSON.stringify(key)} is not a valid key`);
}

// Only for loose, untrusted input such as a path the model typed ("./notes.md", "a/../b.md"). Browser keys never pass
// through it, so they are refused rather than rewritten. The canonical form is what gets checked, so a path that only
// looks safe before normalizing cannot slip through.
export function normalizeKey(input: string): string {
  let key = posix.normalize(input);
  if (key.endsWith('/')) key = key.slice(0, -1);
  if (key === '.') key = '';
  if (posix.isAbsolute(key) || key === '..' || key.startsWith('../')) {
    throw new FileSystemError('invalid', `${input} is outside the workspace`);
  }
  checkKey(key, { allowRoot: true });
  return key;
}

// The folder that holds a key: "a/b/c.md" → "a/b", and "c.md" → "" (the root).
export function parentKey(key: string): string {
  const slash = key.lastIndexOf('/');
  return slash === -1 ? '' : key.slice(0, slash);
}
