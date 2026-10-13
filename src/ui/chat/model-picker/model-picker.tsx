// The New chat picker: which provider, model, and thinking level the new chat uses. It opens on the saved selection,
// read from the server each time it opens.
import { useEffect, useId, useRef, useState } from 'react';
import type { ModelCatalog, ModelInfo, ModelSelection, ProviderId, ThinkingLevel } from '../../../shared/wire';
import { api } from '../../components/api';
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
  opener: _opener,
  busy: _busy,
  confirmFirst: _confirmFirst,
  onStart: _onStart,
  onClose: _onClose,
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
  const provider = useRef<HTMLSelectElement>(null);
  const id = useId();

  useEffect(() => {
    api<ModelCatalog>('GET', '/api/models').then((loaded) => {
      setCatalog(loaded);
      setChoice(loaded.selected);
    });
  }, []);
  useEffect(() => {
    if (catalog) provider.current?.focus();
  }, [catalog]);

  const entry = catalog?.providers.find((p) => p.id === choice?.provider);
  const model = entry?.models.find((m) => m.id === choice?.model);
  return (
    <div className="model-picker" role="dialog" aria-label="New chat">
      {catalog && choice && (
        <>
          <label htmlFor={`${id}-provider`}>Provider</label>
          <select
            id={`${id}-provider`}
            ref={provider}
            value={choice.provider}
            onChange={(e) => {
              const next = catalog.providers.find((p) => p.id === e.target.value)!;
              setChoice(selectionOf(next.id, next.models[0], choice.thinking));
            }}
          >
            {catalog.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.access === 'local' ? 'Local' : 'API'})
              </option>
            ))}
          </select>
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
      )}
    </div>
  );
}
