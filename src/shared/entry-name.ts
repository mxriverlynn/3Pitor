// The characters a new name loses: the ones Windows refuses in a name, which include both path separators, and the
// invisible control characters.
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

// The name a new file or folder gets from what was typed for it: no unsafe characters, no spaces or dots at either end,
// and for a file exactly one ".md". It is "" when nothing usable is left. The end is trimmed before a typed ".md" in any
// case comes off, so "foo.md." and "x.MD " lose it rather than doubling it, and both ends after, so "notes .md" does not
// keep its space.
export function newEntryName(typed: string, kind: 'file' | 'folder'): string {
  let name = typed.replace(UNSAFE, '').replace(/^\s+|[\s.]+$/g, '');
  if (kind === 'file') name = name.replace(/\.md$/i, '');
  name = name.replace(/^[\s.]+|[\s.]+$/g, '');
  return kind === 'file' && name ? `${name}.md` : name;
}
