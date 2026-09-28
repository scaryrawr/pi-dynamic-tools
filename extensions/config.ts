import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

export function configPath(): string {
  return join(getAgentDir(), "pi-dynamic-tools.json");
}

function readConfig(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid pi-dynamic-tools config: ${path} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function getSemanticModel(path = configPath()): string | undefined {
  try {
    const model = readConfig(path).semanticModel;
    return typeof model === "string" && model.length > 0 ? model : undefined;
  } catch {
    // A missing or malformed config must not prevent keyword search.
    return undefined;
  }
}

/** Save only our setting, keeping any other configuration fields intact. */
export function setSemanticModel(model: string | undefined, path = configPath()): void {
  const config = existsSync(path) ? readConfig(path) : {};
  if (model) config.semanticModel = model;
  else delete config.semanticModel;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
