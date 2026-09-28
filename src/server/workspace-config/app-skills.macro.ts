// A Bun macro: it runs when Bun bundles or transpiles the file that imports it `with { type: 'macro' }`,
// and its return value is written into that file's output. That puts the app's skills inside the
// compiled build/3pitor, which cannot read files through a computed path. Editing src/skills/ needs a
// server restart in dev, and a rebuild for the binary.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SRC } from '../paths';

// The text of every .md file under src/skills/, keyed by its path relative to that folder.
export function appSkillFiles(): Record<string, string> {
  const dir = join(SRC, 'skills');
  const files: Record<string, string> = {};
  for (const path of [...new Bun.Glob('**/*.md').scanSync({ cwd: dir })].sort()) files[path] = readFileSync(join(dir, path), 'utf8');
  return files;
}
