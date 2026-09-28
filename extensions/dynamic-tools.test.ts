import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { registerDynamicTool } from "pi-dynamic-tools";

import dynamicTools from "./dynamic-tools.ts";
import { REGISTER } from "./register.ts";
import { keywordSearch, semanticSearch } from "./search.ts";

function harness({ deferRegistry = false } = {}) {
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  const tools = new Map<string, ToolDefinition>();
  const commands = new Map<string, (args: string, ctx: ExtensionCommandContext) => Promise<void> | void>();
  let active = ["read"];
  let initialized = false;
  let start: (() => void) | undefined;
  const emit = (channel: string, data: unknown) => {
    for (const listener of listeners.get(channel) ?? []) listener(data);
  };
  const pi = {
    events: {
      on(channel: string, listener: (data: unknown) => void) {
        listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
        return () => {};
      },
      emit,
    },
    registerCommand(name: string, options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void }) {
      commands.set(name, options.handler);
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
      active.push(tool.name); // pi activates freshly registered tools by default
    },
    getAllTools: () => {
      if (!initialized) throw new Error("pi runtime not bound yet");
      return [...tools.values()];
    },
    getActiveTools: () => [...active],
    setActiveTools(names: string[]) { active = names; },
    on(event: string, handler: () => void) {
      if (event === "session_start") start = handler;
      return () => {};
    },
  };
  const extensionPi = pi as unknown as ExtensionAPI;
  if (!deferRegistry) dynamicTools(extensionPi);
  const makeTool = (name: string, description: string) =>
    defineTool({
      name,
      label: name,
      description,
      parameters: Type.Object({ city: Type.String() }),
      async execute(_id, params) {
        return { content: [{ type: "text", text: params.city }], details: {} };
      },
    });
  async function search(query: string, mode?: string) {
    const tool = tools.get("search_tools");
    if (!tool) throw new Error("search_tools not registered");
    const ctx = { modelRegistry: {} } as ExtensionContext;
    return tool.execute("id", { query, mode }, undefined, undefined, ctx);
  }
  return {
    emit,
    extensionPi,
    loadRegistry: () => dynamicTools(extensionPi),
    start: () => { initialized = true; start?.(); },
    makeTool,
    tools,
    commands,
    search,
    getActive: () => active,
  };
}

describe("dynamic tool discovery", () => {
  it("collects tools regardless of load order and keeps them hidden until searched", async () => {
    const h = harness();
    const weather = h.makeTool("lookup_weather", "Find current weather in a city");
    registerDynamicTool(h.extensionPi, weather); // eager registration before runtime binding
    h.start(); // the helper publishes the same definition again on collection
    expect(h.getActive()).toEqual(["read", "search_tools"]);
    const result = await h.search("weather");
    expect(result.details).toEqual({ matches: ["lookup_weather"], added: ["lookup_weather"] });
    expect(h.getActive()).toEqual(["read", "search_tools", "lookup_weather"]);
    expect((await h.search("weather")).details).toEqual({ matches: ["lookup_weather"], added: [] });
  });

  it("accepts a tool definition directly with inferred argument types", async () => {
    const h = harness();
    registerDynamicTool(h.extensionPi, {
      name: "echo_city",
      label: "Echo City",
      description: "Echo a city name",
      parameters: Type.Object({ city: Type.String() }),
      async execute(_id, params) {
        return { content: [{ type: "text", text: params.city.toUpperCase() }], details: {} };
      },
    });
    h.start();
    expect((await h.search("echo city")).details).toEqual({
      matches: ["echo_city"],
      added: ["echo_city"],
    });
  });

  it("replays a provider's definition when the registry loads after it", async () => {
    const h = harness({ deferRegistry: true });
    registerDynamicTool(h.extensionPi, h.makeTool("lookup_weather", "Find weather"));
    h.loadRegistry();
    h.start();
    expect(h.getActive()).toEqual(["read", "search_tools"]);
    expect((await h.search("weather")).details).toEqual({
      matches: ["lookup_weather"],
      added: ["lookup_weather"],
    });
  });

  it("supports late providers, preserves unrelated active tools, and rejects name collisions", async () => {
    const h = harness();
    h.start();
    registerDynamicTool(h.extensionPi, h.makeTool("issue_lookup", "Look up project issues"));
    expect(h.getActive()).toEqual(["read", "search_tools"]);
    expect((await h.search("issues")).details).toEqual({ matches: ["issue_lookup"], added: ["issue_lookup"] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    h.emit(REGISTER, { tool: h.makeTool("issue_lookup", "A different tool") });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
    expect(h.tools.size).toBe(2);
  });

  it("reports missing semantic configuration rather than silently guessing", async () => {
    const h = harness();
    h.start();
    await expect(h.search("find issues", "semantic")).rejects.toThrow("semanticModel");
  });
});

describe("semantic model command", () => {
  it("saves the selected model, leaves config unchanged on cancel, and can clear it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-dynamic-tools-command-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    try {
      const h = harness();
      const command = h.commands.get("search-tools-model");
      expect(command).toBeDefined();
      const custom = vi.fn(async () => "local/small");
      const notify = vi.fn();
      const ctx = {
        mode: "tui",
        modelRegistry: { getAvailable: () => [{ provider: "local", id: "small", name: "Small" }] },
        ui: { custom, notify },
      } as unknown as ExtensionCommandContext;
      await command?.("", ctx);
      const file = join(dir, "pi-dynamic-tools.json");
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ semanticModel: "local/small" });
      custom.mockResolvedValueOnce(null as unknown as string);
      await command?.("", ctx);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ semanticModel: "local/small" });
      await command?.("clear", ctx);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({});
      expect(notify).toHaveBeenCalledWith("Semantic search model cleared", "info");
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not open an interactive picker in RPC or print mode", async () => {
    const h = harness();
    const custom = vi.fn();
    const notify = vi.fn();
    const ctx = { mode: "rpc", ui: { custom, notify } } as unknown as ExtensionCommandContext;
    await h.commands.get("search-tools-model")?.("", ctx);
    expect(custom).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("interactive TUI"), "warning");
  });
});

describe("search ranking", () => {
  it("prioritizes name matches, filters no matches and respects the limit", () => {
    const tools = [
      { name: "find_issue", description: "Find project tickets" },
      { name: "lookup_ticket", description: "Find issue details" },
      { name: "weather", description: "Get the forecast" },
    ];
    expect(keywordSearch("issue", tools, 2)).toEqual(["find_issue", "lookup_ticket"]);
    expect(keywordSearch("weather", tools, 1)).toEqual(["weather"]);
    expect(keywordSearch("unknown", tools, 3)).toEqual([]);
  });

  it("accepts only known names from structured model output", async () => {
    const streamSimple = vi.fn((_model: unknown, _context: unknown) => ({
      result: async () => ({
        stopReason: "stop",
        content: [{ type: "toolCall", name: "select_tools", arguments: { names: ["weather", "invented", "weather"] } }],
        usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      }),
    }));
    const ctx = {
      modelRegistry: { find: () => ({ id: "small" }), streamSimple },
    } as unknown as ExtensionContext;
    const result = await semanticSearch("forecast", [{ name: "weather", description: "forecast" }], 3, "local/small", ctx, undefined);
    expect(result.names).toEqual(["weather"]);
    expect(streamSimple).toHaveBeenCalledOnce();
    expect(streamSimple.mock.calls[0]?.[1]).toMatchObject({ tools: [{ name: "select_tools" }] });
  });
});
