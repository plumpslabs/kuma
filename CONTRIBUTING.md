# Contributing to Kuma

Thank you for considering contributing to Kuma! This guide will help you understand the project structure, development workflow, and quality standards.

## Table of Contents

- [Quick Start](#quick-start)
- [Development Philosophy](#development-philosophy)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing Patterns](#testing-patterns)
- [Code Quality Standards](#code-quality-standards)
- [Pull Request Process](#pull-request-process)
- [Commit Conventions](#commit-conventions)

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/farhank15/kuma.git
cd kuma
npm install

# Build
npm run build

# Run all tests
npm test

# TypeScript type checking
npm run typecheck

# Watch mode during development
npm run dev
```

### Useful Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build with tsup (ESM only) |
| `npm run dev` | Watch mode with auto-rebuild |
| `npm test` | Run all Jest tests |
| `npm run typecheck` | Full TypeScript type checking |
| `npx jest --verbose` | Run tests with detailed output |
| `npx jest tests/smartGrep.test.ts` | Run a single test file |

---

## Development Philosophy

Kuma is built on five core principles. Every contribution should align with these:

### 1. Zero Setup, Zero Friction

A tool should work immediately after install. No config files, no database setup, no API keys.

- ❌ Adding a feature that requires `process.env.API_KEY` or a config file
- ❌ Adding a runtime dependency that requires native build steps
- ✅ Using Node.js built-in modules (`fs`, `path`, `child_process`) when possible
- ✅ Fallback behavior when optional dependencies are missing

### 2. Safety First, Always

Every tool must have guardrails. If something can fail, it should fail gracefully.

- Every tool should validate inputs before acting
- File operations must use `validateFilePath()` to prevent path traversal
- External commands must use `safeTerminalExec.ts` patterns (timeout, circuit breaker)
- Edits must auto-backup before modifying files

### 3. Graceful Degradation, Not Crash

When a dependency is missing, fall back instead of failing.

- LSP unavailable? → Regex fallback
- File not found? → Show where we looked (CWD, project root)
- Diff mismatch? → Retry with whitespace normalization → fuzzy match
- Test times out? → Circuit breaker stops the loop

### 4. Practical Over Complex

Solve 80% of problems with 20% of effort. Don't over-engineer.

- Prefer simple keyword search over vector embeddings
- Prefer JSON files over databases
- Prefer regex over AST parsers
- Prefer sync file operations over complex async streams

### 5. One Job Per Tool

Each tool should have a single clear purpose. No overlap, no confusion.

- A tool should not do two unrelated things
- If a tool needs two modes, consider splitting it
- Tool descriptions should be one sentence that describes exactly one function

---

## Project Structure

```
src/
├── index.ts                      # MCP server entry point
├── manifest.ts                   # Tool registration (16 tools)
├── agents/
│   ├── codeReviewer.ts           # Pattern-based code review
│   └── projectConventions.ts     # Project auto-detection
├── engine/
│   ├── lspClient.ts              # TypeScript Language Server client
│   ├── orchestrator.ts           # Multi-agent parallel execution
│   ├── sessionMemory.ts          # Session state + persistence
│   └── types.ts                  # Core type definitions
├── tools/
│   ├── batchFileWriter.ts        # Batch file creation (max 15)
│   ├── gitDiff.ts                # Structured git diff output
│   ├── gitLog.ts                 # Git commit history
│   ├── kumaReflect.ts            # Session reflection/drift detection
│   ├── lspTools.ts               # LSP query tools with fallback
│   ├── preciseDiffEditor.ts      # Search-and-replace with fuzzy fallback
│   ├── projectStructure.ts       # Directory tree viewer
│   ├── safeTerminalExec.ts       # Sandboxed command execution
│   ├── smartFilePicker.ts        # Smart file reader with chunking
│   ├── smartGrep.ts              # Regex search with context
│   └── staticAnalysis.ts         # Linter/checker passthrough
└── utils/
    ├── conventionsDetector.ts    # Framework/package detection
    ├── errorHandler.ts           # Error classification + circuit breaker
    ├── pathValidator.ts          # Path sandboxing + backups
    └── tokenCounter.ts           # Token estimation utilities
tests/                            # Jest test files (mirror src/)
```

### Adding a New Tool

1. Create the handler in `src/tools/<toolName>.ts`
2. Export a handler function following the existing pattern
3. Register the tool in `src/manifest.ts` using `server.tool()`
4. Create tests in `tests/<toolName>.test.ts`
5. Update README.md with the new tool

---

## Development Workflow

### 1. Understand First, Code Second

Before making changes:
- Read the relevant source files
- Read the existing tests
- Understand how similar features are implemented
- Search for existing patterns (e.g., `code_searcher`)

### 2. Implement with Minimal Changes

- Make only the changes needed — no scope creep
- Reuse existing utilities (`pathValidator`, `sessionMemory`, `circuitBreaker`)
- Follow the same error handling patterns as existing tools

### 3. Test Everything

- Every new tool needs tests
- Every bug fix needs a regression test
- Every edge case matters: empty state, error state, boundary conditions

### 4. Verify Before Asking for Review

```bash
npm run typecheck   # Must pass with zero errors
npm test            # All tests must pass
```

---

## Testing Patterns

Kuma uses **Jest** with ESM support via `ts-jest`. All test files are in `tests/`.

### Mocking Strategies

**Mock `execSync` (for git tools, terminal commands):**

```typescript
import child_process from "node:child_process";

// Mock execSync to return controlled output
jest.spyOn(child_process, "execSync").mockReturnValue("mock output");

// Mock for error case
jest.spyOn(child_process, "execSync").mockImplementation(() => {
  throw new Error("Command failed");
});
```

**Mock `spawn` (for terminal execution, linters):**

```typescript
import { EventEmitter } from "node:events";
import * as child_process from "node:child_process";

jest.spyOn(child_process, "spawn").mockImplementation(() => {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter() as any;
  proc.stderr = new EventEmitter() as any;
  proc.pid = 12345;
  proc.stdout.on = proc.stdout.on.bind(proc.stdout);

  // Emit data after initialization
  setImmediate(() => {
    proc.stdout.emit("data", Buffer.from("output data"));
    proc.emit("close", 0);
  });

  return proc;
});
```

**Create temporary directories and files:**

```typescript
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-test-"));
const testDir = path.join(tmpDir, "test-project");
fs.mkdirSync(testDir, { recursive: true });
fs.writeFileSync(path.join(testDir, "index.ts"), "const x = 1;");

// Cleanup
afterAll(() => fs.rmSync(tmpDir, { recursive: true }));
```

**Mock `fs` module (for session memory, file operations):**

```typescript
import fs from "node:fs";

// Mock file existence
jest.spyOn(fs, "existsSync").mockReturnValue(true);
jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ key: "value" }));
jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
```

### Test Structure Guidelines

- One `describe` block per tool/function
- Test names should be descriptive: `"returns error when file not found"`, `"parses ESLint output correctly"`
- Cover: happy path, empty state, error state, edge cases
- Assert on output strings when testing formatted output
- Assert on data structures when testing internal functions

### Example Test Patterns

**Testing error handling:**
```typescript
test("handles execution errors gracefully", async () => {
  const result = await handleSomeTool({ param: "value" });
  expect(result).toContain("Error");
  expect(result).not.toContain("undefined");
});
```

**Testing output structure:**
```typescript
test("returns structured output", async () => {
  const result = await handleSomeTool({ param: "value" });
  expect(result).toContain("Summary:");
  expect(result).toContain("✅");
});
```

---

## Code Quality Standards

### TypeScript

- **Strict mode** enabled in `tsconfig.json` — no `any` types
- Use `as const` for literal types and enums
- Prefer `interface` over `type` for object shapes
- Import file extensions: use `.js` extension (ESM convention: `from "./foo.js"`)
- No `require()` — use ESM `import` syntax

### Error Handling

Every tool handler must follow this pattern:

```typescript
async (params) => {
  try {
    const result = await handleFunction(params);
    return { content: [{ type: "text", text: result }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err}` }], isError: true };
  }
}
```

### Path Safety

All file operations must use `validateFilePath()`:

```typescript
import { validateFilePath } from "../utils/pathValidator.js";

const validation = validateFilePath(filePath);
if (!validation.valid) {
  return `Error: ${validation.error.message}`;
}
```

### Session Memory Recording

Every tool call should be recorded:

```typescript
import { sessionMemory } from "../engine/sessionMemory.js";

sessionMemory.recordToolCall("tool_name", { param1: "value" });
```

---

## Pull Request Process

1. **Fork the repo** and create your branch from `main`
2. **Run tests** before submitting: `npm run typecheck && npm test`
3. **Keep PRs focused** — one feature/fix per PR
4. **Write descriptive PR titles** following conventional commits (see below)
5. **Include test coverage** for your changes
6. **Update README.md** if adding/changing tools
7. **Wait for review** — maintainers may request changes

### PR Checklist

Before submitting:

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (all existing + new tests)
- [ ] New tests cover success, error, and edge cases
- [ ] Dependencies are kept minimal — no unnecessary additions
- [ ] README updated if tool descriptions changed
- [ ] No console.log or debug code left behind

### What Gets Rejected

- PRs that add dependencies without justification
- PRs that use `any` types
- PRs that break existing tests
- PRs with unrelated changes (scope creep)
- PRs that introduce configuration files or API keys

---

## Commit Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

[optional body]
```

### Types

| Type | Usage |
|------|-------|
| `feat` | New tool or feature |
| `fix` | Bug fix |
| `test` | Adding or updating tests |
| `docs` | Documentation changes |
| `refactor` | Code restructuring |
| `chore` | Build, dependencies, tooling |
| `perf` | Performance improvement |

### Examples

```
feat: add project_structure tool with depth control
fix: handle Windows paths in ESLint output parser
test: add tests for search_session_memory edge cases
docs: update README with new tool descriptions
refactor: extract normalizeLines into shared utility
chore: remove unused ts-node dependency
```

---

## First-Time Contributors

Good issues for newcomers are tagged with `good first issue` in the GitHub repository.

If you're unsure about anything, open an issue to discuss before coding. This saves everyone time and ensures your contribution aligns with the project's direction.

**Thank you for helping make Kuma better!** 🐻
