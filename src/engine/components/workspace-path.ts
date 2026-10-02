// The workspace confinement check the chat tools and documents.ts share: a path, followed
// through symlinks, must stay inside the workspace's real location on disk.
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

// Throws when the resolved path leaves the workspace. A path that does not exist yet (a new file from
// Write) is checked through the real location of its nearest existing parent folder.
export function resolveInWorkspace(workspace: string, filePath: string): string {
  const realWorkspace = realpathSync(workspace);
  const target = realTarget(resolve(realWorkspace, filePath));
  if (relative(realWorkspace, target).startsWith('..')) throw new Error(`${filePath} is outside the workspace`);
  return target;
}

function realTarget(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  return join(realTarget(dirname(path)), basename(path));
}
