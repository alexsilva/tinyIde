import type { CommandHandler, CommandRegistryApi, Disposable } from "@tinyide/plugin-api";

export class CommandRegistry implements CommandRegistryApi {
  readonly #handlers = new Map<string, CommandHandler>();

  register<Arguments extends unknown[], Result>(
    id: string,
    handler: CommandHandler<Arguments, Result>,
  ): Disposable {
    const commandId = id.trim();

    if (!commandId) {
      throw new Error("Command id cannot be empty.");
    }

    if (this.#handlers.has(commandId)) {
      throw new Error(`Command already registered: ${commandId}`);
    }

    const registeredHandler = handler as CommandHandler;
    this.#handlers.set(commandId, registeredHandler);

    return {
      dispose: () => {
        if (this.#handlers.get(commandId) === registeredHandler) {
          this.#handlers.delete(commandId);
        }
      },
    };
  }

  async execute<Result = unknown>(id: string, ...args: unknown[]): Promise<Result> {
    const handler = this.#handlers.get(id);

    if (!handler) {
      throw new Error(`Unknown command: ${id}`);
    }

    return (await handler(...args)) as Result;
  }

  has(id: string): boolean {
    return this.#handlers.has(id);
  }

  list(): readonly string[] {
    return [...this.#handlers.keys()].sort();
  }
}
