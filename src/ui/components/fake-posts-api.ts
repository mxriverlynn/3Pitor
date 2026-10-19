// Test-only: the post routes over an in-memory store, for UI tests to answer fetch with. It refuses as the store does:
// any id it does not hold is a 404, a deleted one included, and a blank title is a 400; each refusal names its subject,
// the post or a research document. Ids come from a counter that is never reused, "1/p 1", "2/p 2", … for posts and
// "1/r 1", "2/r 2", … for research documents: each holds a "/" and a space and never equals a title, so a page that
// builds an id from a title, or sends one unencoded, fails its tests. The lists come back newest first, never by title,
// so a page that forgets to sort fails too. It sends no events: tests send posts-changed themselves.
import type {
  ApiErrorSubject,
  CreatePostBody,
  Outline,
  Post,
  PostDocuments,
  PostList,
  ResearchDocument,
  SetBodyBody,
  SetOutlineBody,
  SetTitleBody,
} from '../../shared/wire';

const MESSAGES = {
  post: { 404: 'That post no longer exists.', 400: 'A post needs a title.' },
  'research-document': { 404: 'That research document no longer exists.', 400: 'A research document needs a title.' },
} as const;

// `posts` seeds the store by title, in order, so the first is "1/p 1".
export function fakePostsApi(posts: Record<string, string> = {}) {
  let made = 0;
  let madeResearch = 0;
  const api = {
    // Each post's body and title, by id.
    files: new Map<string, string>(),
    titles: new Map<string, string>(),
    // Each post's outline, by post id; a post with none has no entry.
    outlines: new Map<string, string>(),
    // Each post's research documents, by post id, then by research document id.
    research: new Map<string, Map<string, { title: string; body: string }>>(),
    // Each post request, as "METHOD url".
    requests: [] as string[],
    // Makes a post as another tab or the AI would, and returns its id.
    add(title: string, body: string): string {
      const id = `${++made}/p ${made}`;
      api.titles.set(id, title);
      api.files.set(id, body);
      api.research.set(id, new Map());
      return id;
    },
    // Makes a research document on a post as the AI would, and returns its id.
    addResearch(postId: string, title: string, body: string): string {
      const id = `${++madeResearch}/r ${madeResearch}`;
      api.research.get(postId)!.set(id, { title, body });
      return id;
    },
    // Answers a post request, or returns undefined for any other URL.
    handle: async (url: string, init?: RequestInit): Promise<Response | undefined> => {
      if (!url.startsWith('/api/posts')) return undefined;
      const method = init?.method ?? 'GET';
      api.requests.push(`${method} ${url}`);
      const body = () => JSON.parse(String(init!.body));
      const [path, query] = url.split('?');
      if (path === '/api/posts') {
        if (method === 'POST') {
          const { title } = body() as CreatePostBody;
          if (title.trim() === '') return refuse(400, 'post');
          return Response.json({ id: api.add(title, '') });
        }
        // A search keeps the posts whose title or body holds `q`, trimmed, ignoring case, as the route does.
        const needle = (new URLSearchParams(query).get('q') ?? '').trim().toLowerCase();
        const listed = [...api.titles]
          .reverse()
          .filter(([id, title]) => !needle || title.toLowerCase().includes(needle) || api.files.get(id)!.toLowerCase().includes(needle))
          .map(([id, title]) => ({ id, title }));
        return Response.json({ posts: listed } satisfies PostList);
      }
      const [, encoded, field, encodedResearch, researchField] =
        url.match(/^\/api\/posts\/([^/]+)(?:\/(title|body|documents|outline)|\/research\/([^/]+)(\/body)?)?$/) ?? [];
      if (encoded === undefined) return refuse(404, 'post');
      const id = decodeURIComponent(encoded);
      if (!api.titles.has(id)) return refuse(404, 'post');
      if (encodedResearch !== undefined) return handleResearch(method, id, decodeURIComponent(encodedResearch), researchField, body);
      if (field === 'documents') {
        const researchDocuments = [...api.research.get(id)!].reverse().map(([rid, { title }]) => ({ id: rid, title }));
        return Response.json({ outline: api.outlines.has(id), researchDocuments } satisfies PostDocuments);
      }
      if (field === 'outline') {
        if (method === 'PUT') {
          api.outlines.set(id, (body() as SetOutlineBody).outline);
          return Response.json({ ok: true });
        }
        return Response.json({ outline: api.outlines.get(id) ?? null } satisfies Outline);
      }
      if (method === 'DELETE') {
        api.titles.delete(id);
        api.files.delete(id);
        api.outlines.delete(id);
        api.research.delete(id);
        return Response.json({ ok: true });
      }
      if (method === 'PUT' && field === 'title') {
        const { title } = body() as SetTitleBody;
        if (title.trim() === '') return refuse(400, 'post');
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

  // GET, PUT …/body, and DELETE of one research document of a post the fake holds.
  function handleResearch(method: string, postId: string, id: string, field: string | undefined, body: () => unknown) {
    const documents = api.research.get(postId)!;
    const document = documents.get(id);
    if (!document) return refuse(404, 'research-document');
    if (method === 'DELETE') {
      documents.delete(id);
      return Response.json({ ok: true });
    }
    if (method === 'PUT' && field) {
      document.body = (body() as SetBodyBody).body;
      return Response.json({ ok: true });
    }
    return Response.json({ id, ...document } satisfies ResearchDocument);
  }

  const refuse = (status: 400 | 404, subject: ApiErrorSubject) =>
    Response.json({ error: MESSAGES[subject][status], subject }, { status });
  return api;
}

export type FakePostsApi = ReturnType<typeof fakePostsApi>;
