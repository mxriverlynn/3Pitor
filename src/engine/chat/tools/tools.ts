// The model's file tools, and the one place model-driven file access happens. They read posts from the
// chat turn's copy (what the user sees in the editor) and change only that copy: a post reaches disk
// only through the user's Save. The exception is a markdown note under .3pitor/, which the server
// writes to disk itself and keeps out of the editor. Every path is turned into a key with normalizeKey and
// checked as one, and the file system refuses any key that climbs out of the workspace or through a link.
import { tool } from 'ai';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { FileSystemError, glob, normalizeKey, type FileSystem } from '../../../file-system/file-system';
import { unsupportedMarkdown } from '../../../shared/markdown-support';
import { textblocks } from '../../../shared/blocks';
import { parseMarkdown } from '../../../shared/markdown';
import { findQuote } from '../../../shared/passages';
import type { SessionHighlights } from '../../../shared/wire';
import { writeText } from '../../components/json-file';
import { APP_SKILL_PREFIX, appSkillText } from '../../workspace-config/workspace-config';

// One chat turn's copy of the posts it reads and edits, keyed by post name ("notes.md"). It starts
// from the text the user sees in the browser, so the model works on unsaved edits too.
export interface TurnTexts {
  texts: Map<string, string>;
  // Posts Edit or Write changed, in the order they last changed.
  edited: Set<string>;
  // The passages of the turn's last successful Highlight call, plus the text each Edit or Write put in since.
  highlights?: SessionHighlights;
}

export function turnTexts(documents: Record<string, string>): TurnTexts {
  const texts = new Map<string, string>();
  for (const [name, text] of Object.entries(documents)) texts.set(postName(name), text);
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

// A post's name as the documents API knows it: its key, so "./notes.md" is "notes.md".
export function postName(filePath: string): string {
  return resolvePost(filePath);
}

const NOTES_SAVED_DIRECTLY = 'A markdown file under .3pitor/ is saved directly and never opens in the editor.';

// The file tools the model gets. Read, Write, Edit, and Glob match Claude Code's names and input
// fields, so the UI's tool rows and workspace agents' `tools:` lines keep working. Highlight is 3pitor's
// own: it points the writer at passages in a post.
export function fileTools(fileSystem: FileSystem, turn: TurnTexts, onChange: () => void = () => {}) {
  // A post's text: the turn's copy, else the file on disk.
  const postText = async (name: string) => turn.texts.get(name) ?? (await fileSystem.read(name));
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
    description: 'Read a file in the workspace and return its text.',
    inputSchema: z.object({ file_path: z.string() }),
    execute: async ({ file_path }) => {
      // App skill files come from the build; posts from the turn's copy; anything else (a workspace skill
      // file, say) from disk.
      const skillText = appSkillText(file_path);
      if (skillText !== undefined) return skillText;
      const name = postNameOrUndefined(file_path);
      if (name !== undefined && turn.texts.has(name)) return turn.texts.get(name)!;
      return readExisting(normalizeKey(file_path), file_path);
    },
  });
  const Write = tool({
    description: `Create or replace a whole markdown post. It opens in the editor, unsaved, for the user to review and save. ${NOTES_SAVED_DIRECTLY}`,
    inputSchema: z.object({ file_path: z.string(), content: z.string() }),
    execute: async ({ file_path, content }) => {
      const note = resolveAppNote(file_path);
      if (note !== undefined) {
        await writeText(fileSystem, note, content);
        return `wrote ${note}`;
      }
      const name = postName(file_path);
      const text = turn.texts.get(name) ?? (await fileSystem.read(name).catch((error: unknown) => {
        if (error instanceof FileSystemError && error.reason === 'not-found') return '';
        throw error;
      }));
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
      `Change part of a markdown post by replacing old_string, which must occur exactly once, with new_string. The change appears in the editor, unsaved, for the user to review and save. ${NOTES_SAVED_DIRECTLY}`,
    inputSchema: z.object({ file_path: z.string(), old_string: z.string(), new_string: z.string() }),
    execute: async ({ file_path, old_string, new_string }) => {
      const note = resolveAppNote(file_path);
      if (note !== undefined) {
        const text = await readExisting(note, file_path);
        await writeText(fileSystem, note, replaceOnce(note, text, old_string, new_string));
        return `edited ${note}`;
      }
      const name = postName(file_path);
      const text = await postText(name);
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
      return (await glob(fileSystem, pattern)).sort().join('\n');
    },
  });
  const Highlight = tool({
    description:
      "Highlight passages of a markdown post in the writer's editor, to point at what you are discussing. Each quote must be text copied from the post that occurs exactly once in it, within one paragraph, heading, or list item. Each call replaces the passages highlighted before; they stay until the next call, so once a question is answered, call again with only the ones still open. Give each passage a distinct label, such as Q1, and put the question you ask about it in `question`, in the same words as the chat, without the label. Start your question in the chat with that label. Edit and Write highlight the text they change on their own, so never call Highlight just to mark your changes. To clear every highlight, call it with no passages.",
    inputSchema: z.object({
      file_path: z.string(),
      passages: z
        .array(z.object({ quote: z.string().min(1), label: z.string().min(1).optional(), question: z.string().min(1).optional() })),
    }),
    execute: async ({ file_path, passages }) => {
      const labels = passages.flatMap((p) => (p.label ? [p.label] : []));
      const repeated = labels.find((label, i) => labels.indexOf(label) !== i);
      if (repeated) throw new Error(`label "${repeated}" is used twice`);
      const name = postName(file_path);
      const text = await postText(name);
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
  return { Read, Write, Edit, Glob, Highlight };
}

// The text of each paragraph, heading, list item paragraph, and code block in a post, in order: the
// same blocks the editor shows, so a quote Highlight accepts is one the editor can find.
export function postBlocks(markdown: string): string[] {
  return textblocks(parseMarkdown(markdown)).map((block) => block.text);
}

// The key of a markdown post: a .md file outside dot-folders, which keeps the model out of .git/ and .claude/. The app's
// skill files are refused too, since they are read-only.
function resolvePost(filePath: string): string {
  if (filePath.startsWith(APP_SKILL_PREFIX)) throw new Error(`${filePath} is not a markdown post`);
  const key = normalizeKey(filePath);
  if (!key.endsWith('.md') || key.split('/').some((s) => s.startsWith('.'))) {
    throw new Error(`${filePath} is not a markdown post`);
  }
  return key;
}

// The key of a markdown note under .3pitor/, which the server writes to disk itself, or undefined for anything else.
// A path that is not clearly a note falls through to resolvePost and is refused there.
function resolveAppNote(filePath: string): string | undefined {
  if (filePath.startsWith(APP_SKILL_PREFIX)) return undefined;
  const key = normalizeKey(filePath);
  const [folder, ...rest] = key.split('/');
  if (folder !== '.3pitor' || !rest.length || !key.endsWith('.md') || rest.some((s) => s.startsWith('.'))) return undefined;
  return key;
}

function postNameOrUndefined(filePath: string): string | undefined {
  try {
    return postName(filePath);
  } catch {
    return undefined;
  }
}
