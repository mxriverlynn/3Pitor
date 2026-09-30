// Turns the claude program's stream-json output into AI SDK stream parts. Its lines carry whole post texts, so one
// line is often longer than one pipe read; this module owns the framing as well as the mapping.
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';

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
      const data = JSON.parse(line);
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
