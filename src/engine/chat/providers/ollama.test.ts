import { afterEach, expect, test } from 'bun:test';
import { generateText } from 'ai';
import { scriptedModel, useOllamaModel } from '../../components/test-model';
import { ollamaBackend } from './ollama';

// A stand-in Ollama that answers /api/tags with `status` and `body`.
let servers: ReturnType<typeof Bun.serve>[] = [];
function stubOllama(status: number, body: unknown) {
  const server = Bun.serve({ port: 0, fetch: (req) => (new URL(req.url).pathname === '/api/tags' ? Response.json(body, { status }) : new Response('', { status: 404 })) });
  servers.push(server);
  return server.url.origin;
}

afterEach(() => {
  for (const server of servers) server.stop(true);
  servers = [];
});

test('Ollama lists the models the operator has pulled, by name, with no thinking levels', async () => {
  const host = stubOllama(200, { models: [{ name: 'llama3.2:latest', size: 1 }, { name: 'qwen3:8b', size: 2 }] });
  const backend = ollamaBackend({ OLLAMA_HOST: host });
  expect(await backend.models({ OLLAMA_HOST: host })).toEqual([
    { id: 'llama3.2:latest', label: 'llama3.2:latest', thinking: [] },
    { id: 'qwen3:8b', label: 'qwen3:8b', thinking: [] },
  ]);
});

test('when nothing answers at the host, Ollama says it is not running there', async () => {
  const host = 'http://127.0.0.1:1';
  await expect(ollamaBackend({}).models({ OLLAMA_HOST: host })).rejects.toThrow('Ollama is not running at http://127.0.0.1:1');
});

test('when Ollama answers with an error, it says what it answered', async () => {
  const host = stubOllama(500, { error: 'boom' });
  await expect(ollamaBackend({}).models({ OLLAMA_HOST: host })).rejects.toThrow(`Ollama at ${host} answered 500`);
});

test('an Ollama chat model talks to the host OLLAMA_HOST names, or localhost, and asks for no reasoning even when given a level', async () => {
  const model = scriptedModel('chat', 'default');
  const calls = useOllamaModel(model);
  await generateText({ model: ollamaBackend({ OLLAMA_HOST: 'http://studio.local:11434' }).chatModel('qwen3:8b', {}, 'high'), prompt: 'Hi' });
  await generateText({ model: ollamaBackend({}).chatModel('qwen3:8b', {}), prompt: 'Hi' });
  expect(calls).toEqual([
    { baseURL: 'http://studio.local:11434/v1', id: 'qwen3:8b' },
    { baseURL: 'http://localhost:11434/v1', id: 'qwen3:8b' },
  ]);
  expect(model.doGenerateCalls.map((call) => call.reasoning)).toEqual([undefined, undefined]);
});
