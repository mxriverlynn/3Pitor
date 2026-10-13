// The New chat picker: which provider, model, and thinking level the new chat uses. It opens on the saved selection,
// read from the server each time it opens.
import { useEffect, useId, useRef, useState } from 'react';
import type { ModelCatalog, ModelInfo, ModelSelection, ProviderId, ThinkingLevel } from '../../../shared/wire';
import { api } from '../../components/api';
import { ConfirmDialog } from '../../components/confirm-dialog/confirm-dialog';
import './model-picker.css';

// The level a newly chosen model keeps: the current one when it offers it, else medium, else its first, else none.
function levelFor(model: ModelInfo | undefined, current: ThinkingLevel | undefined): ThinkingLevel | undefined {
  const levels = model?.thinking ?? [];
  if (current && levels.includes(current)) return current;
  return levels.includes('medium') ? 'medium' : levels[0];
}

// A selection on `model`, with no thinking key at all when the model has no levels.
function selectionOf(provider: ProviderId, model: ModelInfo | undefined, current: ThinkingLevel | undefined): ModelSelection {
  const thinking = levelFor(model, current);
  return { provider, model: model?.id ?? '', ...(thinking && { thinking }) };
}

export function ModelPicker({
  opener,
  busy,
  confirmFirst,
  onStart,
  onClose,
}: {
  // The New chat button.
  opener: HTMLElement;
  // A turn is running.
  busy: boolean;
  // The chat holds something, so starting a new one asks first.
  confirmFirst: boolean;
  onStart: (selection: ModelSelection) => Promise<void>;
  onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [choice, setChoice] = useState<ModelSelection>();
  // Why the models could not load, or the last start failed.
  const [error, setError] = useState<string>();
  // The saved model, when the list no longer has it.
  const [missing, setMissing] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const provider = useRef<HTMLSelectElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  // Asking before the old chat ends.
  const [asking, setAsking] = useState(false);
  // A start is under way.
  const [starting, setStarting] = useState(false);
  const id = useId();

  useEffect(() => {
    api<ModelCatalog>('GET', '/api/models').then(
      (loaded) => {
        setCatalog(loaded);
        const { selected } = loaded;
        const models = loaded.providers.find((p) => p.id === selected.provider)?.models ?? [];
        if (models.length && !models.some((m) => m.id === selected.model)) {
          setMissing(selected.model);
          setChoice(selectionOf(selected.provider, models[0], selected.thinking));
        } else setChoice(selected);
      },
      (failure: Error) => setError(`Could not load the models: ${failure.message}`),
    );
  }, []);
  useEffect(() => {
    if (catalog) provider.current?.focus();
  }, [catalog]);
  // A press outside the picker and its button closes it. The question before the old chat ends sits inside it.
  useEffect(() => {
    const onPress = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!root.current?.contains(target) && !opener.contains(target)) onClose();
    };
    document.addEventListener('pointerdown', onPress);
    return () => document.removeEventListener('pointerdown', onPress);
  }, [opener, onClose]);

  // Starts the new chat on the choice, and closes once it has started.
  const start = async () => {
    setError(undefined);
    setStarting(true);
    try {
      await onStart(choice!);
    } catch (failure) {
      setError(`Could not start a new chat: ${(failure as Error).message}`);
      return;
    } finally {
      setStarting(false);
    }
    onClose();
  };

  const entry = catalog?.providers.find((p) => p.id === choice?.provider);
  const model = entry?.models.find((m) => m.id === choice?.model);

  // The Model list, and the Thinking list when the model has levels.
  const modelLists = (choice: ModelSelection) => (
    <>
      {missing && <p className="muted">Your saved model {missing} is not available.</p>}
      <label htmlFor={`${id}-model`}>Model</label>
      <select
        id={`${id}-model`}
        value={choice.model}
        onChange={(e) => setChoice(selectionOf(choice.provider, entry?.models.find((m) => m.id === e.target.value), choice.thinking))}
      >
        {entry?.models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      {model && model.thinking.length > 0 && (
        <>
          <label htmlFor={`${id}-thinking`}>Thinking</label>
          <select id={`${id}-thinking`} value={choice.thinking} onChange={(e) => setChoice({ ...choice, thinking: e.target.value as ThinkingLevel })}>
            {model.thinking.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </>
      )}
    </>
  );

  return (
    <div
      ref={root}
      className="model-picker"
      role="dialog"
      aria-label="New chat"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || asking) return;
        onClose();
        opener.focus();
      }}
    >
      {!catalog && !error && <p className="muted">Loading models…</p>}
      {catalog && choice && (
        <>
          <label htmlFor={`${id}-provider`}>Provider</label>
          <select
            id={`${id}-provider`}
            ref={provider}
            value={choice.provider}
            aria-describedby={entry?.problem ? `${id}-problem` : undefined}
            onChange={(e) => {
              const next = catalog.providers.find((p) => p.id === e.target.value)!;
              setChoice(selectionOf(next.id, next.models[0], choice.thinking));
            }}
          >
            {catalog.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.access === 'local' ? 'Local' : 'API'}){p.problem ? ', unavailable' : ''}
              </option>
            ))}
          </select>
          {entry?.problem ? (
            <p id={`${id}-problem`} className="problem">
              {entry.problem}
            </p>
          ) : entry?.models.length ? (
            modelLists(choice)
          ) : (
            <p className="muted">No models pulled in {entry?.label}</p>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        ref={startButton}
        className="primary"
        disabled={!catalog || !!entry?.problem || !entry?.models.length || busy || starting}
        onClick={() => (confirmFirst ? setAsking(true) : start())}
      >
        {starting ? 'Starting…' : 'Start'}
      </button>
      {asking && (
        <ConfirmDialog
          title="Start a new chat?"
          body="This ends the conversation for good and removes Claude's highlights and Undo all. Your posts stay as they are."
          confirm="New chat"
          onConfirm={() => {
            setAsking(false);
            start();
          }}
          onCancel={() => {
            setAsking(false);
            startButton.current!.focus();
          }}
        />
      )}
    </div>
  );
}
