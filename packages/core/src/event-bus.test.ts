import { describe, expect, it, vi } from "vitest";

import { EventBus } from "./event-bus";

describe("EventBus", () => {
  it("delivers events to all listeners", async () => {
    const events = new EventBus();
    const first = vi.fn();
    const second = vi.fn();

    events.on("workspace.opened", first);
    events.on("workspace.opened", second);

    await events.emit("workspace.opened", { name: "tinyIde" });

    expect(first).toHaveBeenCalledWith({ name: "tinyIde" });
    expect(second).toHaveBeenCalledWith({ name: "tinyIde" });
  });

  it("stops delivering after disposal", async () => {
    const events = new EventBus();
    const listener = vi.fn();
    const registration = events.on("sample.event", listener);

    registration.dispose();
    await events.emit("sample.event", undefined);

    expect(listener).not.toHaveBeenCalled();
  });

  it("awaits listeners sequentially and preserves the emission snapshot", async () => {
    const events = new EventBus();
    const order: string[] = [];
    let secondRegistration: { dispose(): void };
    events.on("sample", async () => {
      order.push("first:start");
      secondRegistration.dispose();
      await Promise.resolve();
      order.push("first:end");
    });
    secondRegistration = events.on("sample", () => {
      order.push("second");
    });

    await events.emit("sample", undefined);
    expect(order).toEqual(["first:start", "first:end", "second"]);
    await events.emit("missing", undefined);
  });
});
