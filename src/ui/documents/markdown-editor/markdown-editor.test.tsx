import { expect, mock, spyOn, test } from 'bun:test';
import { useState } from 'react';
import { act, fireEvent, render, within } from '@testing-library/react';
import * as Y from 'yjs';
import { ySyncPluginKey, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { defaultMarkdownParser, schema } from 'prosemirror-markdown';
import { EditorState, TextSelection } from 'prosemirror-state';
import { type DecorationSet, EditorView } from 'prosemirror-view';
import type { Passage } from '../../../shared/wire';
import { textblocks } from '../../../shared/blocks';
import { type Ask, type EditorMode, type SelectionAsk, docFromMarkdown, highlightsPlugin, markdownOf, MarkdownEditor, mergeMarkdown, replaceMarkdown, snapshot, decodeUpdate, encodeUpdate, snapshotFromUpdate } from './markdown-editor';
import { passageAt } from './raw-view';
import { type Box, lineBoxes, outlinePath } from './highlight-outline';

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

// Presses Ctrl-Z in the editor; happy-dom does not report a Mac, so Mod-z is Ctrl-z here.
async function undo(editor: Awaited<ReturnType<typeof showing>>) {
  await act(async () => {
    fireEvent.keyDown(editor.view.container.querySelector('.ProseMirror')!, { key: 'z', ctrlKey: true });
  });
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
  await undo(editor);

  expect(editor.text()).toBe('Garden Plan\nThe quick brown fox.\nThen Water the beans.');
});

test('replacing a document with text from disk that drops a paragraph removes it', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc);

  await act(async () => replaceMarkdown(doc, '# Garden Plan\n\nWater the beans.\n'));

  expect(editor.text()).toBe('Garden Plan\nWater the beans.');
});

test('replacing a document from disk keeps the editor, and the paragraphs that did not change', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc);
  const before = editor.view.container.querySelector('.ProseMirror')!;
  const [heading, , water] = before.children;

  await act(async () => replaceMarkdown(doc, WRITTEN.replace('quick brown', 'slow red')));

  const after = editor.view.container.querySelector('.ProseMirror')!;
  expect(after).toBe(before);
  expect(after.children[0]).toBe(heading);
  expect(after.children[2]).toBe(water);
});

test('undo cannot take back a replacement from disk', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc);

  await act(async () => replaceMarkdown(doc, WRITTEN.replace('quick brown', 'slow red')));
  await undo(editor);

  expect(editor.text()).toBe('Garden Plan\nThe slow red fox.\nWater the beans.');
});

test('undo cannot reach typing from before a replacement from disk', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc);
  await act(async () => type(doc, 2, 0, 'Then '));

  // The disk text keeps the typed words, so an undo that reached the typing would take them out.
  await act(async () => replaceMarkdown(doc, WRITTEN.replace('quick brown', 'slow red').replace('Water', 'Then Water')));
  await undo(editor);

  expect(editor.text()).toBe('Garden Plan\nThe slow red fox.\nThen Water the beans.');
});

test('splits a post into the same blocks as the server does, so a quote the server accepts is one the editor finds', () => {
  const md =
    '# Garden *Plan*\n\nMost gardeners **never** test\ntheir [soil](https://example.com) with `pH` strips.\n\n- beans\n- the *tomatoes*\n\n```\nwater();\n```\n';
  const doc = yXmlFragmentToProseMirrorRootNode(docFromMarkdown(md).getXmlFragment('prosemirror'), schema);
  // The server's tools.test.ts expects these same five blocks from its postBlocks.
  expect(textblocks(doc).map((b) => b.text)).toEqual(['Garden Plan', 'Most gardeners never test their soil with pH strips.', 'beans', 'the tomatoes', 'water();']);
});

// What the editor highlights: each passage's text, and each label chip's text.
function highlighted(container: HTMLElement) {
  return {
    marks: [...container.querySelectorAll('mark.ai-highlight')].map((el) => el.textContent),
    labels: [...container.querySelectorAll('.ai-highlight-label')].map((el) => el.textContent),
    status: container.querySelector('.highlight-status')?.textContent,
  };
}

test('highlights a passage with its label, and says which highlighted passage the writer is on', async () => {
  const editor = await showing(docFromMarkdown(POST), [{ quote: 'quick brown', label: 'Q1' }]);

  expect(highlighted(editor.view.container)).toEqual({ marks: ['quick brown'], labels: ['Q1'], status: 'Highlight 1 of 1' });
  expect(editor.view.container.querySelector('.highlight-status')?.getAttribute('aria-live')).toBe('polite');
});

test('says which highlighted passage the writer is on below the formatting buttons', async () => {
  const editor = await showing(docFromMarkdown(POST), [{ quote: 'quick brown', label: 'Q1' }]);

  const container = editor.view.container;
  const button = container.querySelector('.ProseMirror-menuitem')!;
  const status = container.querySelector('.highlight-status')!;
  expect(button.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('the highlight a cursor lands in becomes the one the writer is on, while the one they are on keeps them', () => {
  const apart = [
    { from: 10, to: 21 },
    { from: 30, to: 45 },
  ];
  const touching = [
    { from: 10, to: 20 },
    { from: 20, to: 30 },
  ];
  const cases: [typeof apart, number, number, number][] = [
    [apart, 10, 0, 0], // at the first one's start
    [apart, 21, 0, 0], // at its end
    [apart, 25, 0, 0], // between them: still on the first
    [apart, 30, 0, 1], // at the second one's start
    [apart, 25, 1, 1], // between them: still on the second
    [touching, 20, 0, 0], // where they touch, on the first
    [touching, 20, 1, 1], // where they touch, on the second
    [[], 5, 0, 0], // nothing highlighted
  ];

  expect(cases.map(([ranges, pos, current]) => passageAt(ranges, pos, current))).toEqual(cases.map(([, , , expected]) => expected));
});

// The text of the highlighted passage outlined as the one the writer is on, in however many pieces it is drawn.
const currentHighlight = (container: HTMLElement) =>
  [...container.querySelectorAll('.current-highlight')].map((el) => el.textContent).join('') || undefined;

// Two passages, given out of the order they appear in the post.
const TWO = [
  { quote: 'Water the beans', label: 'Q1' },
  { quote: 'quick brown', label: 'Q2' },
];

test('outlines the first highlighted passage in the post when highlights appear', async () => {
  const editor = await showing(docFromMarkdown(POST), TWO);

  expect(currentHighlight(editor.view.container)).toBe('quick brown');
});

test('> outlines the next highlighted passage in the post', async () => {
  const editor = await showing(docFromMarkdown(POST), TWO);

  await act(async () => fireEvent.click(within(editor.view.container).getByRole('button', { name: 'Next highlight' })));

  expect(currentHighlight(editor.view.container)).toBe('Water the beans');
});

test('> on the last highlighted passage goes back around to the first', async () => {
  const editor = await showing(docFromMarkdown(POST), TWO);
  const next = within(editor.view.container).getByRole('button', { name: 'Next highlight' });

  await act(async () => fireEvent.click(next));
  await act(async () => fireEvent.click(next));

  expect(currentHighlight(editor.view.container)).toBe('quick brown');
});

// What the highlight bar says.
const status = (container: HTMLElement) => container.querySelector('.highlight-status')?.textContent;

test('> says which highlighted passage the writer is on', async () => {
  const editor = await showing(docFromMarkdown(POST), TWO);

  await act(async () => fireEvent.click(within(editor.view.container).getByRole('button', { name: 'Next highlight' })));

  expect(status(editor.view.container)).toBe('Highlight 2 of 2');
});

test('< on the first highlighted passage goes around to the last, and then back through the post', async () => {
  const editor = await showing(docFromMarkdown(POST), [...TWO, { quote: 'Garden', label: 'Q3' }]);
  const previous = within(editor.view.container).getByRole('button', { name: 'Previous highlight' });
  const outlined: (string | null | undefined)[] = [];

  await act(async () => fireEvent.click(previous));
  outlined.push(currentHighlight(editor.view.container));
  await act(async () => fireEvent.click(previous));
  outlined.push(currentHighlight(editor.view.container));

  expect(outlined).toEqual(['Water the beans', 'quick brown']);
});

test('clicking into a highlighted passage outlines it and says so, leaving the caret where the writer clicked', async () => {
  const editor = await showing(docFromMarkdown(POST), TWO);

  await select(editor.view.container, 'Water the beans', 2);

  expect(currentHighlight(editor.view.container)).toBe('Water the beans');
  expect(status(editor.view.container)).toBe('Highlight 2 of 2');
  expect(document.getSelection()?.toString()).toBe('');
});

test('a caret clicked outside every highlight leaves the writer on the passage they were on', async () => {
  const editor = await showing(docFromMarkdown(POST), TWO);
  await act(async () => fireEvent.click(within(editor.view.container).getByRole('button', { name: 'Next highlight' })));

  await select(editor.view.container, 'Garden', 2);

  expect(currentHighlight(editor.view.container)).toBe('Water the beans');
});

test('> and < step between highlighted passages that touch, without falling back onto the one before', async () => {
  const editor = await showing(docFromMarkdown(POST), [{ quote: 'quick bro' }, { quote: 'wn fox' }]);
  const outlined: (string | null | undefined)[] = [];

  await act(async () => fireEvent.click(within(editor.view.container).getByRole('button', { name: 'Next highlight' })));
  outlined.push(currentHighlight(editor.view.container));
  await act(async () => fireEvent.click(within(editor.view.container).getByRole('button', { name: 'Previous highlight' })));
  outlined.push(currentHighlight(editor.view.container));

  expect(outlined).toEqual(['wn fox', 'quick bro']);
});

test('new highlights outline their first passage, wherever the writer was in the ones before', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc, TWO);
  await act(async () => fireEvent.click(within(editor.view.container).getByRole('button', { name: 'Next highlight' })));

  editor.view.rerender(<MarkdownEditor doc={doc} readOnly={false} highlights={[...TWO]} />);
  await act(async () => {});

  expect(currentHighlight(editor.view.container)).toBe('quick brown');
});

test('< and > bring the passage they outline into view', async () => {
  const editor = await showing(docFromMarkdown(POST), TWO);
  const scrolled: string[] = [];
  const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
    scrolled.push(this.textContent ?? '');
  });

  await act(async () => fireEvent.click(within(editor.view.container).getByRole('button', { name: 'Next highlight' })));
  await act(async () => fireEvent.click(within(editor.view.container).getByRole('button', { name: 'Previous highlight' })));

  scroll.mockRestore();
  expect(scrolled).toEqual(['Water the beans', 'quick brown']);
});

// A post whose first highlight crosses the end of a link, so the editor draws it as two pieces.
const LINKED = '# Garden Plan\n\nThe [quick](https://example.com) brown fox.\n\nWater the beans.\n';
// Where each piece of the passage the writer is on sits on screen, by its text: "quick" ends the first line, and
// " brown" finishes it and wraps onto the next.
const PIECES: Record<string, Box[]> = {
  quick: [{ left: 100, top: 10, right: 150, bottom: 30 }],
  ' brown': [
    { left: 150, top: 12, right: 300, bottom: 30 },
    { left: 20, top: 40, right: 160, bottom: 60 },
  ],
  'Water the beans': [{ left: 20, top: 80, right: 200, bottom: 100 }],
};
// The editor's scrolling host: where it sits on screen, and how far it is scrolled.
const HOST = { left: 10, top: 50, scrollLeft: 4, scrollTop: 30 };

// happy-dom does no layout, so this stands in for it: each piece of the passage the writer is on measures at PIECES,
// and the host at HOST. Returns the restore, and the outline expected around `pieces` in the host's scrolled content.
function laidOut() {
  const rects = spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return (this.matches('mark.current-highlight') ? (PIECES[this.textContent!] ?? []) : []) as unknown as DOMRectList;
  });
  const bounds = Element.prototype.getBoundingClientRect;
  const host = spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.matches('.rich-editor') ? new DOMRect(HOST.left, HOST.top, 800, 600) : bounds.call(this);
  });
  return {
    restore: () => (rects.mockRestore(), host.mockRestore()),
    outline: (...pieces: string[]) =>
      outlinePath(
        lineBoxes(
          pieces.flatMap((text) => PIECES[text]!).map((b) => ({
            left: b.left - HOST.left + HOST.scrollLeft,
            right: b.right - HOST.left + HOST.scrollLeft,
            top: b.top - HOST.top + HOST.scrollTop,
            bottom: b.bottom - HOST.top + HOST.scrollTop,
          })),
        ),
      ),
  };
}

// Scrolls the editor's host to HOST's scroll, which moves the text without the document changing.
async function scrolled(container: HTMLElement) {
  const host = container.querySelector<HTMLElement>('.rich-editor')!;
  Object.defineProperties(host, { scrollLeft: { value: HOST.scrollLeft }, scrollTop: { value: HOST.scrollTop } });
  await act(async () => window.dispatchEvent(new Event('resize')));
}

const outlined = (container: HTMLElement) => container.querySelector('svg.highlight-outline path')?.getAttribute('d');

test('the highlighted passage the writer is on gets one outline around all its pieces, even where it crosses a link', async () => {
  const layout = laidOut();
  const editor = await switchable(docFromMarkdown(LINKED), [{ quote: 'quick brown' }, { quote: 'Water the beans' }]);
  await scrolled(editor.view.container);
  layout.restore();

  const d = outlined(editor.view.container);
  expect(d).toBe(layout.outline('quick', ' brown'));
  expect(d!.match(/M/g)).toHaveLength(1);
  expect(currentHighlight(editor.view.container)).toBe('quick brown');
});

test('> moves the outline to the next highlighted passage', async () => {
  const layout = laidOut();
  const editor = await switchable(docFromMarkdown(LINKED), [{ quote: 'quick brown' }, { quote: 'Water the beans' }]);
  await scrolled(editor.view.container);

  await act(async () => fireEvent.click(within(editor.menubar as HTMLElement).getByRole('button', { name: 'Next highlight' })));
  layout.restore();

  expect(outlined(editor.view.container)).toBe(layout.outline('Water the beans'));
});

test('in raw mode, the formatted document draws no outline, though its passage is still marked', async () => {
  const layout = laidOut();
  const editor = await switchable(docFromMarkdown(LINKED), [{ quote: 'quick brown' }, { quote: 'Water the beans' }]);
  await scrolled(editor.view.container);

  await editor.choose('Raw');
  layout.restore();

  expect(currentHighlight(editor.view.container.querySelector<HTMLElement>('.ProseMirror')!)).toBe('quick brown');
  expect(outlined(editor.view.container)).toBeUndefined();
});

test('in raw mode, > outlines the next highlighted passage in the markdown', async () => {
  const editor = await switchable(docFromMarkdown(POST), TWO);
  await editor.choose('Raw');
  const mirror = editor.view.container.querySelector<HTMLElement>('.raw-mirror')!;
  const outlined = [currentHighlight(mirror)];

  await act(async () => fireEvent.click(within(editor.menubar as HTMLElement).getByRole('button', { name: 'Next highlight' })));
  outlined.push(currentHighlight(mirror));

  expect(outlined).toEqual(['quick brown', 'Water the beans']);
});

test('in raw mode, > brings the passage it outlines in the markdown into view', async () => {
  const editor = await switchable(docFromMarkdown(POST), TWO);
  await editor.choose('Raw');
  const scrolled: string[] = [];
  const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
    scrolled.push(`${this.closest('.raw-mirror') ? 'raw' : 'rendered'}: ${this.textContent}`);
  });

  await act(async () => fireEvent.click(within(editor.menubar as HTMLElement).getByRole('button', { name: 'Next highlight' })));

  scroll.mockRestore();
  expect(scrolled).toEqual(['raw: Water the beans']);
});

test('selects the first highlighted passage when highlights appear, offering to ask about it without taking focus', async () => {
  const onAskSelection = mock((_ask: SelectionAsk) => {});
  const view = render(<MarkdownEditor doc={docFromMarkdown(POST)} readOnly={false} highlights={TWO} onAskSelection={onAskSelection} />);
  await act(async () => {});

  fireEvent.click(within(view.container).getByRole('button', { name: 'Ask the AI about the selection' }));

  expect(onAskSelection.mock.calls.map(([ask]) => ask.markdown)).toEqual(['quick brown']);
  expect(view.container.querySelector('.ProseMirror')!.contains(document.activeElement)).toBe(false);
});

test('> selects the next highlighted passage and moves focus to the editor, offering to ask about it', async () => {
  const onAskSelection = mock((_ask: SelectionAsk) => {});
  const view = render(<MarkdownEditor doc={docFromMarkdown(POST)} readOnly={false} highlights={TWO} onAskSelection={onAskSelection} />);
  await act(async () => {});

  await act(async () => fireEvent.click(within(view.container).getByRole('button', { name: 'Next highlight' })));
  fireEvent.click(within(view.container).getByRole('button', { name: 'Ask the AI about the selection' }));

  expect(onAskSelection.mock.calls.map(([ask]) => ask.markdown)).toEqual(['Water the beans']);
  expect(view.container.querySelector('.ProseMirror')!.contains(document.activeElement)).toBe(true);
});

test('highlights arriving while the writer works in the editor leave their caret where it is', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc);
  const prose = editor.view.container.querySelector<HTMLElement>('.ProseMirror')!;
  await act(async () => prose.focus());
  const caret = () => document.getSelection()?.toString();

  editor.view.rerender(<MarkdownEditor doc={doc} readOnly={false} highlights={TWO} />);
  await act(async () => {});

  expect(caret()).toBe('');
});

test('Clear beside the highlight count asks to clear the highlights', async () => {
  const onClear = mock(() => {});
  const view = render(
    <MarkdownEditor doc={docFromMarkdown(POST)} readOnly={false} highlights={[{ quote: 'quick brown', label: 'Q1' }]} onClearHighlights={onClear} />,
  );
  await act(async () => {});

  fireEvent.click(within(view.container).getByRole('button', { name: 'Clear' }));

  expect(onClear).toHaveBeenCalledTimes(1);
});

test('offers no Clear while nothing is highlighted', async () => {
  const view = render(<MarkdownEditor doc={docFromMarkdown(POST)} readOnly={false} highlights={[]} onClearHighlights={() => {}} />);
  await act(async () => {});

  expect(within(view.container).queryByRole('button', { name: 'Clear' })).toBeNull();
});

test('leaves out a passage the post no longer holds, and says it was not found', async () => {
  const editor = await showing(docFromMarkdown(POST), [
    { quote: 'quick brown', label: 'Q1' },
    { quote: 'purple cow', label: 'Q2' },
  ]);

  expect(highlighted(editor.view.container)).toEqual({ marks: ['quick brown'], labels: ['Q1'], status: 'Highlight 1 of 1 (1 not found)' });
});

test('says no passages were found when the post holds none of the highlighted ones', async () => {
  const editor = await showing(docFromMarkdown(POST), [{ quote: 'purple cow', label: 'Q1' }]);

  expect(status(editor.view.container)).toBe('No passages found');
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
  const paragraph = textblocks(state.doc)[1].pos;

  state = state.apply(state.tr.insertText('very ', paragraph + 'The quick '.length));
  expect(drawn()).toEqual({ text: ['quick very brown'], labels: 1 });

  state = state.apply(state.tr.delete(paragraph + 'The '.length, paragraph + 'The quick very brown'.length));
  expect(drawn()).toEqual({ text: [], labels: 0 });
});

// A bare editor showing POST with `passages` highlighted, the text of the passage it outlines, and the last
// (placed, current) it reported.
function highlighting(passages: Passage[]) {
  const onShown = mock((_shown: number, _current: number) => {});
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({ doc: defaultMarkdownParser.parse(POST)!, plugins: [highlightsPlugin(passages, onShown)] }),
  });
  const paragraph = (i: number) => textblocks(view.state.doc)[i].pos;
  return {
    view,
    paragraph,
    caret: (pos: number) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos))),
    outlined: () => view.dom.querySelector('.current-highlight')?.textContent,
    reported: () => onShown.mock.calls.at(-1),
  };
}

test('deleting a highlighted passage before the one the writer is on keeps them on theirs', () => {
  const editor = highlighting(TWO);
  editor.caret(editor.paragraph(2) + 2);

  editor.view.dispatch(editor.view.state.tr.delete(editor.paragraph(1) + 'The '.length, editor.paragraph(1) + 'The quick brown'.length));

  expect(editor.outlined()).toBe('Water the beans');
  expect(editor.reported()).toEqual([1, 0]);
});

test('deleting the highlighted passage the writer is on moves them onto the last one left', () => {
  const editor = highlighting(TWO);
  editor.caret(editor.paragraph(2) + 2);

  editor.view.dispatch(editor.view.state.tr.delete(editor.paragraph(2), editor.paragraph(2) + 'Water the beans'.length));

  expect(editor.outlined()).toBe('quick brown');
  expect(editor.reported()).toEqual([1, 0]);
});

test('a highlight stays on its passage when an AI edit elsewhere in the post merges in', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc, [{ quote: 'quick brown', label: 'Q1' }]);
  const base = snapshot(doc);

  await act(async () => mergeMarkdown(doc, base, WRITTEN.replace('Water', 'Weed')));

  expect(editor.text()).toContain('Weed the beans.');
  expect(highlighted(editor.view.container)).toEqual({ marks: ['quick brown'], labels: ['Q1'], status: 'Highlight 1 of 1' });
});

test('an AI edit puts the writer back on the first highlighted passage', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc, TWO);
  const base = snapshot(doc);
  await act(async () => fireEvent.click(within(editor.view.container).getByRole('button', { name: 'Next highlight' })));

  await act(async () => mergeMarkdown(doc, base, WRITTEN.replace('fox', 'dog')));

  expect(currentHighlight(editor.view.container)).toBe('quick brown');
  expect(status(editor.view.container)).toBe('Highlight 1 of 2');
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

  await act(async () => (editor.view.container.querySelector('.ProseMirror') as HTMLElement).focus());
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

test('a label tells screen readers it opens a popup', async () => {
  const editor = await showing(docFromMarkdown(POST), [{ quote: 'quick brown', label: 'Q1' }]);

  const button = within(editor.view.container).getByRole('button', { name: 'Q1' });

  expect(button.getAttribute('aria-haspopup')).toBe('dialog');
});

test('pressing Enter or Space on a label leaves the draft unchanged', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await showing(doc, [{ quote: 'quick brown', label: 'Q1' }]);
  const before = markdownOf(doc);

  const chip = editor.view.container.querySelector('.ai-highlight-label') as HTMLElement;
  await act(async () => chip.focus());
  await act(async () => {
    fireEvent.keyDown(chip, { key: 'Enter', code: 'Enter', keyCode: 13 });
    fireEvent.keyDown(chip, { key: ' ', code: 'Space', keyCode: 32 });
  });

  expect(markdownOf(doc)).toBe(before);
});

// Selects `text` in the editor the way the writer's mouse does: the browser moves its selection, and the editor
// reads it back when it hears the selection change. Given `caretAt`, it clicks a caret that far into `text` instead.
async function select(container: HTMLElement, text: string, caretAt?: number) {
  const editor = container.querySelector('.ProseMirror') as HTMLElement;
  await act(async () => editor.focus());
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent!.indexOf(text);
    if (at < 0) continue;
    await act(async () => {
      const [from, to] = caretAt === undefined ? [at, at + text.length] : [at + caretAt, at + caretAt];
      document.getSelection()!.setBaseAndExtent(node, from, node, to);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    return;
  }
  throw new Error(`no text ${text}`);
}

// Drags a selection the way the writer's mouse does, from `from` characters into the text `start` to `to` characters
// into the text `end`, which may be in different runs of text, such as two highlighted passages.
async function drag(container: HTMLElement, [start, from]: [string, number], [end, to]: [string, number]) {
  const editor = container.querySelector('.ProseMirror') as HTMLElement;
  await act(async () => editor.focus());
  const nodes: Node[] = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  const find = (text: string) => nodes.find((n) => n.textContent === text) ?? (() => { throw new Error(`no text ${text}`); })();
  await act(async () => {
    document.getSelection()!.setBaseAndExtent(find(start), from, find(end), to);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const askButton = (container: HTMLElement) => within(container).queryByRole('button', { name: 'Ask the AI about the selection' });

async function selecting(onAskSelection = mock((_ask: SelectionAsk) => {})) {
  const doc = docFromMarkdown(POST);
  const view = render(<MarkdownEditor doc={doc} readOnly={false} highlights={[]} onAskSelection={onAskSelection} />);
  await act(async () => {});
  return { doc, view, onAskSelection };
}

test('the ask button shows only while the writer has text selected', async () => {
  const { view } = await selecting();

  expect(askButton(view.container)).toBeNull();
  await select(view.container, 'quick brown');

  expect(askButton(view.container)?.getAttribute('aria-haspopup')).toBe('dialog');
});

test('clicking the ask button reports the selection as markdown, and the button it came from', async () => {
  const { view, onAskSelection } = await selecting();
  await select(view.container, 'quick brown');

  const button = askButton(view.container)!;
  const allowed = fireEvent.mouseDown(button);
  await act(async () => fireEvent.click(button));

  // Pressing it keeps the editor's selection: the browser never gets to move it.
  expect(allowed).toBe(false);
  expect(onAskSelection.mock.calls.map(([ask]) => ask)).toEqual([{ markdown: 'quick brown', anchor: button }]);
});

test('while its popup is open, the selection stays marked and the button stays, and closing it clears both', async () => {
  const { view, doc, onAskSelection } = await selecting();
  await select(view.container, 'quick brown');
  await act(async () => fireEvent.click(askButton(view.container)!));
  const rerender = (asking: boolean) =>
    view.rerender(<MarkdownEditor doc={doc} readOnly={false} highlights={[]} onAskSelection={onAskSelection} askingSelection={asking} />);

  await act(async () => rerender(true));
  // Focus moves into the popup.
  await act(async () => (view.container.querySelector('.ProseMirror') as HTMLElement).blur());
  expect([...view.container.querySelectorAll('.ask-selection')].map((el) => el.textContent)).toEqual(['quick brown']);
  expect(askButton(view.container)).toBeTruthy();

  await act(async () => rerender(false));
  expect(view.container.querySelectorAll('.ask-selection').length).toBe(0);
  expect(askButton(view.container)).toBeNull();
});

const askHighlight = (container: HTMLElement) => within(container).queryByRole('button', { name: 'Ask the AI about this highlight' });

test('with the caret in the highlighted passage the writer is on, the ask button asks about the whole passage', async () => {
  const onAskSelection = mock((_ask: SelectionAsk) => {});
  const view = render(<MarkdownEditor doc={docFromMarkdown(POST)} readOnly={false} highlights={TWO} onAskSelection={onAskSelection} />);
  await act(async () => {});
  await select(view.container, 'Water the beans', 2);

  const button = askHighlight(view.container)!;
  await act(async () => fireEvent.click(button));

  expect(onAskSelection.mock.calls.map(([ask]) => ask)).toEqual([{ markdown: 'Water the beans', anchor: button }]);
});

test('while its popup is open, the whole highlighted passage the caret was in stays marked', async () => {
  const doc = docFromMarkdown(POST);
  const view = render(<MarkdownEditor doc={doc} readOnly={false} highlights={TWO} onAskSelection={() => {}} />);
  await act(async () => {});
  await select(view.container, 'Water the beans', 2);
  await act(async () => fireEvent.click(askHighlight(view.container)!));

  view.rerender(<MarkdownEditor doc={doc} readOnly={false} highlights={TWO} onAskSelection={() => {}} askingSelection />);
  await act(async () => (view.container.querySelector('.ProseMirror') as HTMLElement).blur());

  expect([...view.container.querySelectorAll('.ask-selection')].map((el) => el.textContent)).toEqual(['Water the beans']);
});

test('with the caret outside every highlighted passage, there is nothing to ask about', async () => {
  const view = render(<MarkdownEditor doc={docFromMarkdown(POST)} readOnly={false} highlights={TWO} onAskSelection={() => {}} />);
  await act(async () => {});

  await select(view.container, 'Garden', 2);

  expect(askHighlight(view.container)).toBeNull();
  expect(askButton(view.container)).toBeNull();
});

test('a selection dragged from one highlighted passage into the next keeps the writer on the first, and asks about the selection', async () => {
  const onAskSelection = mock((_ask: SelectionAsk) => {});
  const view = render(
    <MarkdownEditor doc={docFromMarkdown(POST)} readOnly={false} highlights={[{ quote: 'quick bro' }, { quote: 'wn fox' }]} onAskSelection={onAskSelection} />,
  );
  await act(async () => {});

  await drag(view.container, ['quick bro', 4], ['wn fox', 4]);
  await act(async () => fireEvent.click(askButton(view.container)!));

  expect(currentHighlight(view.container)).toBe('quick bro');
  expect(onAskSelection.mock.calls.map(([ask]) => ask.markdown)).toEqual(['k brown f']);
});

// The editor with `markdown` in it, and a way to press its link button.
async function linking(markdown = POST) {
  const doc = docFromMarkdown(markdown);
  const view = render(<MarkdownEditor doc={doc} readOnly={false} highlights={[]} />);
  await act(async () => {});
  const linkButton = view.container.querySelector<HTMLElement>('.ProseMirror-menubar [title="Add or remove link"]')!;
  return { doc, view, pressLink: () => act(async () => fireEvent.click(linkButton)) };
}

test('the link button on linked text takes the link off', async () => {
  const { doc, view, pressLink } = await linking('The [quick brown](https://example.com) fox.\n');
  await select(view.container, 'quick brown');

  await pressLink();

  expect(markdownOf(doc)).toBe('The quick brown fox.');
});

test('with the caret in plain text, the link button is off: there is nothing to link', async () => {
  const { view } = await linking();
  await select(view.container, 'quick brown', 3);

  expect(view.container.querySelector('[title="Add or remove link"]')!.classList.contains('ProseMirror-menu-disabled')).toBe(true);
});

test('with the caret in linked text, the link button takes the whole link off, leaving its text', async () => {
  const { doc, view, pressLink } = await linking('The [quick brown](https://example.com) fox.\n');
  await select(view.container, 'quick brown', 3);

  expect(view.container.querySelector('[title="Add or remove link"]')!.classList.contains('ProseMirror-menu-disabled')).toBe(false);
  await pressLink();

  expect(markdownOf(doc)).toBe('The quick brown fox.');
});

test('with the caret at either edge of a link, the link button takes the link off', async () => {
  for (const edge of [0, 'quick brown'.length]) {
    const { doc, view, pressLink } = await linking('The [quick brown](https://example.com) fox.\n');
    await select(view.container, 'quick brown', edge);
    await pressLink();
    expect(markdownOf(doc)).toBe('The quick brown fox.');
    view.unmount();
  }
});

test('the link button opens a popup by the selected text, which stays marked while focus is in the popup', async () => {
  const { view, pressLink } = await linking();
  await select(view.container, 'quick brown');

  await pressLink();

  const dialog = within(document.body).getByRole('dialog', { name: 'Add a link' });
  expect(document.activeElement && dialog.contains(document.activeElement)).toBe(true);
  expect([...view.container.querySelectorAll('.ask-selection')].map((el) => el.textContent)).toEqual(['quick brown']);
  expect(document.querySelector('.ProseMirror-prompt')).toBeNull();
});

test('the link popup starts its title as the selected text', async () => {
  const { view, pressLink } = await linking();
  await select(view.container, 'quick brown');

  await pressLink();

  expect((within(document.body).getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('quick brown');
});

test('adding the link from the popup links the selected text, and closes the popup', async () => {
  const { doc, view, pressLink } = await linking();
  await select(view.container, 'quick brown');
  await pressLink();
  const dialog = within(document.body).getByRole('dialog', { name: 'Add a link' });

  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Link target' }), { target: { value: 'https://example.com' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), { target: { value: 'Example' } });
  await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' })));

  expect(markdownOf(doc)).toBe(WRITTEN.replace('quick brown', '[quick brown](https://example.com "Example")'));
  expect(within(document.body).queryByRole('dialog', { name: 'Add a link' })).toBeNull();
  expect(view.container.querySelectorAll('.ask-selection').length).toBe(0);
});

test('closing the link popup leaves the text unlinked, and selected again in the editor', async () => {
  const { doc, view, pressLink } = await linking();
  await select(view.container, 'quick brown');
  await pressLink();

  await act(async () => fireEvent.keyDown(within(document.body).getByRole('textbox', { name: 'Link target' }), { key: 'Escape' }));

  expect(within(document.body).queryByRole('dialog', { name: 'Add a link' })).toBeNull();
  expect(markdownOf(doc)).toBe(WRITTEN);
  expect(view.container.querySelectorAll('.ask-selection').length).toBe(0);
  expect(document.activeElement).toBe(view.container.querySelector('.ProseMirror'));
  expect(document.getSelection()!.toString()).toBe('quick brown');
});

test('pressing elsewhere in the page closes the link popup, without pulling focus back to the editor', async () => {
  const { view, pressLink } = await linking();
  const elsewhere = document.body.appendChild(document.createElement('button'));
  await select(view.container, 'quick brown');
  await pressLink();

  await act(async () => fireEvent.mouseDown(elsewhere));

  expect(within(document.body).queryByRole('dialog', { name: 'Add a link' })).toBeNull();
  expect(view.container.querySelectorAll('.ask-selection').length).toBe(0);
  expect(document.activeElement).not.toBe(view.container.querySelector('.ProseMirror'));
  elsewhere.remove();
});

// Pastes `text` into `target` the way the browser does, as plain text on the clipboard. Returns whether the browser
// was left to paste it.
async function paste(target: Element, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { types: ['text/plain'], files: [], getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
  let allowed = true;
  await act(async () => {
    allowed = target.dispatchEvent(event);
  });
  return allowed;
}

test('pasting text over a selection replaces it with the text', async () => {
  const { doc, view } = await linking();
  await select(view.container, 'quick brown');

  await paste(view.container.querySelector('.ProseMirror')!, 'slow red');

  expect(markdownOf(doc)).toBe(WRITTEN.replace('quick brown', 'slow red'));
});

test('pasting a link over a selection links the selected text to it, titled with the text, and keeps it selected', async () => {
  const { doc, view } = await linking();
  await select(view.container, 'quick brown');

  await paste(view.container.querySelector('.ProseMirror')!, ' https://example.com/ ');

  expect(markdownOf(doc)).toBe(WRITTEN.replace('quick brown', '[quick brown](https://example.com/ "quick brown")'));
  expect(document.getSelection()!.toString()).toBe('quick brown');
});

test('in a code block, which holds no links, a pasted link is pasted as code and the link button is off', async () => {
  const { doc, view } = await linking('```\nquick brown\n```\n');
  await select(view.container, 'quick');

  expect(view.container.querySelector('[title="Add or remove link"]')!.classList.contains('ProseMirror-menu-disabled')).toBe(true);
  await paste(view.container.querySelector('.ProseMirror')!, 'https://example.com/');

  expect(markdownOf(doc)).toBe('```\nhttps://example.com/ brown\n```');
});

test('a link pasted or added over text with spaces at its ends leaves the spaces outside the link', async () => {
  const pasted = await linking('The quick brown fox.\n');
  await select(pasted.view.container, ' quick brown ');
  await paste(pasted.view.container.querySelector('.ProseMirror')!, 'https://example.com/');
  expect(markdownOf(pasted.doc)).toBe('The [quick brown](https://example.com/ "quick brown") fox.');
  pasted.view.unmount();

  const added = await linking('The quick brown fox.\n');
  await select(added.view.container, ' quick brown ');
  await added.pressLink();
  const dialog = within(document.body).getByRole('dialog', { name: 'Add a link' });
  expect((within(dialog).getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('quick brown');
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Link target' }), { target: { value: 'https://example.com/' } });
  await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' })));
  expect(markdownOf(added.doc)).toBe('The [quick brown](https://example.com/ "quick brown") fox.');
});

test('with only spaces selected the link button is off, and a pasted link replaces them', async () => {
  const { doc, view } = await linking('The quick brown fox.\n');
  await select(view.container, ' ');

  expect(view.container.querySelector('[title="Add or remove link"]')!.classList.contains('ProseMirror-menu-disabled')).toBe(true);
  await paste(view.container.querySelector('.ProseMirror')!, 'https://example.com/');
  expect(markdownOf(doc)).toBe('Thehttps://example.com/quick brown fox.');
});

test('a link pasted over text in a link points the whole link at it, keeping its title', async () => {
  const { doc, view } = await linking('The [quick brown](https://old.example/ "Quick") fox.\n');
  await select(view.container, 'brown');

  await paste(view.container.querySelector('.ProseMirror')!, 'https://example.com/');

  expect(markdownOf(doc)).toBe('The [quick brown](https://example.com/ "Quick") fox.');
});

test('a link to an address with spaces or backslashes, or titled with a backslash, still reads as a link once saved', async () => {
  const { doc, view, pressLink } = await linking('The quick brown fox.\n');
  await select(view.container, 'quick brown');
  await pressLink();
  const dialog = within(document.body).getByRole('dialog', { name: 'Add a link' });

  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Link target' }), { target: { value: 'https://example.com/a b\\' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), { target: { value: 'back\\' } });
  await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' })));

  const saved = markdownOf(doc);
  expect(saved).toBe('The [quick brown](https://example.com/a%20b%5C "back") fox.');
  expect(markdownOf(docFromMarkdown(saved))).toBe(saved);
});

test('a link pasted over text ending in a backslash still reads as a link once saved', async () => {
  const { doc, view } = await linking('The quick\\\\ fox.\n');
  await select(view.container, 'quick\\');

  await paste(view.container.querySelector('.ProseMirror')!, 'https://example.com/');

  const saved = markdownOf(doc);
  expect(saved).toBe('The [quick\\\\](https://example.com/ "quick") fox.');
  expect(markdownOf(docFromMarkdown(saved))).toBe(saved);
});

test('the link popup stays open through an edit elsewhere in the paragraph, and still links the selected text', async () => {
  const { doc, view, pressLink } = await linking();
  await select(view.container, 'quick brown');
  await pressLink();

  await act(async () => type(doc, 1, 0, 'So '));
  await act(async () => {});

  const dialog = within(document.body).getByRole('dialog', { name: 'Add a link' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Link target' }), { target: { value: 'https://example.com/' } });
  await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' })));
  expect(markdownOf(doc)).toBe(WRITTEN.replace('The quick brown', 'So The [quick brown](https://example.com/ "quick brown")'));
});

test('the link popup closes when an edit deletes the text it would link', async () => {
  const { doc, view, pressLink } = await linking();
  await select(view.container, 'quick brown');
  await pressLink();

  await act(async () =>
    doc.transact(() => ((doc.getXmlFragment('prosemirror').get(1) as Y.XmlElement).get(0) as Y.XmlText).delete(4, 11), ySyncPluginKey),
  );

  expect(within(document.body).queryByRole('dialog', { name: 'Add a link' })).toBeNull();
  expect(markdownOf(doc)).toBe(WRITTEN.replace('quick brown', ''));
});

const TASKS = '# Chores\n\n- [ ] sow the beans\n- [x] till the bed\n';

test('stores each task as a task_item element in the Yjs document, holding whether its box is ticked', () => {
  const list = docFromMarkdown(TASKS).getXmlFragment('prosemirror').get(1) as Y.XmlElement;

  expect(list.nodeName).toBe('task_list');
  const items = list.toArray() as Y.XmlElement[];
  expect(items.map((item): unknown[] => [item.nodeName, item.getAttributes().checked])).toEqual([
    ['task_item', false],
    ['task_item', true],
  ]);
});

test('shows a checkbox for each task, ticked as the markdown says', async () => {
  const editor = await showing(docFromMarkdown(TASKS));
  const boxes = [...editor.view.container.querySelectorAll<HTMLInputElement>('li.task-item input[type=checkbox]')];

  expect(boxes.map((box) => box.checked)).toEqual([false, true]);
  expect(editor.text()).toBe('Chores\nsow the beanstill the bed');
});

test('ticking and unticking boxes changes the markdown the document saves as', async () => {
  const doc = docFromMarkdown(TASKS);
  const editor = await showing(doc);
  const boxes = () => [...editor.view.container.querySelectorAll<HTMLInputElement>('li.task-item input[type=checkbox]')];

  await act(async () => boxes()[0].click());
  await act(async () => boxes()[1].click());

  expect(boxes().map((box) => box.checked)).toEqual([true, false]);
  expect(markdownOf(doc)).toBe('# Chores\n\n- [x] sow the beans\n- [ ] till the bed');
});

test('a read-only document keeps its boxes as they are', async () => {
  const doc = docFromMarkdown(TASKS);
  const view = render(<MarkdownEditor doc={doc} readOnly={true} highlights={[]} />);
  await act(async () => {});
  const box = view.container.querySelector<HTMLInputElement>('li.task-item input[type=checkbox]')!;

  await act(async () => box.click());

  expect(box.checked).toBe(false);
  expect(markdownOf(doc)).toBe('# Chores\n\n- [ ] sow the beans\n- [x] till the bed');
});

test('an AI edit to a task list keeps a box the writer ticked meanwhile', async () => {
  const doc = docFromMarkdown(TASKS);
  const editor = await showing(doc);
  const base = snapshot(doc);

  await act(async () => editor.view.container.querySelector<HTMLInputElement>('li.task-item input[type=checkbox]')!.click());
  await act(async () => mergeMarkdown(doc, base, markdownOf(docFromMarkdown(TASKS)).replace('till the bed', 'till the north bed')));

  expect(markdownOf(doc)).toBe('# Chores\n\n- [x] sow the beans\n- [x] till the north bed');
});

// Renders the editor with its mode held the way the page holds it, so the switch in the menu bar works.
async function switchable(doc: Y.Doc, highlights: Passage[] = []) {
  function Harness() {
    const [mode, setMode] = useState<EditorMode>('rendered');
    return <MarkdownEditor doc={doc} readOnly={false} highlights={highlights} mode={mode} onModeChange={setMode} />;
  }
  const view = render(<Harness />);
  await act(async () => {});
  const menubar = view.container.querySelector('.ProseMirror-menubar')!;
  return {
    view,
    menubar,
    choose: (name: string) => act(async () => fireEvent.click(within(menubar as HTMLElement).getByRole('button', { name }))),
    textarea: () => view.container.querySelector<HTMLTextAreaElement>('textarea.raw-markdown'),
  };
}

test('the menu bar’s buttons end with a switch between rendered and raw markdown, rendered to start', async () => {
  const editor = await switchable(docFromMarkdown(POST));

  // Only the highlight status row comes after it.
  const group = editor.menubar.lastElementChild!.previousElementSibling!;
  expect(group.getAttribute('aria-label')).toBe('Show the document as');
  expect([...group.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
    ['Rendered', 'true'],
    ['Raw', 'false'],
  ]);
  expect(editor.textarea()).toBeNull();
});

test('raw mode shows the markdown the editor would save', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await switchable(doc);

  await editor.choose('Raw');

  expect(editor.textarea()!.value).toBe(markdownOf(doc));
  expect(within(editor.menubar as HTMLElement).getByRole('button', { name: 'Raw' }).getAttribute('aria-pressed')).toBe('true');
});

test('typing markdown in raw mode changes the document, and the rendered view shows it', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await switchable(doc);
  await editor.choose('Raw');

  const typed = WRITTEN.replace('quick brown', '**slow** red');
  await act(async () => fireEvent.change(editor.textarea()!, { target: { value: typed } }));

  expect(markdownOf(doc)).toBe(typed);
  // The writer's text stays as they typed it.
  expect(editor.textarea()!.value).toBe(typed);
  await editor.choose('Rendered');
  expect(editor.textarea()).toBeNull();
  expect(editor.view.container.querySelector('.ProseMirror strong')!.textContent).toBe('slow');
});

test('raw typing keeps the highlights on passages it did not touch', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await switchable(doc, [{ quote: 'Water the beans.', label: 'Q1' }]);
  await editor.choose('Raw');

  await act(async () => fireEvent.change(editor.textarea()!, { target: { value: WRITTEN.replace('quick', 'slow') } }));
  await editor.choose('Rendered');

  expect(editor.view.container.querySelector('mark.ai-highlight')!.textContent).toBe('Water the beans.');
});

test('an AI edit that merges in while in raw mode shows in the raw text', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await switchable(doc);
  const base = snapshot(doc);
  await editor.choose('Raw');

  await act(async () => mergeMarkdown(doc, base, WRITTEN.replace('quick brown', 'slow red')));

  expect(editor.textarea()!.value).toBe(WRITTEN.replace('quick brown', 'slow red'));
});

test('a read-only document shows rendered even in raw mode, since its menu bar is hidden', async () => {
  render(<MarkdownEditor doc={docFromMarkdown(POST)} readOnly highlights={[]} mode="raw" />);
  await act(async () => {});

  expect(document.querySelector('textarea.raw-markdown')).toBeNull();
});

test('the formatting menu stays in raw mode, and bold wraps the selected markdown in its markers', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await switchable(doc);
  await editor.choose('Raw');
  const area = editor.textarea()!;
  const from = area.value.indexOf('quick');
  area.setSelectionRange(from, from + 'quick'.length);

  await act(async () => fireEvent.click(editor.menubar.querySelector('[title="Toggle strong style"]')!));

  expect(editor.textarea()!.value).toBe(WRITTEN.replace('quick', '**quick**'));
  expect(markdownOf(doc)).toBe(WRITTEN.replace('quick', '**quick**'));
  expect([editor.textarea()!.selectionStart, editor.textarea()!.selectionEnd]).toEqual([from + 2, from + 7]);
});

test('in raw mode the menu hides the items with no markdown to write, and shows none as active', async () => {
  const editor = await switchable(docFromMarkdown(POST));
  const hidden = () =>
    [...editor.menubar.querySelectorAll<HTMLElement>('.ProseMirror-menuitem')].filter((item) => item.style.display === 'none').length;
  await editor.choose('Raw');

  expect(editor.menubar.querySelector('[title="Toggle strong style"]')!.closest<HTMLElement>('.ProseMirror-menuitem')!.style.display).toBe('');
  expect(editor.menubar.querySelector('[title="Select parent node"]')!.closest<HTMLElement>('.ProseMirror-menuitem')!.style.display).toBe('none');
  expect(editor.menubar.querySelector('.ProseMirror-menu-active')).toBeNull();
  expect(hidden()).toBe(3);
});

test('pasting a link over selected markdown in raw mode links the text to it, titled with the text', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await switchable(doc);
  await editor.choose('Raw');
  const area = editor.textarea()!;
  const from = area.value.indexOf('quick brown');
  area.setSelectionRange(from, from + 'quick brown'.length);

  const allowed = await paste(area, ' https://example.com/ ');

  const linked = WRITTEN.replace('quick brown', '[quick brown](https://example.com/ "quick brown")');
  expect(allowed).toBe(false);
  expect(editor.textarea()!.value).toBe(linked);
  expect(markdownOf(doc)).toBe(linked);
  expect([editor.textarea()!.selectionStart, editor.textarea()!.selectionEnd]).toEqual([from + 1, from + 12]);
});

test('pasting other text in raw mode is left to the browser', async () => {
  const editor = await switchable(docFromMarkdown(POST));
  await editor.choose('Raw');
  const area = editor.textarea()!;
  const from = area.value.indexOf('quick brown');
  area.setSelectionRange(from, from + 'quick brown'.length);

  expect(await paste(area, 'slow red')).toBe(true);
});

test('in raw mode, the link button with the caret in a link takes the link off, leaving its text', async () => {
  const doc = docFromMarkdown('The [quick brown](https://example.com) fox.\n');
  const editor = await switchable(doc);
  await editor.choose('Raw');
  const area = editor.textarea()!;
  const caret = area.value.indexOf('brown');
  area.setSelectionRange(caret, caret);

  await act(async () => fireEvent.click(editor.menubar.querySelector('[title="Add or remove link"]')!));

  expect(markdownOf(doc)).toBe('The quick brown fox.');
  expect(editor.textarea()!.value).toBe('The quick brown fox.');
});

test('switching to raw mode or to read-only closes the link popup, linking nothing', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await switchable(doc);
  await select(editor.view.container, 'quick brown');
  await act(async () => fireEvent.click(editor.menubar.querySelector('[title="Add or remove link"]')!));
  expect(within(document.body).queryByRole('dialog', { name: 'Add a link' })).toBeTruthy();

  await editor.choose('Raw');

  expect(within(document.body).queryByRole('dialog', { name: 'Add a link' })).toBeNull();
  editor.view.unmount();

  const { doc: other, view, pressLink } = await linking();
  await select(view.container, 'quick brown');
  await pressLink();
  await act(async () => view.rerender(<MarkdownEditor doc={other} readOnly highlights={[]} />));
  expect(within(document.body).queryByRole('dialog', { name: 'Add a link' })).toBeNull();
});

test('Mod-b in raw mode bolds the selection, as it does in the formatted document', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await switchable(doc);
  await editor.choose('Raw');
  const area = editor.textarea()!;
  const from = area.value.indexOf('beans');
  area.setSelectionRange(from, from + 'beans'.length);

  await act(async () => fireEvent.keyDown(area, { key: 'b', ctrlKey: true }));

  expect(markdownOf(doc)).toBe(WRITTEN.replace('beans', '**beans**'));
});

test('back in rendered mode the menu formats the document again', async () => {
  const doc = docFromMarkdown(POST);
  const editor = await switchable(doc);
  await editor.choose('Raw');
  await editor.choose('Rendered');

  expect(editor.menubar.querySelector('[title="Select parent node"]')!.closest<HTMLElement>('.ProseMirror-menuitem')!.style.display).toBe('');
});

test('raw mode marks each highlighted passage in the markdown, even with emphasis markers inside it', async () => {
  const doc = docFromMarkdown('# Garden Plan\n\nThe quick brown fox.\n\nWater the **beans**.\n');
  const editor = await switchable(doc, [{ quote: 'Water the beans.', label: 'Q1' }, { quote: 'quick' }]);
  await editor.choose('Raw');

  expect([...editor.view.container.querySelectorAll('.raw-mirror mark.ai-highlight')].map((m) => m.textContent)).toEqual([
    'quick',
    'Water the **beans**.',
  ]);
  expect(editor.view.container.querySelector('.highlight-status')!.textContent).toBe('Highlight 1 of 2');
});

test('raw mode colors the markdown it shows: a heading line, and a link’s text', async () => {
  const editor = await switchable(docFromMarkdown(LINKED));
  await editor.choose('Raw');

  const mirror = editor.view.container.querySelector('.raw-mirror')!;
  expect([...mirror.querySelectorAll('.md-heading')].map((el) => el.textContent)).toEqual(['# Garden Plan']);
  expect([...mirror.querySelectorAll('.md-link-text')].map((el) => el.textContent)).toEqual(['quick']);
});

test('in raw mode a highlight over colored markdown is still one marked passage', async () => {
  const doc = docFromMarkdown('The [quick](https://example.com) **brown** fox.\n');
  // A quote taken from the markdown, link and all.
  const editor = await switchable(doc, [{ quote: '[quick](https://example.com) brown fox' }]);
  await editor.choose('Raw');

  const marks = [...editor.view.container.querySelectorAll('.raw-mirror mark.ai-highlight')];
  expect(marks.map((m) => m.textContent)).toEqual(['[quick](https://example.com) **brown** fox']);
  expect(marks[0].querySelector('.md-link-markup, .md-emphasis-markup')).not.toBeNull();
});

test('in raw mode the colored markdown is exactly the markdown being typed, wherever highlights and the ask button cut it', async () => {
  const doc = docFromMarkdown('# Title\n\nA [link](http://x) and `c` and **bold** text.\n\n> quoted\n\n- item\n');
  const view = render(
    <MarkdownEditor doc={doc} readOnly={false} highlights={[{ quote: 'old text' }]} mode="raw" onAskSelection={() => {}} askingSelection={false} />,
  );
  await act(async () => {});
  const area = view.container.querySelector('textarea')!;
  await act(async () => {
    area.focus();
    area.setSelectionRange(2, 5);
    fireEvent.select(area);
  });
  const mirror = view.container.querySelector('.raw-mirror')!;

  expect(view.getByRole('button', { name: 'Ask the AI about the selection' })).toBeDefined();
  expect(mirror.querySelector('mark.ai-highlight')!.textContent).toBe('old** text');
  expect(['heading', 'link-text', 'link-markup', 'emphasis-markup', 'code', 'quote', 'list-marker'].filter((kind) => !mirror.querySelector(`.md-${kind}`))).toEqual([]);
  expect(mirror.textContent!.replace(/​$/, '')).toBe(area.value);
});

test('typing a heading in raw mode colors it, and moving the caret changes no colors', async () => {
  const editor = await switchable(docFromMarkdown(POST));
  await editor.choose('Raw');
  const area = editor.textarea()!;
  const headings = () => [...editor.view.container.querySelectorAll('.raw-mirror .md-heading')].map((el) => el.textContent);

  await act(async () => fireEvent.change(area, { target: { value: `${area.value}\n## x` } }));
  expect(headings()).toEqual(['# Garden Plan', '## x']);

  const classes = () => [...editor.view.container.querySelectorAll('.raw-mirror [class^="md-"]')].map((el) => `${el.className}:${el.textContent}`);
  const before = classes();
  await act(async () => {
    area.focus();
    area.setSelectionRange(3, 3);
    fireEvent.select(area);
  });
  expect(classes()).toEqual(before);
});

test('switching to raw mode never says the writer is past the last passage it could highlight there', async () => {
  // The link's address holds "soil" a second time, so the raw text cannot place it; the formatted document can.
  const doc = docFromMarkdown('The quick brown fox.\n\nTest the [soil](https://soil.example).\n');
  const editor = await switchable(doc, [{ quote: 'quick brown' }, { quote: 'soil' }]);
  await act(async () => fireEvent.click(within(editor.menubar as HTMLElement).getByRole('button', { name: 'Next highlight' })));

  await editor.choose('Raw');

  expect(status(editor.view.container)).toBe('Highlight 1 of 1 (1 not found)');
});

test('clicking a label in raw mode reports its passage, and keeps the caret in the text', async () => {
  const onAsk = mock((_: Ask) => {});
  const doc = docFromMarkdown(POST);
  function Harness() {
    const [mode, setMode] = useState<EditorMode>('raw');
    return <MarkdownEditor doc={doc} readOnly={false} highlights={[{ quote: 'Water the beans.', label: 'Q1' }]} mode={mode} onModeChange={setMode} onAsk={onAsk} />;
  }
  const view = render(<Harness />);
  await act(async () => {});
  const chip = within(view.container.querySelector('.raw-pane') as HTMLElement).getByRole('button', { name: 'Q1' });

  expect(fireEvent.mouseDown(chip)).toBe(false);
  await act(async () => fireEvent.click(chip));

  expect(onAsk).toHaveBeenCalledWith({ passage: { quote: 'Water the beans.', label: 'Q1' }, anchor: chip });
});

test('in raw mode the button beside a selection asks about the selected markdown, and marks it while asking', async () => {
  const onAskSelection = mock((_: SelectionAsk) => {});
  const doc = docFromMarkdown('The **quick** fox.\n');
  function Harness({ asking }: { asking: boolean }) {
    return (
      <MarkdownEditor doc={doc} readOnly={false} highlights={[]} mode="raw" onAskSelection={onAskSelection} askingSelection={asking} />
    );
  }
  const view = render(<Harness asking={false} />);
  await act(async () => {});
  const area = view.container.querySelector('textarea')!;
  await act(async () => {
    area.focus();
    area.setSelectionRange(4, 13);
    fireEvent.select(area);
  });

  const button = view.getByRole('button', { name: 'Ask the AI about the selection' });
  await act(async () => fireEvent.click(button));
  view.rerender(<Harness asking />);

  expect(onAskSelection).toHaveBeenCalledWith({ markdown: '**quick**', anchor: button });
  expect(view.container.querySelector('.raw-mirror mark.ask-selection')!.textContent).toBe('**quick**');

  view.rerender(<Harness asking={false} />);
  await act(async () => {});
  expect(view.container.querySelector('.raw-mirror mark.ask-selection')).toBeNull();
});

// The editor in raw mode, showing a post whose second highlighted passage has emphasis markers inside it.
async function inRaw(onAskSelection = mock((_ask: SelectionAsk) => {})) {
  const doc = docFromMarkdown('Water the beans.\n\nThe **quick** fox.\n');
  const highlights = [{ quote: 'Water the beans' }, { quote: 'The quick fox' }];
  const view = render(<MarkdownEditor doc={doc} readOnly={false} highlights={highlights} mode="raw" onAskSelection={onAskSelection} />);
  await act(async () => {});
  const area = view.container.querySelector('textarea')!;
  return {
    view,
    area,
    onAskSelection,
    mirror: view.container.querySelector<HTMLElement>('.raw-mirror')!,
    // Clicks a caret `offset` characters into the first occurrence of `text` in the markdown.
    caret: (text: string, offset: number) =>
      act(async () => {
        area.focus();
        const at = area.value.indexOf(text) + offset;
        area.setSelectionRange(at, at);
        fireEvent.select(area);
      }),
  };
}

test('in raw mode, clicking into a highlighted passage outlines it and says so, offering to ask about its markdown', async () => {
  const raw = await inRaw();

  await raw.caret('The **quick** fox', 6);
  const button = askHighlight(raw.view.container)!;
  await act(async () => fireEvent.click(button));

  expect(currentHighlight(raw.mirror)).toBe('The **quick** fox');
  expect(status(raw.view.container)).toBe('Highlight 2 of 2');
  expect(raw.onAskSelection.mock.calls.map(([ask]) => ask)).toEqual([{ markdown: 'The **quick** fox', anchor: button }]);
});

test('in raw mode, > puts the caret at the next highlighted passage, offering to ask about it', async () => {
  const raw = await inRaw();
  await raw.caret('Water the beans', 2);

  await act(async () => fireEvent.click(within(raw.view.container).getByRole('button', { name: 'Next highlight' })));

  expect(raw.area.selectionStart).toBe(raw.area.value.indexOf('The **quick** fox'));
  expect(document.activeElement).toBe(raw.area);
  expect(status(raw.view.container)).toBe('Highlight 2 of 2');
  expect(askHighlight(raw.view.container)).toBeTruthy();
});

test('in raw mode, a caret clicked outside every highlight leaves the writer on the passage they were on', async () => {
  const raw = await inRaw();
  await act(async () => fireEvent.click(within(raw.view.container).getByRole('button', { name: 'Next highlight' })));

  await raw.caret('beans.', 6);

  expect(currentHighlight(raw.mirror)).toBe('The **quick** fox');
  expect(status(raw.view.container)).toBe('Highlight 2 of 2');
});

test('in raw mode, typing before the highlighted passages keeps the writer on the one they were on', async () => {
  const raw = await inRaw();
  await act(async () => fireEvent.click(within(raw.view.container).getByRole('button', { name: 'Next highlight' })));

  await act(async () => fireEvent.change(raw.area, { target: { value: `Now ${raw.area.value}` } }));

  expect(currentHighlight(raw.mirror)).toBe('The **quick** fox');
  expect(status(raw.view.container)).toBe('Highlight 2 of 2');
});

test('in raw mode, typing is not pulled back to where the caret was in the formatted document', async () => {
  const editor = await switchable(docFromMarkdown(POST), TWO);
  await select(editor.view.container, 'quick brown', 2);
  await editor.choose('Raw');
  await act(async () => fireEvent.click(within(editor.menubar as HTMLElement).getByRole('button', { name: 'Next highlight' })));
  const area = editor.textarea()!;

  await act(async () => fireEvent.change(area, { target: { value: `Now ${area.value}` } }));

  expect(currentHighlight(editor.view.container.querySelector<HTMLElement>('.raw-mirror')!)).toBe('Water the beans');
});

test('a document and its load-time state stored as text still take an AI edit, keeping the typing', () => {
  const original = docFromMarkdown(POST);
  const loadBase = snapshot(original);
  type(original, 2, 0, 'Then ');

  const doc = new Y.Doc();
  Y.applyUpdate(doc, decodeUpdate(encodeUpdate(Y.encodeStateAsUpdate(original))));
  const base = snapshotFromUpdate(decodeUpdate(encodeUpdate(loadBase.update)));
  mergeMarkdown(doc, base, WRITTEN.replace('quick brown', 'slow red'));

  expect(markdownOf(doc)).toBe(markdownOf(docFromMarkdown('# Garden Plan\n\nThe slow red fox.\n\nThen Water the beans.\n')));
});

test('a large document update survives being stored as text', () => {
  const update = new Uint8Array(400_000).map((_, i) => (i * 7) % 256);
  const text = encodeUpdate(update);
  expect(text).toBe(Buffer.from(update).toString('base64'));
  expect(decodeUpdate(text)).toEqual(update);
});

test('raw mode styles each kind of syntax with color and background only, so the colored text wraps as the typed text does', async () => {
  const css = (await Bun.file(`${import.meta.dir}/markdown-editor.css`).text())
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Forced-colors mode turns the colors off, which takes other properties.
    .replace(/@media \(forced-colors: active\) \{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    properties: body.split(';').map((d) => d.split(':')[0].trim()).filter(Boolean),
  }));
  const kinds = ['heading', 'link-text', 'link-markup', 'emphasis-markup', 'code', 'quote', 'list-marker'];

  expect(kinds.filter((kind) => !rules.some((r) => r.selector.split(',').some((s) => s.trim() === `.rich-editor .raw-mirror .md-${kind}`)))).toEqual([]);
  expect(rules.filter((r) => r.selector.includes('.md-')).flatMap((r) => r.properties).filter((p) => p !== 'color' && p !== 'background')).toEqual([]);
});
