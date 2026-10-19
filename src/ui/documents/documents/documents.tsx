import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import * as Y from 'yjs';
import { unsupportedMarkdown } from '../../../shared/markdown-support';
import type { NotApplied, Passage, Post, PostList, PostSummary, SessionData, SessionHighlights, StoredDoc, TurnProgress, ViewState } from '../../../shared/wire';
import { api } from '../../components/api';
import { ConfirmDialog } from '../../components/confirm-dialog/confirm-dialog';
import { CloseIcon, ErrorIcon, InfoIcon } from '../../components/notice-icons';
import { keyShortcut, shortcut } from '../../components/shortcut';
import { decodeUpdate, docFromMarkdown, encodeUpdate, type EditorMode, MarkdownEditor, markdownOf, mergeMarkdown, replaceMarkdown, snapshot, snapshotFromUpdate, type Snapshot } from '../markdown-editor/markdown-editor';
import { PostTable } from '../post-table/post-table';
import './documents.css';

// One opened post, by its id: its editor document, the text it was loaded or last saved with, how many times it has
// been saved, and the document's state when it loaded (what the AI read, if it read the post from the store).
type Entry = {
  doc: Y.Doc;
  saved: string;
  loadBase: Snapshot;
  saves: number;
  dirty: boolean;
  // The save running for this file, if any.
  saving?: Promise<void>;
  // What the disk holds, when it differs from `saved` while the file has unsaved changes.
  diskText?: string;
  // The disk text the writer chose to keep their version over, so a sync finding it again does not ask again.
  keptOver?: string;
};

// The finished reply Undo all can take back: every post it edited, in the order it first edited them, and the posts
// it made, which Undo all leaves in the list, empty.
export type LastTurn = { files: string[]; made: string[] };

// A constant, so the editor sees no change while there are no highlights.
const NO_PASSAGES: Passage[] = [];

export function useDocuments() {
  // Every post, as the store last listed them, in no order.
  const [posts, setPosts] = useState<PostSummary[]>([]);
  // The file on show; undefined until the writer opens one, or until a reload brings back the one that was open.
  const [current, setCurrent] = useState<string>();
  // `current` for callbacks that outlive a render; `show` keeps it in step before React re-renders.
  const currentRef = useRef(current);
  currentRef.current = current;
  const show = (name: string | undefined) => {
    currentRef.current = name;
    setCurrent(name);
  };
  // Every file opened since the page loaded, plus those a reload brought back with unsaved edits, so switching files
  // keeps unsaved edits. Entries are changed in place; `rerender` tells React about it.
  const opened = useRef(new Map<string, Entry>());
  const [version, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);
  // Each document's state when the latest chat message was sent: the text the AI starts from.
  const turnBases = useRef(new Map<string, Snapshot>());
  // How many times each document had been saved when the latest chat message was sent.
  const turnSaves = useRef(new Map<string, number>());
  // The file open when the latest chat message was sent.
  const turnFile = useRef<string>(undefined);
  // What each opened file held when the latest chat message was sent, for Undo all: its text, its saved text, and
  // whether it had unsaved changes. Undefined until this page sends a message.
  const turnStart = useRef<Map<string, { text: string; saved: string; dirty: boolean }>>(undefined);
  // The posts the latest turn edited, in the order it first edited them.
  const turnEdited = useRef(new Set<string>());
  // The posts listed when the latest chat message was sent: an edited post not among them is one Claude made.
  const turnListed = useRef(new Set<string>());
  // The finished reply Undo all can take back, until the writer saves, moves or deletes one of its files, dismisses
  // the review, or starts another turn. Kept only for this page's life.
  const [lastTurn, setLastTurn] = useState<LastTurn>();
  const lastTurnRef = useRef(lastTurn);
  lastTurnRef.current = lastTurn;
  // True while Undo all runs.
  const [undoing, setUndoing] = useState(false);
  const undoingRef = useRef(false);
  // Files Undo all could not put back, and why.
  const [notUndone, setNotUndone] = useState<NotApplied[]>([]);
  // The id of the last reply whose edits and highlights the editor took in, so a reload never applies one twice.
  const appliedTurn = useRef<string>(undefined);
  // AI edits the latest turn could not bring into the editor, and why.
  const [notApplied, setNotApplied] = useState<NotApplied[]>([]);
  // The passages the latest finished turn highlighted, until the next one replaces them.
  const [highlights, setHighlights] = useState<SessionHighlights>();
  // Rendered or raw. Kept here rather than in the editor, which remounts for each file, so switching files keeps it.
  const [mode, setMode] = useState<EditorMode>('rendered');
  // How many times the writer has asked to find the file on show in the Posts list, which reveals it on each one.
  const [finds, setFinds] = useState(0);
  // How many times the writer has asked for a new post from the empty editor; the post list asks its title each time.
  const [newPosts, setNewPosts] = useState(0);
  // The post the writer just made, until they open another: its editor takes focus when it first shows.
  const [created, setCreated] = useState<string>();
  // True once the stored view is back: from then on, every change to the view is stored.
  const [restored, setRestored] = useState(false);
  const restoredRef = useRef(restored);
  restoredRef.current = restored;

  // Tracks unsaved edits from the document's own changes rather than by comparing text: the editor's markdown output
  // can differ from the file (bullet style, line wrapping) even when nobody changed anything.
  const track = (name: string, entry: Entry) => {
    entry.doc.on('update', () => {
      entry.dirty = true;
      rerender();
    });
    opened.current.set(name, entry);
  };

  const load = (name: string, text: string) => {
    const doc = docFromMarkdown(text);
    track(name, { doc, saved: text, loadBase: snapshot(doc), saves: 0, dirty: false });
  };

  // `posts` for callbacks that outlive a render: the latest list applied.
  const listRef = useRef<PostSummary[]>([]);
  // False until the first list is applied: until then, no post is known to be missing.
  const listLoaded = useRef(false);
  // Counts list requests, so only the latest one started is applied: an older answer arriving last is not.
  const listCalls = useRef(0);
  // Reloads the list from the store and returns what it fetched, applied or not.
  const refreshList = useCallback(async () => {
    const call = ++listCalls.current;
    const { posts } = await api<PostList>('GET', '/api/posts');
    if (call === listCalls.current) {
      listRef.current = posts;
      listLoaded.current = true;
      setPosts(posts);
    }
    return posts;
  }, []);
  // Whether the latest list holds `id`.
  const isListed = (id: string) => listRef.current.some((post) => post.id === id);
  // An open post the store no longer lists: its changes can only be copied or discarded.
  const isGone = (id: string) => listLoaded.current && !isListed(id);

  // Loads in progress, by file name, so two callers wanting one file share a single load.
  const loading = useRef(new Map<string, Promise<void>>());

  // Loads a file from disk the first time it is needed. A load that fails is forgotten, so the next call tries again.
  const ensureLoaded = (name: string): Promise<void> => {
    if (opened.current.has(name)) return Promise.resolve();
    let pending = loading.current.get(name);
    if (!pending) {
      pending = readFile(name)
        .then((text) => load(name, text))
        .finally(() => loading.current.delete(name));
      loading.current.set(name, pending);
    }
    return pending;
  };

  // Shows a file, loading it from disk the first time it is opened.
  const open = useCallback(async (name: string) => {
    setCreated((id) => (id === name ? id : undefined));
    setNotApplied([]);
    setNotUndone([]);
    await ensureLoaded(name);
    show(name);
    // The first file opens while `current` already names it, so showing it alone would not re-render.
    rerender();
  }, []);

  // Undo all is no longer offered once one of its files is saved, moved or deleted: the disk would no longer match it.
  const endOffer = (touches: (file: string) => boolean) => setLastTurn((turn) => (turn?.files.some(touches) ? undefined : turn));

  // A Save pressed while one is running for the same file joins it rather than writing again.
  const save = useCallback(
    async (name: string | undefined = current) => {
      if (name === undefined) return;
      const entry = opened.current.get(name);
      if (entry?.saving) return entry.saving;
      if (!entry?.dirty || unsupportedMarkdown(entry.saved).length) return;
      const run = (async () => {
        const content = markdownOf(entry.doc);
        await api('PUT', `${postUrl(name)}/body`, { body: content });
        // Recorded before anything else can look, so this write never reads as someone else's change on disk.
        entry.saved = content;
        entry.saves++;
        // Typing that landed while the save was in flight is still unsaved.
        entry.dirty = markdownOf(entry.doc) !== content;
        entry.diskText = entry.keptOver = undefined;
        endOffer((file) => file === name);
        rerender();
      })();
      entry.saving = run;
      const clear = () => {
        if (entry.saving === run) entry.saving = undefined;
      };
      run.then(clear, clear);
      return run;
    },
    [current],
  );

  // Makes an empty post from its title and resolves to its id once the list holds it. Opening it is the caller's to do.
  const createPost = useCallback(
    async (title: string) => {
      const { id } = await api<Pick<PostSummary, 'id'>>('POST', '/api/posts', { title });
      setCreated(id);
      await refreshList();
      return id;
    },
    [refreshList],
  );

  // Gives a post a new title. Its id, its text, and any unsaved changes to it stay as they are.
  const rename = useCallback(
    async (id: string, title: string) => {
      await api('PUT', `${postUrl(id)}/title`, { title });
      await refreshList();
    },
    [refreshList],
  );

  // Closes an open file: it leaves the editor, and its highlights go with it.
  const forget = (name: string) => {
    opened.current.delete(name);
    if (currentRef.current === name) show(undefined);
    setHighlights((before) => (before?.file === name ? undefined : before));
  };

  // Deletes a post for good, and closes it, unsaved changes and all: the delete confirmation warns of them first.
  const remove = useCallback(
    async (id: string) => {
      await api('DELETE', postUrl(id));
      endOffer((file) => file === id);
      forget(id);
      await refreshList();
    },
    [refreshList],
  );

  // Throws away the unsaved changes to a post the store no longer lists, and closes it.
  const discard = (id: string) => {
    forget(id);
    rerender();
  };

  // Brings an open file in line with `text` from disk, in place. If the update throws, the entry is left as it was.
  const followDisk = (entry: Entry, text: string) => {
    replaceMarkdown(entry.doc, text);
    entry.saved = text;
    // The update above marked the file unsaved; it is now what the disk holds.
    entry.dirty = false;
    entry.diskText = entry.keptOver = undefined;
  };

  // Drops the unsaved changes to the file on show for what its disk copy holds now. Rejects when it cannot be read.
  const takeDiskVersion = async () => {
    const name = currentRef.current;
    const entry = name === undefined ? undefined : opened.current.get(name);
    if (!entry) return;
    const content = await readFile(name!);
    // The writer may have closed or replaced the file while it was being read.
    if (opened.current.get(name!) !== entry) return;
    followDisk(entry, content);
    rerender();
  };

  // Dismisses the changed-on-disk notice for the file on show, until the disk changes again. Save still overwrites the
  // disk.
  const keepMyVersion = () => {
    const entry = currentRef.current === undefined ? undefined : opened.current.get(currentRef.current);
    if (!entry) return;
    entry.keptOver = entry.diskText;
    entry.diskText = undefined;
    rerender();
  };

  // Brings one open post in line with the store, given the lists from before and after this sync's reload.
  const syncFile = async (name: string, entry: Entry, before: PostSummary[], now: PostSummary[]) => {
    if (!now.some((post) => post.id === name)) {
      // Not listed says it all; that notice takes over from the one about a change.
      entry.diskText = undefined;
      // Closed only once the server confirms it is gone, and only when nothing would be lost.
      if (!entry.dirty && before.some((post) => post.id === name)) {
        await readFile(name).catch((error) => {
          if (error.status === 404 && opened.current.get(name) === entry) forget(name);
        });
      }
      return;
    }
    const saves = entry.saves;
    // A file that cannot be read now is left as it is, for a later sync.
    const text = await readFile(name).catch(() => undefined);
    // The read is out of date if the file was replaced, or a save ran or started, while it was in flight.
    if (text === undefined || opened.current.get(name) !== entry || entry.saving || entry.saves !== saves) return;
    if (text === entry.saved) {
      entry.diskText = undefined;
      return;
    }
    if (entry.dirty) {
      entry.diskText = text === entry.keptOver ? undefined : text;
      return;
    }
    try {
      followDisk(entry, text);
    } catch (error) {
      console.error(`Could not update ${name} from disk:`, error);
    }
  };

  // One sync: brings the list and every open file in line with the disk, after something outside the app may have
  // changed it. It never rejects, so a failed sync cannot hold up the ones queued behind it; the next one tries again.
  const syncOnce = async () => {
    try {
      const before = listRef.current;
      const now = await refreshList();
      for (const [name, entry] of opened.current) await syncFile(name, entry, before, now);
      rerender();
    } catch (error) {
      console.error('Could not sync with the disk:', error);
    }
  };

  // Syncs with the disk. A call while a sync runs asks for one more after it, shared by every call made meanwhile, so a
  // call resolves once a sync that started after it has finished.
  const sync = useRef<{ running?: Promise<void>; queued?: Promise<void> }>({});
  const syncWithDisk = (): Promise<void> => {
    const s = sync.current;
    if (!s.running) {
      s.running = syncOnce().finally(() => {
        s.running = undefined;
      });
      return s.running;
    }
    s.queued ??= s.running.then(() => {
      s.queued = undefined;
      return syncWithDisk();
    });
    return s.queued;
  };

  // Captures what the editor holds as a chat message is sent. The markdown goes to the AI; the snapshot
  // taken with it is what the AI's edits are merged against, so typing done meanwhile survives.
  const beginTurn = useCallback(() => {
    const documents: Record<string, string> = {};
    turnBases.current.clear();
    turnSaves.current.clear();
    turnFile.current = currentRef.current;
    turnStart.current = new Map();
    turnEdited.current.clear();
    turnListed.current = new Set(listRef.current.map((post) => post.id));
    setLastTurn(undefined);
    for (const [name, entry] of opened.current) {
      turnSaves.current.set(name, entry.saves);
      turnStart.current.set(name, { text: markdownOf(entry.doc), saved: entry.saved, dirty: entry.dirty });
      // A post the store no longer lists can only be copied or discarded, so the AI never sees it.
      if (unsupportedMarkdown(entry.saved).length || isGone(name)) continue;
      documents[name] = markdownOf(entry.doc);
      turnBases.current.set(name, snapshot(entry.doc));
    }
    // Stored without the pause, so a reload right after Send still merges the AI's edits against what it was sent.
    if (restoredRef.current) writeView();
    return { documents };
  }, []);

  // Brings a turn's edits into the editor: `edited` is each edited post's final markdown, by id. A post not open yet is
  // loaded from the store first and the edit merged into it, so a post Claude just made, empty in the store, takes the
  // edit as unsaved changes. One the store does not hold cannot take it. Calls run one at a time, in call order.
  const applying = useRef<Promise<void>>(Promise.resolve());
  const applyEdited = useCallback(
    (edited: Record<string, string>): Promise<void> => {
      const run = applying.current.then(() => applyEditedNow(edited));
      applying.current = run.catch(() => {});
      return run;
    },
    [],
  );
  const applyEditedNow = async (edited: Record<string, string>) => {
      const names = Object.keys(edited);
      if (!names.length) return;
      const failed: NotApplied[] = [];
      for (const name of names) {
        if (opened.current.has(name)) continue;
        try {
          // A post made during the turn is listed only once the list catches up.
          if (!isListed(name)) await refreshList();
          await ensureLoaded(name);
        } catch (error) {
          failed.push({ name, message: error instanceof Error ? error.message : String(error) });
        }
      }
      const loaded = names.filter((name) => opened.current.has(name));
      // Read through the ref, since a restored page applies a pending reply from the render that started restoring.
      const current = currentRef.current;
      // Stay on the open file if the AI changed it; otherwise show the file it changed last. That move is
      // the AI's, so the writer still counts as on the file they sent the message from.
      if (loaded.length && (current === undefined || !loaded.includes(current))) {
        if (current === turnFile.current) turnFile.current = loaded.at(-1)!;
        show(loaded.at(-1)!);
      }
      for (const name of loaded) {
        const entry = opened.current.get(name);
        const turnBase = turnBases.current.get(name);
        // With no base from Send, the AI read the file from disk at some point during the turn. A save
        // since then means the load-time base may be older than what the AI read, so merging from it
        // could repeat the user's saved text.
        if (entry && !turnBase && entry.saves > (turnSaves.current.get(name) ?? 0)) {
          failed.push({ name, message: 'it was saved while Claude was working' });
          continue;
        }
        // Each file succeeds or fails on its own, so one bad merge can't lose the others' edits.
        try {
          // The next report of this post from the same turn merges from what this one left.
          turnBases.current.set(name, mergeMarkdown(entry!.doc, turnBase ?? entry!.loadBase, edited[name]));
          entry!.dirty = true;
          turnEdited.current.add(name);
        } catch (error) {
          failed.push({ name, message: error instanceof Error ? error.message : String(error) });
        }
      }
      setNotApplied(failed);
      rerender();
  };

  // Shows `next`'s highlights, or clears them when given none, as a new chat does. The editor moves to the
  // highlighted post only if the writer is still on the file they sent the message from.
  const showHighlights = useCallback(async (next: SessionHighlights | undefined) => {
    setHighlights(next);
    const stayed = () => currentRef.current === turnFile.current;
    if (!next || !stayed()) return;
    await ensureLoaded(next.file);
    // Loading takes a moment, and the writer may have moved meanwhile.
    if (stayed()) show(next.file);
  }, []);

  // Brings back the view stored before a reload, then syncs with the store. Each piece succeeds or fails on its own: one
  // that cannot be used is dropped, and the rest still comes back. Every post the view names is checked against the
  // list first, so a reference to a deleted post, or to a draft path from before posts had ids, drops out; unsaved
  // changes to one come back as a post not in the list, to copy or discard. If the list cannot be read, nothing drops.
  const restore = useCallback(async (view: ViewState) => {
    const listed = await refreshList().then(
      (posts) => new Set(posts.map((post) => post.id)),
      () => undefined,
    );
    const known = (id: string) => !listed || listed.has(id);
    const restoredUnsaved = new Set(view.unsaved.map((stored) => stored.name));
    for (const stored of view.unsaved) {
      try {
        track(stored.name, restoredEntry(stored));
      } catch (error) {
        console.error(`Could not restore the unsaved changes to ${stored.name}:`, error);
      }
    }
    try {
      if (view.turn) {
        turnFile.current = view.turn.file !== undefined && known(view.turn.file) ? view.turn.file : undefined;
        turnBases.current = new Map(
          Object.entries(view.turn.bases).flatMap(([name, base]) => (known(name) ? [[name, snapshotFromUpdate(decodeUpdate(base))] as const] : [])),
        );
      }
    } catch (error) {
      console.error('Could not restore what the latest chat message was sent with:', error);
    }
    appliedTurn.current = view.appliedTurn;
    let file = view.current;
    if (file !== undefined && !known(file)) file = restoredUnsaved.has(file) ? file : undefined;
    if (file !== undefined && !opened.current.has(file)) {
      try {
        await ensureLoaded(file);
      } catch (error) {
        console.error(`Could not reopen ${file}:`, error);
        file = undefined;
      }
    }
    show(file);
    setHighlights(view.highlights && known(view.highlights.file) ? view.highlights : undefined);
    setNotApplied(view.notApplied.filter(({ name }) => known(name)));
    setMode(view.mode);
    setRestored(true);
    rerender();
    // The disk may have changed while the page was away; restored drafts are checked against it too.
    await syncWithDisk();
  }, []);

  // Why the stored view could not be loaded. The writer stays off for this page load, so it cannot overwrite the
  // stored drafts, and leaving warns for unsaved edits as it did before views were stored.
  const [restoreError, setRestoreError] = useState<string>();
  const restoreFailed = useCallback((error: Error) => {
    setRestoreError(`Could not load your saved editor state: ${error.message}. Changes on this page will not survive a reload.`);
  }, []);

  // The view as it stands, read when it is written so a write always stores the latest.
  const latest = useRef({ highlights, notApplied, mode });
  latest.current = { highlights, notApplied, mode };
  const viewState = (): ViewState => ({
    current: currentRef.current,
    mode: latest.current.mode,
    unsaved: [...opened.current].flatMap(([name, entry]) =>
      entry.dirty ? [{ name, saved: entry.saved, doc: encodeUpdate(Y.encodeStateAsUpdate(entry.doc)), loadBase: encodeUpdate(entry.loadBase.update) }] : [],
    ),
    highlights: latest.current.highlights,
    notApplied: latest.current.notApplied,
    appliedTurn: appliedTurn.current,
    turn: {
      file: turnFile.current,
      bases: Object.fromEntries([...turnBases.current].map(([name, base]) => [name, encodeUpdate(base.update)])),
    },
  });

  // One write at a time: a change while one is in flight asks for exactly one more, with the latest view, once it lands.
  // `waiting` covers the pause before a write; `failed` holds until a later write lands.
  const writing = useRef({ waiting: false, inFlight: false, again: false, failed: false });
  // Why the last write failed, until one lands.
  const [writeError, setWriteError] = useState<string>();
  const writeView = async () => {
    const write = writing.current;
    write.waiting = false;
    if (write.inFlight) {
      write.again = true;
      return;
    }
    write.inFlight = true;
    try {
      await api('PUT', '/api/view-state', viewState());
      write.failed = false;
      setWriteError(undefined);
    } catch (error) {
      write.failed = true;
      setWriteError(`Changes are not saved to disk: ${(error as Error).message}`);
    } finally {
      write.inFlight = false;
      if (write.again) {
        write.again = false;
        writeView();
      }
    }
  };
  // Stores the view a short pause after the last change. A change during the pause starts it again.
  useEffect(() => {
    if (!restored) return;
    writing.current.waiting = true;
    const timer = setTimeout(writeView, 300);
    return () => clearTimeout(timer);
  }, [restored, version, current, mode, highlights, notApplied]);

  // Brings what a running turn has done so far into the editor, as it happens. A turn that has neither edited nor
  // highlighted leaves the earlier highlights, so a question still open stays marked; a passage whose text it edited
  // away drops out.
  const applyProgress = async (data: TurnProgress) => {
    await applyEdited(data.edited);
    if (data.highlights) await showHighlights(data.highlights);
  };

  // The one way a finished turn's final edits and highlights enter the editor; they repeat its last progress, which
  // merges in as no change. The edits and the note that this reply was applied change together, so they are stored
  // in the same write.
  const applyTurn = async (messageId: string, data: SessionData) => {
    appliedTurn.current = messageId;
    await applyProgress(data);
    offerUndo(data);
  };

  // Offers Undo all for a turn this page sent that ran to the end and edited something, unless one of the files it
  // edited was saved while it ran: what Undo all would put back no longer matches the disk.
  const offerUndo = (data: SessionData) => {
    const files = [...turnEdited.current];
    const unsaved = files.every((name) => (opened.current.get(name)?.saves ?? 0) === (turnSaves.current.get(name) ?? 0));
    const made = files.filter((name) => !turnListed.current.has(name));
    if (turnStart.current && !data.aborted && files.length && unsaved) setLastTurn({ files, made });
  };

  // Puts every post the last reply edited back the way it was at Send: a post open then gets its text back, and one that
  // was only in the store is read again, so one Claude made comes back empty and stays listed. A post that cannot be
  // read stays as it is, and one that is gone closes.
  // What the writer typed in those files since Send goes too. A call while one runs does nothing.
  const undoTurn = async () => {
    const turn = lastTurnRef.current;
    if (!turn || undoingRef.current) return;
    undoingRef.current = true;
    setUndoing(true);
    const failed: NotApplied[] = [];
    try {
      for (const name of turn.files) {
        const entry = opened.current.get(name);
        const start = turnStart.current?.get(name);
        if (entry && start) {
          replaceMarkdown(entry.doc, start.text);
          // Unsaved as it was at Send, or if the disk copy changed since. The text is compared with what was saved
          // then, not with the editor's markdown, which can differ from the file when nobody changed anything.
          entry.dirty = start.dirty || entry.saved !== start.saved;
          continue;
        }
        try {
          const text = await readFile(name);
          const now = opened.current.get(name);
          if (now) followDisk(now, text);
        } catch (error) {
          if ((error as { status?: number }).status === 404) forget(name);
          else failed.push({ name, message: (error as Error).message });
        }
      }
    } finally {
      undoingRef.current = false;
      setUndoing(false);
      setNotUndone(failed);
      setLastTurn(undefined);
      setHighlights(undefined);
      rerender();
    }
  };

  // Puts the review away: the highlights and the Undo all offer go.
  const dismissReview = () => {
    setLastTurn(undefined);
    showHighlights(undefined);
  };

  // Applies the chat's last reply if it ran to the end while no page was there to take it in: a turn that finished
  // during a reload, or while the page waited on it.
  const applyPending = async (messages: UIMessage[]) => {
    const reply = messages.findLast((message) => message.role === 'assistant');
    const session = reply?.parts.findLast((part) => part.type === 'data-session') as { data: SessionData } | undefined;
    if (!reply || !session || session.data.aborted || reply.id === appliedTurn.current) return;
    await applyTurn(reply.id, session.data);
  };

  useEffect(() => {
    refreshList().catch((error) => console.error('Could not list the posts:', error));
  }, []);

  // The browser asks "Leave site?" while a change has not reached the disk yet. Until the stored view is back, unsaved
  // edits exist only in this page, so any of them counts.
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      const { waiting, inFlight, failed } = writing.current;
      const unstored = restoredRef.current ? waiting || inFlight || failed : [...opened.current.values()].some((entry) => entry.dirty);
      if (unstored) event.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  const entry = current === undefined ? undefined : opened.current.get(current);
  // A post's name for the writer: its title, or its id when the list does not hold it.
  const label = (id: string) => posts.find((post) => post.id === id)?.title ?? id;
  return {
    posts,
    // Open posts with unsaved changes the store no longer lists.
    missing: [...opened.current].flatMap(([name, entry]) => (entry.dirty && isGone(name) ? [name] : [])),
    label,
    current,
    doc: entry?.doc,
    dirty: entry?.dirty ?? false,
    // The file on show has unsaved changes, and its copy on disk changed.
    diskChanged: entry?.diskText !== undefined,
    // The post on show is the one the writer just made.
    justCreated: current !== undefined && current === created,
    // The post on show is not in the latest list, so its changes can only be copied or discarded.
    gone: current !== undefined && isGone(current),
    unsupported: unsupportedMarkdown(entry?.saved ?? ''),
    isDirty: (name: string) => opened.current.get(name)?.dirty ?? false,
    open,
    save,
    syncWithDisk,
    takeDiskVersion,
    keepMyVersion,
    createPost,
    rename,
    remove,
    discard,
    beginTurn,
    applyEdited,
    notApplied,
    dismissNotApplied: (name: string) => setNotApplied((before) => before.filter((n) => n.name !== name)),
    notUndone,
    dismissNotUndone: (name: string) => setNotUndone((before) => before.filter((n) => n.name !== name)),
    lastTurn,
    undoing,
    undoTurn,
    dismissReview,
    showHighlights,
    // The highlighted passages of the file on show.
    highlights: highlights && highlights.file === current ? highlights.passages : NO_PASSAGES,
    mode,
    setMode,
    finds,
    findInDocs: () => setFinds((n) => n + 1),
    newPosts,
    requestNewPost: () => setNewPosts((n) => n + 1),
    restore,
    // True once the stored view is back, or could not be loaded: until then, a reload may yet reopen a post.
    ready: restored || restoreError !== undefined,
    // The ids of the posts whose title or saved text holds `query`. Changes nothing here.
    search: async (query: string) => (await api<PostList>('GET', `/api/posts?q=${encodeURIComponent(query)}`)).posts.map((post) => post.id),
    applyTurn,
    applyProgress,
    applyPending,
    restoreFailed,
    restoreError,
    writeError,
  };
}

// Where a post's routes are. An id is opaque and may hold "/", so it travels encoded, as one path segment.
const postUrl = (id: string) => `/api/posts/${encodeURIComponent(id)}`;

// A post's text as the store holds it now. Rejects with the request's error, whose `status` is 404 for a missing post.
async function readFile(id: string): Promise<string> {
  return (await api<Post>('GET', postUrl(id))).body;
}

// A file with unsaved changes as it was before a reload, still unsaved. Its update is applied before anything listens,
// so bringing it back is not an edit.
function restoredEntry(stored: StoredDoc): Entry {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, decodeUpdate(stored.doc));
  return { doc, saved: stored.saved, loadBase: snapshotFromUpdate(decodeUpdate(stored.loadBase)), saves: 0, dirty: true };
}

export type Documents = ReturnType<typeof useDocuments>;

// `onAsk` is called with a highlighted passage's question when the writer clicks its label, and `onAskSelection`
// with the selection, as markdown, when they ask Claude about it. `onAnnounce` tells screen readers what Undo all did.
// `busy` says Claude is working, which pauses New post as it pauses the Posts list.
export function Editor({
  docs,
  onAsk,
  onAskSelection,
  onAnnounce,
  busy = false,
}: {
  docs: Documents;
  busy?: boolean;
  onAsk?: (passage: Passage & { label: string }) => void;
  onAskSelection?: (markdown: string) => void;
  onAnnounce?: (text: string) => void;
}) {
  // Why the last save failed, until a save succeeds.
  const [saveError, setSaveError] = useState<string>();
  const save = () => {
    const name = docs.label(docs.current ?? '');
    docs.save().then(
      () => setSaveError(undefined),
      (error: Error & { status?: number }) =>
        setSaveError(
          error.status === 404
            ? `Could not save “${name}”: ${sentence(error.message)} Copy your changes into another post.`
            : `Could not save “${name}”: ${error.message}`,
        ),
    );
  };
  // Why taking the disk version last failed, until it succeeds.
  const [diskError, setDiskError] = useState<string>();
  const takeDiskVersion = () => {
    const name = docs.current;
    docs.takeDiskVersion().then(
      () => setDiskError(undefined),
      (error: Error) => setDiskError(`Could not load the disk version of “${docs.label(name ?? '')}”: ${error.message}`),
    );
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docs.save]);

  const readOnly = docs.unsupported.length > 0;
  // The file name in the post header, where focus goes when the control that had it goes away.
  const nameButton = useRef<HTMLButtonElement>(null);
  // A post opened from the post table: its name takes focus once its bar shows, since the table has gone.
  const [focusName, setFocusName] = useState(false);
  useEffect(() => {
    if (!focusName || !nameButton.current) return;
    nameButton.current.focus();
    setFocusName(false);
  }, [focusName, docs.current]);
  // The reply Undo all would take back, while the file on show is one it edited.
  const turn = docs.current !== undefined && docs.lastTurn?.files.includes(docs.current) ? docs.lastTurn : undefined;
  // The writer pressed Undo all, and is being asked to confirm it.
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  // The writer pressed Discard on a post not in the list, and is being asked to confirm it.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  return (
    <section className="editor">
      <div className="editor-bar">
        {docs.current !== undefined && (
          <>
            {/* Shows the post on show in the post list. */}
            <button ref={nameButton} className="name" aria-label={`Show “${docs.label(docs.current)}” in the post list`} onClick={docs.findInDocs}>
              {docs.label(docs.current)}
            </button>
            <span className={`save-state ${docs.dirty ? 'unsaved' : ''}`}>{docs.dirty ? 'Unsaved' : 'Saved'}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <ViewSwitch mode={docs.mode} onMode={docs.setMode} readOnly={readOnly} />
        <button
          className={docs.dirty ? 'primary' : ''}
          disabled={!docs.dirty || readOnly || docs.gone}
          aria-keyshortcuts={keyShortcut('S')}
          onClick={save}
        >
          Save <span className="hint" aria-hidden="true">{shortcut('S')}</span>
        </button>
      </div>
      {docs.current === undefined && docs.ready && <PostTable docs={docs} busy={busy} onOpened={() => setFocusName(true)} />}
      {docs.gone && (
        <div className="notice">
          <InfoIcon />
          These unsaved changes belong to a post that isn't in your list, so they can't be saved here. To keep them, copy them
          into a post from the list. Then discard them.
          <button onClick={() => setConfirmingDiscard(true)}>Discard</button>
        </div>
      )}
      {!docs.gone && docs.diskChanged && (
        <div className="notice">
          <InfoIcon />
          This file changed on disk since you opened it. Save overwrites it.
          <button onClick={takeDiskVersion}>Use the disk version</button>
          <button
            onClick={() => {
              docs.keepMyVersion();
              nameButton.current?.focus();
            }}
          >
            Keep my version
          </button>
        </div>
      )}
      {diskError && (
        <div className="notice error" role="alert">
          <ErrorIcon />
          {diskError}
        </div>
      )}
      {saveError && (
        <div className="notice error" role="alert">
          <ErrorIcon />
          {saveError}
        </div>
      )}
      {docs.restoreError && (
        <div className="notice error" role="alert">
          <ErrorIcon />
          {docs.restoreError}
        </div>
      )}
      {docs.writeError && (
        <div className="notice error" role="alert">
          <ErrorIcon />
          {docs.writeError}
        </div>
      )}
      {docs.notApplied.map(({ name, message }) => (
        <div key={name} className="notice error" role="alert">
          <ErrorIcon />
          <span className="notice-text">
            Could not apply Claude's edit to “{docs.label(name)}”: {sentence(message)} Ask Claude again with the post open.
          </span>
          <button className="close" aria-label="Close error" title="Close" onClick={() => docs.dismissNotApplied(name)}>
            <CloseIcon />
          </button>
        </div>
      ))}
      {docs.notUndone.map(({ name, message }) => (
        <div key={name} className="notice error" role="alert">
          <ErrorIcon />
          <span className="notice-text">
            Could not undo Claude's edit to “{docs.label(name)}”: {message}
          </span>
          <button className="close" aria-label="Close error" title="Close" onClick={() => docs.dismissNotUndone(name)}>
            <CloseIcon />
          </button>
        </div>
      ))}
      {readOnly && (
        <div className="notice" id="read-only-notice">
          <InfoIcon />
          Read-only: this document has {docs.unsupported.join(' and ')}, which the editor can't keep yet. Saving would damage
          them, so editing is off for this file.
        </div>
      )}
      {docs.doc && (
        <MarkdownEditor
          key={docs.current}
          doc={docs.doc}
          autoFocus={docs.justCreated}
          readOnly={readOnly}
          highlights={docs.highlights}
          mode={docs.mode}
          onAsk={onAsk}
          onAskSelection={onAskSelection}
          review={{
            turn: turn && { files: turn.files.map(docs.label), pending: docs.undoing, onUndoAll: () => setConfirmingUndo(true) },
            onDismiss: () => {
              docs.dismissReview();
              nameButton.current?.focus();
            },
          }}
        />
      )}
      {confirmingUndo && turn && (
        <ConfirmDialog
          title="Undo Claude's changes?"
          body={undoWarning(turn.files.map(docs.label), turn.made.length > 0)}
          confirm="Undo changes"
          onConfirm={async () => {
            setConfirmingUndo(false);
            await docs.undoTurn();
            const changed = `Undid Claude's changes in ${turn.files.length} ${turn.files.length === 1 ? 'post' : 'posts'}.`;
            onAnnounce?.(turn.made.length ? `${changed} Posts it made are still in your list.` : changed);
            nameButton.current?.focus();
          }}
          onCancel={() => setConfirmingUndo(false)}
        />
      )}
      {confirmingDiscard && docs.current !== undefined && (
        <ConfirmDialog
          title="Discard these unsaved changes?"
          body="The text goes for good. Copy anything you want to keep first."
          confirm="Discard changes"
          onConfirm={() => {
            setConfirmingDiscard(false);
            docs.discard(docs.current!);
          }}
          onCancel={() => setConfirmingDiscard(false)}
        />
      )}
    </section>
  );
}

// What Undo all's confirmation warns about, for the posts it puts back, by name. Posts Claude made stay, empty.
function undoWarning(names: string[], made: boolean): string {
  const one = names.length === 1;
  const warning = `This puts ${names.join(', ')} back the way ${one ? 'it was' : 'they were'} when you pressed Send. Anything you typed in ${one ? 'it' : 'them'} since then goes too. You can't redo this.`;
  return made ? `${warning} Posts Claude made stay in your list, empty. Delete them from the list if you don't want them.` : warning;
}

// A message as a sentence that ends in one full stop, so a next step can follow it.
const sentence = (message: string) => (/[.!?]$/.test(message) ? message : `${message}.`);

// The switch between the formatted post and its markdown text. A read-only file always shows formatted, so there the
// switch is off, with Formatted pressed, and described by the notice that says why.
function ViewSwitch({ mode, onMode, readOnly }: { mode: EditorMode; onMode: (mode: EditorMode) => void; readOnly: boolean }) {
  const showing = readOnly ? 'rendered' : mode;
  return (
    <div className="view-switch" role="group" aria-label="View" aria-describedby={readOnly ? 'read-only-notice' : undefined}>
      {(['rendered', 'raw'] as const).map((option) => (
        <button key={option} type="button" aria-pressed={option === showing} disabled={readOnly} onClick={() => onMode(option)}>
          {option === 'rendered' ? 'Formatted' : 'Markdown'}
        </button>
      ))}
    </div>
  );
}
