// Rich text markdown editor built on ProseMirror, bound to a Yjs document so that edits from
// elsewhere (the AI's) merge with the user's typing instead of replacing it. Markdown is parsed
// into the Yjs document when a file loads and serialized back out when it is saved.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { EditorState, NodeSelection, Plugin, PluginKey, type Selection, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { redoItem, undoItem } from 'prosemirror-menu';
import type { Node } from 'prosemirror-model';
import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownSerializer, schema } from 'prosemirror-markdown';
import { buildMenuItems, exampleSetup } from 'prosemirror-example-setup';
import 'prosemirror-view/style/prosemirror.css';
import 'prosemirror-menu/style/menu.css';
import 'prosemirror-example-setup/style/style.css';
import { textblocks } from '../../../shared/blocks';
import { findQuote } from '../../../shared/passages';
import type { Passage } from '../../../shared/wire';
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

// The passages the editor highlights, and the decorations of those it could place.
type Highlights = { passages: Passage[]; decorations: DecorationSet };

// A transaction with this meta replaces the highlighted passages.
const highlightsKey = new PluginKey<Highlights>('highlights');

// Draws each passage whose quote occurs exactly once in the document; any other passage is left out.
function drawHighlights(doc: Node, passages: Passage[]): Highlights {
  // The same blocks the server's postBlocks finds in the markdown, so a quote it accepts is one the editor can find.
  const blocks = textblocks(doc);
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

// A button, so the writer can reach it with Tab and press it with Enter or Space. It opens the question popup.
function labelChip(label: string): HTMLElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.setAttribute('aria-haspopup', 'dialog');
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

// The selection the writer is asking the AI about, and the button they clicked to ask.
export type SelectionAsk = { markdown: string; anchor: HTMLElement };

// A transaction with this meta pins the selection's range (a Selection) or unpins it (null). A pinned range stays
// marked while focus is in the popup, where the browser no longer shows the editor's selection.
const pinnedKey = new PluginKey<DecorationSet>('pinned-selection');

function pinDecorations(doc: Node, selection: Selection | null): DecorationSet {
  if (!selection) return DecorationSet.empty;
  const attrs = { class: 'ask-selection' };
  const decoration =
    selection instanceof NodeSelection ? Decoration.node(selection.from, selection.to, attrs) : Decoration.inline(selection.from, selection.to, attrs);
  return DecorationSet.create(doc, [decoration]);
}

// Marks the pinned selection, and calls `onUpdate` after every change to the editor's state.
function selectionPlugin(onUpdate: () => void) {
  return new Plugin<DecorationSet>({
    key: pinnedKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, value) => {
        const pin = tr.getMeta(pinnedKey) as Selection | null | undefined;
        if (pin !== undefined) return pinDecorations(tr.doc, pin);
        return value.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations: (state) => pinnedKey.getState(state) },
    view: () => ({ update: onUpdate }),
  });
}

// The selection as markdown, whole blocks and all.
function selectedMarkdown(state: EditorState): string {
  const { from, to } = state.selection;
  return serializer.serialize(state.doc.cut(from, to)).trim();
}

// Where the ask button goes, in `scroller`'s scrolled content: its top level with the top of the selection, and its
// right edge at the left edge of the text, so the button sits in the margin and covers none of it.
function askButtonSpot(view: EditorView, scroller: HTMLElement): { top: number; left: number } | undefined {
  const { selection } = view.state;
  if (selection.empty) return;
  const box = scroller.getBoundingClientRect();
  const node = selection instanceof NodeSelection ? view.nodeDOM(selection.from) : null;
  const top = node instanceof HTMLElement ? node.getBoundingClientRect().top : view.coordsAtPos(selection.from, 1).top;
  const text = view.dom.getBoundingClientRect().left + (parseFloat(getComputedStyle(view.dom).paddingLeft) || 0);
  return { top: top - box.top + scroller.scrollTop, left: text - box.left + scroller.scrollLeft };
}

// The example setup's menu, less its undo and redo items: those drive prosemirror-history, which
// cannot see changes that arrive through Yjs.
const menuContent = buildMenuItems(schema).fullMenu.filter((group) => !group.includes(undoItem) && !group.includes(redoItem));

export function MarkdownEditor({
  doc,
  readOnly,
  highlights,
  onAsk,
  onAskSelection,
  askingSelection = false,
}: {
  doc: Y.Doc;
  readOnly: boolean;
  highlights: Passage[];
  // Called when the writer clicks a passage's label.
  onAsk?: (ask: Ask) => void;
  // Called when the writer clicks the button beside their selection to ask the AI about it.
  onAskSelection?: (ask: SelectionAsk) => void;
  // The popup the button opened is showing, so the selection stays marked and the button stays put.
  askingSelection?: boolean;
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
  // Where the ask button sits, while there is a selection.
  const [spot, setSpot] = useState<{ top: number; left: number }>();
  // Focus is in the editor, or on its ask button.
  const [focused, setFocused] = useState(false);
  const placeButton = () => {
    const editor = view.current;
    const next = editor && host.current ? askButtonSpot(editor, host.current) : undefined;
    // Called after every change to the editor's state, most of which leave the button where it is.
    setSpot((spot) => (spot?.top === next?.top && spot?.left === next?.left ? spot : next));
  };
  const placeButtonRef = useRef(placeButton);
  placeButtonRef.current = placeButton;

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
          selectionPlugin(() => placeButtonRef.current()),
        ],
      }),
      editable: () => !readOnlyRef.current,
    });
    view.current = editor;
    undoManagers.set(doc, yUndoPluginKey.getState(editor.state)!.undoManager);
    // The text can move without the document changing: the window resizes, or an image loads.
    const moved = () => placeButtonRef.current();
    const resized = new ResizeObserver(moved);
    resized.observe(editor.dom);
    window.addEventListener('resize', moved);
    return () => {
      resized.disconnect();
      window.removeEventListener('resize', moved);
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

  // The popup closing unpins the selection it was about.
  useEffect(() => {
    const editor = view.current;
    if (!askingSelection && editor && pinnedKey.getState(editor.state) !== DecorationSet.empty) {
      editor.dispatch(editor.state.tr.setMeta(pinnedKey, null).setMeta('addToHistory', false));
    }
  }, [askingSelection]);

  const askSelection = (anchor: HTMLElement) => {
    const editor = view.current;
    if (!editor || editor.state.selection.empty) return;
    const markdown = selectedMarkdown(editor.state);
    editor.dispatch(editor.state.tr.setMeta(pinnedKey, editor.state.selection).setMeta('addToHistory', false));
    onAskSelection?.({ markdown, anchor });
  };

  useEffect(() => {
    // Re-evaluate `editable` after a read-only change.
    view.current?.setProps({});
  }, [readOnly]);

  return (
    <>
      <div className="highlight-status" aria-live="polite">
        {highlights.length > 0 && `Highlighted ${shown} of ${highlights.length} passages`}
      </div>
      <div
        className={`rich-editor ${readOnly ? 'read-only' : ''}`}
        ref={host}
        onFocus={() => setFocused(true)}
        onBlur={(e) => setFocused(host.current!.contains(e.relatedTarget as HTMLElement | null))}
      />
      {/* In the editor's scrolling box, so it scrolls with the text. React adds only the button there; ProseMirror
          owns the rest. */}
      {onAskSelection &&
        spot &&
        (focused || askingSelection) &&
        createPortal(
          <button
            type="button"
            className="ask-selection-button"
            style={{ top: spot.top, left: spot.left }}
            aria-label="Ask the AI about the selection"
            title="Ask the AI about the selection"
            aria-haspopup="dialog"
            aria-expanded={askingSelection}
            // Pressing it must not move the caret or take focus from the editor, which would lose the selection.
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => askSelection(e.currentTarget)}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3 3v-3h-.5A1.5 1.5 0 0 1 2 9.5z" />
            </svg>
          </button>,
          host.current!,
        )}
    </>
  );
}
