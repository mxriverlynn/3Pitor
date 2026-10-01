// The formatting menu's commands for raw mode: each turns the markdown text and its selection into the edit that
// writes the chosen formatting as markdown syntax.
import { parseMarkdown } from '../../../shared/markdown';

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
  return close.exec(text) ? close.lastIndex : at;
}

// A link or image in markdown text: where it starts and ends, and where its text is.
type RawLink = { start: number; end: number; text: [number, number]; image: boolean };

// The links and images in `text`, pairing each ] with the [ it closes so an image can be a link's text, and the
// stretches of `text` that are code.
function scan(text: string): { links: RawLink[]; code: [number, number][] } {
  const links: RawLink[] = [];
  const code: [number, number][] = [];
  const open: { at: number; image: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    // An escaped bracket is only text, and code is only code.
    if (text[i] === '\\') {
      i++;
      continue;
    }
    const end = codeEnd(text, i);
    if (end > i) {
      code.push([i, end]);
      i = end - 1;
      continue;
    }
    // Backticks no others close are only text, skipped whole so a shorter run inside them is not taken as code.
    if (text[i] === '`') {
      while (text[i + 1] === '`') i++;
      continue;
    }
    if (text[i] === '[') open.push({ at: i, image: text[i - 1] === '!' });
    if (text[i] !== ']' || !open.length) continue;
    const { at, image } = open.pop()!;
    const tail = text[i + 1] === '(' ? tailEnd(text, i + 1) : -1;
    if (tail >= 0) links.push({ start: image ? at - 1 : at, end: tail, text: [at + 1, i], image });
  }
  return { links, code };
}

// Takes off the links the selection touches, or the caret is in, leaving their text.
function unlink({ text, from, to }: RawText): RawEdit | undefined {
  const touched = (link: RawLink) => (from === to ? link.start <= from && to <= link.end : link.start < to && from < link.end);
  const links = scan(text).links.filter((link) => !link.image && touched(link));
  if (!links.length) return;
  const start = links[0].start;
  const end = links.at(-1)!.end;
  let insert = '';
  let at = start;
  for (const link of links) {
    insert += text.slice(at, link.start) + text.slice(...link.text);
    at = link.end;
  }
  insert += text.slice(at, end);
  // Where a position lands once the links are text: the same character, or a link's text's end past it.
  const map = (pos: number) => {
    let shift = 0;
    for (const { start, end, text: [textStart, textEnd] } of links) {
      if (pos <= start) break;
      if (pos < end) return Math.max(start, Math.min(pos - (textStart - start), start + textEnd - textStart)) - shift;
      shift += end - start - (textEnd - textStart);
    }
    return pos - shift;
  };
  return { from: start, to: end, insert, select: [map(from), map(to)] };
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
  // Spaces at the selection's ends stay outside the link.
  while (from < to && /\s/.test(text[from])) from++;
  while (to > from && /\s/.test(text[to - 1])) to--;
  if (from === to || !href) return;
  if (scan(text).code.some(([start, end]) => start < to && from < end)) return;
  const label = text.slice(from, to);
  // A quote in the text would end the title early.
  const title = label.replaceAll('"', '\\"');
  // An address the markdown cannot hold as it is, such as one with an unmatched bracket, goes in angle brackets.
  const insert = [href, `<${href}>`].map((address) => `[${label}](${address} "${title}")`).find((link) => readsAsLink(link, href));
  if (!insert) return;
  return { from, to, insert, select: [from + 1, from + 1 + label.length] };
}

// Whether `markdown` reads back as one link to `href`, all of it linked.
function readsAsLink(markdown: string, href: string): boolean {
  const doc = parseMarkdown(markdown);
  const block = doc.childCount === 1 ? doc.firstChild! : undefined;
  let linked = !!block?.isTextblock && block.childCount > 0;
  block?.forEach((node) => {
    if (!node.marks.some((mark) => mark.type.name === 'link' && mark.attrs.href === href)) linked = false;
  });
  return linked;
}

// The text after `edit`.
export function applyEdit(text: string, edit: RawEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}
