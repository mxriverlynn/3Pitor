// Turns the claude program's stream-json output into AI SDK stream parts. Its lines carry whole post texts, so one
// line is often longer than one pipe read; this module owns the framing as well as the mapping.
import type { LanguageModelV4StreamPart, LanguageModelV4Usage } from '@ai-sdk/provider';

// Splits text into lines, holding back the unfinished tail until its newline arrives or the input ends.
export function lines(): TransformStream<string, string> {
  let tail = '';
  return new TransformStream({
    transform(chunk, controller) {
      const parts = (tail + chunk).split('\n');
      tail = parts.pop()!;
      for (const line of parts) controller.enqueue(line);
    },
    flush(controller) {
      if (tail) controller.enqueue(tail);
    },
  });
}

// One stream-json line per chunk in, AI SDK stream parts out. Only text blocks become parts: claude's own tool events
// are left out, because 3pitor's tool rows come from its MCP endpoint.
export function streamJsonParts(): TransformStream<string, LanguageModelV4StreamPart> {
  // Counts message_start events, so text ids stay unique across the messages of one run.
  let msg = 0;
  const openText = new Set<string>();
  return new TransformStream({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
    },
    transform(line, controller) {
      const data = parseLine(line);
      if (data === undefined) return;
      if (data.type === 'system' && data.subtype === 'init') {
        // The 3pitor server is only listed when the call has tools.
        const server = data.mcp_servers?.find((s: { name: string }) => s.name === '3pitor');
        if (server && server.status !== 'connected') {
          const message = `claude could not reach 3pitor's tools (MCP server "3pitor" status: ${server.status})`;
          controller.enqueue({ type: 'error', error: new Error(message) });
        }
        return;
      }
      if (data.type === 'result') {
        // A successful run is always one stop, so the AI SDK treats the whole claude run as one step.
        const unified = data.is_error ? 'error' : 'stop';
        if (data.is_error) controller.enqueue({ type: 'error', error: new Error(`claude failed: ${data.result || data.subtype}`) });
        controller.enqueue({ type: 'finish', finishReason: { unified, raw: data.subtype }, usage: usageOf(data.usage) });
        return;
      }
      if (data.type !== 'stream_event') return;
      const event = data.event;
      const id = `${msg}.${event.index}`;
      if (event.type === 'message_start') msg++;
      else if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
        openText.add(id);
        controller.enqueue({ type: 'text-start', id });
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        controller.enqueue({ type: 'text-delta', id, delta: event.delta.text });
      } else if (event.type === 'content_block_stop' && openText.delete(id)) {
        controller.enqueue({ type: 'text-end', id });
      }
    },
  });
}

// A line claude printed that is not JSON, such as a notice, is skipped rather than failing the turn.
function parseLine(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    console.warn(`3pitor: skipped a line from claude that is not JSON: ${line}`);
    return undefined;
  }
}

interface ResultUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

// claude's input_tokens leaves out cached input, which the AI SDK counts in its total.
function usageOf(usage: ResultUsage): LanguageModelV4Usage {
  const { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens } = usage;
  return {
    inputTokens: {
      total: input_tokens + cache_read_input_tokens + cache_creation_input_tokens,
      noCache: input_tokens,
      cacheRead: cache_read_input_tokens,
      cacheWrite: cache_creation_input_tokens,
    },
    outputTokens: { total: output_tokens, text: output_tokens, reasoning: undefined },
  };
}
