// What to color in raw mode's markdown text: the stretches of it that are headings, links, emphasis markers, code,
// quotes, and list markers, by where they are in the text.
import { HEADING, LIST, QUOTE, scan } from './raw-formatting';

export type SyntaxKind = 'heading' | 'link-text' | 'link-markup' | 'emphasis-markup' | 'code' | 'quote' | 'list-marker';
// A stretch of markdown drawn as `kind`: `from` inclusive, `to` exclusive, as UTF-16 offsets into the text.
export type SyntaxSpan = { from: number; to: number; kind: SyntaxKind };

// The spans to color in `text`, sorted and not overlapping. Where two would overlap, the one found first below wins,
// and the other keeps what is left of it on either side.
export function rawSyntax(text: string): SyntaxSpan[] {
  const { links, code } = scan(text);
  const linkMarkup: SyntaxSpan[] = links.flatMap(({ start, end, text: [textStart, textEnd] }) => [
    { from: start, to: textStart, kind: 'link-markup' as const },
    { from: textEnd, to: end, kind: 'link-markup' as const },
  ]);
  const linkText: SyntaxSpan[] = links.map(({ text: [from, to] }) => ({ from, to, kind: 'link-text' }));
  const lineKinds: SyntaxSpan[] = [];
  const emphasis: SyntaxSpan[] = [];
  const markup = [...code, ...linkMarkup.map(({ from, to }): [number, number] => [from, to])];
  let start = 0;
  for (const line of text.split('\n')) {
    const at = start;
    start += line.length + 1;
    const marker = LIST.exec(line)?.[0];
    emphasis.push(...emphasisMarkers(text, at + (marker?.length ?? 0), at + line.length, markup));
    // A line in code is only code.
    if (code.some(([from, to]) => from <= at && at < to)) continue;
    if (HEADING.test(line)) lineKinds.push({ from: at, to: at + line.length, kind: 'heading' });
    else if (QUOTE.test(line)) lineKinds.push({ from: at, to: at + line.length, kind: 'quote' });
    else if (marker) lineKinds.push({ from: at, to: at + marker.length, kind: 'list-marker' });
  }

  const spans: SyntaxSpan[] = [];
  for (const span of [...code.map(([from, to]): SyntaxSpan => ({ from, to, kind: 'code' })), ...linkMarkup, ...emphasis, ...linkText, ...lineKinds]) {
    spans.push(...uncovered(span, spans));
  }
  return spans.sort((a, b) => a.from - b.from);
}

// The emphasis and strong markers in `text` from `from` to `to`, one line of it, leaving out any in `markup`. A run
// of one to three * or _ opens where text follows it and closes where text precedes it, and pairs with the next run
// of the same characters that closes. An _ next to a letter or digit, as in snake_case, neither opens nor closes.
function emphasisMarkers(text: string, from: number, to: number, markup: [number, number][]): SyntaxSpan[] {
  const RUN = /(?<!\\)(\*+|_+)/g;
  RUN.lastIndex = from;
  const spans: SyntaxSpan[] = [];
  const open: { from: number; run: string }[] = [];
  for (let found = RUN.exec(text); found && found.index < to; found = RUN.exec(text)) {
    const run = found[0];
    const start = found.index;
    const end = start + run.length;
    if (run.length > 3 || markup.some(([a, b]) => a < end && start < b)) continue;
    const before = start > from ? text[start - 1] : ' ';
    const after = end < to ? text[end] : ' ';
    const word = run[0] === '_' ? /[\p{L}\p{N}]/u : /(?!)/;
    const opens = !/\s/.test(after) && !word.test(before);
    const closes = !/\s/.test(before) && !word.test(after);
    const pair = closes ? open.findIndex((o) => o.run === run) : -1;
    if (pair >= 0) {
      spans.push({ from: open[pair].from, to: open[pair].from + run.length, kind: 'emphasis-markup' }, { from: start, to: end, kind: 'emphasis-markup' });
      open.splice(pair, 1);
    } else if (opens) open.push({ from: start, run });
  }
  return spans;
}

// What is left of `span` outside `taken`, in pieces, leaving out empty ones.
function uncovered(span: SyntaxSpan, taken: SyntaxSpan[]): SyntaxSpan[] {
  let pieces = [span];
  for (const { from, to } of taken) {
    pieces = pieces.flatMap((piece) =>
      piece.to <= from || to <= piece.from
        ? [piece]
        : [
            { ...piece, to: from },
            { ...piece, from: to },
          ],
    );
  }
  return pieces.filter((piece) => piece.from < piece.to);
}
