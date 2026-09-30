// The model's file tools, and the one place model-driven file access happens. They read posts from the
// chat turn's copy (what the user sees in the editor) and change only that copy: nothing here writes a
// file, because only the user's Save does. Every path is checked against the workspace's real location
// on disk, so neither `..` nor a symlink can lead outside it.
import { tool } from 'ai';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { z } from 'zod';
import { unsupportedMarkdown } from '../../../shared/markdown-support';
import { textblocks } from '../../../shared/blocks';
import { parseMarkdown } from '../../../shared/markdown';
import { findQuote } from '../../../shared/passages';
import type { SessionHighlights } from '../../../shared/wire';
import { resolveInWorkspace } from '../../components/workspace-path';
import { APP_SKILL_PREFIX, appSkillText } from '../../workspace-config/workspace-config';

// One chat turn's copy of the posts it reads and edits, keyed by post name ("notes.md"). It starts
// from the text the user sees in the browser, so the model works on unsaved edits too.
export interface TurnTexts {
  texts: Map<string, string>;
  // Posts Edit or Write changed, in the order they last changed.
  edited: Set<string>;
  // The passages of the turn's last successful Highlight call.
  highlights?: SessionHighlights;
}

export function turnTexts(workspace: string, documents: Record<string, string>): TurnTexts {
  const texts = new Map<string, string>();
  for (const [name, text] of Object.entries(documents)) texts.set(postName(workspace, name), text);
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

// Re-adding the name keeps `edited` in last-changed order.
function markEdited(turn: TurnTexts, name: string, text: string) {
  turn.texts.set(name, text);
  turn.edited.delete(name);
  turn.edited.add(name);
}

// A post's name as the documents API knows it: workspace-relative, so "./notes.md" is "notes.md".
export function postName(workspace: string, filePath: string): string {
  return relative(realpathSync(workspace), resolvePost(workspace, filePath));
}

// The file tools the model gets. Read, Write, Edit, and Glob match Claude Code's names and input
// fields, so the UI's tool rows and workspace agents' `tools:` lines keep working. Highlight is 3pitor's
// own: it points the writer at passages in a post.
export function fileTools(workspace: string, turn: TurnTexts) {
  // A post's text: the turn's copy, else the file on disk.
  const postText = async (name: string, filePath: string) =>
    turn.texts.get(name) ?? (await Bun.file(resolvePost(workspace, filePath)).text());
  const Read = tool({
    description: 'Read a file in the workspace and return its text.',
    inputSchema: z.object({ file_path: z.string() }),
    execute: async ({ file_path }) => {
      // App skill files come from the build; posts from the turn's copy; anything else (a workspace skill
      // file, say) from disk.
      const skillText = appSkillText(file_path);
      if (skillText !== undefined) return skillText;
      const name = postNameOrUndefined(workspace, file_path);
      if (name !== undefined && turn.texts.has(name)) return turn.texts.get(name)!;
      const file = Bun.file(resolveInWorkspace(workspace, file_path));
      if (!(await file.exists())) throw new Error(`${file_path} does not exist`);
      return file.text();
    },
  });
  const Write = tool({
    description: 'Create or replace a whole markdown post. It opens in the editor, unsaved, for the user to review and save.',
    inputSchema: z.object({ file_path: z.string(), content: z.string() }),
    execute: async ({ file_path, content }) => {
      const name = postName(workspace, file_path);
      const file = Bun.file(resolvePost(workspace, file_path));
      const text = turn.texts.get(name) ?? ((await file.exists()) ? await file.text() : '');
      refuseUnsupported(name, text, content);
      markEdited(turn, name, content);
      return `wrote ${name}`;
    },
  });
  const Edit = tool({
    description:
      'Change part of a markdown post by replacing old_string, which must occur exactly once, with new_string. The change appears in the editor, unsaved, for the user to review and save.',
    inputSchema: z.object({ file_path: z.string(), old_string: z.string(), new_string: z.string() }),
    execute: async ({ file_path, old_string, new_string }) => {
      const name = postName(workspace, file_path);
      const text = await postText(name, file_path);
      const count = text.split(old_string).length - 1;
      if (count === 0) throw new Error(`old_string not found in ${name}`);
      if (count > 1) throw new Error(`old_string appears ${count} times in ${name}`);
      const next = text.replace(old_string, () => new_string);
      refuseUnsupported(name, text, next);
      markEdited(turn, name, next);
      return `edited ${name}`;
    },
  });
  const Glob = tool({
    description: 'List the workspace files matching a glob pattern, such as **/*.md, one path per line.',
    inputSchema: z.object({ pattern: z.string() }),
    execute: async ({ pattern }) => {
      if (isAbsolute(pattern) || pattern.split('/').includes('..')) throw new Error(`${pattern} is outside the workspace`);
      const matches = await Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: workspace, onlyFiles: true }));
      return matches.filter((match) => insideWorkspace(workspace, match)).sort().join('\n');
    },
  });
  const Highlight = tool({
    description:
      "Highlight passages of a markdown post in the writer's editor, to point at what you are discussing. Each quote must be text copied from the post that occurs exactly once in it, within one paragraph, heading, or list item. Each call replaces the passages highlighted before; they stay until the next call, so once a question is answered, call again with only the ones still open. Give each passage a distinct label, such as Q1, and put the question you ask about it in `question`, in the same words as the chat, without the label. Start your question in the chat with that label. To mark changes you made rather than ask about them, give no labels. To clear every highlight, call it with no passages.",
    inputSchema: z.object({
      file_path: z.string(),
      passages: z
        .array(z.object({ quote: z.string().min(1), label: z.string().min(1).optional(), question: z.string().min(1).optional() })),
    }),
    execute: async ({ file_path, passages }) => {
      const labels = passages.flatMap((p) => (p.label ? [p.label] : []));
      const repeated = labels.find((label, i) => labels.indexOf(label) !== i);
      if (repeated) throw new Error(`label "${repeated}" is used twice`);
      const name = postName(workspace, file_path);
      const text = await postText(name, file_path);
      const blocks = postBlocks(text);
      for (const { quote } of passages) {
        const count = findQuote(blocks, quote).length;
        if (count === 0) throw new Error(`"${quote}" is not in ${name}`);
        if (count > 1) throw new Error(`"${quote}" appears ${count} times in ${name}; quote more of it`);
      }
      turn.highlights = { file: name, passages };
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

// Like resolveInWorkspace, and also refuses anything but a .md file outside dot-folders, which keeps
// the model out of .git/ and .claude/, and refuses the app's skill files, which are read-only.
function resolvePost(workspace: string, filePath: string): string {
  if (filePath.startsWith(APP_SKILL_PREFIX)) throw new Error(`${filePath} is not a markdown post`);
  const target = resolveInWorkspace(workspace, filePath);
  const segments = relative(realpathSync(workspace), target).split(sep);
  if (!target.endsWith('.md') || segments.some((s) => s.startsWith('.'))) {
    throw new Error(`${filePath} is not a markdown post`);
  }
  return target;
}

function postNameOrUndefined(workspace: string, filePath: string): string | undefined {
  try {
    return postName(workspace, filePath);
  } catch {
    return undefined;
  }
}

function insideWorkspace(workspace: string, filePath: string): boolean {
  try {
    resolveInWorkspace(workspace, filePath);
    return true;
  } catch {
    return false;
  }
}
