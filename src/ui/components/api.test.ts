import { afterEach, expect, mock, test } from 'bun:test';
import { api } from './api';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Every request answers with `response`.
const answer = (response: Response) => {
  globalThis.fetch = mock(async () => response) as unknown as typeof fetch;
};

test('returns the body of an OK response', async () => {
  answer(Response.json({ ok: true }));
  expect(await api<{ ok: boolean }>('PUT', '/api/documents/notes.md', { content: '# Notes\n' })).toEqual({ ok: true });
});

test('throws the server’s sentence for a refusal', async () => {
  answer(Response.json({ error: 'notes.md already exists' }, { status: 400 }));
  await expect(api('POST', '/api/documents/create', { path: 'notes.md', kind: 'file' })).rejects.toThrow('notes.md already exists');
});

test('throws the body text of a plain-text failure, or its status when the body is empty', async () => {
  answer(new Response('Internal Server Error', { status: 500 }));
  await expect(api('GET', '/api/documents')).rejects.toThrow('Internal Server Error');
  answer(new Response(null, { status: 502, statusText: 'Bad Gateway' }));
  await expect(api('GET', '/api/documents')).rejects.toThrow('502 Bad Gateway');
});
