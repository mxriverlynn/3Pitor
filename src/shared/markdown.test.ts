import { expect, test } from 'bun:test';
import { markdownSerializer, parseMarkdown } from './markdown';

const roundTrip = (markdown: string) => markdownSerializer.serialize(parseMarkdown(markdown));

test('reads a bullet list with boxes as a task list, each box ticked or not', () => {
  const list = parseMarkdown('- [ ] sow the beans\n- [x] till the bed\n- [X] water\n').firstChild!;

  expect(list.type.name).toBe('task_list');
  expect(list.content.content.map((item) => [item.type.name, item.attrs.checked, item.textContent])).toEqual([
    ['task_item', false, 'sow the beans'],
    ['task_item', true, 'till the bed'],
    ['task_item', true, 'water'],
  ]);
});

test('writes each task back out with its box as it is', () => {
  expect(roundTrip('- [ ] sow the beans\n- [x] till *the* bed\n')).toBe('- [ ] sow the beans\n- [x] till *the* bed');
});

test('keeps plain items in a task list without a box, and nested and loose task lists as they are', () => {
  expect(roundTrip('- [ ] sow\n- plain\n')).toBe('- [ ] sow\n- plain');
  expect(roundTrip('* [ ] beds\n  - [x] north bed\n')).toBe('- [ ] beds\n  - [x] north bed');
  expect(roundTrip('- [ ] sow\n\n- [x] till\n\n  then rake\n')).toBe('- [ ] sow\n\n- [x] till\n\n  then rake');
});

test('leaves lists without boxes, and escaped brackets, as plain lists', () => {
  expect(parseMarkdown('- beans\n').firstChild!.type.name).toBe('bullet_list');
  expect(parseMarkdown('- \\[ ] beans\n').firstChild!.type.name).toBe('bullet_list');
  expect(parseMarkdown('- [link](https://example.com)\n').firstChild!.type.name).toBe('bullet_list');
});
