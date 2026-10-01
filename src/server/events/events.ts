// In-process event bus: sessions and the workspace watcher publish here; the event socket and scripts listen.
import type { HostEvent } from '../../shared/wire';

export type Listener = (event: HostEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: HostEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
