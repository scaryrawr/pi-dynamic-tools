import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

/** Shared event-bus protocol; no dependency on a particular extension load order. */
export const COLLECT = "pi-dynamic-tools:collect";
export const REGISTER = "pi-dynamic-tools:register";

/** Published definition received by the dynamic-tools extension. */
export interface ToolRegistration<TParams extends TSchema = TSchema, TDetails = unknown, TState = unknown> {
  tool: ToolDefinition<TParams, TDetails, TState>;
}

/**
 * Offer a tool to search_tools instead of registering it directly with pi.
 *
 * Call once per definition in the providing extension's factory. The immediate
 * publication handles late additions; the collection listener handles cases
 * where the registry loads after this extension (and session replacement).
 * Keep the same definition object for the lifetime of this extension instance.
 * Pi does not support removing a registered tool without reloading.
 */
export function registerDynamicTool<TParams extends TSchema, TDetails = unknown, TState = unknown>(
  pi: Pick<ExtensionAPI, "events">,
  tool: ToolDefinition<TParams, TDetails, TState>,
): void {
  const publish = () => pi.events.emit(REGISTER, { tool } satisfies ToolRegistration<TParams, TDetails, TState>);
  pi.events.on(COLLECT, publish);
  publish();
}
