// Sends a JSON request and returns the JSON body. A response that is not OK throws an Error carrying the server's
// `error` sentence, else the body text, else the status line, so the caller can show why it failed. The Error's
// `status` holds the HTTP status, so a caller can tell a missing item (404) from other failures, and its `subject`,
// when the body names one, says what was missing: the post or one of its research documents.
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return res.json();
  const text = await res.text();
  let message: unknown;
  let subject: unknown;
  try {
    ({ error: message, subject } = JSON.parse(text));
  } catch {}
  throw Object.assign(new Error(typeof message === 'string' ? message : text || `${res.status} ${res.statusText}`), {
    status: res.status,
    ...(typeof subject === 'string' && { subject }),
  });
}
