# pi-dynamic-tools

> **Retired for Pi 0.99.1+.** Pi provides a native deferred-tool catalog and
> built-in `tool_search` for on-demand discovery and activation. Remove this
> extension from Pi settings and enable `"defaultTools": ["+tool_search"]`.
> Replace `registerDynamicTool(pi, tool)` or event publication with
> `pi.registerTool({ ...tool, exposure: "deferred" })`; no registry dependency
> is needed. Use `pi.registerMcpServer()` and built-in MCP support for servers.
>
> Built-in search uses keyword ranking, not the optional small-model semantic
> mode. `pi-dynamic-tools.json` and `/search-tools-model` are no longer used;
> keep the old config only for rollback. The remainder documents the legacy
> extension, not built-in Pi support.

A pi package that gives extensions one shared `search_tools` tool. Contributing extensions publish tool definitions to a shared registry. The definitions are registered with pi but **inactive** until a search selects them; pi exposes the selected tool schemas to the model on its next request.

## Install

```sh
pi install git:github.com/scaryrawr/pi-dynamic-tools
# For local development:
pi -e ./extensions/dynamic-tools.ts -e ./my-provider.ts
```

Or include this package alongside provider extensions in pi settings. The registry uses pi's shared `pi.events` bus, not a module singleton, so independently installed packages can participate.

## Register tools from another extension

Add `pi-dynamic-tools` as a dependency of the providing extension so its public helper can be imported (the git-installed pi package alone is not a Node module dependency of other packages). For a git-based consumer, for example, use `npm install git+https://github.com/scaryrawr/pi-dynamic-tools.git` in the consumer's package. When publishing a pi package with this dependency, bundle it as required by pi's package rules. The helper only uses pi's shared event bus; importing it does **not** load a second registry.

```ts
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerDynamicTool } from "pi-dynamic-tools";

const lookupWeather = defineTool({
  name: "lookup_weather",
  label: "Lookup Weather",
  description: "Get current weather for a city",
  parameters: Type.Object({ city: Type.String() }),
  async execute(_id, { city }) {
    return { content: [{ type: "text", text: `Weather for ${city}` }], details: {} };
  },
});

export default function (pi: ExtensionAPI) {
  registerDynamicTool(pi, lookupWeather);

  // This also works later, for example after asynchronous discovery:
  // registerDynamicTool(pi, anotherTool);
}
```

`registerDynamicTool` publishes immediately and republishes the same definition whenever the registry collects tools at session start. This works regardless of extension load order, including `/reload` and session replacement. It accepts typed `defineTool()` definitions (including their renderers) and preserves their inferred parameter types. Call it once per tool per extension instance; do not also call `pi.registerTool()` for a managed tool.

Tools must have unique names (including across built-ins and other extensions). Duplicate publications of the *same definition object* are ignored; conflicting registrations are rejected and logged. The catalog is in memory per session and reconstructed at session start. Pi does not expose tool unregistration; stop publishing a tool and reload to remove it. For integrations that cannot depend on this package, the underlying `pi-dynamic-tools:collect` / `pi-dynamic-tools:register` event protocol remains available.

## Search

The agent calls `search_tools` with `{ "query": "weather in Paris", "mode": "keyword", "limit": 3 }`. `mode` defaults to `keyword` (local, deterministic, no model call). Keyword search ranks exact name/description phrases and word matches. Only matching registered tools become active; already-active tools are not re-added. The rest of the active tool set is preserved.

For reasoning over descriptions instead of lexical matching, choose a small, fast authenticated pi model in the interactive TUI:

```text
/search-tools-model         # fuzzy-search available models; Enter to save, Esc to cancel
/search-tools-model show    # show the saved choice
/search-tools-model clear   # remove the saved choice
```

The picker marks the current selection, filters by provider, ID or model name, and saves the choice across sessions. It does not change your main conversation model. For non-interactive use, or to configure manually, create `~/.pi/agent/pi-dynamic-tools.json` (or `$PI_CODING_AGENT_DIR/pi-dynamic-tools.json`):

```json
{ "semanticModel": "provider/model-id" }
```

The provider/model must be in pi's model registry and authenticated. The search call `{ "query": "check my tickets", "mode": "semantic" }` uses `ctx.modelRegistry.streamSimple()` with a *separate* structured tool-call request. The model selects tool names via `select_tools`; that synthetic tool is **not executed** or registered in the main session. Unknown names and duplicates are discarded; usage is attributed to the search tool result. Model/config errors are reported as tool errors rather than silently switching modes. Semantic mode accepts at most 50 tools and sends up to 300 characters of each description to bound the request size. Keyword mode has no model requirement.

`search_tools` does not search or change built-in tools or tools owned by other extensions. Searching adds matching tools to the active list for the current session; it does not automatically unload them later. pi's normal `--tools` / `--exclude-tools` policy still applies.

## Development

```sh
npm install
npm run check
```
