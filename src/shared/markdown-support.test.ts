import { expect, test } from 'bun:test';
import { unsupportedMarkdown } from './markdown-support';

test('names each kind of markdown the editor cannot keep', () => {
  expect(unsupportedMarkdown('| a | b |\n| - | - |\n| 1 | 2 |\n')).toEqual(['tables']);
  expect(unsupportedMarkdown('- [ ] water the tomatoes\n')).toEqual(['task lists']);
  expect(unsupportedMarkdown('<div>hi</div>\n')).toEqual(['raw HTML']);
});

test('finds nothing in a plain post', () => {
  expect(unsupportedMarkdown('# Garden Plan\n\n- tomatoes\n- beans\n\nSome *text*.\n')).toEqual([]);
});
