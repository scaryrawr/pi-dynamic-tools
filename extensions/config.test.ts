import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getSemanticModel, setSemanticModel } from "./config.ts";

const dirs: string[] = [];
function path(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-dynamic-tools-"));
  dirs.push(dir);
  return join(dir, "pi-dynamic-tools.json");
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("semantic search model config", () => {
  it("saves, replaces and clears a model without discarding other settings", () => {
    const file = path();
    expect(getSemanticModel(file)).toBeUndefined();
    writeFileSync(file, JSON.stringify({ futureSetting: true, semanticModel: "old/id" }));
    setSemanticModel("local/small", file);
    expect(getSemanticModel(file)).toBe("local/small");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ futureSetting: true, semanticModel: "local/small" });
    setSemanticModel(undefined, file);
    expect(getSemanticModel(file)).toBeUndefined();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ futureSetting: true });
  });

  it("does not overwrite malformed configuration", () => {
    const file = path();
    writeFileSync(file, "bad json");
    expect(getSemanticModel(file)).toBeUndefined();
    expect(() => setSemanticModel("local/small", file)).toThrow();
    expect(readFileSync(file, "utf8")).toBe("bad json");
  });
});
