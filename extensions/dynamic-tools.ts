import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { getSemanticModel, setSemanticModel } from "./config.ts";
import { SemanticModelSelector } from "./model-selector.ts";
import { COLLECT, REGISTER } from "./register.ts";
import { keywordSearch, semanticSearch, type SearchableTool } from "./search.ts";

export default function dynamicTools(pi: ExtensionAPI): void {
  const catalog = new Map<string, ToolDefinition>();
  let started = false;

  function install(tool: ToolDefinition): void {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(tool.name) || tool.name === "search_tools") {
      throw new Error(`Invalid dynamic tool name: ${tool.name}`);
    }
    if (catalog.has(tool.name)) {
      // Providers may publish eagerly and again when COLLECT is emitted.
      if (catalog.get(tool.name) === tool) return;
      throw new Error(`Duplicate dynamic tool: ${tool.name}`);
    }
    // The pi runtime is not bound during extension factories: getAllTools()
    // cannot be called until session_start, even for eager publications.
    if (started && pi.getAllTools().some((item) => item.name === tool.name)) {
      throw new Error(`Tool name already in use: ${tool.name}`);
    }
    catalog.set(tool.name, tool);
    if (started) {
      pi.registerTool(tool);
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== tool.name));
    }
  }

  pi.events.on(REGISTER, (data) => {
    if (!data || typeof data !== "object" || !("tool" in data)) return;
    const tool = data.tool as ToolDefinition;
    if (!tool || typeof tool.name !== "string" || typeof tool.description !== "string" ||
      typeof tool.execute !== "function" || !tool.parameters) return;
    try {
      install(tool);
    } catch (error) {
      console.error(`[pi-dynamic-tools] ${String(error)}`);
    }
  });

  pi.registerTool({
    name: "search_tools",
    label: "Search Tools",
    description: "Find and activate additional tools registered by other extensions. Use keyword (fast, local) or semantic (configured small model) search.",
    promptSnippet: "Search for additional tools not yet available in the active tool list",
    promptGuidelines: ["Use search_tools when you need a capability not currently available."],
    parameters: Type.Object({
      query: Type.String({ minLength: 1, description: "Task or capability to find" }),
      mode: Type.Optional(StringEnum(["keyword", "semantic"] as const, { description: "keyword (default) or semantic" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const tools: SearchableTool[] = [...catalog.values()].map(({ name, description }) => ({
        name,
        description,
      }));
      const limit = params.limit ?? 3;
      const result = params.mode === "semantic"
        ? await semanticSearch(params.query, tools, limit, getSemanticModel(), ctx, signal)
        : { names: keywordSearch(params.query, tools, limit), usage: undefined };
      const active = pi.getActiveTools();
      const added = result.names.filter((name) => !active.includes(name));
      if (added.length) pi.setActiveTools([...new Set([...active, ...added])]);
      return {
        content: [{
          type: "text",
          text: result.names.length
            ? `Matching tools: ${result.names.join(", ")}. ${added.length ? `Activated: ${added.join(", ")}.` : "Already active."}`
            : `No matching tools found for: ${params.query}`,
        }],
        details: { matches: result.names, added },
        ...(result.usage ? { usage: result.usage } : {}),
      };
    },
  });

  pi.registerCommand("search-tools-model", {
    description: "Choose the semantic search model (or use show/clear)",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === "show") {
        ctx.ui.notify(`Semantic search model: ${getSemanticModel() ?? "not configured"}`, "info");
        return;
      }
      if (action === "clear") {
        try {
          setSemanticModel(undefined);
          ctx.ui.notify("Semantic search model cleared", "info");
        } catch (error) {
          ctx.ui.notify(`Could not save semantic model: ${String(error)}`, "error");
        }
        return;
      }
      if (action) {
        ctx.ui.notify("Usage: /search-tools-model [show|clear]", "warning");
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/search-tools-model requires the interactive TUI; edit pi-dynamic-tools.json instead", "warning");
        return;
      }
      const models = ctx.modelRegistry.getAvailable();
      if (!models.length) {
        ctx.ui.notify("No authenticated models available. Use /login to configure a provider.", "warning");
        return;
      }
      const selected = await ctx.ui.custom<string | null>((tui, theme, keybindings, done) =>
        new SemanticModelSelector(
          tui, theme, keybindings, models, getSemanticModel(),
          (modelId) => done(modelId), () => done(null),
        ),
      );
      if (selected === null || selected === undefined) return; // Cancel without changing config.
      try {
        setSemanticModel(selected);
        ctx.ui.notify(`Semantic search model set to ${selected}`, "info");
      } catch (error) {
        ctx.ui.notify(`Could not save semantic model: ${String(error)}`, "error");
      }
    },
  });

  pi.on("session_start", () => {
    // All factories have run, regardless of package load order. Providers can
    // also emit REGISTER later (e.g. once a remote catalog has loaded).
    pi.events.emit(COLLECT, undefined);
    started = true;
    for (const tool of catalog.values()) {
      if (pi.getAllTools().some((item) => item.name === tool.name)) {
        console.error(`[pi-dynamic-tools] Tool name already in use: ${tool.name}`);
        catalog.delete(tool.name);
        continue;
      }
      pi.registerTool(tool);
    }
    const hidden = new Set(catalog.keys());
    pi.setActiveTools([
      ...new Set([...pi.getActiveTools().filter((name) => !hidden.has(name)), "search_tools"]),
    ]);
  });
}
