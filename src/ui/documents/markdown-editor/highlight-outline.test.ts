import { expect, test } from 'bun:test';
import { lineBoxes, outlinePath } from './highlight-outline';

// A box given as left, top, right, bottom.
const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

test('nothing to outline gives no path', () => {
  expect(outlinePath([])).toBe('');
});

test('one line is outlined as a rectangle just outside it', () => {
  expect(outlinePath([box(10, 20, 110, 40)])).toBe('M8 18 H112 V42 H8 Z');
});

test('boxes with no width are not lines', () => {
  expect(lineBoxes([box(40, 10, 40, 30)])).toEqual([]);
});

test('pieces on the same line become one box covering them all, one per line', () => {
  expect(lineBoxes([box(100, 10, 150, 30), box(150, 12, 300, 30), box(20, 40, 200, 60)])).toEqual([box(100, 10, 300, 30), box(20, 40, 200, 60)]);
});

test('lines that overlap side to side are outlined as one shape, meeting halfway between them', () => {
  expect(outlinePath([box(100, 10, 300, 30), box(20, 40, 200, 60)])).toBe('M98 8 H302 V35 H202 V62 H18 V35 H98 Z');
});

test('lines that do not overlap side to side are outlined as separate shapes', () => {
  expect(outlinePath([box(100, 10, 300, 30), box(400, 40, 500, 60)])).toBe('M98 8 H302 V32 H98 Z M398 38 H502 V62 H398 Z');
});

test('a wrapped passage with a ragged right edge is outlined as one shape stepping out and back in', () => {
  expect(outlinePath([box(300, 10, 550, 30), box(20, 40, 600, 60), box(20, 70, 580, 90)])).toBe('M298 8 H552 V35 H602 V65 H582 V92 H18 V65 H18 V35 H298 Z');
});

test('a piece taller than its neighbors, such as inline code, still joins their line, and the next line stays its own', () => {
  expect(lineBoxes([box(20, 12, 100, 30), box(100, 8, 160, 42), box(160, 12, 300, 30), box(20, 40, 200, 58)])).toEqual([box(20, 8, 300, 42), box(20, 40, 200, 58)]);
});
