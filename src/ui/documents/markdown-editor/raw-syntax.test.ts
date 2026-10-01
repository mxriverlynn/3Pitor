import { expect, test } from 'bun:test';
import { rawSyntax } from './raw-syntax';

test('an empty text has nothing to color', () => {
  expect(rawSyntax('')).toEqual([]);
});

test('a heading is colored across its whole line', () => {
  expect(rawSyntax('Intro\n## Title\nMore')).toEqual([{ from: 6, to: 14, kind: 'heading' }]);
});

test('a quote is colored across its line, a list item only at its marker, and a hashtag not at all', () => {
  expect(rawSyntax('#hashtag\n1. item\n* item\n> q\n  - [x] done')).toEqual([
    { from: 9, to: 12, kind: 'list-marker' },
    { from: 17, to: 19, kind: 'list-marker' },
    { from: 24, to: 27, kind: 'quote' },
    { from: 28, to: 36, kind: 'list-marker' },
  ]);
});

test('inline code is shaded, but not when its closing backticks lie past a blank line', () => {
  expect(rawSyntax('a `b` c')).toEqual([{ from: 2, to: 5, kind: 'code' }]);
  expect(rawSyntax('a `b\n\nc` d')).toEqual([]);
});

test('a fenced code block is one shaded stretch, closing fence included, with no headings or lists inside it', () => {
  const text = 'Intro\n```\n# not a heading\n- not a list\n```\nAfter';
  expect(rawSyntax(text)).toEqual([{ from: 6, to: 42, kind: 'code' }]);
});

test("a link's text is colored apart from its brackets and address", () => {
  expect(rawSyntax('A [link](http://x)')).toEqual([
    { from: 2, to: 3, kind: 'link-markup' },
    { from: 3, to: 7, kind: 'link-text' },
    { from: 7, to: 18, kind: 'link-markup' },
  ]);
});

test('a link in a heading cuts the heading around it', () => {
  expect(rawSyntax('# See [a](b) more')).toEqual([
    { from: 0, to: 6, kind: 'heading' },
    { from: 6, to: 7, kind: 'link-markup' },
    { from: 7, to: 8, kind: 'link-text' },
    { from: 8, to: 12, kind: 'link-markup' },
    { from: 12, to: 17, kind: 'heading' },
  ]);
});

test("an image in a link's text has its own markup cut out of the link's text, and an empty text is left out", () => {
  expect(rawSyntax('[![alt](i.png)](http://u)')).toEqual([
    { from: 0, to: 1, kind: 'link-markup' },
    { from: 1, to: 3, kind: 'link-markup' },
    { from: 3, to: 6, kind: 'link-text' },
    { from: 6, to: 14, kind: 'link-markup' },
    { from: 14, to: 25, kind: 'link-markup' },
  ]);
  expect(rawSyntax('![](u)')).toEqual([
    { from: 0, to: 2, kind: 'link-markup' },
    { from: 2, to: 6, kind: 'link-markup' },
  ]);
});

test('an escaped bracket is no link', () => {
  expect(rawSyntax('\\[x](y)')).toEqual([]);
});

test('emphasis markers of one to three stars or underscores are colored where they pair up', () => {
  expect(rawSyntax('*a* __b__ ***c***')).toEqual([
    { from: 0, to: 1, kind: 'emphasis-markup' },
    { from: 2, to: 3, kind: 'emphasis-markup' },
    { from: 4, to: 6, kind: 'emphasis-markup' },
    { from: 7, to: 9, kind: 'emphasis-markup' },
    { from: 10, to: 13, kind: 'emphasis-markup' },
    { from: 14, to: 17, kind: 'emphasis-markup' },
  ]);
});

test('stars and underscores that are not emphasis stay plain', () => {
  expect(rawSyntax('snake_case_name\n**bold\n**a*\n2 * 3 * 4\n\\*a\\*')).toEqual([]);
});

test('stars in code or in a link address are no emphasis, but in link text they cut the text around them', () => {
  expect(rawSyntax('`*a*`')).toEqual([{ from: 0, to: 5, kind: 'code' }]);
  expect(rawSyntax('[x](http://a*b*c)')).toEqual([
    { from: 0, to: 1, kind: 'link-markup' },
    { from: 1, to: 2, kind: 'link-text' },
    { from: 2, to: 17, kind: 'link-markup' },
  ]);
  expect(rawSyntax('[**a**](b)')).toEqual([
    { from: 0, to: 1, kind: 'link-markup' },
    { from: 1, to: 3, kind: 'emphasis-markup' },
    { from: 3, to: 4, kind: 'link-text' },
    { from: 4, to: 6, kind: 'emphasis-markup' },
    { from: 6, to: 10, kind: 'link-markup' },
  ]);
});

test('nested emphasis pairs each marker with its own', () => {
  expect(rawSyntax('*a **b** c*').map((s) => [s.from, s.to])).toEqual([
    [0, 1],
    [3, 5],
    [6, 8],
    [10, 11],
  ]);
});

test('a star in code does not pair with one outside it', () => {
  expect(rawSyntax('`a*` b *c*')).toEqual([
    { from: 0, to: 4, kind: 'code' },
    { from: 7, to: 8, kind: 'emphasis-markup' },
    { from: 9, to: 10, kind: 'emphasis-markup' },
  ]);
});

test('a document with every kind of syntax has each colored in order', () => {
  expect(rawSyntax('# Title\nA [link](http://x) and `c`\n> quoted\n- item **b**')).toEqual([
    { from: 0, to: 7, kind: 'heading' },
    { from: 10, to: 11, kind: 'link-markup' },
    { from: 11, to: 15, kind: 'link-text' },
    { from: 15, to: 26, kind: 'link-markup' },
    { from: 31, to: 34, kind: 'code' },
    { from: 35, to: 43, kind: 'quote' },
    { from: 44, to: 46, kind: 'list-marker' },
    { from: 51, to: 53, kind: 'emphasis-markup' },
    { from: 54, to: 56, kind: 'emphasis-markup' },
  ]);
});
