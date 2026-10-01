import { afterEach, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { LinkPopup } from './link-popup';

// The anchors each test put in the page.
afterEach(() => {
  document.body.innerHTML = '';
});

const target = () => screen.getByRole('textbox', { name: 'Link target' });

// The popup as the editor shows it, pointing at the selected text.
function popup(props: Partial<Parameters<typeof LinkPopup>[0]> = {}) {
  const anchor = document.createElement('span');
  anchor.textContent = 'quick brown';
  document.body.append(anchor);
  const onLink = mock((_link: { href: string; title: string }) => {});
  const onClose = mock(() => {});
  const view = render(<LinkPopup anchor={anchor} onLink={onLink} onClose={onClose} {...props} />);
  return { anchor, onLink, onClose, view };
}

test('shows a dialog for the link, with its target focused', () => {
  popup();

  expect(screen.getByRole('dialog', { name: 'Add a link' })).toBeTruthy();
  expect(document.activeElement).toBe(target());
});

test('Add link and Enter link the text to the target and title, but not while the target is blank', () => {
  const { onLink } = popup();

  fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
  fireEvent.change(target(), { target: { value: '  https://example.com  ' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: ' Example ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
  fireEvent.keyDown(target(), { key: 'Enter' });

  expect(onLink.mock.calls).toEqual([[{ href: 'https://example.com', title: 'Example' }], [{ href: 'https://example.com', title: 'Example' }]]);
});

test('the X and Escape close it without linking', () => {
  for (const close of [() => fireEvent.click(screen.getByRole('button', { name: 'Close' })), () => fireEvent.keyDown(target(), { key: 'Escape' })]) {
    const { onLink, onClose, view } = popup();
    fireEvent.change(target(), { target: { value: 'https://example.com' } });
    close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onLink).toHaveBeenCalledTimes(0);
    view.unmount();
    document.body.innerHTML = '';
  }
});

test('the title starts as the one it is given, ready to change', () => {
  const { onLink } = popup({ title: 'quick brown' });

  expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('quick brown');
  fireEvent.change(target(), { target: { value: 'https://example.com' } });
  fireEvent.keyDown(target(), { key: 'Enter' });
  expect(onLink.mock.calls).toEqual([[{ href: 'https://example.com', title: 'quick brown' }]]);
});

test('an address that runs a script is no link: the popup says so and links nothing', () => {
  const { onLink } = popup();

  for (const address of ['javascript:alert(1)', ' JavaScript:alert(1)', 'vbscript:x', 'data:text/html,hi']) {
    fireEvent.change(target(), { target: { value: address } });
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
  }

  expect(onLink).toHaveBeenCalledTimes(0);
  expect(screen.getByRole('alert').textContent).toBe('A link can’t run a script. Use a web address instead.');
});
