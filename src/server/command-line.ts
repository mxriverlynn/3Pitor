// Turns 3pitor's command line and environment into a folder argument and how chat reaches Claude, or a request to
// print the version or usage instead. It does not print, exit, look for the claude program, or know about models.
import { parseArgs } from 'node:util';
import type { ClaudeMode } from '../shared/wire';

// Set by `bun build --define` (see the Makefile); a run from source has none.
declare const THREEPITOR_VERSION: string | undefined;
export const VERSION = typeof THREEPITOR_VERSION === 'string' ? THREEPITOR_VERSION : 'dev';

export const USAGE = 'Usage: 3pitor [--claude=auto|api|cli] [--version|-v] [--help] [folder-or-file]';

// Either how to start, or something to print instead of starting.
export type CommandLine = { target: string | undefined; claude: ClaudeMode } | { print: 'version' };

export function parseCommandLine(argv: string[], env: Record<string, string | undefined>): CommandLine {
  const { values, positionals } = parseArgs({
    args: lowerCaseOptionNames(argv),
    options: { claude: { type: 'string', default: 'auto' }, version: { type: 'boolean', short: 'v' } },
    allowPositionals: true,
    strict: true,
  });
  if (values.version) return { print: 'version' };
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
