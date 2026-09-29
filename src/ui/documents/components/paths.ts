// Workspace-relative paths, as the documents API names files and folders ("drafts/2026/soil.md").

// True when `p` is `root` or inside it; "drafts-old.md" is not inside "drafts".
export const within = (p: string, root: string) => p === root || p.startsWith(root + '/');

// The path `p` has after moving `from` to `to`, or undefined when the move does not touch it.
export function movedPath(p: string, from: string, to: string): string | undefined {
  return within(p, from) ? to + p.slice(from.length) : undefined;
}
