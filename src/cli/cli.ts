// Entry point: the `3pitor` command. Reads the command line and environment, starts the engine on a workspace,
// serves it over HTTP, prints where, and opens the browser. Owns process concerns only: argv, env, exit codes,
// stdout lines, and the browser.
import { join } from 'node:path';
import { startEngine } from '../engine/engine';
import { serveTools, startServer } from '../server/server';
import { USAGE, VERSION, parseCommandLine } from './command-line';

const { target, claude } = commandLine();
// MODEL takes a full model id or a shortcut (haiku, sonnet, opus); the engine picks the default.
const engine = await startEngine({ target, claude, model: process.env.MODEL, serveTools });
const server = startServer(engine, {
  // Port 0 asks the OS for any free port, so several instances can run side by side. Set PORT to pin one.
  port: Number(process.env.PORT ?? 0),
  development: process.env.NODE_ENV !== 'production',
});
// check.ts and make check-build read the URL from this line; keep its "listening on <url>" shape.
console.log(`3pitor listening on ${server.url.origin} (workspace: ${join(engine.workspace)})`);

// Open the UI in the default browser. Set OPEN_BROWSER=0 to skip it (the check script does).
if (process.env.OPEN_BROWSER !== '0') openBrowser(server.url.origin);

// A bad flag stops startup, so a forced mode is never silently ignored. --version and --help print and exit before
// anything starts, including any workspace I/O.
function commandLine() {
  let line;
  try {
    line = parseCommandLine(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(`3pitor: ${error instanceof Error ? error.message : error}\n${USAGE}`);
    process.exit(2);
  }
  if ('print' in line) {
    console.log(line.print === 'version' ? `3pitor ${VERSION}` : USAGE);
    process.exit(0);
  }
  return line;
}

function openBrowser(url: string) {
  const command =
    process.platform === 'darwin' ? ['open', url]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
    : ['xdg-open', url];
  try {
    Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' });
  } catch {
    console.log(`Could not open a browser; visit ${url}`);
  }
}
