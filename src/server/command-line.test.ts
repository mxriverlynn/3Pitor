import { expect, test } from 'bun:test';
import { USAGE, parseCommandLine } from './command-line';

const withKey = { ANTHROPIC_API_KEY: 'sk-ant-test' };

test('with no flag and an API key, chat uses the API and there is no folder argument', () => {
  expect(parseCommandLine([], withKey)).toEqual({ target: undefined, claude: 'api' });
});

test('with no flag and no API key, or an empty one, chat uses the claude program', () => {
  expect(parseCommandLine([], {})).toEqual({ target: undefined, claude: 'cli' });
  expect(parseCommandLine([], { ANTHROPIC_API_KEY: '' })).toEqual({ target: undefined, claude: 'cli' });
});

test('--claude forces a mode, in any letter case, and the folder argument still follows it', () => {
  expect(parseCommandLine(['--claude=CLI', 'posts'], withKey)).toEqual({ target: 'posts', claude: 'cli' });
});

test('--claude also takes its mode as the next argument, and auto chooses by the API key', () => {
  expect(parseCommandLine(['--claude', 'api'], {})).toEqual({ target: undefined, claude: 'api' });
  expect(parseCommandLine(['--claude=auto'], withKey)).toEqual({ target: undefined, claude: 'api' });
  expect(parseCommandLine(['--claude=Auto', 'posts'], {})).toEqual({ target: 'posts', claude: 'cli' });
});

test('a --claude mode other than api, cli, or auto is an error', () => {
  expect(() => parseCommandLine(['--claude=bogus'], withKey)).toThrow('--claude must be api, cli, or auto (got "bogus")');
});

test('an option 3pitor does not know is an error, so a mistyped mode is never silently ignored', () => {
  expect(() => parseCommandLine(['--claud=cli', 'notes'], withKey)).toThrow("Unknown option '--claud'");
});

test('option names are case-insensitive too, while the folder argument keeps its case', () => {
  expect(parseCommandLine(['--CLAUDE=cli', 'Posts'], withKey)).toEqual({ target: 'Posts', claude: 'cli' });
  expect(parseCommandLine(['--Claude', 'API', 'My Notes'], {})).toEqual({ target: 'My Notes', claude: 'api' });
});

test('a folder named after a bare -- keeps its spelling, even when it looks like an option', () => {
  expect(parseCommandLine(['--', '--My-Posts'], withKey)).toEqual({ target: '--My-Posts', claude: 'api' });
});

test('the usage line names every flag, the claude modes, and the folder argument', () => {
  expect(USAGE).toBe('Usage: 3pitor [--claude=auto|api|cli] [--version|-v] [--help] [folder-or-file]');
});

test('--version, in any letter case, and -v ask to print the version instead of starting', () => {
  expect(parseCommandLine(['--version'], withKey)).toEqual({ print: 'version' });
  expect(parseCommandLine(['--VERSION'], withKey)).toEqual({ print: 'version' });
  expect(parseCommandLine(['-v'], {})).toEqual({ print: 'version' });
});

test('--help asks to print the usage line, and wins when --version is given too', () => {
  expect(parseCommandLine(['--help'], withKey)).toEqual({ print: 'help' });
  expect(parseCommandLine(['--help', '--version'], withKey)).toEqual({ print: 'help' });
});
