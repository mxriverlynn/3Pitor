// The Outline box: the open file's # to ##### headings, indented by level. Named for headings, since "outline" already
// names each post's outline document.
import type * as Y from 'yjs';
import { headingsOf } from '../markdown-editor/markdown-editor';
import './headings-panel.css';

export function HeadingsPanel({ doc, onGo }: { doc: Y.Doc | undefined; onGo?: (index: number) => void }) {
  const headings = doc === undefined ? [] : headingsOf(doc);
  return (
    <aside className="headings" aria-label="Outline">
      <div className="headings-head"><h2>Outline</h2></div>
      {/* A focus stop while it holds a list, so the list scrolls from the keyboard; Safari gives scrolling areas none. */}
      <div className="headings-body" tabIndex={headings.length > 0 ? 0 : undefined}>
        {doc === undefined ? <p className="hint">No file open.</p>
          : headings.length === 0 ? <p className="hint">Headings from # to ##### appear here.</p>
          : <ul aria-label="Headings in this file">
              {headings.map((heading, i) => (
                <li key={i} style={{ '--level': heading.level } as React.CSSProperties}>
                  <button type="button" onClick={() => onGo?.(i)}>
                    <span className="visually-hidden">Level {heading.level}, </span>
                    {heading.text}
                  </button>
                </li>
              ))}
            </ul>}
      </div>
    </aside>
  );
}
