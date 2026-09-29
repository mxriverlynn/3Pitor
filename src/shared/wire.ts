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
