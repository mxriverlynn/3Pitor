// The editor's view, stored so a reload or restart brings it back. The page writes it and reads it; the server never
// looks inside.
import type { ViewState } from '../../shared/wire';
import { readJson, stateFile, writeJson } from '../components/json-file';

// Missing or unreadable reads as the view of a page with nothing open.
export async function loadViewState(workspace: string): Promise<ViewState> {
  return ((await readJson(stateFile(workspace, 'view.json'))) as ViewState | undefined) ?? { mode: 'rendered', unsaved: [], notApplied: [] };
}

// Rejects when the write fails.
export function saveViewState(workspace: string, view: ViewState): Promise<void> {
  return writeJson(stateFile(workspace, 'view.json'), view);
}
