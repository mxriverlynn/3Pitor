// Markdown the editor's schema (CommonMark plus task lists) cannot hold, shared by the UI and the
// server: no imports, so both can load it. Saving a document that contains any of these would silently rewrite or flatten it,
// so such documents open read-only.
const UNSUPPORTED: [string, RegExp][] = [
  ['tables', /^\s*\|?[^\n]*\|[^\n]*\n\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/m],
  ['raw HTML', /^\s*<\/?[a-zA-Z][^>]*>/m],
];

export function unsupportedMarkdown(markdown: string): string[] {
  return UNSUPPORTED.filter(([, pattern]) => pattern.test(markdown)).map(([name]) => name);
}
