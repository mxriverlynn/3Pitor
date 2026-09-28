import { expect, test } from 'bun:test';
import { findQuote } from './passages';

test('finds nothing when no block holds the quote', () => {
  expect(findQuote(['Most gardeners never test their soil'], 'as I said earlier')).toEqual([]);
});

test('finds a quote that occurs exactly as written, with offsets into its block', () => {
  expect(findQuote(['Garden Plan', 'Most gardeners never test their soil'], 'never test')).toEqual([{ block: 1, from: 15, to: 25 }]);
});

test('treats a run of whitespace as one space, with offsets into the original text', () => {
  expect(findQuote(['Most gardeners  never test'], 'gardeners never')).toEqual([{ block: 0, from: 5, to: 21 }]);
});

test('matches curly quotes to straight ones, either way round', () => {
  expect(findQuote(['the “best” soil'], '"best"')).toEqual([{ block: 0, from: 4, to: 10 }]);
  expect(findQuote(["it's the \"best\" soil"], 'it’s the “best”')).toEqual([{ block: 0, from: 0, to: 15 }]);
});

test('ignores emphasis and code markers in the quote and in the block', () => {
  expect(findQuote(['Most gardeners never test their soil'], 'never **test** their `soil`')).toEqual([{ block: 0, from: 15, to: 36 }]);
  expect(findQuote(['run the _pH_ test'], 'the pH test')).toEqual([{ block: 0, from: 4, to: 17 }]);
});

test('matches across a soft line break inside a block', () => {
  expect(findQuote(['Most gardeners never\ntest their soil'], 'never test their')).toEqual([{ block: 0, from: 15, to: 31 }]);
});

test('returns every match, so a caller can tell a quote is not unique', () => {
  expect(findQuote(['the soil is dry', 'water the soil'], 'the soil')).toEqual([
    { block: 0, from: 0, to: 8 },
    { block: 1, from: 6, to: 14 },
  ]);
});

test('never matches a quote that spans two blocks', () => {
  expect(findQuote(['Garden Plan', 'Most gardeners'], 'Plan Most')).toEqual([]);
});
