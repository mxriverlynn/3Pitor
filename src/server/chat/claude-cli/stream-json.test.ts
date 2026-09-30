import { expect, test } from 'bun:test';
import { convertArrayToReadableStream, convertReadableStreamToArray } from 'ai/test';
import { lines, streamJsonParts } from './stream-json';

// Lines recorded from claude 2.1.285 (see the change plan's unit-0-findings.md), trimmed of ids and fields 3pitor
// never reads.
const recorded = {
  init: '{"type":"system","subtype":"init","cwd":"/private/tmp","tools":["WebFetch","WebSearch","mcp__3pitor__Read"],"mcp_servers":[{"name":"3pitor","status":"connected","source":"dynamic"}],"model":"claude-haiku-4-5-20251001"}',
  messageStart: '{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-haiku-4-5-20251001","type":"message","role":"assistant","content":[]}}}',
  textStart: (index: number) => `{"type":"stream_event","event":{"type":"content_block_start","index":${index},"content_block":{"type":"text","text":""}}}`,
  textDelta: (index: number, text: string) => `{"type":"stream_event","event":{"type":"content_block_delta","index":${index},"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}}`,
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
