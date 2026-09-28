// Finding a quoted passage in a post, shared by the server's Highlight tool and the editor's highlights
// so both agree on where a passage is. No imports, so both sides can load it.

// Where one match is: offsets into the text of blocks[block].
export interface QuoteMatch {
  block: number;
  from: number;
  to: number;
}

export function findQuote(blocks: string[], quote: string): QuoteMatch[] {
  const wanted = normalize(quote).text;
  const matches: QuoteMatch[] = [];
  blocks.forEach((original, block) => {
    const { text, at } = normalize(original);
    for (let i = text.indexOf(wanted); i >= 0; i = text.indexOf(wanted, i + 1)) {
      matches.push({ block, from: at[i], to: at[i + wanted.length - 1] + 1 });
    }
  });
  return matches;
}

// Emphasis and code markers, which a quote copied from the markdown may carry and the editor's text does not.
const MARKERS = '*_`';
const STRAIGHT: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"' };

// The text with each whitespace run made one space, curly quotes made straight, and
// emphasis and code markers dropped; at[i]: where text[i] came from in the original.
function normalize(original: string): { text: string; at: number[] } {
  let text = '';
  const at: number[] = [];
  for (let i = 0; i < original.length; i++) {
    const char = /\s/.test(original[i]) ? ' ' : (STRAIGHT[original[i]] ?? original[i]);
    if (MARKERS.includes(char) || (char === ' ' && text.endsWith(' '))) continue;
    text += char;
    at.push(i);
  }
  return { text, at };
}
