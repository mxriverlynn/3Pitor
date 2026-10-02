import { expect, spyOn, test } from 'bun:test';
import { convertArrayToReadableStream, convertReadableStreamToArray } from 'ai/test';
import { lines, streamJsonParts } from './stream-json';

// Lines recorded from claude 2.1.285 (see the change plan's unit-0-findings.md), trimmed of ids and fields 3pitor
// never reads.
const recorded = {
  init: '{"type":"system","subtype":"init","cwd":"/private/tmp","tools":["WebFetch","WebSearch","mcp__3pitor__Read"],"mcp_servers":[{"name":"3pitor","status":"connected","source":"dynamic"}],"model":"claude-haiku-4-5-20251001"}',
  messageStart: '{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-haiku-4-5-20251001","type":"message","role":"assistant","content":[]}}}',
  textStart: (index: number) => `{"type":"stream_event","event":{"type":"content_block_start","index":${index},"content_block":{"type":"text","text":""}}}`,
  textDelta: (index: number, text: string) => `{"type":"stream_event","event":{"type":"content_block_delta","index":${index},"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}}`,
  success: '{"type":"result","subtype":"success","is_error":false,"result":"The secret word is **pineapple**.","stop_reason":"end_turn","usage":{"input_tokens":9,"cache_creation_input_tokens":8362,"cache_read_input_tokens":120,"output_tokens":92}}',
  failure: '{"type":"result","subtype":"success","is_error":true,"result":"There\'s an issue with the selected model (claude-nope-1). It may not exist or you may not have access to it. Run --model to pick a different model.","usage":{"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0}}',
  blockStop: (index: number) => `{"type":"stream_event","event":{"type":"content_block_stop","index":${index}}}`,
};


// Everything a transform produces once its chunks go in and its input closes.
const through = <I, O>(transform: TransformStream<I, O>, chunks: I[]) =>
  convertReadableStreamToArray(convertArrayToReadableStream(chunks).pipeThrough(transform));

test('lines joins chunks into whole lines, holding back an unfinished one until its newline arrives', async () => {
  expect(await through(lines(), ['{"a":', '1}\n{"b"', ':2}\n{"c":3}\n'])).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
});

test('lines passes on a last line that has no newline', async () => {
  expect(await through(lines(), ['{"a":1}\n{"b"', ':2}'])).toEqual(['{"a":1}', '{"b":2}']);
});

test('a curly quote split across two reads of claude’s output comes through whole', async () => {
  const bytes = new TextEncoder().encode('{"text":"“hi”"}\n');
  const split = bytes.indexOf(0x80); // inside the three bytes of the opening quote
  const decoded = convertArrayToReadableStream([bytes.slice(0, split), bytes.slice(split)])
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(lines());
  expect(await convertReadableStreamToArray(decoded)).toEqual(['{"text":"“hi”"}']);
});

test('streamJsonParts starts the stream, then turns a text block into text parts', async () => {
  const parts = await through(streamJsonParts(), [
    recorded.init,
    recorded.messageStart,
    recorded.textStart(1),
    recorded.textDelta(1, 'The secret word '),
    recorded.textDelta(1, 'is **pineapple**.'),
    recorded.blockStop(1),
  ]);
  expect(parts).toEqual([
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: '1.1' },
    { type: 'text-delta', id: '1.1', delta: 'The secret word ' },
    { type: 'text-delta', id: '1.1', delta: 'is **pineapple**.' },
    { type: 'text-end', id: '1.1' },
  ]);
});

test('streamJsonParts keeps text ids apart across the messages of one run, whose block indexes both start at 0', async () => {
  const parts = await through(streamJsonParts(), [
    recorded.messageStart,
    recorded.textStart(0),
    recorded.textDelta(0, 'I’ll read it.'),
    recorded.blockStop(0),
    recorded.messageStart,
    recorded.textStart(0),
    recorded.textDelta(0, 'Done.'),
    recorded.blockStop(0),
  ]);
  expect(parts.filter((p) => p.type === 'text-start')).toEqual([
    { type: 'text-start', id: '1.0' },
    { type: 'text-start', id: '2.0' },
  ]);
});

test('streamJsonParts finishes a successful run as one stop, counting cached input in the input total', async () => {
  const parts = await through(streamJsonParts(), [recorded.success]);
  expect(parts.at(-1)).toEqual({
    type: 'finish',
    finishReason: { unified: 'stop', raw: 'success' },
    usage: {
      inputTokens: { total: 9 + 120 + 8362, noCache: 9, cacheRead: 120, cacheWrite: 8362 },
      outputTokens: { total: 92, text: 92, reasoning: undefined },
    },
  });
});

test('streamJsonParts reports a failed run as an error, then finishes it as an error', async () => {
  const [, error, finish] = await through(streamJsonParts(), [recorded.failure]);
  expect(error).toEqual({
    type: 'error',
    error: new Error(
      'claude failed: There\'s an issue with the selected model (claude-nope-1). It may not exist or you may not have access to it. Run --model to pick a different model.',
    ),
  });
  expect(finish).toMatchObject({ type: 'finish', finishReason: { unified: 'error', raw: 'success' } });
});

test('streamJsonParts names the subtype of a failed run that gives no reason', async () => {
  const [, error] = await through(streamJsonParts(), [
    '{"type":"result","subtype":"error_max_turns","is_error":true,"usage":{"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0}}',
  ]);
  expect(error).toEqual({ type: 'error', error: new Error('claude failed: error_max_turns') });
});

test('streamJsonParts leaves out thinking, claude’s own tool calls, and whole-message events', async () => {
  const parts = await through(streamJsonParts(), [
    recorded.messageStart,
    '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}}',
    '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me read it."}}}',
    '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"Erk"}}}',
    recorded.blockStop(0),
    '{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"mcp__3pitor__Read","input":{}}}}',
    '{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"file_path\\":\\"a.md\\"}"}}}',
    recorded.blockStop(1),
    '{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"tool_use"}}}',
    '{"type":"stream_event","event":{"type":"message_stop"}}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"mcp__3pitor__Read","input":{"file_path":"a.md"}}]}}',
    '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"# A"}]}}',
    '{"type":"system","subtype":"status","status":"requesting"}',
    '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}',
  ]);
  expect(parts).toEqual([{ type: 'stream-start', warnings: [] }]);
});

test('streamJsonParts skips a line that is not JSON with one warning, and carries on', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const parts = await through(streamJsonParts(), ['Update available!', recorded.success]);
    expect(parts.map((p) => p.type)).toEqual(['stream-start', 'finish']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]!.join(' ')).toContain('Update available!');
  } finally {
    warn.mockRestore();
  }
});

test('streamJsonParts reports an error when claude could not connect to 3pitor’s tools', async () => {
  const parts = await through(streamJsonParts(), [recorded.init.replace('"connected"', '"failed"')]);
  expect(parts).toEqual([
    { type: 'stream-start', warnings: [] },
    { type: 'error', error: new Error('claude could not reach 3pitor\'s tools (MCP server "3pitor" status: failed)') },
  ]);
});

test('streamJsonParts says nothing about an init with no 3pitor server, as in a call with no tools', async () => {
  const parts = await through(streamJsonParts(), ['{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}']);
  expect(parts).toEqual([{ type: 'stream-start', warnings: [] }]);
});
