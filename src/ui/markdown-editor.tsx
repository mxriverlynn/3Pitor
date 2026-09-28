// Rich text markdown editor built on ProseMirror. Markdown is parsed into a ProseMirror
// document on load and serialized back to markdown on every edit.
import { useEffect, useRef } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownSerializer, schema } from 'prosemirror-markdown';
import { exampleSetup } from 'prosemirror-example-setup';
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

function createState(markdown: string): EditorState {
  return EditorState.create({
    doc: defaultMarkdownParser.parse(markdown) ?? undefined,
    plugins: exampleSetup({ schema }),
  });
}

export function MarkdownEditor({
  markdown,
  version,
  readOnly,
  onChange,
}: {
  /** The markdown to load. Only read when `version` changes, so typing never resets the editor. */
  markdown: string;
  /** Bump this to replace the editor's content with `markdown` (opening a file, reloading from disk). */
  version: number;
  readOnly: boolean;
  onChange: (markdown: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  useEffect(() => {
    const editor = new EditorView(host.current!, {
      state: createState(markdown),
      editable: () => !readOnlyRef.current,
      dispatchTransaction(tr) {
        editor.updateState(editor.state.apply(tr));
        if (tr.docChanged) onChangeRef.current(serializer.serialize(editor.state.doc));
      },
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    view.current?.updateState(createState(markdown));
  }, [version]);

  useEffect(() => {
    // Re-evaluate `editable` after a read-only change.
    view.current?.setProps({});
  }, [readOnly]);

  return <div className={`rich-editor ${readOnly ? 'read-only' : ''}`} ref={host} />;
}
