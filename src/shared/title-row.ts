// A post's title row: the first top-level level-1 heading in its markdown, an ATX "# ..." line or a setext heading
// underlined with "===". One inside a quote, a list, or a code fence does not count. The server, the engine, and the
// UI each use these to keep a post's title and that heading in step, so all three compute the same text.
import { markdownParser, markdownSerializer, parseMarkdown, schema } from './markdown';

// A title tidied as a heading would hold it: runs of whitespace become one space, and the ends are trimmed.
export function titleText(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

// The title row's lines, from `start` up to `end`, in `markdown` split at each "\n"; null without one.
function titleRow(markdown: string): { lines: string[]; start: number; end: number } | null {
  const heading = markdownParser.tokenizer
    .parse(markdown, {})
    .find((token) => token.type === 'heading_open' && token.tag === 'h1' && token.level === 0);
  if (!heading?.map) return null;
  return { lines: markdown.split('\n'), start: heading.map[0], end: heading.map[1] };
}

// The title row's plain text, its formatting dropped and its escapes read, tidied as titleText does. null without a
// title row, or when it is blank: it never skips ahead to a later heading.
export function headingTitle(markdown: string): string | null {
  const row = titleRow(markdown);
  if (!row) return null;
  return titleText(parseMarkdown(row.lines.slice(row.start, row.end).join('\n')).textContent) || null;
}

// `markdown` with its title row's lines replaced by one line, the serializer's level-1 heading holding titleText(title).
// A "\r" ending the last replaced line is kept, and nothing else changes. Without a title row, the heading and a blank
// line go at the top.
export function withHeadingTitle(markdown: string, title: string): string {
  const text = titleText(title);
  const heading = schema.node('heading', { level: 1 }, text ? schema.text(text) : undefined);
  const line = markdownSerializer.serialize(schema.node('doc', null, heading));
  const row = titleRow(markdown);
  if (!row) return markdown === '' ? line : `${line}\n\n${markdown}`;
  const { lines, start, end } = row;
  const cr = lines[end - 1].endsWith('\r') ? '\r' : '';
  return [...lines.slice(0, start), line + cr, ...lines.slice(end)].join('\n');
}
