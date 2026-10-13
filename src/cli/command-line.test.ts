import { expect, test } from 'bun:test';
import { USAGE, parseCommandLine } from './command-line';

test('with no arguments there is no folder argument', () => {
  expect(parseCommandLine([])).toEqual({ target: undefined });
});

test('the first argument is the folder, and extra ones are ignored', () => {
  expect(parseCommandLine(['posts', 'other'])).toEqual({ target: 'posts' });
});

test('--claude is no longer an option, so it stops startup instead of being silently ignored', () => {
  expect(() => parseCommandLine(['--claude=cli', 'posts'])).toThrow("Unknown option '--claude'");
  expect(() => parseCommandLine(['--CLAUDE', 'api'])).toThrow("Unknown option '--claude'");
});

test('an unknown option is an error even beside --version, because it is caught before --version is read', () => {
  expect(() => parseCommandLine(['--version', '--claude=cli'])).toThrow("Unknown option '--claude'");
});

test('an option 3pitor does not know is an error', () => {
  expect(() => parseCommandLine(['--claud=cli', 'notes'])).toThrow("Unknown option '--claud'");
});

test('option names are case-insensitive, while the folder argument keeps its case', () => {
  expect(parseCommandLine(['--VERSION'])).toEqual({ print: 'version' });
  expect(parseCommandLine(['My Notes'])).toEqual({ target: 'My Notes' });
});

test('a folder named after a bare -- keeps its spelling, even when it looks like an option', () => {
  expect(parseCommandLine(['--', '--My-Posts'])).toEqual({ target: '--My-Posts' });
});

test('the usage line names every flag and the folder argument', () => {
  expect(USAGE).toBe('Usage: 3pitor [--version|-v] [--help] [folder-or-file]');
});

test('--version, in any letter case, and -v ask to print the version instead of starting', () => {
  expect(parseCommandLine(['--version'])).toEqual({ print: 'version' });
  expect(parseCommandLine(['--VERSION'])).toEqual({ print: 'version' });
  expect(parseCommandLine(['-v'])).toEqual({ print: 'version' });
});

test('--help asks to print the usage line, and wins when --version is given too', () => {
  expect(parseCommandLine(['--help'])).toEqual({ print: 'help' });
  expect(parseCommandLine(['--help', '--version'])).toEqual({ print: 'help' });
});

test('--version wins over a folder argument', () => {
  expect(parseCommandLine(['--version', 'posts'])).toEqual({ print: 'version' });
});

test('--version takes no value, and -h is not a short form of --help', () => {
  expect(() => parseCommandLine(['--version=x'])).toThrow("Option '-v, --version' does not take an argument");
  expect(() => parseCommandLine(['-h'])).toThrow("Unknown option '-h'");
});

test('a folder named --version after a bare -- is a folder, not a request for the version', () => {
  expect(parseCommandLine(['--', '--version'])).toEqual({ target: '--version' });
});
