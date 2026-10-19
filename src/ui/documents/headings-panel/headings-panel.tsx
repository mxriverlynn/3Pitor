// The Content Outline box: the open file's # to ##### headings, indented by level; choosing one goes to it in the editor. Named
// for headings, since "outline" already names each post's outline document.
import type * as Y from 'yjs';
import { headingsOf } from '../markdown-editor/markdown-editor';
import './headings-panel.css';

export function HeadingsPanel({ doc, onGo }: { doc: Y.Doc | undefined; onGo?: (index: number) => void }) {
  const headings = doc === undefined ? [] : headingsOf(doc);
  return (
    <aside className="headings" aria-label="Content Outline">
      <div className="headings-head"><h2>Content Outline</h2></div>
      <div className="headings-body">
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
