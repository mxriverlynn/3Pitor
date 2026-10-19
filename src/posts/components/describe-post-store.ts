// Test-only: it imports bun:test. Every PostStore implementation's own *.test.ts file calls it once, so a second
// implementation is held to the same contract. posts.ts never re-exports it; boundary.test.ts fails if anything but a
// *.test.ts file under src/posts/ imports it; the package's Bun-free scan names it as an exemption.
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { PostError, type PostErrorReason, type PostErrorSubject } from '../post-error';
import type { PostStore } from '../posts';

export interface PostStoreFixture {
  store: PostStore; // a new store over empty storage, used by exactly one test
  dispose(): Promise<void>; // frees that storage; run after the test whether it passed or failed
}

const MESSAGES: Record<PostErrorSubject, Record<PostErrorReason, string>> = {
  post: { 'not-found': 'That post no longer exists.', invalid: 'A post needs a title.' },
  'research-document': {
    'not-found': 'That research document no longer exists.',
    invalid: 'A research document needs a title.',
  },
};

// Every refusal is checked here, so a plain Error (or a stub's) never passes as one.
async function expectRefusal(promise: Promise<unknown>, reason: PostErrorReason, subject: PostErrorSubject): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PostError);
  expect({ reason: (error as PostError).reason, subject: (error as PostError).subject }).toEqual({ reason, subject });
  expect((error as PostError).message).toBe(MESSAGES[subject][reason]);
}

// Registers describe(`PostStore contract: ${name}`, …). Uses only the contract, never storage, so it holds for any
// implementation.
export function describePostStore(name: string, makeStore: () => Promise<PostStoreFixture>): void {
  describe(`PostStore contract: ${name}`, () => {
    let fixture: PostStoreFixture;
    let store: PostStore;
    // Every unsubscribe watch gave this test, drained before the storage is freed, so a failing case still stops
    // listening.
    let unsubscribes: (() => void)[] = [];

    beforeEach(async () => {
      fixture = await makeStore();
      store = fixture.store;
      unsubscribes = [];
    });

    afterEach(async () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      await fixture.dispose();
    });

    // Subscribes and remembers the unsubscribe, so afterEach stops it even when the case fails part-way.
    const subscribe = (listener: () => void) => {
      const unsubscribe = store.watch(listener);
      unsubscribes.push(unsubscribe);
      return unsubscribe;
    };

    // A listener that counts its calls.
    const counter = () => {
      const listener = Object.assign(() => void listener.calls++, { calls: 0 });
      return listener;
    };

    test('every change through the store signals every subscription before its call settles', async () => {
      const a = counter();
      const b = counter();
      subscribe(a);
      subscribe(b);
      const changes: [string, () => Promise<unknown>][] = [];
      let id = '';
      changes.push(['create', async () => (id = await store.create({ title: 'Signalled', body: '' }))]);
      changes.push(['setBody', () => store.setBody(id, 'b')]);
      changes.push(['setTitle', () => store.setTitle(id, 't')]);
      changes.push(['delete', () => store.delete(id)]);
      for (const [name, change] of changes) {
        const before = [a.calls, b.calls];
        await change();
        expect({ name, a: a.calls > before[0], b: b.calls > before[1] }).toEqual({ name, a: true, b: true });
      }
    });

    test('a listener that throws is logged, and neither fails the change nor stops other listeners', async () => {
      const logged = spyOn(console, 'error').mockImplementation(() => {});
      try {
        subscribe(() => {
          throw new Error('listener broke');
        });
        const after = counter();
        subscribe(after);
        await store.create({ title: 'Still made', body: '' });
        await store.create({ title: 'Made again', body: '' });
        expect(after.calls).toBeGreaterThanOrEqual(2);
        expect(logged).toHaveBeenCalledWith('Could not report a post change: listener broke');
      } finally {
        logged.mockRestore();
      }
    });

    test('after unsubscribing, a listener hears nothing more, and unsubscribing twice is safe', async () => {
      const heard = counter();
      const unsubscribe = subscribe(heard);
      await store.create({ title: 'Heard', body: '' });
      unsubscribe();
      unsubscribe();
      const before = heard.calls;
      await store.create({ title: 'Unheard', body: '' });
      expect(heard.calls).toBe(before);
    });

    test('one function subscribed twice is called for each subscription, and unsubscribing one keeps the other', async () => {
      const twice = counter();
      const first = subscribe(twice);
      subscribe(twice);
      await store.create({ title: 'Twice', body: '' });
      expect(twice.calls).toBeGreaterThanOrEqual(2);
      first();
      const before = twice.calls;
      await store.create({ title: 'Once', body: '' });
      expect(twice.calls).toBeGreaterThan(before);
    });

    test('of two listeners that unsubscribe each other, exactly one is called', async () => {
      let stopA = () => {};
      let stopB = () => {};
      const a = Object.assign(() => void (a.calls++, stopB()), { calls: 0 });
      const b = Object.assign(() => void (b.calls++, stopA()), { calls: 0 });
      stopA = subscribe(a);
      stopB = subscribe(b);
      await store.create({ title: 'One of two', body: '' });
      expect([a.calls > 0, b.calls > 0].filter(Boolean)).toHaveLength(1);
      expect(Math.min(a.calls, b.calls)).toBe(0);
    });

    test('a call refused with a PostError signals nothing', async () => {
      const id = await store.create({ title: 'Quiet', body: '' });
      const heard = counter();
      subscribe(heard);
      await expectRefusal(store.create({ title: ' ', body: '' }), 'invalid', 'post');
      await expectRefusal(store.setTitle(id, ''), 'invalid', 'post');
      await expectRefusal(store.setBody('never given', 'b'), 'not-found', 'post');
      await expectRefusal(store.delete('never given'), 'not-found', 'post');
      expect(heard.calls).toBe(0);
    });

    test('a new store lists no posts', async () => {
      expect(await store.list()).toEqual({ posts: [] });
    });

    test('a created post can be got and is listed, with its title and body exactly as given', async () => {
      const id = await store.create({ title: '  The Sun  ', body: '# The Sun\n\nIt rises.' });
      expect(await store.get(id)).toEqual({ id, title: '  The Sun  ', body: '# The Sun\n\nIt rises.' });
      expect(await store.list()).toEqual({ posts: [{ id, title: '  The Sun  ' }] });
    });

    test('two posts made with one title get two ids', async () => {
      const first = await store.create({ title: 'Notes', body: 'one' });
      const second = await store.create({ title: 'Notes', body: 'two' });
      expect(second).not.toBe(first);
      expect(await store.get(first)).toEqual({ id: first, title: 'Notes', body: 'one' });
      expect(await store.get(second)).toEqual({ id: second, title: 'Notes', body: 'two' });
    });

    test('a blank title is refused as invalid, and nothing is made', async () => {
      for (const title of ['', ' \t\n', ' \u3000']) await expectRefusal(store.create({ title, body: 'b' }), 'invalid', 'post');
      expect(await store.list()).toEqual({ posts: [] });
    });

    test('a zero-width space is a title, not a blank one', async () => {
      const id = await store.create({ title: '\u200B', body: '' });
      expect((await store.get(id)).title).toBe('\u200B');
    });

    test('get refuses an empty id and an id never given out as not-found', async () => {
      await store.create({ title: 'Kept', body: '' });
      await expectRefusal(store.get(''), 'not-found', 'post');
      await expectRefusal(store.get('never given'), 'not-found', 'post');
    });

    test('a letter-case variant of an id names no post', async () => {
      const id = await store.create({ title: 'Mixed Case', body: '' });
      await expectRefusal(store.get(id.toUpperCase()), 'not-found', 'post');
      await expectRefusal(store.get(id.toLowerCase()), 'not-found', 'post');
    });

    test('setBody replaces the body and leaves the title', async () => {
      const id = await store.create({ title: 'Title', body: 'old' });
      await store.setBody(id, 'new');
      expect(await store.get(id)).toEqual({ id, title: 'Title', body: 'new' });
    });

    test('setTitle replaces the title and leaves the body', async () => {
      const id = await store.create({ title: 'Old', body: 'kept' });
      await store.setTitle(id, '  New  ');
      expect(await store.get(id)).toEqual({ id, title: '  New  ', body: 'kept' });
      expect(await store.list()).toEqual({ posts: [{ id, title: '  New  ' }] });
    });

    test('setTitle refuses a blank title as invalid and leaves the title, but takes a zero-width space', async () => {
      const id = await store.create({ title: 'Kept', body: '' });
      for (const title of ['', ' \t\n', ' \u3000']) await expectRefusal(store.setTitle(id, title), 'invalid', 'post');
      expect((await store.get(id)).title).toBe('Kept');
      await store.setTitle(id, '\u200B');
      expect((await store.get(id)).title).toBe('\u200B');
    });

    test('setBody and setTitle refuse an id that names no post, and never create one', async () => {
      const id = await store.create({ title: 'Kept', body: '' });
      const before = await store.list();
      for (const missing of ['', 'never given', id.toUpperCase()]) {
        await expectRefusal(store.setBody(missing, 'b'), 'not-found', 'post');
        await expectRefusal(store.setTitle(missing, 't'), 'not-found', 'post');
      }
      await expectRefusal(store.get('never given'), 'not-found', 'post');
      expect(await store.list()).toEqual(before);
    });

    test('calls on one post take effect in call order, awaited or not', async () => {
      const id = await store.create({ title: 'Ordered', body: '' });
      const first = store.setBody(id, 'a');
      const second = store.setBody(id, 'b');
      const read = store.get(id);
      await Promise.all([first, second]);
      expect((await read).body).toBe('b');
      expect((await store.get(id)).body).toBe('b');
    });

    test('a deleted post is not-found and no longer listed', async () => {
      const id = await store.create({ title: 'Doomed', body: '' });
      const kept = await store.create({ title: 'Kept', body: '' });
      await store.delete(id);
      await expectRefusal(store.get(id), 'not-found', 'post');
      expect(await store.list()).toEqual({ posts: [{ id: kept, title: 'Kept' }] });
    });

    test('the id of a deleted post is never given to a later post', async () => {
      const old = await store.create({ title: 'Again', body: 'old' });
      await store.delete(old);
      const fresh = await store.create({ title: 'Again', body: 'fresh' });
      expect(fresh).not.toBe(old);
      await expectRefusal(store.setBody(old, 'stale'), 'not-found', 'post');
      expect(await store.get(fresh)).toEqual({ id: fresh, title: 'Again', body: 'fresh' });
    });

    test('delete refuses an id that names no post', async () => {
      const id = await store.create({ title: 'Once', body: '' });
      await store.delete(id);
      for (const missing of ['', 'never given', id, id.toUpperCase()]) await expectRefusal(store.delete(missing), 'not-found', 'post');
    });

    test('a delete queued behind a setBody leaves no post, and a setBody queued behind a delete is not-found', async () => {
      const first = await store.create({ title: 'First', body: '' });
      const setting = store.setBody(first, 'b');
      const deleting = store.delete(first);
      await Promise.all([setting, deleting]);
      await expectRefusal(store.get(first), 'not-found', 'post');

      const second = await store.create({ title: 'Second', body: '' });
      const deletingAgain = store.delete(second);
      const late = store.setBody(second, 'b');
      await deletingAgain;
      await expectRefusal(late, 'not-found', 'post');
      expect(await store.list()).toEqual({ posts: [] });
    });

    test('bodies come back exactly as given', async () => {
      for (const body of ['', 'one\r\ntwo\r\n', 'café ☕ 日本語 😀', 'x'.repeat(1_000_000)]) {
        const id = await store.create({ title: 'Body', body });
        expect((await store.get(id)).body).toBe(body);
      }
    });

    test('the id create gives is one list gives, for a plain title and a decomposed one', async () => {
      for (const title of ['Plain', 'Cafe\u0301']) {
        const id = await store.create({ title, body: '' });
        expect((await store.list()).posts.map((post) => post.id)).toContain(id);
      }
    });

    test('a new post has no outline, and setOutline creates, replaces, and empties it', async () => {
      const id = await store.create({ title: 'Outlined', body: 'kept' });
      expect(await store.getOutline(id)).toBeNull();
      await store.setOutline(id, '- one');
      expect(await store.getOutline(id)).toBe('- one');
      await store.setOutline(id, '- two');
      expect(await store.getOutline(id)).toBe('- two');
      await store.setOutline(id, '');
      expect(await store.getOutline(id)).toBe('');
      expect(await store.get(id)).toEqual({ id, title: 'Outlined', body: 'kept' });
    });

    test('setOutline(null) removes the outline, and removing an absent outline resolves and leaves null', async () => {
      const id = await store.create({ title: 'Unoutlined', body: '' });
      await store.setOutline(id, null);
      expect(await store.getOutline(id)).toBeNull();
      await store.setOutline(id, '- gone soon');
      await store.setOutline(id, null);
      expect(await store.getOutline(id)).toBeNull();
    });

    test('outline calls on an id that names no post are not-found for the post, and never create one', async () => {
      const id = await store.create({ title: 'Once', body: '' });
      await store.delete(id);
      for (const missing of ['', 'never given', id]) {
        await expectRefusal(store.getOutline(missing), 'not-found', 'post');
        await expectRefusal(store.setOutline(missing, '- x'), 'not-found', 'post');
        await expectRefusal(store.setOutline(missing, null), 'not-found', 'post');
      }
      expect(await store.list()).toEqual({ posts: [] });
    });
  });
}
