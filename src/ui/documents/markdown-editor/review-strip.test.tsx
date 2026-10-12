import { expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReviewStrip, reviewSummary } from './review-strip';

const change = (quote: string) => ({ quote });
const question = (quote: string, label: string) => ({ quote, label, question: '?' });

test('the summary counts unlabeled passages as changes and labeled ones as questions', () => {
  expect(reviewSummary([change('a'), change('b'), question('c', 'Q1')])).toBe('Claude changed 2 passages and left 1 question');
});

test('the summary counts one change, one question, or only questions', () => {
  expect(reviewSummary([change('a')])).toBe('Claude changed 1 passage');
  expect(reviewSummary([question('a', 'Q1')])).toBe('Claude left 1 question');
  expect(reviewSummary([question('a', 'Q1'), question('b', 'Q2')])).toBe('Claude left 2 questions');
});

test('with no passages, the summary says Claude changed the post', () => {
  expect(reviewSummary([], ['notes.md'])).toBe('Claude changed this post');
  expect(reviewSummary([], ['notes.md', 'ideas.md', 'plan.md'])).toBe('Claude changed 3 posts');
});

test('a reply that touched more than one post says how many', () => {
  expect(reviewSummary([change('a')], ['notes.md', 'ideas.md', 'plan.md'])).toBe('Claude changed 1 passage in 3 posts');
  expect(reviewSummary([change('a')], ['notes.md'])).toBe('Claude changed 1 passage');
});

const strip = () => document.querySelector('.review-strip');

test('the strip draws nothing with no passages and no reply to undo', () => {
  render(<ReviewStrip passages={[]} placed={0} current={0} onStep={() => {}} onDismiss={() => {}} />);

  expect(strip()).toBeNull();
});

test('the strip shows for a reply that changed the post without leaving passages, with no stepping', () => {
  render(<ReviewStrip passages={[]} placed={0} current={0} onStep={() => {}} turn={{ files: ['notes.md'], pending: false, onUndoAll: () => {} }} onDismiss={() => {}} />);

  expect(strip()!.textContent).toContain('Claude changed this post');
  expect(screen.queryByRole('button', { name: 'Next highlight' })).toBeNull();
  expect(screen.getByRole('button', { name: "Undo Claude's changes in notes.md" })).toBeTruthy();
});

test('the strip says where the writer is, and steps through the passages', async () => {
  const onStep = mock((_: -1 | 1) => {});
  render(<ReviewStrip passages={[change('a'), change('b'), change('c')]} placed={2} current={1} onStep={onStep} onDismiss={() => {}} />);

  expect(document.querySelector('.highlight-status')!.textContent).toBe('2 of 2 (1 not found)');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Previous highlight' })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Next highlight' })));

  expect(onStep.mock.calls).toEqual([[-1], [1]]);
});

test('Undo all is offered only with a reply to undo, named for the posts it changes, and off while it runs', () => {
  const view = render(<ReviewStrip passages={[change('a')]} placed={1} current={0} onStep={() => {}} onDismiss={() => {}} />);
  expect(screen.queryByText('Undo all')).toBeNull();

  view.rerender(
    <ReviewStrip passages={[change('a')]} placed={1} current={0} onStep={() => {}} turn={{ files: ['notes.md', 'ideas.md'], pending: true, onUndoAll: () => {} }} onDismiss={() => {}} />,
  );

  const undo = screen.getByRole('button', { name: "Undo Claude's changes in notes.md, ideas.md" }) as HTMLButtonElement;
  expect(undo.textContent).toBe('Undo all');
  expect(undo.disabled).toBe(true);
});

test('Dismiss review asks to dismiss it', async () => {
  const onDismiss = mock(() => {});
  render(<ReviewStrip passages={[change('a')]} placed={1} current={0} onStep={() => {}} onDismiss={onDismiss} />);

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dismiss review' })));

  expect(onDismiss).toHaveBeenCalledTimes(1);
});
