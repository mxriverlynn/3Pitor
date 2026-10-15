// The characters a new name loses: the ones Windows refuses in a name, which include both path separators, and the
// invisible control characters.
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

// The name a new folder gets from what was typed for it, such as a post's working title: no unsafe characters, and no
// spaces or dots at either end. It is "" when nothing usable is left.
export function newEntryName(typed: string): string {
  return typed.replace(UNSAFE, '').replace(/^[\s.]+|[\s.]+$/g, '');
}
