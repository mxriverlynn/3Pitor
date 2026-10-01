// The formatting menu's commands for raw mode: each turns the markdown text and its selection into the edit that
// writes the chosen formatting as markdown syntax.

// The text and its selection, as a textarea holds them.
export type RawText = { text: string; from: number; to: number };

// Replace `from`..`to` with `insert`, then select `select`.
export type RawEdit = { from: number; to: number; insert: string; select: [number, number] };

export type RawFormat =
  | { kind: 'strong' | 'em' | 'code' }
  | { kind: 'link' | 'image' | 'rule' | 'bullet-list' | 'ordered-list' | 'blockquote' | 'code-block' }
  // Level 0 is a paragraph: no heading.
  | { kind: 'heading'; level: number };

const MARKERS = { strong: '**', em: '*', code: '`' };

// Wraps the selection in `marker`, or takes the marker off if it is already wrapped.
function inline({ text, from, to }: RawText, marker: string): RawEdit {
  const m = marker.length;
  if (text.slice(from - m, from) === marker && text.slice(to, to + m) === marker) {
    return { from: from - m, to: to + m, insert: text.slice(from, to), select: [from - m, to - m] };
  }
  return { from, to, insert: marker + text.slice(from, to) + marker, select: [from + m, to + m] };
}

// `[text](url)` or `![alt](url)` around the selection, with the url selected to type over.
function target({ text, from, to }: RawText, prefix: string, placeholder: string): RawEdit {
  const label = `${prefix}[${text.slice(from, to) || placeholder}](`;
  return { from, to, insert: `${label}url)`, select: [from + label.length, from + label.length + 3] };
}

// Takes off the link the selection is in, leaving its text.
function unlink({ text, from, to }: RawText): RawEdit | undefined {
  for (const match of text.matchAll(/\[([^\]]*)\]\([^)]*\)/g)) {
    const start = match.index;
    const end = start + match[0].length;
    if (from < start || to > end) continue;
    const label = match[1];
    return { from: start, to: end, insert: label, select: [from - 1, to - 1] };
  }
}

// The whole lines the selection touches. A selection that ends at the start of a line leaves that line out.
function lines({ text, from, to }: RawText): { start: number; end: number; lines: string[] } {
  const last = to > from && text[to - 1] === '\n' ? to - 1 : to;
  const start = text.lastIndexOf('\n', from - 1) + 1;
  const newline = text.indexOf('\n', last);
  const end = newline === -1 ? text.length : newline;
  return { start, end, lines: text.slice(start, end).split('\n') };
}

function replaceLines(raw: RawText, change: (lines: string[]) => string[]): RawEdit {
  const { start, end, lines: current } = lines(raw);
  const insert = change(current).join('\n');
  return { from: start, to: end, insert, select: [start, start + insert.length] };
}

const LIST = /^(\s*)(?:[-*+]|\d+[.)]) (?:\[[ xX]\] )?/;
const BULLET = /^\s*[-*+] /;
const ORDERED = /^\s*\d+[.)] /;
const QUOTE = /^> ?/;
const HEADING = /^#{1,6} /;

// Makes each line an item of the list, or, when every line already is one, takes them out of it.
function list(raw: RawText, pattern: RegExp, marker: (i: number) => string): RawEdit {
  return replaceLines(raw, (lines) => {
    const filled = lines.filter((line) => line.trim());
    if (filled.length && filled.every((line) => pattern.test(line))) return lines.map((line) => line.replace(LIST, '$1'));
    let item = 0;
    return lines.map((line) => (line.trim() ? line.replace(LIST, '$1').replace(/^(\s*)/, `$1${marker(item++)}`) : line));
  });
}

export function rawFormat(raw: RawText, format: RawFormat): RawEdit {
  switch (format.kind) {
    case 'strong':
    case 'em':
    case 'code':
      return inline(raw, MARKERS[format.kind]);
    case 'link':
      return unlink(raw) ?? target(raw, '', 'link text');
    case 'image':
      return target(raw, '!', 'alt text');
    case 'rule': {
      // On a line of its own after the selection, with a blank line before it: "---" straight under a line of
      // text would make that line a heading.
      const { end } = lines(raw);
      const insert = '\n\n---\n';
      return { from: end, to: end, insert, select: [end + insert.length, end + insert.length] };
    }
    case 'bullet-list':
      return list(raw, BULLET, () => '- ');
    case 'ordered-list':
      return list(raw, ORDERED, (i) => `${i + 1}. `);
    case 'blockquote':
      return replaceLines(raw, (lines) =>
        lines.every((line) => QUOTE.test(line)) ? lines.map((line) => line.replace(QUOTE, '')) : lines.map((line) => `> ${line}`),
      );
    case 'heading':
      return replaceLines(raw, (lines) =>
        lines.map((line) => (format.level ? '#'.repeat(format.level) + ' ' : '') + line.replace(HEADING, '')),
      );
    case 'code-block':
      return replaceLines(raw, (lines) => ['```', ...lines, '```']);
  }
}

// `pasted` as a web address, when it is only that: what pasting over selected text links the text to.
export function webAddress(pasted: string): string | undefined {
  const href = pasted.trim();
  return /^https?:\/\/\S+$/.test(href) ? href : undefined;
}

// A web address pasted over the selection links it: `[text](url "text")`, with the text still selected.
export function pastedLink({ text, from, to }: RawText, pasted: string): RawEdit | undefined {
  const href = webAddress(pasted);
  if (from === to || !href) return;
  const label = text.slice(from, to);
  // A quote in the text would end the title early.
  const title = label.replaceAll('"', '\\"');
  return { from, to, insert: `[${label}](${href} "${title}")`, select: [from + 1, from + 1 + label.length] };
}

// The text after `edit`.
export function applyEdit(text: string, edit: RawEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}
