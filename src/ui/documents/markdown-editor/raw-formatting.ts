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

// Where the address and title after a link's text end, given the ( they start at; -1 if they are not a link's. The
// address may hold balanced brackets, and the title, in quotes or brackets, may hold a closing bracket.
function tailEnd(text: string, at: number): number {
  let i = at + 1;
  const spaces = () => {
    while (/[ \t\n]/.test(text[i] ?? '')) i++;
  };
  spaces();
  if (text[i] === '<') {
    // An address in angle brackets may hold spaces.
    for (i++; i < text.length && !/[<>\n]/.test(text[i]); i++) if (text[i] === '\\') i++;
    if (text[i++] !== '>') return -1;
  } else {
    for (let depth = 0; i < text.length && !/[ \t\n]/.test(text[i]); i++) {
      if (text[i] === '\\') i++;
      else if (text[i] === '(') depth++;
      else if (text[i] === ')' && depth-- === 0) break;
    }
  }
  const afterAddress = i;
  spaces();
  const close = { '"': '"', "'": "'", '(': ')' }[text[i]];
  if (close && i > afterAddress) {
    for (i++; i < text.length && text[i] !== close; i++) if (text[i] === '\\') i++;
    if (i++ >= text.length) return -1;
    spaces();
  }
  return text[i] === ')' ? i + 1 : -1;
}

const FENCE = / {0,3}(`{3,}|~{3,})/y;
const TICKS = /`+/y;

// Where the code starting at `at` ends: a fenced code block starting on that line, or a code span. `at` itself when
// no code starts there.
function codeEnd(text: string, at: number): number {
  FENCE.lastIndex = at;
  const fence = (at === 0 || text[at - 1] === '\n') && FENCE.exec(text);
  if (fence) {
    const [, marker] = fence;
    const close = new RegExp(`\\n {0,3}${marker[0]}{${marker.length},}[ \\t]*(?=\\n|$)`, 'g');
    close.lastIndex = FENCE.lastIndex;
    const found = close.exec(text);
    return found ? close.lastIndex : text.length;
  }
  TICKS.lastIndex = at;
  const ticks = TICKS.exec(text)?.[0];
  if (!ticks) return at;
  const close = new RegExp(`(?<!\`)${ticks}(?!\`)`, 'g');
  close.lastIndex = at + ticks.length;
  // A run of backticks with none to close it is only text.
  return close.exec(text) ? close.lastIndex : at + ticks.length;
}

// A link or image in markdown text: where it starts and ends, and where its text is.
type RawLink = { start: number; end: number; text: [number, number]; image: boolean };

// The links and images in `text`, pairing each ] with the [ it closes, so an image can be a link's text.
function rawLinks(text: string): RawLink[] {
  const links: RawLink[] = [];
  const open: { at: number; image: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    // An escaped bracket is only text, and code is only code.
    if (text[i] === '\\') {
      i++;
      continue;
    }
    const code = codeEnd(text, i);
    if (code > i) {
      i = code - 1;
      continue;
    }
    if (text[i] === '[') open.push({ at: i, image: text[i - 1] === '!' });
    if (text[i] !== ']' || !open.length) continue;
    const { at, image } = open.pop()!;
    const end = text[i + 1] === '(' ? tailEnd(text, i + 1) : -1;
    if (end >= 0) links.push({ start: image ? at - 1 : at, end, text: [at + 1, i], image });
  }
  return links;
}

// Takes off the link the selection is in, leaving its text.
function unlink({ text, from, to }: RawText): RawEdit | undefined {
  const link = rawLinks(text).find(({ start, end, image }) => !image && start <= from && to <= end);
  if (!link) return;
  const [labelStart, labelEnd] = link.text;
  // Where a position in the link lands in its text: the same character there, or the text's end past it.
  const at = (pos: number) => link.start + Math.max(0, Math.min(pos - labelStart, labelEnd - labelStart));
  return { from: link.start, to: link.end, insert: text.slice(labelStart, labelEnd), select: [at(from), at(to)] };
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
