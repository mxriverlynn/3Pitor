import { expect, mock, spyOn, test } from 'bun:test';
import { act, fireEvent, render, within } from '@testing-library/react';
import * as Y from 'yjs';
import { ySyncPluginKey, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { defaultMarkdownParser, schema } from 'prosemirror-markdown';
import { EditorState } from 'prosemirror-state';
import type { DecorationSet } from 'prosemirror-view';
import { postBlocks } from '../server/tools';
import type { Passage } from '../shared/wire';
import { type Ask, blocksOf, docFromMarkdown, highlightsPlugin, markdownOf, MarkdownEditor, mergeMarkdown, snapshot } from './markdown-editor';

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
async function showing(doc: Y.Doc, highlights: Passage[] = [], onAsk?: (ask: Ask) => void) {
  const view = render(<MarkdownEditor doc={doc} readOnly={false} highlights={highlights} onAsk={onAsk} />);
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

test('splits a post into the same blocks as the server does, so a quote the server accepts is one the editor finds', () => {
  const md =
    '# Garden *Plan*\n\nMost gardeners **never** test\ntheir [soil](https://example.com) with `pH` strips.\n\n- beans\n- the *tomatoes*\n\n```\nwater();\n```\n';
  const doc = yXmlFragmentToProseMirrorRootNode(docFromMarkdown(md).getXmlFragment('prosemirror'), schema);
  expect(postBlocks(md).length).toBe(5);
  expect(blocksOf(doc).map((b) => b.text)).toEqual(postBlocks(md));
});

// What the editor highlights: each passage's text, and each label chip's text.
function highlighted(container: HTMLElement) {
  return {
    marks: [...container.querySelectorAll('mark.ai-highlight')].map((el) => el.textContent),
    labels: [...container.querySelectorAll('.ai-highlight-label')].map((el) => el.textContent),
    status: container.querySelector('.highlight-status')?.textContent,
  };
}

test('highlights a passage with its label, and says how many passages it highlighted', async () => {
  const editor = await showing(docFromMarkdown(POST), [{ quote: 'quick brown', label: 'Q1' }]);

  expect(highlighted(editor.view.container)).toEqual({ marks: ['quick brown'], labels: ['Q1'], status: 'Highlighted 1 of 1 passages' });
  expect(editor.view.container.querySelector('.highlight-status')?.getAttribute('aria-live')).toBe('polite');
});

test('leaves out a passage the post no longer holds, and counts it as not highlighted', async () => {
  const editor = await showing(docFromMarkdown(POST), [
    { quote: 'quick brown', label: 'Q1' },
    { quote: 'purple cow', label: 'Q2' },
  ]);

  expect(highlighted(editor.view.container)).toEqual({ marks: ['quick brown'], labels: ['Q1'], status: 'Highlighted 1 of 2 passages' });
});

test('typing inside a highlighted passage stretches its highlight, and deleting the passage removes it', () => {
  const plugin = highlightsPlugin([{ quote: 'quick brown', label: 'Q1' }], () => {});
  let state = EditorState.create({ doc: defaultMarkdownParser.parse(POST)!, plugins: [plugin] });
  // The highlighted text, and how many label chips there are.
  const drawn = () => {
    const found = (plugin.props.decorations!.call(plugin, state) as DecorationSet).find();
    return {
      text: found.filter((d) => d.from < d.to).map((d) => state.doc.textBetween(d.from, d.to)),
      labels: found.filter((d) => d.from === d.to).length,
    };
  };
  const paragraph = blocksOf(state.doc)[1].pos;

  state = state.apply(state.tr.insertText('very ', paragraph + 'The quick '.length));
  expect(drawn()).toEqual({ text: ['quick very brown'], labels: 1 });

  state = state.apply(state.tr.delete(paragraph + 'The '.length, paragraph + 'The quick very brown'.length));
  expect(drawn()).toEqual({ text: [], labels: 0 });
});

test('a highlight stays on its passage when an AI edit elsewhere in the post merges in', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc, [{ quote: 'quick brown', label: 'Q1' }]);
  const base = snapshot(doc);

  await act(async () => mergeMarkdown(doc, base, WRITTEN.replace('Water', 'Weed')));

  expect(editor.text()).toContain('Weed the beans.');
  expect(highlighted(editor.view.container)).toEqual({ marks: ['quick brown'], labels: ['Q1'], status: 'Highlighted 1 of 1 passages' });
});

test('highlights a passage that follows a line break in the same paragraph', async () => {
  const editor = await showing(docFromMarkdown('Roses are red\\\nThe quick brown fox.\n'), [{ quote: 'quick brown' }]);

  expect(highlighted(editor.view.container).marks).toEqual(['quick brown']);
});

test('brings the first highlighted passage into view, unless the writer is typing in the editor', async () => {
  const scrolled: string[] = [];
  const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
    scrolled.push(this.textContent ?? '');
  });
  const doc = docFromMarkdown(POST);
  const passages = [{ quote: 'quick brown' }, { quote: 'the beans' }];
  const editor = await showing(doc);

  editor.view.rerender(<MarkdownEditor doc={doc} readOnly={false} highlights={passages} />);
  await act(async () => {});
  expect(scrolled).toEqual(['quick brown']);

  (editor.view.container.querySelector('.ProseMirror') as HTMLElement).focus();
  editor.view.rerender(<MarkdownEditor doc={doc} readOnly={false} highlights={[{ quote: 'the beans' }]} />);
  await act(async () => {});
  expect(scrolled).toEqual(['quick brown']);
  scroll.mockRestore();
});

test('clicking a label reports the passage it labels now, even after a later turn moved the label', async () => {
  const onAsk = mock((_ask: Ask) => {});
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc, [{ quote: 'quick brown', label: 'Q1', question: 'Too plain?' }], onAsk);
  const later = { quote: 'Water the beans', label: 'Q1', question: 'Say how often?' };
  editor.view.rerender(<MarkdownEditor doc={doc} readOnly={false} highlights={[later]} onAsk={onAsk} />);
  await act(async () => {});

  const chip = editor.view.container.querySelector('.ai-highlight-label') as HTMLElement;
  fireEvent.click(chip);

  expect(onAsk.mock.calls.map(([ask]) => ask.passage)).toEqual([later]);
  expect(onAsk.mock.calls[0]?.[0].anchor).toBe(chip);
});

test('pressing on a label keeps the caret where it was: the browser never gets to move it', async () => {
  const editor = await showing(docFromMarkdown(POST), [{ quote: 'quick brown', label: 'Q1' }]);

  const chip = editor.view.container.querySelector('.ai-highlight-label') as HTMLElement;
  const allowed = fireEvent.mouseDown(chip);

  expect(allowed).toBe(false);
});

test('a label is a button, so the writer can reach it with Tab', async () => {
  const editor = await showing(docFromMarkdown(POST), [{ quote: 'quick brown', label: 'Q1' }]);

  const button = within(editor.view.container).getByRole('button', { name: 'Q1' }) as HTMLButtonElement;

  expect(button.type).toBe('button');
});

test('pressing Enter or Space on a label leaves the draft unchanged', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc, [{ quote: 'quick brown', label: 'Q1' }]);
  const before = markdownOf(doc);

  const chip = editor.view.container.querySelector('.ai-highlight-label') as HTMLElement;
  chip.focus();
  await act(async () => {
    fireEvent.keyDown(chip, { key: 'Enter', code: 'Enter', keyCode: 13 });
    fireEvent.keyDown(chip, { key: ' ', code: 'Space', keyCode: 32 });
  });

  expect(markdownOf(doc)).toBe(before);
});
