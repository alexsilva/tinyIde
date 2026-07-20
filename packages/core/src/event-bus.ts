import type { Disposable, EventBusApi, EventListener } from "@tinyide/plugin-api";

export class EventBus implements EventBusApi {
  readonly #listeners = new Map<string, Set<EventListener<unknown>>>();

  on<Payload>(event: string, listener: EventListener<Payload>): Disposable {
    const listeners = this.#listeners.get(event) ?? new Set<EventListener<unknown>>();
    const registeredListener = listener as EventListener<unknown>;

    listeners.add(registeredListener);
    this.#listeners.set(event, listeners);

    return {
      dispose: () => {
        listeners.delete(registeredListener);

        if (listeners.size === 0) {
          this.#listeners.delete(event);
        }
      },
    };
  }

  async emit<Payload>(event: string, payload: Payload): Promise<void> {
    const listeners = this.#listeners.get(event);

    if (!listeners) {
      return;
    }

    for (const listener of [...listeners]) {
      await listener(payload);
    }
  }
}
