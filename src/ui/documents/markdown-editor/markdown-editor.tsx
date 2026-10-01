// Rich text markdown editor built on ProseMirror, bound to a Yjs document so that edits from
// elsewhere (the AI's) merge with the user's typing instead of replacing it. Markdown is parsed
// into the Yjs document when a file loads and serialized back out when it is saved.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { EditorState, NodeSelection, Plugin, PluginKey, TextSelection, type Selection, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { Dropdown, DropdownSubmenu, joinUpItem, liftItem, type MenuElement, MenuItem, selectParentNodeItem } from 'prosemirror-menu';
import type { Node } from 'prosemirror-model';
import { buildMenuItems, exampleSetup } from 'prosemirror-example-setup';
import 'prosemirror-view/style/prosemirror.css';
import 'prosemirror-menu/style/menu.css';
import 'prosemirror-example-setup/style/style.css';
import { textblocks } from '../../../shared/blocks';
import { markdownSerializer as serializer, parseMarkdown, schema } from '../../../shared/markdown';
import { findQuote } from '../../../shared/passages';
import type { Passage } from '../../../shared/wire';
import { applyEdit, type RawFormat, rawFormat } from './raw-formatting';
import { askName, passageAt, rawHighlights, RawView } from './raw-view';
import { type Box, lineBoxes, outlinePath } from './highlight-outline';
import { taskItemKeymap, taskItemView } from './task-items';
import { LinkPopup } from '../../popups/link-popup/link-popup';
import './markdown-editor.css';

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
  prosemirrorToYXmlFragment(parseMarkdown(markdown), fragmentOf(doc));
  return doc;
}

export function snapshot(doc: Y.Doc): Snapshot {
  return { update: Y.encodeStateAsUpdate(doc), vector: Y.encodeStateVector(doc) };
}

// A snapshot rebuilt from its update alone, as stored; the vector follows from the update.
export function snapshotFromUpdate(update: Uint8Array): Snapshot {
  return { update, vector: Y.encodeStateVectorFromUpdate(update) };
}

// A Yjs update as standard base64, for storing it as text. Built in chunks, since an update can be hundreds of
// kilobytes and spreading one that large into a single call overflows the stack.
export function encodeUpdate(update: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < update.length; i += 0x8000) binary += String.fromCharCode(...update.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function decodeUpdate(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

// The undo history of the editor showing each document, so a merge can keep the AI's edit a step of its own.
const undoManagers = new WeakMap<Y.Doc, Y.UndoManager>();

// Turns `markdown` into Yjs changes made on a copy of `base`, then applies them to `live`. Changes made
// to `live` since `base` (the user's typing) are concurrent with the AI's and survive the merge. Returns the copy
// with the changes, the base for merging a later version of the same AI text.
export function mergeMarkdown(live: Y.Doc, base: Snapshot, markdown: string): Snapshot {
  const fork = new Y.Doc();
  Y.applyUpdate(fork, base.update);
  // updateYFragment's last argument is y-prosemirror's internal binding metadata; a fresh one is empty.
  const meta = { mapping: new Map(), isOMark: new Map() } as unknown as Parameters<typeof updateYFragment>[3];
  fork.transact(() => updateYFragment(fork, fragmentOf(fork), parseMarkdown(markdown), meta));
  // Undo groups changes made close together; stopping capture on both sides keeps typing out of the AI's step.
  undoManagers.get(live)?.stopCapturing();
  Y.applyUpdate(live, Y.encodeStateAsUpdate(fork, base.vector), AI_ORIGIN);
  undoManagers.get(live)?.stopCapturing();
  return snapshot(fork);
}

// The passages the editor highlights, the decorations of those it could place, and which of those, counted in the
// order they appear in the post, the writer is on.
type Highlights = { passages: Passage[]; decorations: DecorationSet; current: number };

// A transaction with this meta moves the writer to the placed passage at that index.
const CURRENT_META = 'currentHighlight';

// A transaction with this meta replaces the highlighted passages.
const highlightsKey = new PluginKey<Highlights>('highlights');

// Draws each passage whose quote occurs exactly once in the document; any other passage is left out.
function drawHighlights(doc: Node, passages: Passage[]): Highlights {
  // The same blocks the server's postBlocks finds in the markdown, so a quote it accepts is one the editor can find.
  const blocks = textblocks(doc);
  const texts = blocks.map((b) => b.text);
  const found = passages.flatMap(({ quote, label }) => {
    const matches = findQuote(texts, quote);
    if (matches.length !== 1) return [];
    const { block, from, to } = matches[0];
    return [{ start: textPos(doc, blocks[block].pos, from, false), end: textPos(doc, blocks[block].pos, to, true), label }];
  });
  const decorations: Decoration[] = [];
  found.forEach(({ start, end, label }, passage) => {
    const spec = { passage };
    decorations.push(Decoration.inline(start, end, { nodeName: 'mark', class: 'ai-highlight' }, spec));
    if (!label) return;
    // The editor leaves events on a label, and focus inside it, to the label.
    const widget = { ...spec, side: -1, key: `label-${label}`, stopEvent: () => true, ignoreSelection: true };
    decorations.push(Decoration.widget(start, () => labelChip(label), widget));
  });
  return { passages, decorations: outline(DecorationSet.create(doc, decorations), doc, 0), current: 0 };
}

// The placed passages' highlights, in the order they appear in the post; each label is a widget, which is empty.
function placed(decorations: DecorationSet): Decoration[] {
  return decorations.find().filter((d) => d.from < d.to).sort((a, b) => a.from - b.from);
}

// Where the placed passage the writer is on is in the document, if any passage is placed.
function currentRange(state: EditorState): Decoration | undefined {
  const { decorations, current } = highlightsKey.getState(state)!;
  return placed(decorations)[current];
}

// Selects the passage the writer is on, as if they had selected it themselves.
function selectCurrent(view: EditorView) {
  const range = currentRange(view.state);
  if (range) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)));
}

// Whether the selection is exactly the passage the writer is on, as selecting it for them leaves it.
function selectsCurrent(state: EditorState): boolean {
  const range = currentRange(state);
  return !!range && state.selection.from === range.from && state.selection.to === range.to;
}

// Outlines the placed passage at `current`, counted in the order they appear in the post, and no other.
function outline(decorations: DecorationSet, doc: Node, current: number): DecorationSet {
  const marks = placed(decorations);
  const redrawn = marks.map((d, i) =>
    Decoration.inline(d.from, d.to, { nodeName: 'mark', class: i === current ? 'ai-highlight current-highlight' : 'ai-highlight' }, d.spec),
  );
  return decorations.remove(marks).add(doc, redrawn);
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

// Highlights `initial` when the view mounts, and reports how many passages it placed and which of them, counted in
// the order they appear in the post, the writer is on. A click on a label
// reports the passage that label names in the current highlights, so a label kept from an earlier turn
// reports the current passage.
export function highlightsPlugin(initial: Passage[], onShown: (shown: number, current: number) => void, onAsk: (ask: Ask) => void = () => {}) {
  return new Plugin<Highlights>({
    key: highlightsKey,
    state: {
      init: (_, state) => drawHighlights(state.doc, initial),
      apply: (tr, value, oldState) => {
        const passages = tr.getMeta(highlightsKey) as Passage[] | undefined;
        if (passages) return drawHighlights(tr.doc, passages);
        const current = tr.getMeta(CURRENT_META) as number | undefined;
        if (current !== undefined) return { ...value, current, decorations: outline(value.decorations, tr.doc, current) };
        if (!tr.docChanged && tr.selectionSet && !isRaw(oldState)) {
          // The writer moved the cursor, and the passage it is in becomes the one they are on.
          const at = passageAt(placed(value.decorations), tr.selection.from, value.current);
          return at === value.current ? value : { ...value, current: at, decorations: outline(value.decorations, tr.doc, at) };
        }
        if (!tr.docChanged) return value;
        // A change arriving through Yjs (an AI edit, an undo) replaces the whole document, which would
        // collapse every highlight, so those are found again from their quotes.
        if (tr.getMeta(ySyncPluginKey)?.isChangeOrigin) return drawHighlights(tr.doc, value.passages);
        const decorations = mapHighlights(value.decorations, tr);
        if (isRaw(oldState)) return { ...value, decorations };
        // The writer stays on the passage they were on; if they deleted it, on the one that took its place.
        const was = placed(value.decorations)[value.current]?.spec.passage;
        const marks = placed(decorations);
        const kept = marks.findIndex((d) => d.spec.passage === was);
        const at = kept >= 0 ? kept : Math.max(0, Math.min(value.current, marks.length - 1));
        return { ...value, current: at, decorations: outline(decorations, tr.doc, at) };
      },
    },
    props: { decorations: (state) => highlightsKey.getState(state)!.decorations },
    view: (view) => {
      let passages: Passage[] | undefined;
      const update = () => {
        const state = highlightsKey.getState(view.state)!;
        // Each highlighted passage has one inline decoration; its label is a widget, which is empty.
        onShown(state.decorations.find().filter((d) => d.from < d.to).length, state.current);
        if (state.passages === passages) return;
        passages = state.passages;
        // New passages: bring the outlined first one into view, unless the writer is typing here.
        if (!view.hasFocus()) view.dom.querySelector('mark.current-highlight')?.scrollIntoView({ block: 'nearest' });
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

// What the ask button asks about: the writer's selection, or with only a caret, the highlighted passage they are on
// when the caret is in it.
function askedSelection(state: EditorState): Selection | undefined {
  if (!state.selection.empty) return state.selection;
  const range = currentRange(state);
  const { from } = state.selection;
  if (range && range.from <= from && from <= range.to) return TextSelection.create(state.doc, range.from, range.to);
}

// `selection` as markdown, whole blocks and all.
function selectedMarkdown(state: EditorState, selection: Selection): string {
  return serializer.serialize(state.doc.cut(selection.from, selection.to)).trim();
}

// Where the ask button goes, in `scroller`'s scrolled content: its top level with the top of what it asks about, and its
// right edge at the left edge of the text, so the button sits in the margin and covers none of it.
function askButtonSpot(view: EditorView, scroller: HTMLElement): { top: number; left: number } | undefined {
  const selection = askedSelection(view.state);
  if (!selection) return;
  const box = scroller.getBoundingClientRect();
  const node = selection instanceof NodeSelection ? view.nodeDOM(selection.from) : null;
  const top = node instanceof HTMLElement ? node.getBoundingClientRect().top : view.coordsAtPos(selection.from, 1).top;
  const text = view.dom.getBoundingClientRect().left + (parseFloat(getComputedStyle(view.dom).paddingLeft) || 0);
  return { top: top - box.top + scroller.scrollTop, left: text - box.left + scroller.scrollLeft };
}

// The outline around the highlighted passage the writer is on, in `scroller`'s scrolled content: one shape around all
// the pieces the passage is drawn in, however many links or formats split it.
function highlightOutline(view: EditorView, scroller: HTMLElement): string | undefined {
  const box = scroller.getBoundingClientRect();
  const x = scroller.scrollLeft - box.left;
  const y = scroller.scrollTop - box.top;
  const pieces: Box[] = [...view.dom.querySelectorAll('mark.current-highlight')].flatMap((mark) =>
    [...mark.getClientRects()].map((r) => ({ left: r.left + x, top: r.top + y, right: r.right + x, bottom: r.bottom + y })),
  );
  return outlinePath(lineBoxes(pieces)) || undefined;
}

// Replaces the editor's document with `markdown`'s, changing only the stretch that differs, so highlights and
// text outside it stay put. ySyncPlugin carries the change into the Yjs document.
function replaceMarkdown(view: EditorView, markdown: string): void {
  const { doc } = view.state;
  const next = parseMarkdown(markdown);
  const start = doc.content.findDiffStart(next.content);
  if (start == null) return;
  const end = doc.content.findDiffEnd(next.content)!;
  // Where the two documents share text around the change, the ends can cross; pull them back apart.
  const overlap = Math.max(0, start - Math.min(end.a, end.b));
  const tr = view.state.tr.replace(start, end.a + overlap, next.slice(start, end.b + overlap));
  // Fitting the slice in can add nodes the markdown has none of; then the whole document is replaced instead.
  if (!tr.doc.eq(next)) tr.replaceWith(0, tr.doc.content.size, next.content);
  view.dispatch(tr);
}

// Whether the editor shows raw markdown, which the menu items read from the editor's state. A transaction with this
// meta changes it.
const rawKey = new PluginKey<boolean>('raw-mode');
const rawPlugin = (initial: boolean) =>
  new Plugin<boolean>({ key: rawKey, state: { init: () => initial, apply: (tr, raw) => tr.getMeta(rawKey) ?? raw } });
const isRaw = (state: EditorState) => rawKey.getState(state) ?? false;

// How each editor's raw mode writes a format into its markdown text.
const rawFormatters = new WeakMap<EditorView, (format: RawFormat) => void>();

// `item` as it is, while the editor is formatted. In raw mode it writes `format` as markdown instead; an item with no
// markdown to write is hidden there.
function rawAware(item: MenuItem, format?: RawFormat): MenuItem {
  const { spec } = item;
  return new MenuItem({
    ...spec,
    run: (state, dispatch, view, event) => (isRaw(state) ? format && rawFormatters.get(view)?.(format) : spec.run(state, dispatch, view, event)),
    enable: (state) => (isRaw(state) ? !!format : (spec.enable?.(state) ?? true)),
    select: (state) => (isRaw(state) ? !!format : (spec.select?.(state) ?? true)),
    active: (state) => !isRaw(state) && (spec.active?.(state) ?? false),
  });
}

const items = buildMenuItems(schema);

// How each editor opens its link popup beside the selection.
const linkPopups = new WeakMap<EditorView, () => void>();

// The example setup's link item opens its own prompt in the middle of the window, and the selection it links stops
// showing. This one takes a link off as that one does, but asks the editor to open its link popup by the selection.
const linkItem = new MenuItem({
  ...items.toggleLink!.spec,
  run: (state, dispatch, view) => {
    if (!items.toggleLink!.spec.active!(state)) return linkPopups.get(view)?.();
    dispatch(state.tr.removeMark(state.selection.from, state.selection.to, schema.marks.link));
  },
});

// The example setup's menu, less its undo and redo items: those drive prosemirror-history, which cannot see changes
// that arrive through Yjs.
const menuContent: MenuElement[][] = [
  [
    rawAware(items.toggleStrong!, { kind: 'strong' }),
    rawAware(items.toggleEm!, { kind: 'em' }),
    rawAware(items.toggleCode!, { kind: 'code' }),
    rawAware(linkItem, { kind: 'link' }),
  ],
  [
    new Dropdown([rawAware(items.insertImage!, { kind: 'image' }), rawAware(items.insertHorizontalRule!, { kind: 'rule' })], { label: 'Insert' }),
    new Dropdown(
      [
        rawAware(items.makeParagraph!, { kind: 'heading', level: 0 }),
        rawAware(items.makeCodeBlock!, { kind: 'code-block' }),
        new DropdownSubmenu(
          [items.makeHead1!, items.makeHead2!, items.makeHead3!, items.makeHead4!, items.makeHead5!, items.makeHead6!].map((item, i) =>
            rawAware(item, { kind: 'heading', level: i + 1 }),
          ),
          { label: 'Heading' },
        ),
      ],
      { label: 'Type...' },
    ),
  ],
  [
    rawAware(items.wrapBulletList!, { kind: 'bullet-list' }),
    rawAware(items.wrapOrderedList!, { kind: 'ordered-list' }),
    rawAware(items.wrapBlockQuote!, { kind: 'blockquote' }),
    rawAware(joinUpItem),
    rawAware(liftItem),
    rawAware(selectParentNodeItem),
  ],
];

// The keys that format raw text, as they do the formatted document.
const RAW_KEYS: Record<string, RawFormat> = { b: { kind: 'strong' }, i: { kind: 'em' }, '`': { kind: 'code' } };

// How the editor shows the document: formatted, or as the markdown text it saves.
export type EditorMode = 'rendered' | 'raw';

export function MarkdownEditor({
  doc,
  readOnly,
  highlights,
  mode = 'rendered',
  onModeChange,
  onAsk,
  onAskSelection,
  askingSelection = false,
  onClearHighlights,
}: {
  doc: Y.Doc;
  readOnly: boolean;
  highlights: Passage[];
  mode?: EditorMode;
  // Called when the writer flips the switch at the right of the menu bar.
  onModeChange?: (mode: EditorMode) => void;
  // Called when the writer clicks a passage's label.
  onAsk?: (ask: Ask) => void;
  // Called when the writer clicks the button beside their selection to ask the AI about it.
  onAskSelection?: (ask: SelectionAsk) => void;
  // The popup the button opened is showing, so the selection stays marked and the button stays put.
  askingSelection?: boolean;
  // Called when the writer clicks Clear beside the highlight count.
  onClearHighlights?: () => void;
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
  // Which highlighted passage the writer is on, counted in the order they appear in the post.
  const [current, setCurrent] = useState(0);
  // Where the ask button sits while there is something to ask about, and what its name says that is.
  const [spot, setSpot] = useState<{ top: number; left: number; name: string }>();
  // Focus is in the editor, or on its ask button.
  const [focused, setFocused] = useState(false);
  // The outline around the highlighted passage the writer is on, while there is one.
  const [outline, setOutline] = useState<string>();
  const placeButton = () => {
    const editor = view.current;
    const at = editor && host.current ? askButtonSpot(editor, host.current) : undefined;
    const next = at && { ...at, name: askName(editor!.state.selection) };
    // Called after every change to the editor's state, most of which leave the button where it is.
    setSpot((spot) => (spot?.top === next?.top && spot?.left === next?.left && spot?.name === next?.name ? spot : next));
    // The text it outlines moves at the same moments the button's does. An unchanged path is an equal string, which
    // React skips re-rendering for.
    setOutline(editor && host.current ? highlightOutline(editor, host.current) : undefined);
  };
  const placeButtonRef = useRef(placeButton);
  placeButtonRef.current = placeButton;
  // The menu bar and its wrapper, which ProseMirror builds; the mode switch and the raw text go in them.
  const [menubar, setMenubar] = useState<{ bar: HTMLElement; wrapper: HTMLElement }>();
  // A read-only document hides the menu bar, and with it the way back from raw mode, so it always shows formatted.
  const raw = mode === 'raw' && !readOnly;
  // The markdown text shown in raw mode. The writer's typing stays as they typed it; a change from elsewhere (an
  // AI edit) replaces it with the document written out afresh.
  const [text, setText] = useState('');
  // Set while the writer's raw typing goes into the document, so it does not come back to replace their text.
  const typing = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // The selection a format leaves, set again once React has put the formatted text in the textarea.
  const formatted = useRef<[number, number]>(undefined);
  const rawRef = useRef(raw);
  rawRef.current = raw;
  // The marked text the link popup is showing beside, while it is open.
  const [linking, setLinking] = useState<HTMLElement>();

  useEffect(() => {
    const { doc: initial, mapping } = initProseMirrorDoc(fragmentOf(doc), schema);
    const editor = new EditorView(host.current!, {
      state: EditorState.create({
        doc: initial,
        plugins: [
          ySyncPlugin(fragmentOf(doc), { mapping }),
          yUndoPlugin({ trackedOrigins: [AI_ORIGIN] }),
          keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
          taskItemKeymap,
          ...exampleSetup({ schema, history: false, menuContent }),
          highlightsPlugin(
            highlightsRef.current,
            (count, at) => {
              setShown(count);
              setCurrent(at);
            },
            (ask) => onAskRef.current?.(ask),
          ),
          selectionPlugin(() => placeButtonRef.current()),
          rawPlugin(rawRef.current),
        ],
      }),
      editable: () => !readOnlyRef.current,
      nodeViews: { task_item: taskItemView },
    });
    view.current = editor;
    const bar = host.current!.querySelector<HTMLElement>('.ProseMirror-menubar');
    setMenubar(bar ? { bar, wrapper: bar.parentElement! } : undefined);
    undoManagers.set(doc, yUndoPluginKey.getState(editor.state)!.undoManager);
    rawFormatters.set(editor, (format) => formatRawRef.current(format));
    linkPopups.set(editor, () => openLinkRef.current());
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
    // New highlights select the first, unless the writer is working in the editor.
    if (editor && !editor.hasFocus()) selectCurrent(editor);
  }, [highlights]);

  // The popup closing unpins the selection it was about.
  useEffect(() => {
    const editor = view.current;
    if (!askingSelection && editor && pinnedKey.getState(editor.state) !== DecorationSet.empty) {
      editor.dispatch(editor.state.tr.setMeta(pinnedKey, null).setMeta('addToHistory', false));
    }
  }, [askingSelection]);

  // Marks the selection, which stops showing once focus moves into the popup, and opens the popup by its last line.
  const openLink = () => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch(editor.state.tr.setMeta(pinnedKey, editor.state.selection).setMeta('addToHistory', false));
    setLinking([...editor.dom.querySelectorAll<HTMLElement>('.ask-selection')].at(-1));
  };
  // Unmarks the text and selects it again in the editor, linked to `link` if the writer added one; the popup hands
  // focus back to the editor when the writer closes it from there. The text is
  // wherever edits made while the popup was open have moved it.
  const closeLink = (link?: { href: string; title: string }) => {
    const editor = view.current;
    setLinking(undefined);
    if (!editor) return;
    const [pinned] = pinnedKey.getState(editor.state)!.find();
    const tr = editor.state.tr.setMeta(pinnedKey, null);
    if (pinned) {
      if (link) tr.addMark(pinned.from, pinned.to, schema.marks.link.create({ href: link.href, title: link.title || null }));
      tr.setSelection(TextSelection.create(tr.doc, pinned.from, pinned.to));
    }
    editor.dispatch(tr);
  };
  const openLinkRef = useRef(openLink);
  openLinkRef.current = openLink;

  const askSelection = (anchor: HTMLElement) => {
    const editor = view.current;
    const selection = editor && askedSelection(editor.state);
    if (!editor || !selection) return;
    const markdown = selectedMarkdown(editor.state, selection);
    editor.dispatch(editor.state.tr.setMeta(pinnedKey, selection).setMeta('addToHistory', false));
    onAskSelection?.({ markdown, anchor });
  };

  useEffect(() => {
    if (!raw) return;
    setText(markdownOf(doc));
    const changed = () => {
      if (!typing.current) setText(markdownOf(doc));
    };
    doc.on('update', changed);
    return () => doc.off('update', changed);
  }, [doc, raw]);

  // The menu bar redraws its items for the mode.
  useEffect(() => {
    const editor = view.current;
    if (editor && isRaw(editor.state) !== raw) editor.dispatch(editor.state.tr.setMeta(rawKey, raw).setMeta('addToHistory', false));
  }, [raw]);

  // Where the highlighted passages are in the raw text.
  const rawMarks = useMemo(() => (raw ? rawHighlights(text, highlights) : []), [raw, text, highlights]);
  // How many of the highlights are placed in whichever of the formatted document and the raw text is showing.
  const count = raw ? rawMarks.length : shown;

  const formatRaw = (format: RawFormat) => {
    const area = textarea.current;
    if (!area) return;
    const edit = rawFormat({ text: area.value, from: area.selectionStart, to: area.selectionEnd }, format);
    area.focus();
    area.setSelectionRange(edit.from, edit.to);
    // Through the browser's own editing where it can, so Undo in the textarea takes the format back.
    const edited = edit.insert ? document.execCommand?.('insertText', false, edit.insert) : edit.from === edit.to || document.execCommand?.('delete');
    if (!edited) typeRaw(applyEdit(area.value, edit));
    formatted.current = edit.select;
    area.setSelectionRange(...edit.select);
  };
  const formatRawRef = useRef(formatRaw);
  formatRawRef.current = formatRaw;

  useLayoutEffect(() => {
    if (!formatted.current) return;
    textarea.current?.setSelectionRange(...formatted.current);
    formatted.current = undefined;
  }, [text]);

  const typeRaw = (markdown: string) => {
    setText(markdown);
    const editor = view.current;
    if (!editor) return;
    typing.current = true;
    try {
      replaceMarkdown(editor, markdown);
    } finally {
      typing.current = false;
    }
  };

  // How many times the writer has pressed < or >. Each press brings the passage it outlines into view, in whichever
  // of the formatted document and the raw text is showing, once that has redrawn.
  const [steps, setSteps] = useState(0);
  useEffect(() => {
    if (!steps) return;
    host.current?.querySelector(raw ? '.raw-mirror mark.current-highlight' : '.ProseMirror mark.current-highlight')?.scrollIntoView({ block: 'nearest' });
  }, [steps]);

  // Moves the writer `step` placed passages along.
  const stepHighlight = (step: number) => {
    const editor = view.current;
    if (!editor) return;
    if (!count) return;
    const next = (current + step + count) % count;
    editor.dispatch(editor.state.tr.setMeta(CURRENT_META, next).setMeta('addToHistory', false));
    // The writer asked to go there, so the editor takes focus too. In raw mode the caret goes to the passage's start,
    // which offers to ask about it without selecting text their typing would replace.
    if (!raw) {
      selectCurrent(editor);
      editor.focus();
    } else if (textarea.current) {
      textarea.current.setSelectionRange(rawMarks[next].from, rawMarks[next].from);
      textarea.current.focus();
    }
    setSteps((n) => n + 1);
  };

  useEffect(() => {
    // Re-evaluate `editable` after a read-only change.
    view.current?.setProps({});
  }, [readOnly]);

  return (
    <>
      <div
        className={`rich-editor ${readOnly ? 'read-only' : ''} ${raw ? 'raw' : ''}`}
        ref={host}
        onFocus={() => setFocused(true)}
        onBlur={(e) => setFocused(host.current!.contains(e.relatedTarget as HTMLElement | null))}
      />
      {/* In the editor's scrolling box, so it scrolls with the text. React adds only the button there; ProseMirror
          owns the rest. */}
      {menubar &&
        createPortal(
          <div className="editor-mode" role="group" aria-label="Show the document as">
            {(['rendered', 'raw'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={option === mode ? 'active' : ''}
                aria-pressed={option === mode}
                onClick={() => onModeChange?.(option)}
              >
                {option === 'rendered' ? 'Rendered' : 'Raw'}
              </button>
            ))}
          </div>,
          menubar.bar,
        )}
      {/* The last row of the menu bar, below the formatting buttons, so it stays in view with them. */}
      {menubar &&
        createPortal(
          <div className={`highlight-bar ${highlights.length > 0 ? 'showing' : ''}`}>
            <span className="highlight-status" aria-live="polite">
              {highlights.length > 0 &&
                (count
                  ? `Highlight ${Math.min(current, count - 1) + 1} of ${count}` + (count < highlights.length ? ` (${highlights.length - count} not found)` : '')
                  : 'No passages found')}
            </span>
            {highlights.length > 0 && (
              <span className="highlight-actions">
                <button type="button" aria-label="Previous highlight" onClick={() => stepHighlight(-1)}>
                  {'<'}
                </button>
                <button type="button" aria-label="Next highlight" onClick={() => stepHighlight(1)}>
                  {'>'}
                </button>
                {onClearHighlights && (
                  <button type="button" onClick={onClearHighlights}>
                    Clear
                  </button>
                )}
              </span>
            )}
          </div>,
          menubar.bar,
        )}
      {menubar &&
        raw &&
        createPortal(
          <RawView
            text={text}
            areaRef={textarea}
            highlights={rawMarks}
            current={current}
            onCurrent={(at) => view.current?.dispatch(view.current.state.tr.setMeta(CURRENT_META, at).setMeta('addToHistory', false))}
            onType={typeRaw}
            onKeyDown={(e) => {
              const format = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && RAW_KEYS[e.key];
              if (!format) return;
              e.preventDefault();
              formatRaw(format);
            }}
            onAsk={onAsk}
            onAskSelection={onAskSelection}
            askingSelection={askingSelection}
          />,
          menubar.wrapper,
        )}
      {!raw &&
        outline &&
        createPortal(
          <svg className="highlight-outline" aria-hidden="true">
            <path d={outline} />
          </svg>,
          host.current!,
        )}
      {onAskSelection &&
        !raw &&
        spot &&
        (focused || askingSelection || selectsCurrent(view.current!.state)) &&
        createPortal(
          <button
            type="button"
            className="ask-selection-button"
            style={{ top: spot.top, left: spot.left }}
            aria-label={spot.name}
            title={spot.name}
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
      {linking && <LinkPopup anchor={linking} onLink={closeLink} onClose={() => closeLink()} />}
    </>
  );
}
