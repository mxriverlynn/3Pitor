// Test-only: the post routes over an in-memory store, for UI tests to answer fetch with. It refuses as the store does:
// any id it does not hold is a 404, a deleted one included, and a blank title is a 400. Ids come from a counter that is
// never reused, "1/p 1", "2/p 2", …: each holds a "/" and a space and never equals a title, so a page that builds an id
// from a title, or sends one unencoded, fails its tests. The list comes back newest first, never by title, so a page
// that forgets to sort fails too. It sends no events: tests send posts-changed themselves.
import type { CreatePostBody, Post, PostList, SetBodyBody, SetTitleBody } from '../../shared/wire';

const NOT_FOUND = 'That post no longer exists.';
const NEEDS_TITLE = 'A post needs a title.';

// `posts` seeds the store by title, in order, so the first is "1/p 1".
export function fakePostsApi(posts: Record<string, string> = {}) {
  let made = 0;
  const api = {
    // Each post's body and title, by id.
    files: new Map<string, string>(),
    titles: new Map<string, string>(),
    // Each post request, as "METHOD url".
    requests: [] as string[],
    // Makes a post as another tab or the AI would, and returns its id.
    add(title: string, body: string): string {
      const id = `${++made}/p ${made}`;
      api.titles.set(id, title);
      api.files.set(id, body);
      return id;
    },
    // Answers a post request, or returns undefined for any other URL.
    handle: async (url: string, init?: RequestInit): Promise<Response | undefined> => {
      if (!url.startsWith('/api/posts')) return undefined;
      const method = init?.method ?? 'GET';
      api.requests.push(`${method} ${url}`);
      const body = () => JSON.parse(String(init!.body));
      if (url === '/api/posts') {
        if (method === 'POST') {
          const { title } = body() as CreatePostBody;
          if (title.trim() === '') return refuse(400, NEEDS_TITLE);
          return Response.json({ id: api.add(title, '') });
        }
        const listed = [...api.titles].reverse().map(([id, title]) => ({ id, title }));
        return Response.json({ posts: listed } satisfies PostList);
      }
      const [, encoded, field] = url.match(/^\/api\/posts\/([^/]+)(?:\/(title|body))?$/) ?? [];
      if (encoded === undefined) return refuse(404, NOT_FOUND);
      const id = decodeURIComponent(encoded);
      if (!api.titles.has(id)) return refuse(404, NOT_FOUND);
      if (method === 'DELETE') {
        api.titles.delete(id);
        api.files.delete(id);
        return Response.json({ ok: true });
      }
      if (method === 'PUT' && field === 'title') {
        const { title } = body() as SetTitleBody;
        if (title.trim() === '') return refuse(400, NEEDS_TITLE);
        api.titles.set(id, title);
        return Response.json({ ok: true });
      }
      if (method === 'PUT' && field === 'body') {
        api.files.set(id, (body() as SetBodyBody).body);
        return Response.json({ ok: true });
      }
      return Response.json({ id, title: api.titles.get(id)!, body: api.files.get(id)! } satisfies Post);
    },
  };
  for (const [title, text] of Object.entries(posts)) api.add(title, text);

  const refuse = (status: number, error: string) => Response.json({ error }, { status });
  return api;
}

export type FakePostsApi = ReturnType<typeof fakePostsApi>;
