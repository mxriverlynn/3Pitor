// The strip above a post Claude replied about: what Claude changed and asked, where the writer is among those
// passages, Undo all for the reply, and a way to dismiss it. It only draws; MarkdownEditor owns the count, the passage
// the writer is on and stepping, and useDocuments owns Undo all.
import type { Passage } from '../../../shared/wire';
import './review-strip.css';

// The reply Undo all would take back: every post it edited, and whether an undo is running.
export type ReviewTurn = { files: string[]; pending: boolean; onUndoAll: () => void };

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// What Claude did, counting each unlabeled passage as a change and each labeled one as a question:
// "Claude changed 2 passages and left 1 question", plus " in 3 posts" when the reply edited more than one.
export function reviewSummary(passages: Passage[], files: string[] = []): string {
  const questions = passages.filter((p) => p.label).length;
  const changes = passages.length - questions;
  const did = [changes && `changed ${counted(changes, 'passage', 'passages')}`, questions && `left ${counted(questions, 'question', 'questions')}`].filter(Boolean);
  if (!did.length) return files.length > 1 ? `Claude changed ${files.length} posts` : 'Claude changed this post';
  return `Claude ${did.join(' and ')}${files.length > 1 ? ` in ${files.length} posts` : ''}`;
}

export function ReviewStrip({
  passages,
  placed,
  current,
  onStep,
  turn,
  onDismiss,
}: {
  // The open file's highlighted passages.
  passages: Passage[];
  // How many of them were found in the text.
  placed: number;
  // Which placed passage the writer is on, from 0.
  current: number;
  onStep: (step: -1 | 1) => void;
  // Only when the open file is one the reply Undo all would take back edited.
  turn?: ReviewTurn;
  onDismiss?: () => void;
}) {
  if (!passages.length && !turn) return null;
  const notFound = passages.length - placed;
  return (
    <div className="review-strip">
      <span className="summary">{reviewSummary(passages, turn?.files)}</span>
      {passages.length > 0 && (
        <>
          <span className="highlight-status" aria-live="polite">
            {placed ? `${Math.min(current, placed - 1) + 1} of ${placed}` + (notFound ? ` (${notFound} not found)` : '') : 'No passages found'}
          </span>
          <button type="button" className="ghost" aria-label="Previous highlight" onClick={() => onStep(-1)}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className="ghost" aria-label="Next highlight" onClick={() => onStep(1)}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </>
      )}
      <span className="spacer" />
      {turn && (
        <button
          type="button"
          aria-label={`Undo Claude's changes in ${turn.files.join(', ')}`}
          title={`Undo Claude's changes in ${turn.files.join(', ')}`}
          disabled={turn.pending}
          onClick={turn.onUndoAll}
        >
          Undo all
        </button>
      )}
      {onDismiss && (
        <button type="button" className="ghost" aria-label="Dismiss review" title="Dismiss review" onClick={onDismiss}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
