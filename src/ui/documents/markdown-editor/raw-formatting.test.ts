import { expect, test } from 'bun:test';
import { applyEdit, pastedLink, type RawFormat, rawFormat } from './raw-formatting';
import { parseMarkdown } from '../../../shared/markdown';

// Applies `format` to `marked`, whose selection runs from "[" to "]" (or sits at "|"), and returns the result
// marked the same way.
function format(marked: string, format: RawFormat): string {
  const caret = marked.indexOf('|');
  const from = caret >= 0 ? caret : marked.indexOf('[');
  const to = caret >= 0 ? caret : marked.indexOf(']') - 1;
  const text = caret >= 0 ? marked.replace('|', '') : marked.replace('[', '').replace(']', '');
  const edit = rawFormat({ text, from, to }, format);
  const result = applyEdit(text, edit);
  const [start, end] = edit.select;
  if (start === end) return `${result.slice(0, start)}|${result.slice(start)}`;
  return `${result.slice(0, start)}[${result.slice(start, end)}]${result.slice(end)}`;
}

test('bold, italic, and code wrap the selection in their markers, keeping it selected', () => {
  expect(format('The [quick] fox.', { kind: 'strong' })).toBe('The **[quick]** fox.');
  expect(format('The [quick] fox.', { kind: 'em' })).toBe('The *[quick]* fox.');
  expect(format('The [quick] fox.', { kind: 'code' })).toBe('The `[quick]` fox.');
});

test('with nothing selected, bold puts its markers at the caret with the caret between them', () => {
  expect(format('The | fox.', { kind: 'strong' })).toBe('The **|** fox.');
});

test('bold on text already in bold markers takes them off', () => {
  expect(format('The **[quick]** fox.', { kind: 'strong' })).toBe('The [quick] fox.');
});

test('a link and an image wrap the selection as their text, with the url selected to type over', () => {
  expect(format('See [the docs] now.', { kind: 'link' })).toBe('See [the docs]([url]) now.');
  expect(format('See | now.', { kind: 'link' })).toBe('See [link text]([url]) now.');
  expect(format('A |', { kind: 'image' })).toBe('A ![alt text]([url])');
});

test('a horizontal rule goes on a line of its own after the line with the caret', () => {
  expect(format('First| line.\nSecond.', { kind: 'rule' })).toBe('First line.\n\n---\n|\nSecond.');
});

test('a list turns each selected line into an item, and takes them back out when they all are', () => {
  expect(format('[One\nTwo]\nThree', { kind: 'bullet-list' })).toBe('[- One\n- Two]\nThree');
  expect(format('[- One\n- Two]', { kind: 'bullet-list' })).toBe('[One\nTwo]');
  expect(format('[One\n\nTwo]', { kind: 'ordered-list' })).toBe('[1. One\n\n2. Two]');
  expect(format('[- One\n- Two]', { kind: 'ordered-list' })).toBe('[1. One\n2. Two]');
});

test('a selection that ends at the start of a line leaves that line out', () => {
  expect(format('[One\n]Two', { kind: 'bullet-list' })).toBe('[- One]\nTwo');
});

test('a block quote marks each selected line, and unmarks them when they all are', () => {
  expect(format('Wi|se words\nhere', { kind: 'blockquote' })).toBe('[> Wise words]\nhere');
  expect(format('[> Wise\n> words]', { kind: 'blockquote' })).toBe('[Wise\nwords]');
});

test('a heading replaces any heading marker on the line, and a paragraph removes it', () => {
  expect(format('Gar|den Plan', { kind: 'heading', level: 2 })).toBe('[## Garden Plan]');
  expect(format('# Gar|den Plan', { kind: 'heading', level: 3 })).toBe('[### Garden Plan]');
  expect(format('## Gar|den Plan', { kind: 'heading', level: 0 })).toBe('[Garden Plan]');
});

test('a code block fences the selected lines', () => {
  expect(format('Intro\n[let a = 1;\nlet b = 2;]', { kind: 'code-block' })).toBe('Intro\n[```\nlet a = 1;\nlet b = 2;\n```]');
});

test('a link pasted over a selection wraps it as the link text, titled with the text, keeping the text selected', () => {
  const text = 'The quick brown fox.';
  const edit = pastedLink({ text, from: 4, to: 15 }, ' https://example.com/ ')!;

  expect(applyEdit(text, edit)).toBe('The [quick brown](https://example.com/ "quick brown") fox.');
  expect(edit.select).toEqual([5, 16]);
});

test('pasting anything but a web address, or pasting with nothing selected, makes no link', () => {
  const text = 'The quick brown fox.';

  expect(pastedLink({ text, from: 4, to: 15 }, 'slow red')).toBeUndefined();
  expect(pastedLink({ text, from: 4, to: 15 }, 'https://example.com/ and more')).toBeUndefined();
  expect(pastedLink({ text, from: 4, to: 4 }, 'https://example.com/')).toBeUndefined();
});

test('a link pasted over text with quotes in it keeps the whole text as its title', () => {
  const text = 'She said "hi" twice.';
  const linked = applyEdit(text, pastedLink({ text, from: 4, to: 13 }, 'https://example.com/')!);

  const link = parseMarkdown(linked).firstChild!.child(1).marks[0];
  expect(link.attrs).toEqual({ href: 'https://example.com/', title: 'said "hi"' });
});

test('a link with the caret in its text takes the link off, leaving the caret where it was in the text', () => {
  expect(format('The [qui|ck brown](https://example.com "Quick") fox.', { kind: 'link' })).toBe('The qui|ck brown fox.');
});

test('a link with the caret in its address takes the link off, leaving the caret at the end of the text', () => {
  expect(format('The [quick brown](https://exa|mple.com) fox.', { kind: 'link' })).toBe('The quick brown| fox.');
});

test('a link with the caret in an image leaves the image as it is', () => {
  expect(format('A ![fox|](fox.png) here.', { kind: 'link' })).toContain('](fox.png)');
});

test('a link whose title has a closing bracket in it comes off whole', () => {
  expect(format('The [qu|ick](https://example.com "Smile :)") fox.', { kind: 'link' })).toBe('The qu|ick fox.');
  expect(format("The [qu|ick](https://example.com 'Smile :)') fox.", { kind: 'link' })).toBe('The qu|ick fox.');
});

test('a link whose title is in brackets comes off whole', () => {
  expect(format('The [qu|ick](https://example.com (Quick)) fox.', { kind: 'link' })).toBe('The qu|ick fox.');
});

test('a link whose text is an image comes off, leaving the image', () => {
  expect(format('A [![a|lt](i.png)](https://example.com) here.', { kind: 'link' })).toBe('A ![a|lt](i.png) here.');
});

test('a link whose address has brackets in it comes off whole', () => {
  expect(format('See [fo|o](https://en.wikipedia.org/wiki/Foo_(bar)) here.', { kind: 'link' })).toBe('See fo|o here.');
});

test('a link comes off whole when its text has brackets or escapes in it, or its address is in angle brackets', () => {
  expect(format('A [fo|o [x] bar](https://example.com) b', { kind: 'link' })).toBe('A fo|o [x] bar b');
  expect(format('A [fo|o \\] bar](https://example.com) b', { kind: 'link' })).toBe('A fo|o \\] bar b');
  expect(format('A [fo|o](<https://example.com/a b>) b', { kind: 'link' })).toBe('A fo|o b');
});

test('link markdown that is escaped is only text, which the link button links rather than unlinks', () => {
  expect(rawFormat({ text: 'A \\[foo](u) b', from: 4, to: 4 }, { kind: 'link' }).insert).toBe('[link text](url)');
});

test('link markdown in code is only code, which the link button does not unlink', () => {
  expect(rawFormat({ text: 'A `[foo](u)` b', from: 5, to: 5 }, { kind: 'link' }).insert).toBe('[link text](url)');
  expect(rawFormat({ text: '```\n[foo](u)\n```\n', from: 6, to: 6 }, { kind: 'link' }).insert).toBe('[link text](url)');
});

test('a selection that touches links takes them all off, rather than putting a link around them', () => {
  const unlinked = (text: string, from: number, to: number) => applyEdit(text, rawFormat({ text, from, to }, { kind: 'link' }));

  expect(unlinked('x [a](u) y', 0, 6)).toBe('x a y');
  expect(unlinked('[a](u) and [b](v "B")', 0, 21)).toBe('a and b');
});

test('a link pasted over only spaces makes no link', () => {
  expect(pastedLink({ text: 'a   b', from: 1, to: 4 }, 'https://example.com/')).toBeUndefined();
});

test('a link pasted over text with spaces at its ends leaves the spaces outside the link', () => {
  const text = 'a  quick  b';
  const edit = pastedLink({ text, from: 1, to: 9 }, 'https://example.com/')!;

  expect(applyEdit(text, edit)).toBe('a  [quick](https://example.com/ "quick")  b');
  expect(edit.select).toEqual([4, 9]);
});

test('a link pasted over text the link markdown cannot hold is left to the browser to paste', () => {
  const pasted = (text: string) => pastedLink({ text, from: 0, to: text.length }, 'https://example.com/');

  expect(pasted('foo\\')).toBeUndefined();
  expect(pasted('[')).toBeUndefined();
  expect(pasted('one\n\ntwo')).toBeUndefined();
});

test('a pasted address with a bracket the markdown cannot hold as it is goes in angle brackets', () => {
  const edit = pastedLink({ text: 'foo', from: 0, to: 3 }, 'https://example.com/a)b');

  expect(edit && applyEdit('foo', edit)).toBe('[foo](<https://example.com/a)b> "foo")');
});

test('a link pasted over code is left to the browser to paste, since code holds no links', () => {
  expect(pastedLink({ text: 'A `quick` b', from: 3, to: 8 }, 'https://example.com/')).toBeUndefined();
  expect(pastedLink({ text: '```\nquick\n```\n', from: 4, to: 9 }, 'https://example.com/')).toBeUndefined();
});

test('a link pasted over text in a link points that link at it instead, keeping its text and title', () => {
  const text = 'See [quick brown](https://old.example/ "Quick") here.';
  const from = text.indexOf('brown');
  const edit = pastedLink({ text, from, to: from + 5 }, 'https://example.com/')!;

  expect(applyEdit(text, edit)).toBe('See [quick brown](https://example.com/ "Quick") here.');
  expect(edit.select).toEqual([from, from + 5]);
});

test('a link pasted over part of a link’s markdown, or over an image, is left to the browser to paste', () => {
  const pasted = (text: string, from: number, to: number) => pastedLink({ text, from, to }, 'https://example.com/');

  expect(pasted('See [quick](u) here.', 0, 8)).toBeUndefined();
  expect(pasted('A ![fox](f.png) b', 4, 7)).toBeUndefined();
});
