#!/usr/bin/env bun
// A stand-in for the claude program, for tests. Tests copy it into a folder as `claude` and put that folder on PATH.
// Its only inputs are its arguments, stdin, and its environment: it never reads ~/.claude or the network, other than
// the MCP endpoint named in --mcp-config. What it does depends on the words in stdin:
//
//   echo stdin          replies with stdin
//   echo args           replies with its arguments, working folder, and MCP_TOOL_TIMEOUT, as JSON
//   call <Tool> <json>  (at the start of a line) calls that tool on the MCP endpoint, then replies with the tool's text
//   slow call <Tool> <json>  starts a call, then prints its pid as text while the tool runs
//   hang                prints its pid as text and never finishes
//   fail after text     replies, then reports a failed run
//   fail                reports a failed run before any text
//   crash               prints to stderr and exits 3 with no output
//   mcp down            reports the MCP server as failed
//   anything else       replies "ANTHROPIC_API_KEY=present" or "=absent", the same for ANTHROPIC_AUTH_TOKEN, then
//                       " hello"
//
// FAKE_CLAUDE_LOG, when set, is a file each run appends a line to, so a test can tell whether it ran at all.
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const stdin = await Bun.stdin.text();
if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `ran ${process.pid}\n`);

const argument = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const print = (line: object) => console.log(JSON.stringify(line));
const event = (e: object) => print({ type: 'stream_event', event: e });
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

// One assistant message with one text block.
function say(...chunks: string[]) {
  event({ type: 'message_start', message: { role: 'assistant', content: [] } });
  event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  for (const text of chunks) event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  event({ type: 'content_block_stop', index: 0 });
  event({ type: 'message_stop' });
}
const succeed = () => print({ type: 'result', subtype: 'success', is_error: false, result: '', usage });
const failRun = () => {
  print({ type: 'result', subtype: 'success', is_error: true, result: 'The model is not available.', usage });
  process.exit(1);
};

const config = argument('--mcp-config');
const url: string | undefined = config && JSON.parse(config).mcpServers['3pitor'].url;
const status = stdin.includes('mcp down') ? 'failed' : 'connected';
print({ type: 'system', subtype: 'init', mcp_servers: url ? [{ name: '3pitor', status }] : [] });

async function rpc(method: string, params: object) {
  const response = await fetch(url!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return (await response.json()).result;
}

const call = stdin.match(/^(slow )?call (\w+) (\{.*\})$/m);
if (stdin.includes('crash')) {
  console.error('starting up\nsomething broke');
  process.exit(3);
} else if (stdin.includes('mcp down')) {
  succeed();
} else if (stdin.includes('fail after text')) {
  say('partial answer');
  failRun();
} else if (stdin.includes('fail')) {
  failRun();
} else if (stdin.includes('hang')) {
  say(`pid=${process.pid}`);
  await new Promise(() => {});
} else if (call) {
  const [, slow, name, input] = call;
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fake-claude' } });
  const pending = rpc('tools/call', { name, arguments: JSON.parse(input!) });
  // Once the call has had time to reach 3pitor, so a test can stop the run while the tool is running.
  if (slow) {
    await Bun.sleep(100);
    say(`pid=${process.pid}`);
  }
  const result = await pending;
  say(result.content[0].text);
  succeed();
} else if (stdin.includes('echo stdin')) {
  say(stdin);
  succeed();
} else if (stdin.includes('echo args')) {
  say(JSON.stringify({ args, cwd: process.cwd(), mcpToolTimeout: process.env.MCP_TOOL_TIMEOUT }));
  succeed();
} else {
  const seen = (name: string) => `${name}=${process.env[name] ? 'present' : 'absent'}`;
  say(seen('ANTHROPIC_API_KEY'), ` ${seen('ANTHROPIC_AUTH_TOKEN')}`, ' hello');
  succeed();
}
