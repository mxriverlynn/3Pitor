// Test-only: what counts as Bun-only code, for every Bun-free scan. The engine's scan and the posts package's scan both
// use it, so there is one definition. Each scan picks its own files and exemptions.

// Bun-only code: any Bun API, a 'bun' or 'bun:*' import, an import attribute (Bun's macro and text imports), a
// Bun-only import.meta field, or an import of src/app-files/, which holds the host's Bun code.
const BUN_ONLY = [
  /\bBun\.\w/,
  /\b(from|import)\s*\(?\s*['"]bun(:[\w-]+)?['"]/,
  /\bwith\s*\{\s*type\s*:/,
  /\bimport\.meta\.(dir|file|path|main)\b/,
  /['"][^'"]*app-files\//,
];

// path:line for each line with Bun-only code.
export function bunHits(files: { path: string; lines: string[] }[]): string[] {
  return files.flatMap(({ path, lines }) =>
    lines.flatMap((line, i) => (BUN_ONLY.some((pattern) => pattern.test(line)) ? [`${path}:${i + 1}`] : [])),
  );
}
