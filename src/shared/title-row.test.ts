import { expect, test } from 'bun:test';
import { headingTitle, titleText, withHeadingTitle } from './title-row';

test('tidies a title: runs of whitespace become one space, and the ends are trimmed', () => {
  expect(titleText('  The   Sun\n')).toBe('The Sun');
});

test.each([
  ['# A *star* title', 'A star title'],
  ['Title\n===', 'Title'],
  ['Intro\n\n## Sub\n\n# Part One', 'Part One'],
  ['#   \n\nx', null],
  ['#\n\n# Second', null],
  ['Intro', null],
  ['> # q', null],
  ['- # item', null],
  ['```\n# code\n```', null],
  ['## Sub', null],
])('reads the plain text of the title row from %j', (markdown, title) => {
  expect(headingTitle(markdown)).toBe(title);
});

test.each([
  ['', 'The Sun', '# The Sun'],
  ['Intro para', 'New', '# New\n\nIntro para'],
  ['# Old\n\nBody', 'New', '# New\n\nBody'],
  ['Old\n===\n\nBody', 'New', '# New\n\nBody'],
  ['## Sub\n\n# Old\nmore', 'New', '## Sub\n\n# New\nmore'],
  ['# Old\r\n\r\nBody', 'New', '# New\r\n\r\nBody'],
  ['Old\r\n===\r\n', 'New', '# New\r\n'],
  ['#\n\nBody', 'New', '# New\n\nBody'],
  ['```\n# code\n```', 'New', '# New\n\n```\n# code\n```'],
  ['> # q\n\nx', 'New', '# New\n\n> # q\n\nx'],
  ['# A *b*\n\n# Second', 'New', '# New\n\n# Second'],
  ['', '*star* _u_', '# \\*star\\* \\_u\\_'],
  ['', 'C #', '# C \\#'],
  ['', '#', '# \\#'],
  ['# Old', '  New   title ', '# New title'],
])('sets the title row of %j to %j', (markdown, title, result) => {
  expect(withHeadingTitle(markdown, title)).toBe(result);
});

// Characters and line openings a heading's text could be misread as markup for.
const SAMPLES = ['*', '_', '\\', '`', '[', ']', '~', '1.', '- ', '+ ', '<b>', '|', 'C#', 'C #', '#', 'C:\\'];
const TITLES = SAMPLES.flatMap((sample) => [sample, `a ${sample} b`, `${sample} end`, `start ${sample}`]);
const BODIES = ['', 'Intro', '# Old\n\nBody', 'Old\n===\n\nBody', '> # q\n\nx'];

test('reads back every title it writes, as titleText tidies it', () => {
  for (const body of BODIES) {
    for (const title of TITLES) expect([title, headingTitle(withHeadingTitle(body, title))]).toEqual([title, titleText(title)]);
  }
});

test('writes the same text again when the title row already holds the title', () => {
  for (const body of BODIES) {
    for (const title of TITLES) {
      const once = withHeadingTitle(body, title);
      expect(withHeadingTitle(once, title)).toBe(once);
      expect(withHeadingTitle(body, title)).toBe(once);
    }
  }
});
