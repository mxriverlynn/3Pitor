// Posts: checks each request's body and hands it to the post store, and maps each PostError to a 400 or 404 carrying
// the store's own sentence and what it refused, the post or a research document. Any other error is a plain-text 500.
// The create, title, and body routes also keep a post's title and its title row, its first # heading, in step: a new
// post starts with "# <title>", a rename rewrites the heading, and a Save makes the title follow it.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type {
  ApiError,
  CreatePostBody,
  Outline,
  Post,
  PostDocuments,
  PostList,
  PostSummary,
  ResearchDocument,
  SetBodyBody,
  SetOutlineBody,
  SetTitleBody,
} from '../../shared/wire';
import type { Engine } from '../../engine/engine';
import { PostError } from '../../posts/post-error';
import { headingTitle, titleText, withHeadingTitle } from '../../shared/title-row';

const CreateBody: z.ZodType<CreatePostBody> = z.object({ title: z.string() });
const TitleBody: z.ZodType<SetTitleBody> = z.object({ title: z.string() });
const TextBody: z.ZodType<SetBodyBody> = z.object({ body: z.string() });
const OutlineBody: z.ZodType<SetOutlineBody> = z.object({ outline: z.string() });

// A request body that does not fit its route. Private: PostError's fixed sentences describe posts, not requests.
class BadBody extends Error {}

export function postRoutes(posts: Engine['posts']): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof PostError) {
      return c.json<ApiError>({ error: error.message, subject: error.subject }, error.reason === 'not-found' ? 404 : 400);
    }
    if (error instanceof BadBody) return c.json<ApiError>({ error: error.message }, 400);
    console.error(error);
    return c.text('Internal Server Error', 500);
  });

  // With a `q` that is not blank, only the posts whose title or saved body holds it, ignoring case.
  app.get('/api/posts', async (c) => c.json<PostList>(await search(posts, c.req.query('q') ?? '')));

  app.post('/api/posts', async (c) => {
    const title = titleText((await body(c, CreateBody)).title);
    return c.json<Pick<PostSummary, 'id'>>({ id: await posts.create({ title, body: withHeadingTitle('', title) }) });
  });

  app.get('/api/posts/:id', async (c) => c.json<Post>(await posts.get(c.req.param('id'))));

  // The title row changes first, so a title write that fails leaves the new heading, and a retry finishes the rename.
  // Were it the other way round, the next Save would take the old heading back as the title.
  app.put('/api/posts/:id/title', async (c) => {
    const id = c.req.param('id');
    const title = titleText((await body(c, TitleBody)).title);
    if (title === '') throw new PostError('invalid', 'post');
    const { body: text } = await posts.get(id);
    const next = withHeadingTitle(text, title);
    if (next !== text) await posts.setBody(id, next);
    await posts.setTitle(id, title);
    return c.json({ ok: true });
  });

  // The title follows a saved title row's plain text. A post with no title row, or a blank one, keeps its title.
  app.put('/api/posts/:id/body', async (c) => {
    const id = c.req.param('id');
    const text = (await body(c, TextBody)).body;
    await posts.setBody(id, text);
    const heading = headingTitle(text);
    if (heading !== null && heading !== (await posts.get(id)).title) await posts.setTitle(id, heading);
    return c.json({ ok: true });
  });

  app.delete('/api/posts/:id', async (c) => {
    await posts.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  // Both calls are ordered with the post's others, so a delete between them is a 404, never half an answer.
  app.get('/api/posts/:id/documents', async (c) => {
    const id = c.req.param('id');
    const { researchDocuments } = await posts.listResearchDocuments(id);
    return c.json<PostDocuments>({ outline: (await posts.getOutline(id)) !== null, researchDocuments });
  });

  app.get('/api/posts/:id/outline', async (c) => c.json<Outline>({ outline: await posts.getOutline(c.req.param('id')) }));

  app.put('/api/posts/:id/outline', async (c) => {
    await posts.setOutline(c.req.param('id'), (await body(c, OutlineBody)).outline);
    return c.json({ ok: true });
  });

  app.get('/api/posts/:id/research/:rid', async (c) =>
    c.json<ResearchDocument>(await posts.getResearchDocument(c.req.param('id'), c.req.param('rid'))),
  );

  app.put('/api/posts/:id/research/:rid/body', async (c) => {
    await posts.setResearchDocumentBody(c.req.param('id'), c.req.param('rid'), (await body(c, TextBody)).body);
    return c.json({ ok: true });
  });

  app.delete('/api/posts/:id/research/:rid', async (c) => {
    await posts.deleteResearchDocument(c.req.param('id'), c.req.param('rid'));
    return c.json({ ok: true });
  });

  return app;
}

// The posts whose title or saved body holds `q`, trimmed, ignoring case; every post when it is blank. The bodies are
// read in parallel. A post deleted between the list and its read drops out.
async function search(posts: Engine['posts'], q: string): Promise<PostList> {
  const all = await posts.list();
  const needle = q.trim().toLowerCase();
  if (!needle) return all;
  const found = await Promise.all(
    all.posts.map(async (post) => {
      if (post.title.toLowerCase().includes(needle)) return post;
      const body = await posts.get(post.id).then(
        (read) => read.body,
        (error) => {
          if (error instanceof PostError && error.reason === 'not-found') return '';
          throw error;
        },
      );
      return body.toLowerCase().includes(needle) ? post : undefined;
    }),
  );
  return { posts: found.filter((post) => post !== undefined) };
}

// The request's JSON body, checked against its schema.
async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) throw new BadBody(`the request body is not valid: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
