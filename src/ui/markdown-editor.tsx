// Rich text markdown editor built on ProseMirror, bound to a Yjs document so that edits from
// elsewhere (the AI's) merge with the user's typing instead of replacing it. Markdown is parsed
// into the Yjs document when a file loads and serialized back out when it is saved.
import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  initProseMirrorDoc,
  prosemirrorToYXmlFragment,
  redo,
  undo,
  updateYFragment,
  yUndoPlugin,
  yUndoPluginKey,
  ySyncPlugin,
  ySyncPluginKey,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import { EditorState, Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { redoItem, undoItem } from 'prosemirror-menu';
import type { Node } from 'prosemirror-model';
import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownSerializer, schema } from 'prosemirror-markdown';
import { buildMenuItems, exampleSetup } from 'prosemirror-example-setup';
import 'prosemirror-view/style/prosemirror.css';
import 'prosemirror-menu/style/menu.css';
import 'prosemirror-example-setup/style/style.css';
import { findQuote } from '../shared/passages';
import type { Passage } from '../shared/wire';
import './markdown-editor.css';

// Same as the default serializer, but writes "-" bullets instead of "*".
const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    bullet_list(state, node) {
      state.renderList(node, '  ', () => '- ');
    },
  },
  defaultMarkdownSerializer.marks,
);

// The Yjs type each document's content lives in.
const fragmentOf = (doc: Y.Doc) => doc.getXmlFragment('prosemirror');

// The transaction origin for edits the AI makes, so the editor's undo can track them.
export const AI_ORIGIN = 'ai';

// A document's Yjs state at one moment: enough to rebuild it (`update`) and to diff later changes against it (`vector`).
export type Snapshot = { update: Uint8Array; vector: Uint8Array };

export function markdownOf(doc: Y.Doc): string {
  return serializer.serialize(yXmlFragmentToProseMirrorRootNode(fragmentOf(doc), schema));
}

export function docFromMarkdown(markdown: string): Y.Doc {
  const doc = new Y.Doc();
  prosemirrorToYXmlFragment(defaultMarkdownParser.parse(markdown)!, fragmentOf(doc));
  return doc;
}

export function snapshot(doc: Y.Doc): Snapshot {
  return { update: Y.encodeStateAsUpdate(doc), vector: Y.encodeStateVector(doc) };
}

// The undo history of the editor showing each document, so a merge can keep the AI's edit a step of its own.
const undoManagers = new WeakMap<Y.Doc, Y.UndoManager>();

// Turns `markdown` into Yjs changes made on a copy of `base`, then applies them to `live`. Changes made
// to `live` since `base` (the user's typing) are concurrent with the AI's and survive the merge.
export function mergeMarkdown(live: Y.Doc, base: Snapshot, markdown: string): void {
  const fork = new Y.Doc();
  Y.applyUpdate(fork, base.update);
  // updateYFragment's last argument is y-prosemirror's internal binding metadata; a fresh one is empty.
  const meta = { mapping: new Map(), isOMark: new Map() } as unknown as Parameters<typeof updateYFragment>[3];
  fork.transact(() => updateYFragment(fork, fragmentOf(fork), defaultMarkdownParser.parse(markdown)!, meta));
  // Undo groups changes made close together; stopping capture on both sides keeps typing out of the AI's step.
  undoManagers.get(live)?.stopCapturing();
  Y.applyUpdate(live, Y.encodeStateAsUpdate(fork, base.vector), AI_ORIGIN);
  undoManagers.get(live)?.stopCapturing();
}

// Each textblock's text and the position where its content starts, in document order: the same blocks
// the server's postBlocks finds in the markdown, so a quote it accepts is one the editor can find.
export function blocksOf(doc: Node): { text: string; pos: number }[] {
  const blocks: { text: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) blocks.push({ text: node.textContent, pos: pos + 1 });
  });
  return blocks;
}

// The passages the editor highlights, and the decorations of those it could place.
type Highlights = { passages: Passage[]; decorations: DecorationSet };

// A transaction with this meta replaces the highlighted passages.
const highlightsKey = new PluginKey<Highlights>('highlights');

// Draws each passage whose quote occurs exactly once in the document; any other passage is left out.
function drawHighlights(doc: Node, passages: Passage[]): Highlights {
  const blocks = blocksOf(doc);
  const texts = blocks.map((b) => b.text);
  const decorations: Decoration[] = [];
  passages.forEach(({ quote, label }) => {
    const matches = findQuote(texts, quote);
    if (matches.length !== 1) return;
    const { block, from, to } = matches[0];
    const start = textPos(doc, blocks[block].pos, from, false);
    const spec = { passage: decorations.length };
    decorations.push(Decoration.inline(start, textPos(doc, blocks[block].pos, to, true), { nodeName: 'mark', class: 'ai-highlight' }, spec));
    if (!label) return;
    // The editor leaves events on a label, and focus inside it, to the label.
    const widget = { ...spec, side: -1, key: `label-${label}`, stopEvent: () => true, ignoreSelection: true };
    decorations.push(Decoration.widget(start, () => labelChip(label), widget));
  });
  return { passages, decorations: DecorationSet.create(doc, decorations) };
}

// The document position of an offset into the text of the textblock whose content starts at `blockPos`.
// Inline nodes with no text (a line break, an image) take up a position but no text. At an offset between
// two text runs, a passage's end stays in the run before and its start moves to the run after.
function textPos(doc: Node, blockPos: number, offset: number, end: boolean): number {
  const block = doc.nodeAt(blockPos - 1)!;
  let seen = 0;
  let pos = blockPos;
  for (let i = 0; i < block.childCount; i++) {
    const child = block.child(i);
    const length = child.isText ? child.text!.length : 0;
    if (child.isText && (end ? offset <= seen + length : offset < seen + length)) return pos + offset - seen;
    seen += length;
    pos += child.nodeSize;
  }
  return pos;
}

// Moves the highlights with an edit. A passage whose text was deleted loses its highlight, and its label
// goes with it.
function mapHighlights(decorations: DecorationSet, tr: Transaction): DecorationSet {
  const mapped = decorations.map(tr.mapping, tr.doc);
  const found = mapped.find();
  const kept = new Set(found.filter((d) => d.from < d.to).map((d) => d.spec.passage));
  return mapped.remove(found.filter((d) => !kept.has(d.spec.passage)));
}

// A button, so the writer can reach it with Tab and press it with Enter or Space.
function labelChip(label: string): HTMLElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'ai-highlight-label';
  chip.contentEditable = 'false';
  chip.textContent = label;
  return chip;
}

// The passage the writer asked about by clicking its label, and the label they clicked.
export type Ask = { passage: Passage; anchor: HTMLElement };

// Highlights `initial` when the view mounts, and reports how many passages it placed. A click on a label
// reports the passage that label names in the current highlights, so a label kept from an earlier turn
// reports the current passage.
export function highlightsPlugin(initial: Passage[], onShown: (shown: number) => void, onAsk: (ask: Ask) => void = () => {}) {
  return new Plugin<Highlights>({
    key: highlightsKey,
    state: {
      init: (_, state) => drawHighlights(state.doc, initial),
      apply: (tr, value) => {
        const passages = tr.getMeta(highlightsKey) as Passage[] | undefined;
        if (passages) return drawHighlights(tr.doc, passages);
        if (!tr.docChanged) return value;
        // A change arriving through Yjs (an AI edit, an undo) replaces the whole document, which would
        // collapse every highlight, so those are found again from their quotes.
        if (tr.getMeta(ySyncPluginKey)?.isChangeOrigin) return drawHighlights(tr.doc, value.passages);
        return { ...value, decorations: mapHighlights(value.decorations, tr) };
      },
    },
    props: { decorations: (state) => highlightsKey.getState(state)!.decorations },
    view: (view) => {
      let passages: Passage[] | undefined;
      const update = () => {
        const state = highlightsKey.getState(view.state)!;
        // Each highlighted passage has one inline decoration; its label is a widget, which is empty.
        onShown(state.decorations.find().filter((d) => d.from < d.to).length);
        if (state.passages === passages) return;
        passages = state.passages;
        // New passages: bring the first into view, unless the writer is typing here.
        if (!view.hasFocus()) view.dom.querySelector('mark.ai-highlight')?.scrollIntoView({ block: 'nearest' });
      };
      const chipOf = (event: Event) => (event.target as HTMLElement).closest<HTMLElement>('.ai-highlight-label');
      // Pressing on a label must not move the caret or focus the editor.
      const mousedown = (event: MouseEvent) => {
        if (chipOf(event)) event.preventDefault();
      };
      const click = (event: MouseEvent) => {
        const chip = chipOf(event);
        if (!chip) return;
        const passage = highlightsKey.getState(view.state)!.passages.find((p) => p.label === chip.textContent);
        if (passage) onAsk({ passage, anchor: chip });
      };
      view.dom.addEventListener('mousedown', mousedown);
      view.dom.addEventListener('click', click);
      update();
      return {
        update,
        destroy: () => {
          view.dom.removeEventListener('mousedown', mousedown);
          view.dom.removeEventListener('click', click);
        },
      };
    },
  });
}

// The example setup's menu, less its undo and redo items: those drive prosemirror-history, which
// cannot see changes that arrive through Yjs.
const menuContent = buildMenuItems(schema).fullMenu.filter((group) => !group.includes(undoItem) && !group.includes(redoItem));

export function MarkdownEditor({
  doc,
  readOnly,
  highlights,
  onAsk,
}: {
  doc: Y.Doc;
  readOnly: boolean;
  highlights: Passage[];
  // Called when the writer clicks a passage's label.
  onAsk?: (ask: Ask) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  // The plugin is built once per document, so it reads the latest onAsk through a ref.
  const onAskRef = useRef(onAsk);
  onAskRef.current = onAsk;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const { doc: initial, mapping } = initProseMirrorDoc(fragmentOf(doc), schema);
    const editor = new EditorView(host.current!, {
      state: EditorState.create({
        doc: initial,
        plugins: [
          ySyncPlugin(fragmentOf(doc), { mapping }),
          yUndoPlugin({ trackedOrigins: [AI_ORIGIN] }),
          keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
          ...exampleSetup({ schema, history: false, menuContent }),
          highlightsPlugin(highlightsRef.current, setShown, (ask) => onAskRef.current?.(ask)),
        ],
      }),
      editable: () => !readOnlyRef.current,
    });
    view.current = editor;
    undoManagers.set(doc, yUndoPluginKey.getState(editor.state)!.undoManager);
    return () => {
      undoManagers.delete(doc);
      editor.destroy();
      view.current = null;
    };
  }, [doc]);

  useEffect(() => {
    const editor = view.current;
    if (editor && highlightsKey.getState(editor.state)!.passages !== highlights) {
      editor.dispatch(editor.state.tr.setMeta(highlightsKey, highlights).setMeta('addToHistory', false));
    }
  }, [highlights]);

  useEffect(() => {
    // Re-evaluate `editable` after a read-only change.
    view.current?.setProps({});
  }, [readOnly]);

  return (
    <>
      <div className="highlight-status" aria-live="polite">
        {highlights.length > 0 && `Highlighted ${shown} of ${highlights.length} passages`}
      </div>
      <div className={`rich-editor ${readOnly ? 'read-only' : ''}`} ref={host} />
    </>
  );
}
