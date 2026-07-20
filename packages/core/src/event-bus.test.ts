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
});
