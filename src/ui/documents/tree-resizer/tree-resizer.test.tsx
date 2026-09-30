import { expect, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { TreeResizer } from './tree-resizer';

// The resizer over a width it owns, as the page wires it; `width` is the latest.
let width: number;
function Resizer({ start = 170 }: { start?: number }) {
  const [now, setNow] = useState(start);
  width = now;
  return <TreeResizer width={now} onResize={setNow} />;
}

const bar = () => screen.getByRole('separator', { name: 'Resize the Documents tree' });
const drag = async (from: number, to: number) => {
  await act(async () => fireEvent.pointerDown(bar(), { clientX: from, button: 0 }));
  await act(async () => fireEvent.pointerMove(window, { clientX: to }));
  await act(async () => fireEvent.pointerUp(window, { clientX: to }));
};

test('dragging the bar widens or narrows the tree by the distance dragged', async () => {
  render(<Resizer />);

  await drag(170, 250);
  expect(width).toBe(250);

  await drag(250, 200);
  expect(width).toBe(200);
});

test('once the pointer is let go, moving it no longer resizes the tree', async () => {
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

test('the tree is never narrower than 120px or wider than 600px', async () => {
  render(<Resizer />);

  await drag(170, 0);
  expect(width).toBe(120);

  await drag(120, 900);
  expect(width).toBe(600);
});
