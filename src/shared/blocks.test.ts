import { expect, test } from 'bun:test';
import { defaultMarkdownParser } from 'prosemirror-markdown';
import { type TextblockTree, textblocks } from './blocks';

test('finds no blocks in a document with no textblocks', () => {
  expect(textblocks({ isTextblock: false, textContent: '', descendants: () => {} })).toEqual([]);
});

// A tree built by hand, not by ProseMirror: blocks.ts depends on nothing but this shape.
const block = (textContent: string): TextblockTree => ({ isTextblock: true, textContent, descendants: () => {} });
const container = (children: [TextblockTree, number][]): TextblockTree => ({
  isTextblock: false,
  textContent: '',
  descendants: (visit) => children.forEach(([node, pos]) => visit(node, pos)),
});

test('finds each textblock with the position just inside it, in any tree of that shape', () => {
  expect(textblocks(container([[block('Title'), 0], [container([]), 7], [block('Body'), 9]]))).toEqual([
    { text: 'Title', pos: 1 },
    { text: 'Body', pos: 10 },
  ]);
});

test('finds the blocks of a parsed post, each at the position its content starts', () => {
  expect(textblocks(defaultMarkdownParser.parse('# A\n\nb'))).toEqual([
    { text: 'A', pos: 1 },
    { text: 'b', pos: 4 },
  ]);
});

test('finds headings, paragraphs, list items and code blocks in document order, and not the lists around them', () => {
  const doc = defaultMarkdownParser.parse('# Plan\n\nSoil\n\n- beans\n\n```\nwater();\n```\n');
  expect(textblocks(doc)).toEqual([
    { text: 'Plan', pos: 1 },
    { text: 'Soil', pos: 7 },
    { text: 'beans', pos: 15 },
    { text: 'water();', pos: 24 },
  ]);
});
