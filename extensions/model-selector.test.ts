import type { Api, Model } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { SemanticModelSelector } from "./model-selector.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;
const keys = {
  matches(data: string, binding: string) {
    return ({ up: "tui.select.up", down: "tui.select.down", enter: "tui.select.confirm", esc: "tui.select.cancel" } as Record<string, string>)[data] === binding;
  },
} as KeybindingsManager;
const models = [
  { provider: "local", id: "small", name: "Small fast model" },
  { provider: "remote", id: "weather", name: "Weather model" },
] as Model<Api>[];

describe("semantic model picker", () => {
  it("marks the saved model and selects a fuzzy-filtered model", () => {
    const select = vi.fn();
    const cancel = vi.fn();
    const tui = { requestRender: vi.fn() } as unknown as TUI;
    const picker = new SemanticModelSelector(tui, theme, keys, models, "local/small", select, cancel);
    picker.focused = true;
    expect(picker.render(80).join("\n")).toContain("small [local] ✓");
    picker.handleInput("w");
    expect(picker.render(80).join("\n")).toContain("weather [remote]");
    picker.handleInput("enter");
    expect(select).toHaveBeenCalledWith("remote/weather");
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels without selecting", () => {
    const select = vi.fn();
    const cancel = vi.fn();
    const picker = new SemanticModelSelector(
      { requestRender: vi.fn() } as unknown as TUI, theme, keys, models, undefined, select, cancel,
    );
    picker.handleInput("esc");
    expect(cancel).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
  });
});
