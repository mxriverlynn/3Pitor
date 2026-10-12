// Loads the engine and runs claude through it on Node, to show the engine needs no Bun: `make check-node` runs it with
// node --experimental-transform-types --import ./scripts/node-ts.mjs. It catches what bun-free.test.ts cannot see,
// such as a module that fails to load on Node, and it is the one place the claude process code runs on Node. Exits
// non-zero on the first failure. Needs bun on PATH, because the fake claude it runs is a Bun script.
import { chmod, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// The folder on PATH that holds bun, for the fake claude's #!/usr/bin/env bun line.
const bunFolder = process.env.BUN_FOLDER;
if (!bunFolder) fail('BUN_FOLDER is not set; make check-node sets it to the folder holding bun');

// 1. The engine loads.
await import('./engine').catch((error) => fail(`importing engine.ts failed: ${error instanceof Error ? error.stack : error}`));
const { CLAUDE_NOT_FOUND_HELP, claudeCliModel } = await import('./chat/claude-cli/claude-cli');
console.log('node-check: engine.ts loads');

const model = claudeCliModel('claude-sonnet-5', {}, { webTools: false, serveTools: () => fail('no tools were offered') });
const call = { prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hi' }] }] };

// 2. A claude call runs to its finish, against the fake claude.
const bin = await mkdtemp(join(tmpdir(), '3pitor-node-check-'));
try {
  await copyFile(join(HERE, 'chat/components/fake-claude.ts'), join(bin, 'claude'));
  await chmod(join(bin, 'claude'), 0o755);
  process.env.PATH = [bin, bunFolder].join(delimiter);
  const { stream } = await model.doStream(call);
  const types: string[] = [];
  for await (const part of stream as unknown as AsyncIterable<{ type: string }>) types.push(part.type);
  if (types.at(-1) !== 'finish') fail(`the claude call ended without finishing: ${types.join(', ')}`);
  console.log('node-check: a claude call runs to its finish');
} finally {
  await rm(bin, { recursive: true, force: true });
}

// 3. A missing claude fails the call with how to install it.
process.env.PATH = '';
const missing = await model.doStream(call).then(
  () => fail('a missing claude did not fail the call'),
  (error: unknown) => (error instanceof Error ? error.message : String(error)),
);
if (missing !== CLAUDE_NOT_FOUND_HELP) fail(`a missing claude failed with: ${missing}`);
console.log('node-check: a missing claude fails with how to install it');

function fail(message: string): never {
  console.error(`node-check: ${message}`);
  process.exit(1);
}
