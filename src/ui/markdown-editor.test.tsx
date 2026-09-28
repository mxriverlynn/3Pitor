import { expect, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import * as Y from 'yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import { docFromMarkdown, markdownOf, MarkdownEditor, mergeMarkdown, snapshot } from './markdown-editor';

const POST = '# Garden Plan\n\nThe quick brown fox.\n\nWater the beans.\n';
// The post as the editor writes it out, which is the text the AI's edits start from.
const WRITTEN = markdownOf(docFromMarkdown(POST));

// Types into a paragraph the way the editor's own keystrokes reach the document: through ySyncPlugin.
function type(doc: Y.Doc, paragraph: number, offset: number, text: string) {
  doc.transact(() => {
    const block = doc.getXmlFragment('prosemirror').get(paragraph) as Y.XmlElement;
    (block.get(0) as Y.XmlText).insert(offset, text);
  }, ySyncPluginKey);
}

// Renders the editor, then returns what it shows as plain text, one line per block.
async function showing(doc: Y.Doc) {
  const view = render(<MarkdownEditor doc={doc} readOnly={false} />);
  await act(async () => {});
  return {
    text: () => [...view.container.querySelectorAll('.ProseMirror > *')].map((el) => el.textContent).join('\n'),
    view,
  };
}

test('an AI edit and typing in another paragraph both show in the editor', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc);
  const base = snapshot(doc);

  await act(async () => type(doc, 2, 0, 'Then '));
  await act(async () => mergeMarkdown(doc, base, WRITTEN.replace('quick brown', 'slow red')));

  expect(editor.text()).toBe('Garden Plan\nThe slow red fox.\nThen Water the beans.');
});

test('an AI edit and typing in the same paragraph both show in the editor', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc);
  const base = snapshot(doc);

  await act(async () => type(doc, 1, 20, ' It naps.'));
  await act(async () => mergeMarkdown(doc, base, WRITTEN.replace('quick brown', 'slow red')));

  expect(editor.text()).toBe('Garden Plan\nThe slow red fox. It naps.\nWater the beans.');
});

test('an AI edit that adds a paragraph keeps typing done meanwhile', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc);
  const base = snapshot(doc);

  await act(async () => type(doc, 2, 0, 'Then '));
  await act(async () => mergeMarkdown(doc, base, `${WRITTEN}\n\nPick the tomatoes.\n`));

  expect(editor.text()).toBe('Garden Plan\nThe quick brown fox.\nThen Water the beans.\nPick the tomatoes.');
});

test('one undo after an AI edit takes back only the AI edit', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc);
  const base = snapshot(doc);

  await act(async () => type(doc, 2, 0, 'Then '));
  await act(async () => mergeMarkdown(doc, base, WRITTEN.replace('quick brown', 'slow red')));
  // happy-dom does not report a Mac, so Mod-z is Ctrl-z here.
  await act(async () => {
    fireEvent.keyDown(editor.view.container.querySelector('.ProseMirror')!, { key: 'z', ctrlKey: true });
  });

  expect(editor.text()).toBe('Garden Plan\nThe quick brown fox.\nThen Water the beans.');
});
