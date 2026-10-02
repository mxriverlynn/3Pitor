// The editor's view, stored so a reload or restart brings it back. The page writes it and reads it; the server never
// looks inside.
import type { ViewState } from '../../shared/wire';
import type { FileSystem } from '../../file-system/file-system';
import { readJson, stateKey, writeJson } from '../components/json-file';

// Missing or unreadable reads as the view of a page with nothing open.
export async function loadViewState(fileSystem: FileSystem): Promise<ViewState> {
  return ((await readJson(fileSystem, stateKey('view.json'))) as ViewState | undefined) ?? { mode: 'rendered', unsaved: [], notApplied: [] };
}

// Rejects when the write fails.
export function saveViewState(fileSystem: FileSystem, view: ViewState): Promise<void> {
  return writeJson(fileSystem, stateKey('view.json'), view);
}
