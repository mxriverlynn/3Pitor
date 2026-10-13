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

test('reads a pipe table as a table: a row of header cells, then a row of cells for each line under it', () => {
  const table = parseMarkdown('| crop | bed |\n| --- | --- |\n| beans | north |\n| kale | south |\n').firstChild!;

  expect(table.type.name).toBe('table');
  expect(table.content.content.map((row) => row.content.content.map((cell) => [cell.type.name, cell.textContent]))).toEqual([
    [['table_header', 'crop'], ['table_header', 'bed']],
    [['table_cell', 'beans'], ['table_cell', 'north']],
    [['table_cell', 'kale'], ['table_cell', 'south']],
  ]);
});

test('writes a table back out as a pipe table', () => {
  expect(roundTrip('Plan:\n\n| crop | bed |\n|-|-|\n| beans | north |\n')).toBe('Plan:\n\n| crop | bed |\n| --- | --- |\n| beans | north |');
});

test("keeps each column's alignment", () => {
  expect(roundTrip('| crop | rows | bed | note |\n| :-- | :-: | --: | --- |\n| beans | 4 | north | ok |')).toBe(
    '| crop | rows | bed | note |\n| :--- | :---: | ---: | --- |\n| beans | 4 | north | ok |',
  );
});

test('keeps the formatting in each cell', () => {
  const table = '| crop | note |\n| --- | --- |\n| *beans* | see [the plan](plan.md) and `rows` |';
  expect(roundTrip(table)).toBe(table);
});

test('writes a pipe in a cell so it stays in that cell', () => {
  const table = parseMarkdown('| a \\| b | `c \\| d` |\n| --- | --- |\n').firstChild!;
  expect(table.firstChild!.content.content.map((cell) => cell.textContent)).toEqual(['a | b', 'c | d']);
  expect(roundTrip('| a \\| b | `c \\| d` |\n| --- | --- |\n')).toBe('| a \\| b | `c \\| d` |\n| --- | --- |');
});
