// Posts: checks each request's body and hands it to the post store, and maps each PostError to a 400 or 404 carrying
// the store's own sentence. Any other error is a plain-text 500.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ApiError, CreatePostBody, Post, PostList, PostSummary, SetBodyBody, SetTitleBody } from '../../shared/wire';
import type { Engine } from '../../engine/engine';
import { PostError } from '../../posts/post-error';

const CreateBody: z.ZodType<CreatePostBody> = z.object({ title: z.string() });
const TitleBody: z.ZodType<SetTitleBody> = z.object({ title: z.string() });
const TextBody: z.ZodType<SetBodyBody> = z.object({ body: z.string() });

// A request body that does not fit its route. Private: PostError's fixed sentences describe posts, not requests.
class BadBody extends Error {}

export function postRoutes(posts: Engine['posts']): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof PostError) return c.json<ApiError>({ error: error.message }, error.reason === 'not-found' ? 404 : 400);
    if (error instanceof BadBody) return c.json<ApiError>({ error: error.message }, 400);
    console.error(error);
    return c.text('Internal Server Error', 500);
  });

  // With a `q` that is not blank, only the posts whose title or saved body holds it, ignoring case.
  app.get('/api/posts', async (c) => c.json<PostList>(await search(posts, c.req.query('q') ?? '')));

  app.post('/api/posts', async (c) => {
    const { title } = await body(c, CreateBody);
    return c.json<Pick<PostSummary, 'id'>>({ id: await posts.create({ title, body: '' }) });
  });

  app.get('/api/posts/:id', async (c) => c.json<Post>(await posts.get(c.req.param('id'))));

  app.put('/api/posts/:id/title', async (c) => {
    await posts.setTitle(c.req.param('id'), (await body(c, TitleBody)).title);
    return c.json({ ok: true });
  });

  app.put('/api/posts/:id/body', async (c) => {
    await posts.setBody(c.req.param('id'), (await body(c, TextBody)).body);
    return c.json({ ok: true });
  });

  app.delete('/api/posts/:id', async (c) => {
    await posts.delete(c.req.param('id'));
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
