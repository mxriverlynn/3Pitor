// The shapes that cross the wire between the server and its clients (the UI and the check script).
// Types only, with no imports, so the browser bundle can import it with `import type`.

export type HostEvent =
  | { type: 'task'; sessionId: string; subtype: 'task_started' | 'task_notification'; description: string; subagentType: string }
  | { type: 'turn-finished'; sessionId: string; aborted: boolean };

// The body of POST /api/sessions/:id/chat.
export interface ChatRequest {
  text: string;
  // The document open in the editor.
  openFile?: string;
  // Every editable document the browser holds, by name, as markdown: what the user sees, saved or not.
  documents?: Record<string, string>;
}

// A passage in a post the model points the writer at: its text, and an optional label such as "Q1"
// that the chat's question about it starts with.
export interface Passage {
  quote: string;
  label?: string;
  // The question the chat asks about this passage, without its label, shown when the writer clicks the label.
  question?: string;
}

// The passages of one post that the editor highlights.
export interface SessionHighlights {
  file: string;
  passages: Passage[];
  // True when the passages mark changes rather than ask about them, so saving the post clears them.
  untilSaved?: true;
}

// The data of the `data-session` part that ends a chat turn's stream.
export interface SessionData {
  aborted: boolean;
  // The final markdown of every post the turn edited, by name, in the order they last changed; {} when aborted.
  edited: Record<string, string>;
  // The turn's last successful Highlight call; absent when it made none or was stopped.
  highlights?: SessionHighlights;
}

// One file or folder in the workspace, by workspace-relative path with "/" separators.
export interface DocumentEntry {
  path: string;
  kind: 'file' | 'folder';
}

// GET /api/documents: every folder (empty ones too) and every .md file, none starting with "." and no symlinks,
// sorted by `path` with `<`.
export interface DocumentList {
  entries: DocumentEntry[];
}

// POST /api/documents/count: everything a delete of the folder would remove, hidden and non-markdown items included.
export interface FolderCount {
  files: number;
  folders: number;
}

// The body of every 4xx from the documents routes.
export interface ApiError {
  error: string;
}

// GET /api/sessions/current. `Message` is the AI SDK's UIMessage on the page; this file stays import-free.
export interface CurrentSession<Message = unknown> {
  id: string;
  messages: Message[];
  running: boolean;
}

// A file with unsaved changes: its last saved text and its editor state, so a reload keeps the changes and later AI
// edits can still merge. `doc` and `loadBase` are base64 of Yjs updates; a Snapshot's vector is rebuilt from its update.
export interface StoredDoc {
  name: string;
  saved: string;
  doc: string;
  loadBase: string;
}

// The documents as they were when the latest chat message was sent: what the AI's edits are merged against.
export interface TurnRecord {
  // The file open when the message was sent.
  file?: string;
  // File name → base64 of that file's snapshot update.
  bases: Record<string, string>;
}

// An AI edit the editor could not bring in, and why.
export interface NotApplied {
  name: string;
  message: string;
}

// GET/PUT /api/view-state, and the body of .3pitor/view.json.
export interface ViewState {
  current?: string;
  mode: 'rendered' | 'raw';
  unsaved: StoredDoc[];
  highlights?: SessionHighlights;
  notApplied: NotApplied[];
  turn?: TurnRecord;
  // The id of the last assistant message whose edits and highlights the editor took in.
  appliedTurn?: string;
}
