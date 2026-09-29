// The editor's raw mode: the document's markdown in a textarea. The AI's highlights, their labels, and the button
// that asks about a selection work here as they do in the formatted document. A textarea cannot mark its text, so a
// mirror of it, laid out the same way, sits behind it: its text is invisible and only its marks show through.
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { findQuote } from '../../../shared/passages';
import type { Passage } from '../../../shared/wire';
import type { Ask, SelectionAsk } from './markdown-editor';

// A highlighted passage and where its quote is in the markdown.
export type RawHighlight = { passage: Passage; from: number; to: number };

// The passages whose quote occurs exactly once in the markdown, in the order they occur, leaving out any that
// overlaps one before it. Emphasis and code markers do not count, as for the formatted document.
export function rawHighlights(text: string, passages: Passage[]): RawHighlight[] {
  const found = passages.flatMap((passage) => {
    const matches = findQuote([text], passage.quote);
    return matches.length === 1 ? [{ passage, from: matches[0].from, to: matches[0].to }] : [];
  });
  found.sort((a, b) => a.from - b.from);
  return found.filter((h, i) => i === 0 || h.from >= found[i - 1].to);
}

type Range = { from: number; to: number };
type Mark = Range & { className: string; start?: number };

// The mirror's content: `text` with each mark's stretch in a <mark>, and an empty span at `caret`. Where marks
// overlap, a stretch carries both classes. The first piece of highlight `start` is tagged so its line can be found.
function mirrorPieces(text: string, marks: Mark[], caret: number | undefined): ReactNode[] {
  const cuts = [...new Set([0, text.length, ...marks.flatMap((m) => [m.from, m.to]), ...(caret === undefined ? [] : [caret])])]
    .filter((at) => at >= 0 && at <= text.length)
    .sort((a, b) => a - b);
  const pieces: ReactNode[] = [];
  cuts.forEach((at, i) => {
    if (at === caret) pieces.push(<span key={`caret-${at}`} data-caret="" />);
    const end = cuts[i + 1];
    if (end === undefined) return;
    const over = marks.filter((m) => m.from <= at && end <= m.to);
    const piece = text.slice(at, end);
    if (!over.length) return pieces.push(piece);
    const start = over.find((m) => m.start !== undefined && m.from === at)?.start;
    pieces.push(
      <mark key={at} className={over.map((m) => m.className).join(' ')} data-start={start}>
        {piece}
      </mark>,
    );
  });
  return pieces;
}

// A focusable, pressable label, as in the formatted document; it opens the question popup.
function LabelChip({ label, onAsk }: { label: string; onAsk: (anchor: HTMLElement) => void }) {
  return (
    <button
      type="button"
      className="ai-highlight-label"
      aria-haspopup="dialog"
      // Pressing it must not move the caret or take focus from the text.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onAsk(e.currentTarget)}
    >
      {label}
    </button>
  );
}

export function RawView({
  text,
  areaRef,
  highlights,
  onType,
  onKeyDown,
  onAsk,
  onAskSelection,
  askingSelection,
}: {
  text: string;
  areaRef: RefObject<HTMLTextAreaElement | null>;
  // Where each highlight's quote is in `text`.
  highlights: RawHighlight[];
  onType: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onAsk?: (ask: Ask) => void;
  onAskSelection?: (ask: SelectionAsk) => void;
  askingSelection: boolean;
}) {
  const mirror = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Range>({ from: 0, to: 0 });
  // The selection a popup is asking about, marked while focus is in the popup.
  const [pinned, setPinned] = useState<Range>();
  const [focused, setFocused] = useState(false);
  // How far down the text each labelled highlight's first line is, and the top of the ask button's line.
  const [tops, setTops] = useState<number[]>([]);
  const [caretTop, setCaretTop] = useState<number>();

  const readSelection = () => {
    const area = areaRef.current;
    if (area) setSelection((s) => (s.from === area.selectionStart && s.to === area.selectionEnd ? s : { from: area.selectionStart, to: area.selectionEnd }));
  };

  // React's onSelect follows the mouse and keys; these also catch a selection set any other way.
  const readSelectionRef = useRef(readSelection);
  readSelectionRef.current = readSelection;
  useEffect(() => {
    const area = areaRef.current!;
    const read = () => readSelectionRef.current();
    area.addEventListener('select', read);
    area.addEventListener('selectionchange', read);
    return () => {
      area.removeEventListener('select', read);
      area.removeEventListener('selectionchange', read);
    };
  }, []);

  // The popup closing unpins the selection it was about.
  useEffect(() => {
    if (!askingSelection) setPinned(undefined);
  }, [askingSelection]);
  // Pinned only while its popup shows.
  const pin = askingSelection ? pinned : undefined;

  const asked = pin ?? (selection.from < selection.to ? selection : undefined);
  const showButton = onAskSelection && asked && (focused || pin);
  const marks: Mark[] = [
    ...highlights.map((h, i) => ({ from: h.from, to: h.to, className: 'ai-highlight', start: i })),
    ...(pin ? [{ ...pin, className: 'ask-selection' }] : []),
  ];

  // The mirror lays out as the textarea does, so its marks' lines are the text's. Measured after every render, since
  // any change to the text can move them; most renders leave them where they were.
  useLayoutEffect(() => {
    const box = mirror.current;
    if (!box) return;
    const next = highlights.map((_, i) => box.querySelector<HTMLElement>(`[data-start="${i}"]`)?.offsetTop ?? 0);
    setTops((tops) => (tops.join() === next.join() ? tops : next));
    setCaretTop(box.querySelector<HTMLElement>('[data-caret]')?.offsetTop);
  });

  // New passages: bring the first into view, unless the writer is typing here.
  const quotes = highlights.map((h) => h.passage.quote).join('\n');
  useEffect(() => {
    if (document.activeElement !== areaRef.current) mirror.current?.querySelector('mark.ai-highlight')?.scrollIntoView?.({ block: 'nearest' });
  }, [quotes]);

  // Labels on the same line share a row in the right margin.
  const rows = new Map<number, RawHighlight[]>();
  highlights.forEach((h, i) => {
    if (h.passage.label) rows.set(tops[i] ?? 0, [...(rows.get(tops[i] ?? 0) ?? []), h]);
  });

  const askSelection = (anchor: HTMLElement) => {
    const area = areaRef.current;
    if (!area || area.selectionStart === area.selectionEnd) return;
    const range = { from: area.selectionStart, to: area.selectionEnd };
    setPinned(range);
    onAskSelection?.({ markdown: text.slice(range.from, range.to).trim(), anchor });
  };

  return (
    <div className="raw-pane">
      <div className="raw-mirror raw-text" ref={mirror} aria-hidden="true">
        {mirrorPieces(text, marks, showButton ? asked.from : undefined)}
        {/* A final newline takes a line of its own, as it does in the textarea. */}
        {'​'}
      </div>
      <textarea
        className="raw-markdown raw-text"
        aria-label="Markdown"
        spellCheck={false}
        ref={areaRef}
        value={text}
        onChange={(e) => {
          onType(e.target.value);
          readSelection();
        }}
        onSelect={readSelection}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={(e) => setFocused(!!e.relatedTarget?.closest('.raw-pane'))}
      />
      {[...rows].map(([top, row]) => (
        <div key={top} className="raw-labels" style={{ top }}>
          {row.map((h) => (
            <LabelChip key={h.passage.label} label={h.passage.label!} onAsk={(anchor) => onAsk?.({ passage: h.passage, anchor })} />
          ))}
        </div>
      ))}
      {showButton && caretTop !== undefined && (
        <button
          type="button"
          className="ask-selection-button"
          style={{ top: caretTop }}
          aria-label="Ask the AI about the selection"
          title="Ask the AI about the selection"
          aria-haspopup="dialog"
          aria-expanded={askingSelection}
          // Pressing it must not take focus from the text, which would hide the selection.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => askSelection(e.currentTarget)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3 3v-3h-.5A1.5 1.5 0 0 1 2 9.5z" />
          </svg>
        </button>
      )}
    </div>
  );
}
