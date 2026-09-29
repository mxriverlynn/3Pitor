// Test-only: the documents routes over an in-memory workspace, for UI tests to answer fetch with. It refuses only a
// missing item (404); the path grammar and every other refusal belong to the server's own tests.
import type { DocumentEntry, DocumentList, FolderCount } from '../../shared/wire';

export function fakeDocumentsApi(files: Record<string, string>, folders: string[] = []) {
  const api = {
    // The workspace's files by path, and its folders. A file's parent folders count as existing whether listed or not.
    files: new Map(Object.entries(files)),
    folders: new Set(folders),
    // Each documents request, as "METHOD path".
    requests: [] as string[],
    // Answers a documents request, or returns undefined for any other URL.
    handle: async (url: string, init?: RequestInit): Promise<Response | undefined> => {
      if (!url.startsWith('/api/documents')) return undefined;
      const method = init?.method ?? 'GET';
      api.requests.push(`${method} ${url}`);
      if (url === '/api/documents') return Response.json({ entries: entries() } satisfies DocumentList);
      if (url === '/api/documents/create') {
        const { path, kind } = JSON.parse(String(init!.body)) as DocumentEntry;
        if (exists(path)) return refuse(400, `${path} already exists`);
        if (kind === 'folder') api.folders.add(path);
        else api.files.set(path, `# ${path.slice(path.lastIndexOf('/') + 1, -'.md'.length)}\n`);
        return Response.json({ ok: true });
      }
      if (url === '/api/documents/move') {
        const { from, to } = JSON.parse(String(init!.body)) as { from: string; to: string };
        if (!exists(from)) return refuse(404, `${from} was not found`);
        if (exists(to)) return refuse(400, `${to} already exists`);
        const moved = (path: string) => (path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path);
        api.files = new Map([...api.files].map(([path, text]) => [moved(path), text]));
        api.folders = new Set([...api.folders].map(moved));
        return Response.json({ ok: true });
      }
      if (url === '/api/documents/count' || url === '/api/documents/delete') {
        const { path } = JSON.parse(String(init!.body)) as { path: string };
        if (!exists(path)) return refuse(404, `${path} was not found`);
        const inside = (p: string) => p.startsWith(`${path}/`);
        if (url === '/api/documents/count') {
          const all = entries();
          return Response.json({
            files: all.filter((e) => e.kind === 'file' && inside(e.path)).length,
            folders: all.filter((e) => e.kind === 'folder' && inside(e.path)).length,
          } satisfies FolderCount);
        }
        for (const p of [...api.files.keys()]) if (p === path || inside(p)) api.files.delete(p);
        for (const p of [...api.folders]) if (p === path || inside(p)) api.folders.delete(p);
        return Response.json({ ok: true });
      }
      const name = decodeURIComponent(url.slice('/api/documents/'.length));
      if (method === 'PUT') {
        api.files.set(name, JSON.parse(String(init!.body)).content);
        return Response.json({ ok: true });
      }
      const content = api.files.get(name);
      if (content === undefined) return refuse(404, `${name} was not found`);
      return Response.json({ name, content });
    },
  };

  const refuse = (status: number, error: string) => Response.json({ error }, { status });
  const exists = (path: string) => entries().some((e) => e.path === path);

  // Every folder, listed or implied by a file, and every file, sorted by path as the server sorts them.
  const entries = (): DocumentEntry[] => {
    const all = new Set(api.folders);
    for (const path of api.files.keys()) {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) all.add(parts.slice(0, i).join('/'));
    }
    return [
      ...[...all].map((path) => ({ path, kind: 'folder' as const })),
      ...[...api.files.keys()].map((path) => ({ path, kind: 'file' as const })),
    ].sort((a, b) => (a.path < b.path ? -1 : 1));
  };

  return api;
}

export type FakeDocumentsApi = ReturnType<typeof fakeDocumentsApi>;
