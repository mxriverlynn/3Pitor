import { expect, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { PanelResizer } from './panel-resizer';

// A resizer over a width it owns, from 120px to 600px, as the page wires the Documents tree's; `width` is the latest.
let width: number;
function Resizer({ start = 170 }: { start?: number }) {
  const [now, setNow] = useState(start);
  width = now;
  return <PanelResizer label="Resize the panel" width={now} min={120} max={600} onResize={setNow} />;
}

const bar = () => screen.getByRole('separator', { name: 'Resize the panel' });
const drag = async (from: number, to: number) => {
  await act(async () => fireEvent.pointerDown(bar(), { clientX: from, button: 0 }));
  await act(async () => fireEvent.pointerMove(window, { clientX: to }));
  await act(async () => fireEvent.pointerUp(window, { clientX: to }));
};

test('dragging the bar widens or narrows the panel by the distance dragged', async () => {
  render(<Resizer />);

  await drag(170, 250);
  expect(width).toBe(250);

  await drag(250, 200);
  expect(width).toBe(200);
});

test('once the pointer is let go, moving it no longer resizes the panel', async () => {
  render(<Resizer />);
  await drag(170, 250);

  await act(async () => fireEvent.pointerMove(window, { clientX: 400 }));

  expect(width).toBe(250);
});

test('a pointer the browser cancels ends the drag too', async () => {
  render(<Resizer />);
  await act(async () => fireEvent.pointerDown(bar(), { clientX: 170, button: 0 }));
  await act(async () => fireEvent.pointerCancel(window));

  await act(async () => fireEvent.pointerMove(window, { clientX: 400 }));

  expect(width).toBe(170);
});

test('dragging the bar does not select text on the page', async () => {
  render(<Resizer />);

  const selecting = fireEvent.pointerDown(bar(), { clientX: 170, button: 0 });
  await act(async () => fireEvent.pointerUp(window));

  // fireEvent returns false when the press's default action, starting a text selection, was prevented.
  expect(selecting).toBe(false);
});

test('only the main button drags the bar', async () => {
  render(<Resizer />);
  await act(async () => fireEvent.pointerDown(bar(), { clientX: 170, button: 2 }));

  await act(async () => fireEvent.pointerMove(window, { clientX: 400 }));

  expect(width).toBe(170);
});

test('the panel is never narrower than its least width or wider than its greatest', async () => {
  render(<Resizer />);

  await drag(170, 0);
  expect(width).toBe(120);

  await drag(120, 900);
  expect(width).toBe(600);
});

test('the arrow keys resize the panel from the keyboard, and the bar says how wide the panel is', async () => {
  render(<Resizer />);
  expect(bar().tabIndex).toBe(0);
  expect([bar().getAttribute('aria-valuenow'), bar().getAttribute('aria-valuemin'), bar().getAttribute('aria-valuemax')]).toEqual(['170', '120', '600']);

  await act(async () => fireEvent.keyDown(bar(), { key: 'ArrowRight' }));
  expect(width).toBe(180);
  expect(bar().getAttribute('aria-valuenow')).toBe('180');

  await act(async () => fireEvent.keyDown(bar(), { key: 'ArrowLeft' }));
  await act(async () => fireEvent.keyDown(bar(), { key: 'ArrowLeft' }));
  expect(width).toBe(160);
});
