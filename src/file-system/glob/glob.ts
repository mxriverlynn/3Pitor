// Pattern search over any file system, written on top of list(), since no remote store can glob natively. It answers
// the way Bun.Glob's scan does over a folder on disk: unless `dot` is set, a hidden name is matched only by a pattern
// segment that itself starts with "." (a brace alternative that starts with "." does not count, as in scan).
import type { FileSystem } from '../file-system';
import { FileSystemError } from '../components/file-system-error';

// The file keys matching pattern, in no order. A folder the pattern cannot reach is never listed, so a hidden folder
// such as .git is not walked unless the pattern names it. Links and other non-regular entries are skipped. A folder
// that is missing or refused gives nothing; other errors propagate.
export async function glob(fileSystem: FileSystem, pattern: string, options: { dot?: boolean } = {}): Promise<string[]> {
  const parts = (pattern.startsWith('./') ? pattern.slice(2) : pattern).split('/');
  const dot = options.dot ?? false;
  const found: string[] = [];
  const walk = async (folder: string) => {
    const entries = await fileSystem.list(folder).catch((e: unknown) => {
      if (e instanceof FileSystemError) return [];
      throw e;
    });
    for (const { key, kind } of entries) {
      const segments = key.split('/');
      if (kind === 'file' && matches(parts, segments, dot, false)) found.push(key);
      else if (kind === 'folder' && matches(parts, segments, dot, true)) await walk(key);
    }
  };
  await walk('');
  return found;
}

// Whether the key's segments match the pattern's. With `partial`, whether some key under these segments could.
function matches(parts: string[], segments: string[], dot: boolean, partial: boolean, i = 0, j = 0): boolean {
  if (j === segments.length) return partial || parts.slice(i).every((part) => part === '**');
  if (i === parts.length) return false;
  const segment = segments[j];
  const hiddenAllowed = dot || !segment.startsWith('.');
  if (parts[i] === '**') {
    return (
      matches(parts, segments, dot, partial, i + 1, j) ||
      (hiddenAllowed && matches(parts, segments, dot, partial, i, j + 1))
    );
  }
  if (!(hiddenAllowed || parts[i].startsWith('.'))) return false;
  return new Bun.Glob(parts[i]).match(segment) && matches(parts, segments, dot, partial, i + 1, j + 1);
}
