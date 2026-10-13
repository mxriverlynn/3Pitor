import { afterEach, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { type Image, ImagePopup } from './image-popup';

// The anchors each test put in the page.
afterEach(() => {
  document.body.innerHTML = '';
});

const address = () => screen.getByRole('textbox', { name: 'Image address' });

// The popup as the editor shows it, pointing at the caret.
function popup(props: Partial<Parameters<typeof ImagePopup>[0]> = {}) {
  const anchor = document.createElement('span');
  document.body.append(anchor);
  const onInsert = mock((_image: Image) => {});
  const onClose = mock(() => {});
  const view = render(<ImagePopup anchor={anchor} onInsert={onInsert} onClose={onClose} {...props} />);
  return { anchor, onInsert, onClose, view };
}

test('shows a dialog for the image, with its address focused', () => {
  popup();

  expect(screen.getByRole('dialog', { name: 'Add an image' })).toBeTruthy();
  expect(document.activeElement).toBe(address());
});

test('Add image and Enter put in the image with its address, description and hover text', () => {
  const { onInsert } = popup();

  fireEvent.change(address(), { target: { value: '  https://example.com/fox.png  ' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: ' A fox ' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Hover text' }), { target: { value: ' Quick ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add image' }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Hover text' }), { key: 'Enter' });
  fireEvent.keyDown(address(), { key: 'Enter', isComposing: true });

  const image = { src: 'https://example.com/fox.png', alt: 'A fox', title: 'Quick' };
  expect(onInsert.mock.calls).toEqual([[image], [image]]);
});

test('with no address, it says to add one, and puts nothing in until there is one', () => {
  const { onInsert } = popup();

  fireEvent.click(screen.getByRole('button', { name: 'Add image' }));

  expect(screen.getByRole('alert').textContent).toBe('Add the image’s address.');
  expect(address().getAttribute('aria-invalid')).toBe('true');
  expect(address().getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
  expect(onInsert).toHaveBeenCalledTimes(0);
  fireEvent.change(address(), { target: { value: 'fox.png' } });
  expect(screen.queryByRole('alert')).toBeNull();
});

test('an address that runs a script, or holds the image itself, is refused', () => {
  for (const src of ['javascript:alert(1)', ' data:image/png;base64,AAAA']) {
    const { onInsert, view } = popup();
    fireEvent.change(address(), { target: { value: src } });
    fireEvent.keyDown(address(), { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('An image address can’t run a script or hold the image itself. Paste a web address instead.');
    expect(onInsert).toHaveBeenCalledTimes(0);
    view.unmount();
    document.body.innerHTML = '';
  }
});

test('the X and Escape close it without putting the image in', () => {
  for (const close of [() => fireEvent.click(screen.getByRole('button', { name: 'Close' })), () => fireEvent.keyDown(address(), { key: 'Escape' })]) {
    const { onInsert, onClose, view } = popup();
    fireEvent.change(address(), { target: { value: 'fox.png' } });
    close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledTimes(0);
    view.unmount();
    document.body.innerHTML = '';
  }
});

test('changing an image, it starts with the image’s address, description and hover text, and saves them', () => {
  const { onInsert } = popup({ image: { src: 'fox.png', alt: 'A fox', title: 'Quick' }, editing: true });

  expect(screen.getByRole('dialog', { name: 'Edit image' })).toBeTruthy();
  expect([address(), screen.getByRole('textbox', { name: 'Description' }), screen.getByRole('textbox', { name: 'Hover text' })].map((input) => (input as HTMLInputElement).value)).toEqual(['fox.png', 'A fox', 'Quick']);
  fireEvent.change(address(), { target: { value: 'hen.png' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save image' }));
  expect(onInsert.mock.calls).toEqual([[{ src: 'hen.png', alt: 'A fox', title: 'Quick' }]]);
});

test('it says when the image will take the place of the selected text', () => {
  const { view } = popup();
  expect(screen.queryByText('Replaces the selected text.')).toBeNull();
  view.unmount();

  popup({ replacesSelection: true });
  expect(screen.getByText('Replaces the selected text.')).toBeTruthy();
});

// The text the ids in `input`'s aria-describedby point at.
const describedBy = (input: HTMLElement) =>
  (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)!.textContent);

test('the address and description say what to put in them, as the fields’ descriptions', () => {
  popup();
  fireEvent.click(screen.getByRole('button', { name: 'Add image' }));

  expect(describedBy(address())).toEqual(['Paste a web address for the image.', 'Add the image’s address.']);
  expect(describedBy(screen.getByRole('textbox', { name: 'Description' }))).toEqual([
    'Read aloud to people who can’t see the image. Leave it empty if the image is only decoration.',
  ]);
  expect((screen.getByRole('textbox', { name: 'Hover text' }) as HTMLInputElement).placeholder).toBe('Optional');
});

const preview = () => screen.queryByRole('img', { name: 'Preview' }) as HTMLImageElement | null;

test('it shows the image at the address as a preview, once there is an address', () => {
  popup();
  expect(preview()).toBeNull();

  fireEvent.change(address(), { target: { value: ' https://example.com/fox.png ' } });

  expect(preview()!.getAttribute('src')).toBe('https://example.com/fox.png');
});

test('when the image at the address does not load, it says so in place of the preview', () => {
  popup();
  fireEvent.change(address(), { target: { value: 'https://example.com/missing.png' } });

  fireEvent.error(preview()!);

  expect(preview()).toBeNull();
  expect(describedBy(address())).toEqual(['Paste a web address for the image.', 'Couldn’t load this image. Check the address.']);
});

test('changing the address after an image did not load tries the new address', () => {
  popup();
  fireEvent.change(address(), { target: { value: 'https://example.com/missing.png' } });
  fireEvent.error(preview()!);

  fireEvent.change(address(), { target: { value: 'https://example.com/fox.png' } });

  expect(preview()!.getAttribute('src')).toBe('https://example.com/fox.png');
  expect(screen.queryByText('Couldn’t load this image. Check the address.')).toBeNull();
});

test('an address it would refuse is never previewed', () => {
  popup();

  for (const src of ['javascript:alert(1)', 'data:image/png;base64,AAAA']) {
    fireEvent.change(address(), { target: { value: src } });
    expect(preview()).toBeNull();
  }
});
