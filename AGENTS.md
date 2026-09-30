# pi-dynamic-tools

Validation: `npm run check` (typecheck + vitest) before committing. See README for design and setup.

## Testing invariants

- Tests must never read the developer's real agent directory. `extensions/config.ts` resolves `pi-dynamic-tools.json` through `getAgentDir()`, so a locally configured `semanticModel` (or any file under `~/.pi/agent/`) makes "missing configuration" tests fail intermittently.
- `extensions/dynamic-tools.test.ts` repoints `PI_CODING_AGENT_DIR` at a fresh temp dir in `beforeEach` and restores it in `afterEach`. Keep that isolation; any new test or helper that can reach `getAgentDir()` (directly or via `config.ts`) must run inside it.
