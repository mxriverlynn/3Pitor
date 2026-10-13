// Turns 3pitor's command line into a folder argument, or a request to print the version or usage instead. It does not
// print, exit, or know about models; which provider and model chat uses is chosen in the app.
import { parseArgs } from 'node:util';

// Set by `bun build --define` (see the Makefile); a run from source has none.
declare const THREEPITOR_VERSION: string | undefined;
export const VERSION = typeof THREEPITOR_VERSION === 'string' ? THREEPITOR_VERSION : 'dev';

export const USAGE = 'Usage: 3pitor [--version|-v] [--help] [folder-or-file]';

// Either how to start, or something to print instead of starting.
export type CommandLine = { target: string | undefined } | { print: 'version' | 'help' };

// An unknown option, such as the removed --claude, throws before --version or --help is read.
export function parseCommandLine(argv: string[]): CommandLine {
  const { values, positionals } = parseArgs({
    args: lowerCaseOptionNames(argv),
    options: {
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean' },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.help) return { print: 'help' };
  if (values.version) return { print: 'version' };
  // Extra positionals are ignored, as they always were.
  return { target: positionals[0] };
}

// --VERSION works like --version. Only option names change; everything after a bare -- is left alone.
function lowerCaseOptionNames(argv: string[]): string[] {
  const end = argv.indexOf('--');
  return argv.map((arg, i) => {
    if (!arg.startsWith('--') || (end !== -1 && i >= end)) return arg;
    const [name, ...value] = arg.split('=');
    return [name!.toLowerCase(), ...value].join('=');
  });
}
