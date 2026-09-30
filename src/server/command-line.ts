// Turns 3pitor's command line and environment into a folder argument and how chat reaches Claude. It does not print,
// exit, look for the claude program, or know about models.
import { parseArgs } from 'node:util';
import type { ClaudeMode } from '../shared/wire';

export const USAGE = 'Usage: 3pitor [--claude=auto|api|cli] [folder-or-file]';

export function parseCommandLine(
  argv: string[],
  env: Record<string, string | undefined>,
): { target: string | undefined; claude: ClaudeMode } {
  const { values, positionals } = parseArgs({
    args: lowerCaseOptionNames(argv),
    options: { claude: { type: 'string', default: 'auto' } },
    allowPositionals: true,
    strict: true,
  });
  const mode = values.claude.toLowerCase();
  // Extra positionals are ignored, as they always were.
  const target = positionals[0];
  if (mode === 'auto') return { target, claude: env.ANTHROPIC_API_KEY ? 'api' : 'cli' };
  if (mode === 'api' || mode === 'cli') return { target, claude: mode };
  throw new Error(`--claude must be api, cli, or auto (got "${values.claude}")`);
}

// --CLAUDE=CLI works like --claude=cli. Only option names change; everything after a bare -- is left alone.
function lowerCaseOptionNames(argv: string[]): string[] {
  const end = argv.indexOf('--');
  return argv.map((arg, i) => {
    if (!arg.startsWith('--') || (end !== -1 && i >= end)) return arg;
    const [name, ...value] = arg.split('=');
    return [name!.toLowerCase(), ...value].join('=');
  });
}
