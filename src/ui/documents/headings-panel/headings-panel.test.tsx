import { expect, mock, test } from 'bun:test';
import { fireEvent, render, within } from '@testing-library/react';
import { docFromMarkdown, replaceMarkdown } from '../markdown-editor/markdown-editor';
import { HeadingsPanel } from './headings-panel';

test('says no file is open when there is no document', () => {
  const view = render(<HeadingsPanel doc={undefined} />);

  expect(within(view.getByRole('complementary', { name: 'Outline' })).getByText('No file open.')).toBeTruthy();
});

test('says where headings come from when the document has none to list', () => {
  const view = render(<HeadingsPanel doc={docFromMarkdown('###### Too deep\n\nThe quick brown fox.\n')} />);

  const panel = within(view.getByRole('complementary', { name: 'Outline' }));
  expect(panel.getByText('Headings from # to ##### appear here.')).toBeTruthy();
  expect(panel.queryByText('No file open.')).toBeNull();
});

test("lists the document's headings, each read with its level first", () => {
  const view = render(<HeadingsPanel doc={docFromMarkdown('# Garden Plan\n\n## Beds\n\nSow them.\n\n### North bed\n')} />);

  const list = view.getByRole('list', { name: 'Headings in this file' });
  expect(within(list).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
    'Level 1, Garden Plan',
    'Level 2, Beds',
    'Level 3, North bed',
  ]);
});

test('shows a heading added to the document when it next renders', () => {
  const doc = docFromMarkdown('# Garden Plan\n');
  const view = render(<HeadingsPanel doc={doc} />);

  replaceMarkdown(doc, '# Garden Plan\n\n## Pricing\n');
  view.rerender(<HeadingsPanel doc={doc} />);

  const list = view.getByRole('list', { name: 'Headings in this file' });
  expect(within(list).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
    'Level 1, Garden Plan',
    'Level 2, Pricing',
  ]);
});

test('the list area takes no focus stop of its own, since Tab reaches each heading, scrolling the list to it', () => {
  const view = render(<HeadingsPanel doc={docFromMarkdown('# Garden Plan\n')} />);

  expect(view.getByRole('list', { name: 'Headings in this file' }).parentElement!.hasAttribute('tabindex')).toBe(false);
});

test('choosing a heading says which one, counted from the top of the list', () => {
  const onGo = mock((_index: number) => {});
  const view = render(<HeadingsPanel doc={docFromMarkdown('# Garden Plan\n\n## Beds\n\n### North bed\n')} onGo={onGo} />);

  fireEvent.click(view.getByRole('button', { name: 'Level 2, Beds' }));

  expect(onGo.mock.calls).toEqual([[1]]);
});
