// Sends a JSON request and returns the JSON body. A response that is not OK throws an Error carrying the server's
// `error` sentence, else the body text, else the status line, so the caller can show why it failed.
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return res.json();
  const text = await res.text();
  let message: unknown;
  try {
    message = JSON.parse(text).error;
  } catch {}
  throw new Error(typeof message === 'string' ? message : text || `${res.status} ${res.statusText}`);
}
