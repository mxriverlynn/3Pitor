// The model's file tools, and the one place model-driven file access happens. They read posts, outlines, and research
// documents from the chat turn's copy (what the user sees in the editor), else the post store, and change only that
// copy: their text reaches disk only through the user's Save. The exceptions are the post NewPost makes, holding only
// its title as its # heading, the empty research document NewResearchDocument makes, and a markdown note under
// .3pitor/, which the server writes to disk itself and keeps out of the editor. Every path is turned into a key with
// normalizeKey and checked as one, and the file system refuses any key that climbs out of the workspace or through a
// link.
import { tool } from 'ai';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { FileSystemError, normalizeKey, type FileSystem } from '../../../file-system/file-system';
import { unsupportedMarkdown } from '../../../shared/markdown-support';
import { textblocks } from '../../../shared/blocks';
import { titleText, withHeadingTitle } from '../../../shared/title-row';
import { parseMarkdown } from '../../../shared/markdown';
import { findQuote } from '../../../shared/passages';
import { documentKey, parseDocumentKey } from '../../../shared/document-key';
import type { SessionHighlights } from '../../../shared/wire';
import type { PostStore, PostSummary } from '../../../posts/posts';
import { PostError } from '../../../posts/post-error';
import { writeText } from '../../components/json-file';
import { APP_SKILL_PREFIX, appSkillText, type AppSkillFiles } from '../../workspace-config/workspace-config';

// One chat turn's copy of the posts it reads and edits, keyed by post id ("the sun"), exactly as the browser sent it.
// It starts from the text the user sees in the browser, so the model works on unsaved edits too.
export interface TurnTexts {
  texts: Map<string, string>;
  // Posts Edit or Write changed, in the order they last changed.
  edited: Set<string>;
  // The passages of the turn's last successful Highlight call, plus the text each Edit or Write put in since.
  highlights?: SessionHighlights;
}

export function turnTexts(documents: Record<string, string>): TurnTexts {
  const texts = new Map<string, string>();
  for (const [id, text] of Object.entries(documents)) if (id !== '') texts.set(id, text);
  return { texts, edited: new Set() };
}

// The final text of every post the turn changed, in the order they last changed.
export function editedTexts(turn: TurnTexts): Record<string, string> {
  return Object.fromEntries([...turn.edited].map((name) => [name, turn.texts.get(name)!]));
}

// The editor flattens these, so an edit applied there would become damage on Save. Checking the
// current text first also catches a post that already has them.
function refuseUnsupported(name: string, text: string, next: string) {
  const has = unsupportedMarkdown(text);
  if (has.length) throw new Error(`${name} has ${has.join(' and ')}, which the editor can't keep, so it can't be edited here`);
  const adds = unsupportedMarkdown(next);
  if (adds.length) throw new Error(`the edit would add ${adds.join(' and ')} to ${name}, which the editor can't keep`);
}

// Edit's replacement: `oldString` must occur exactly once in the text of the file called `name`.
function replaceOnce(name: string, text: string, oldString: string, newString: string): string {
  const count = text.split(oldString).length - 1;
  if (count === 0) throw new Error(`old_string not found in ${name}`);
  if (count > 1) throw new Error(`old_string appears ${count} times in ${name}`);
  return text.replace(oldString, () => newString);
}

// Re-adding the name keeps `edited` in last-changed order.
function markEdited(turn: TurnTexts, name: string, text: string) {
  turn.texts.set(name, text);
  turn.edited.delete(name);
  turn.edited.add(name);
}

// Adds `quotes`, the text an edit put in the post, to the turn's highlights of it, so the writer sees each change as
// it lands. Earlier passages the edit changed drop out, and so does any quote that does not occur exactly once.
function highlightChanges(turn: TurnTexts, name: string, text: string, quotes: string[]) {
  const blocks = postBlocks(text);
  const found = (quote: string) => quote !== '' && findQuote(blocks, quote).length === 1;
  const earlier = turn.highlights?.file === name ? turn.highlights.passages.filter((p) => found(p.quote)) : [];
  turn.highlights = { file: name, passages: [...earlier, ...quotes.filter(found).map((quote) => ({ quote }))] };
}

const NOTES_SAVED_DIRECTLY = 'A markdown file under .3pitor/ is saved directly and never opens in the editor.';

// The file tools the model gets. Read, Write, Edit, and Glob match Claude Code's names and input
// fields, so the UI's tool rows and workspace agents' `tools:` lines keep working. Highlight is 3pitor's
// own: it points the writer at passages in a post, and Posts lists the posts by id and title.
export function fileTools(fileSystem: FileSystem, posts: Pick<PostStore, 'get' | 'list' | 'create' | 'getOutline' | 'getResearchDocument' | 'createResearchDocument'>, appSkillFiles: AppSkillFiles, turn: TurnTexts, onChange: () => void = () => {}) {
  // A post's body from the store, or undefined when the id names no post.
  const storedBody = async (id: string) => {
    try {
      return (await posts.get(id)).body;
    } catch (error) {
      if (error instanceof PostError && error.reason === 'not-found') return undefined;
      throw error;
    }
  };
  const notAPost = (key: string) => new Error(`${key} is not a post. Call Posts to list the posts by id, or NewPost to make one.`);
  // The document a tool names, by its exact key, and its text: the turn's copy, else the store's. A post's key is its
  // id; an outline's or research document's is the name the open-document sentence or NewResearchDocument gave. An
  // outline the post does not have yet is empty, and marked absent. Anything else is refused, so the AI changes only
  // documents (and its .3pitor/ notes), never another workspace file.
  const target = async (key: string): Promise<{ name: string; text: string; absentOutline?: boolean }> => {
    const copy = turn.texts.get(key);
    if (copy !== undefined) return { name: key, text: copy };
    const ref = parseDocumentKey(key);
    if (ref?.kind === 'outline' || ref?.kind === 'research') {
      try {
        if (ref.kind === 'research') return { name: key, text: (await posts.getResearchDocument(ref.postId, ref.researchDocumentId)).body };
        const outline = await posts.getOutline(ref.postId);
        return outline === null ? { name: key, text: '', absentOutline: true } : { name: key, text: outline };
      } catch (error) {
        if (!(error instanceof PostError && error.reason === 'not-found')) throw error;
        if (error.subject === 'post') throw notAPost(ref.postId);
        throw new Error(`${key} is not a research document of the post ${JSON.stringify(ref.postId)}. NewResearchDocument makes one.`);
      }
    }
    // A mangled tagged key is pointed back at the name it was given, rather than toward making a stray post.
    if (key.startsWith('.[')) {
      throw new Error(`${key} is not a document. Name an outline or research document exactly as my message or NewResearchDocument gave it.`);
    }
    const text = await storedBody(key);
    if (text === undefined) throw notAPost(key);
    return { name: key, text };
  };
  // A file's text, or `${filePath} does not exist` when there is none.
  const readExisting = async (key: string, filePath: string) => {
    try {
      return await fileSystem.read(key);
    } catch (error) {
      if (error instanceof FileSystemError && error.reason === 'not-found') throw new Error(`${filePath} does not exist`);
      throw error;
    }
  };
  const Read = tool({
    description: 'Read a post by its id, or any other workspace file by its path, and return its text.',
    inputSchema: z.object({ file_path: z.string() }),
    execute: async ({ file_path }) => {
      // App skill files come from the host's appSkillFiles; posts from the turn's copy; anything else (a
      // workspace skill file, say) from disk.
      const skillText = appSkillText(appSkillFiles, file_path);
      if (skillText !== undefined) return skillText;
      if (turn.texts.has(file_path)) return turn.texts.get(file_path)!;
      if (file_path.startsWith('.[')) {
        const { text, absentOutline } = await target(file_path);
        const ref = parseDocumentKey(file_path);
        if (absentOutline && ref) return `the post ${JSON.stringify(ref.postId)} has no outline yet; Write the whole outline to ${file_path} to make one`;
        return text;
      }
      const body = await storedBody(file_path);
      if (body !== undefined) return body;
      return readExisting(normalizeKey(file_path), file_path);
    },
  });
  const Write = tool({
    description: `Replace the whole text of a post, named by its id. It opens in the editor, unsaved, for the user to review and save. To make a new post, use NewPost. ${NOTES_SAVED_DIRECTLY}`,
    inputSchema: z.object({ file_path: z.string(), content: z.string() }),
    execute: async ({ file_path, content }) => {
      const note = resolveAppNote(file_path);
      if (note !== undefined) {
        await writeText(fileSystem, note, content);
        return `wrote ${note}`;
      }
      const { name, text } = await target(file_path);
      refuseUnsupported(name, text, content);
      markEdited(turn, name, content);
      const before = new Set(postBlocks(text));
      highlightChanges(turn, name, content, postBlocks(content).filter((block) => !before.has(block)));
      onChange();
      return `wrote ${name}`;
    },
  });
  const Edit = tool({
    description:
      `Change part of a post, named by its id, by replacing old_string, which must occur exactly once, with new_string. The change appears in the editor, unsaved, for the user to review and save. ${NOTES_SAVED_DIRECTLY}`,
    inputSchema: z.object({ file_path: z.string(), old_string: z.string(), new_string: z.string() }),
    execute: async ({ file_path, old_string, new_string }) => {
      const note = resolveAppNote(file_path);
      if (note !== undefined) {
        const text = await readExisting(note, file_path);
        await writeText(fileSystem, note, replaceOnce(note, text, old_string, new_string));
        return `edited ${note}`;
      }
      const { name, text } = await target(file_path);
      const next = replaceOnce(name, text, old_string, new_string);
      refuseUnsupported(name, text, next);
      markEdited(turn, name, next);
      highlightChanges(turn, name, next, postBlocks(new_string));
      onChange();
      return `edited ${name}`;
    },
  });
  const Glob = tool({
    description: 'List the workspace files matching a glob pattern, such as **/*.md, one path per line.',
    inputSchema: z.object({ pattern: z.string() }),
    execute: async ({ pattern }) => {
      if (isAbsolute(pattern) || pattern.split('/').includes('..')) throw new Error(`${pattern} is outside the workspace`);
      return (await fileSystem.glob(pattern)).sort().join('\n');
    },
  });
  const Highlight = tool({
    description:
      "Highlight passages of a post, named by its id, in the writer's editor, to point at what you are discussing. Each quote must be text copied from the post that occurs exactly once in it, within one paragraph, heading, or list item. Each call replaces the passages highlighted before; they stay until the next call, so once a question is answered, call again with only the ones still open. Give each passage a distinct label, such as Q1, and put the question you ask about it in `question`, in the same words as the chat, without the label. Start your question in the chat with that label. Edit and Write highlight the text they change on their own, so never call Highlight just to mark your changes. To clear every highlight, call it with no passages.",
    inputSchema: z.object({
      file_path: z.string(),
      passages: z
        .array(z.object({ quote: z.string().min(1), label: z.string().min(1).optional(), question: z.string().min(1).optional() })),
    }),
    execute: async ({ file_path, passages }) => {
      const labels = passages.flatMap((p) => (p.label ? [p.label] : []));
      const repeated = labels.find((label, i) => labels.indexOf(label) !== i);
      if (repeated) throw new Error(`label "${repeated}" is used twice`);
      const { name, text } = await target(file_path);
      const blocks = postBlocks(text);
      for (const { quote } of passages) {
        const count = findQuote(blocks, quote).length;
        if (count === 0) throw new Error(`"${quote}" is not in ${name}`);
        if (count > 1) throw new Error(`"${quote}" appears ${count} times in ${name}; quote more of it`);
      }
      turn.highlights = { file: name, passages };
      onChange();
      return passages.length ? `highlighted ${passages.length} passages in ${name}` : `cleared the highlights in ${name}`;
    },
  });
  const Posts = tool({
    description: "List the writer's posts as JSON: each post's id, which names it to every other tool, and its title.",
    inputSchema: z.object({}),
    execute: async () => {
      const { posts: listed } = await posts.list();
      const order = (a: PostSummary, b: PostSummary) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return JSON.stringify(listed.map(({ id, title }) => ({ id, title })).sort(order));
    },
  });
  const NewPost = tool({
    description:
      "Make a new post with a title and its text. The post is made at once, holding only its title as a # heading. The text, with its first # heading set to the title (or the title added as one at the top), appears in the writer's editor as an unsaved edit, for them to review and save. Returns the new post's id, which names it to the other tools.",
    inputSchema: z.object({ title: z.string(), content: z.string() }),
    execute: async ({ title: given, content }) => {
      const title = titleText(given);
      const body = withHeadingTitle('', title);
      const text = withHeadingTitle(content, title);
      refuseUnsupported(title, '', text);
      let id: string;
      try {
        id = await posts.create({ title, body });
      } catch (error) {
        // A refusal is the model's to fix, such as a blank title, so it is the answer rather than a failure.
        if (error instanceof PostError) return error.message;
        throw error;
      }
      markEdited(turn, id, text);
      const stored = new Set(postBlocks(body));
      highlightChanges(turn, id, text, postBlocks(text).filter((block) => !stored.has(block)));
      onChange();
      return `made post ${JSON.stringify(id)} titled ${JSON.stringify(title)}; its text is in the editor, unsaved`;
    },
  });
  const NewResearchDocument = tool({
    description:
      "Save research as a new research document of a post, from a title and its text. The document is made empty at once, and the text appears in the writer's editor as an unsaved edit, for them to review and save. The post's own text is not changed. Returns the document's name, which names it to Read, Edit, Write, and Highlight.",
    inputSchema: z.object({ post_id: z.string(), title: z.string(), content: z.string() }),
    execute: async ({ post_id, title, content }) => {
      if (parseDocumentKey(post_id)?.kind !== 'post') return `${post_id} is not a post. Call Posts to list the posts by id.`;
      refuseUnsupported(title, '', content);
      let researchDocumentId: string;
      try {
        researchDocumentId = await posts.createResearchDocument(post_id, { title, body: '' });
      } catch (error) {
        // As with NewPost, a refusal is the model's to fix, so it is the answer rather than a failure.
        if (error instanceof PostError) return error.message;
        throw error;
      }
      const key = documentKey({ kind: 'research', postId: post_id, researchDocumentId });
      markEdited(turn, key, content);
      highlightChanges(turn, key, content, postBlocks(content));
      onChange();
      return `made research document ${key} titled ${JSON.stringify(title)} on post ${JSON.stringify(post_id)}; its text is in the editor, unsaved`;
    },
  });
  return { Read, Write, Edit, Glob, Highlight, Posts, NewPost, NewResearchDocument };
}

// The text of each paragraph, heading, list item paragraph, and code block in a post, in order: the
// same blocks the editor shows, so a quote Highlight accepts is one the editor can find.
export function postBlocks(markdown: string): string[] {
  return textblocks(parseMarkdown(markdown)).map((block) => block.text);
}

// The key of a markdown note under .3pitor/, which the server writes to disk itself, or undefined for anything else.
// A path that is not clearly a note is taken as a document's key, and a name starting `.[` is always one.
function resolveAppNote(filePath: string): string | undefined {
  if (filePath.startsWith(APP_SKILL_PREFIX) || filePath.startsWith('.[')) return undefined;
  const key = normalizeKey(filePath);
  const [folder, ...rest] = key.split('/');
  if (folder !== '.3pitor' || !rest.length || !key.endsWith('.md') || rest.some((s) => s.startsWith('.'))) return undefined;
  return key;
}
