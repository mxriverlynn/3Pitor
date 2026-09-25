// The model's file tools, and the one place model-driven file access happens. Every path is checked
// against the workspace's real location on disk, so neither `..` nor a symlink can lead outside it.
import { tool } from 'ai';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

// The four tools the model gets. Names and input fields match Claude Code's, so the UI's tool rows
// and workspace agents' `tools:` lines keep working.
export function fileTools(workspace: string) {
  const Read = tool({
    description: 'Read a file in the workspace and return its text.',
    inputSchema: z.object({ file_path: z.string() }),
    execute: async ({ file_path }) => {
      const file = Bun.file(resolveInWorkspace(workspace, file_path));
      if (!(await file.exists())) throw new Error(`${file_path} does not exist`);
      return file.text();
    },
  });
  const Write = tool({
    description: 'Create or replace a whole markdown post in the workspace.',
    inputSchema: z.object({ file_path: z.string(), content: z.string() }),
    execute: async ({ file_path, content }) => {
      await Bun.write(resolvePost(workspace, file_path), content);
      return `wrote ${file_path}`;
    },
  });
  const Edit = tool({
    description: 'Change part of a markdown post by replacing old_string, which must occur exactly once, with new_string.',
    inputSchema: z.object({ file_path: z.string(), old_string: z.string(), new_string: z.string() }),
    execute: async ({ file_path, old_string, new_string }) => {
      const file = Bun.file(resolvePost(workspace, file_path));
      const text = await file.text();
      const count = text.split(old_string).length - 1;
      if (count === 0) throw new Error(`old_string not found in ${file_path}`);
      if (count > 1) throw new Error(`old_string appears ${count} times in ${file_path}`);
      await Bun.write(file, text.replace(old_string, () => new_string));
      return `edited ${file_path}`;
    },
  });
  const Glob = tool({
    description: 'List the workspace files matching a glob pattern, such as **/*.md, one path per line.',
    inputSchema: z.object({ pattern: z.string() }),
    execute: async ({ pattern }) => {
      if (isAbsolute(pattern) || pattern.split('/').includes('..')) throw new Error(`${pattern} is outside the workspace`);
      const matches = await Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: workspace, onlyFiles: true }));
      return matches.filter((match) => insideWorkspace(workspace, match)).sort().join('\n');
    },
  });
  return { Read, Write, Edit, Glob };
}

// Throws when the resolved path leaves the workspace. A path that does not exist yet (a new file from
// Write) is checked through the real location of its nearest existing parent folder.
export function resolveInWorkspace(workspace: string, filePath: string): string {
  const realWorkspace = realpathSync(workspace);
  const target = realTarget(resolve(realWorkspace, filePath));
  if (relative(realWorkspace, target).startsWith('..')) throw new Error(`${filePath} is outside the workspace`);
  return target;
}

// Like resolveInWorkspace, and also refuses anything but a .md file outside dot-folders, which keeps
// the model (and unattended jobs in particular) out of .git/ and .claude/.
function resolvePost(workspace: string, filePath: string): string {
  const target = resolveInWorkspace(workspace, filePath);
  const segments = relative(realpathSync(workspace), target).split(sep);
  if (!target.endsWith('.md') || segments.some((s) => s.startsWith('.'))) {
    throw new Error(`${filePath} is not a markdown post`);
  }
  return target;
}

function insideWorkspace(workspace: string, filePath: string): boolean {
  try {
    resolveInWorkspace(workspace, filePath);
    return true;
  } catch {
    return false;
  }
}

function realTarget(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  return join(realTarget(dirname(path)), basename(path));
}
