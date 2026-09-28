// Rich text markdown editor built on ProseMirror, bound to a Yjs document so that edits from
// elsewhere (the AI's) merge with the user's typing instead of replacing it. Markdown is parsed
// into the Yjs document when a file loads and serialized back out when it is saved.
import { useEffect, useRef } from 'react';
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
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { redoItem, undoItem } from 'prosemirror-menu';
import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownSerializer, schema } from 'prosemirror-markdown';
import { buildMenuItems, exampleSetup } from 'prosemirror-example-setup';
import 'prosemirror-view/style/prosemirror.css';
import 'prosemirror-menu/style/menu.css';
import 'prosemirror-example-setup/style/style.css';
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

// The example setup's menu, less its undo and redo items: those drive prosemirror-history, which
// cannot see changes that arrive through Yjs.
const menuContent = buildMenuItems(schema).fullMenu.filter((group) => !group.includes(undoItem) && !group.includes(redoItem));

export function MarkdownEditor({ doc, readOnly }: { doc: Y.Doc; readOnly: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

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
    // Re-evaluate `editable` after a read-only change.
    view.current?.setProps({});
  }, [readOnly]);

  return <div className={`rich-editor ${readOnly ? 'read-only' : ''}`} ref={host} />;
}
