import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Tool handlers
import { handleSmartGrep } from "./tools/smartGrep.js";
import { handleSmartFilePicker } from "./tools/smartFilePicker.js";
import { handlePreciseDiffEditor, handleRollbackEdit } from "./tools/preciseDiffEditor.js";
import { handleBatchFileWriter } from "./tools/batchFileWriter.js";
import { handleSafeTerminalExec } from "./tools/safeTerminalExec.js";
import { handleCodeReviewer } from "./agents/codeReviewer.js";
import { handleProjectConventions } from "./agents/projectConventions.js";

// Engine
import { injectMandates } from "./engine/mandateInjector.js";
import { getSessionMemory } from "./engine/sessionMemory.js";

// LSP Tools
import {
  handleFindReferences,
  handleGoToDefinition,
  handleRenameSymbol,
  handleGetTypeInfo,
} from "./tools/lspTools.js";

// ============================================================
// MANIFEST — MCP Tool Registry
// ============================================================

export function registerAllTools(server: McpServer): void {
  // ============================================================
  // 1. initialize_session_rules
  // ============================================================
  server.tool(
    "initialize_session_rules",
    "Forces AI to load minimalist coding rules (Ponytail + Caveman doctrine)",
    {},
    async () => {
      try {
        const result = await injectMandates();
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error injecting mandates: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 2. smart_grep
  // ============================================================
  server.tool(
    "smart_grep",
    "Acts as the AI's 'eyes' to locate functions or specific text in the project. Output limited: filename, line number, 3 lines of context.",
    {
      query: z.string().min(1).describe("Regex pattern to search for"),
      targetFolder: z.string().optional().describe("Target folder (default: project root, max depth 3)"),
      maxResults: z.number().min(1).max(100).optional().default(30).describe("Max results to return"),
    },
    async (params) => {
      try {
        const result = await handleSmartGrep(params);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in smart_grep: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 3. smart_file_picker
  // ============================================================
  server.tool(
    "smart_file_picker",
    "Opens a specific file without exhausting token budget. Supports chunking for files >300 lines and smart mode (signatures only).",
    {
      filePath: z.string().min(1).describe("Path to the file to read"),
      startLine: z.number().min(1).optional().describe("Start line (1-indexed)"),
      endLine: z.number().min(1).optional().describe("End line (1-indexed)"),
      chunkStrategy: z.enum(["full", "smart", "outline"]).optional().default("smart").describe("Read strategy: full=entire file, smart=signatures+imports, outline=exported symbols only"),
    },
    async (params) => {
      try {
        const result = await handleSmartFilePicker(params);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in smart_file_picker: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 4. precise_diff_editor
  // ============================================================
  server.tool(
    "precise_diff_editor",
    "Modifies file contents precisely using Search-and-Replace. Supports fuzzy fallback if exact match fails. Automatic backup before editing.",
    {
      filePath: z.string().min(1).describe("Path to the file to edit"),
      edits: z.array(z.object({
        searchBlock: z.string().min(1).describe("Code block to replace (MUST be exact or fuzzy match)"),
        replaceBlock: z.string().describe("Replacement code block"),
        allowMultiple: z.boolean().optional().default(false).describe("Allow multiple replacements"),
        fuzzyThreshold: z.number().min(0).max(1).optional().default(0.85).describe("Fuzzy match threshold (0.0-1.0)"),
      })).min(1).max(10).describe("Array of edits (max 10)"),
      dryRun: z.boolean().optional().default(false).describe("Preview changes without writing to disk (returns diff preview)"),
    },
    async (params) => {
      try {
        const result = await handlePreciseDiffEditor(params);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in precise_diff_editor: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 4b. rollback_last_edit
  // ============================================================
  server.tool(
    "rollback_last_edit",
    "Rolls back the last edit of a file by restoring it from the most recent backup in .agent-backups.",
    {
      filePath: z.string().min(1).describe("Path to the file to rollback"),
    },
    async (params) => {
      try {
        const result = await handleRollbackEdit(params);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in rollback_last_edit: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 5. batch_file_writer
  // ============================================================
  server.tool(
    "batch_file_writer",
    "Creates new files in batch. Safe with path validation and extension whitelist.",
    {
      files: z.array(z.object({
        filePath: z.string().min(1).describe("File path to create"),
        content: z.string().describe("File content"),
        instructions: z.string().min(1).describe("Reason for creating the file"),
      })).min(1).max(5).describe("Array of files to create (max 5)"),
    },
    async (params) => {
      try {
        const result = await handleBatchFileWriter(params);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in batch_file_writer: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 6. execute_safe_test
  // ============================================================
  server.tool(
    "execute_safe_test",
    "Executes terminal commands with timeout protection, circuit breaker, and command whitelist.",
    {
      task: z.enum(["test", "build", "lint", "typecheck", "custom"]).describe("Task to execute"),
      customCommand: z.string().optional().describe("Custom command (only if task='custom')"),
      timeout: z.number().min(5).max(180).optional().default(60).describe("Timeout in seconds (default: 60s, max: 180s)"),
    },
    async (params) => {
      try {
        const result = await handleSafeTerminalExec(params);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in execute_safe_test: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 7. code_reviewer
  // ============================================================
  server.tool(
    "code_reviewer",
    "Specialized agent for reviewing modified code. Separation of concerns: reviewer is NOT the same AI that wrote the code.",
    {
      files: z.array(z.string().min(1)).max(10).optional().describe("Files to review (if omitted/empty, auto-detects changed files via git diff)"),
      focus: z.enum(["correctness", "conventions", "security", "performance"]).optional().default("correctness").describe("Review focus"),
      customCriteria: z.string().optional().describe("Custom review criteria/rules to check (e.g. 'Ensure all API endpoints follow RESTful standards')"),
    },
    async (params) => {
      try {
        const result = await handleCodeReviewer(params);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in code_reviewer: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 8. project_conventions
  // ============================================================
  server.tool(
    "project_conventions",
    "Automatically detects project conventions: framework, test runner, styling, import alias, etc.",
    {
      forceRescan: z.boolean().optional().default(false).describe("Force rescan (ignore cache)"),
    },
    async (params) => {
      try {
        const result = await handleProjectConventions(params);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in project_conventions: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 9. get_session_memory
  // ============================================================
  server.tool(
    "get_session_memory",
    "AI's notebook to prevent amnesia during coding sessions. Tracks modified files, failures, and component dependencies.",
    {},
    async () => {
      try {
        const memory = getSessionMemory();
        return {
          content: [{ type: "text", text: JSON.stringify(memory, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error getting session memory: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 10. context_pruner_advice
  // ============================================================
  server.tool(
    "context_pruner_advice",
    "Provides context pruning suggestions when token usage is nearing the limit.",
    {},
    async () => {
      try {
        const { getPrunerAdvice } = await import("./engine/contextPruner.js");
        const advice = getPrunerAdvice();
        return {
          content: [{ type: "text", text: advice }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in context_pruner_advice: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 10b. context_prune_execute
  // ============================================================
  server.tool(
    "context_prune_execute",
    "Clears the session search history and trims tool call records in session memory to save context window tokens.",
    {},
    async () => {
      try {
        const { handleContextPrunerExecute } = await import("./engine/contextPruner.js");
        const result = handleContextPrunerExecute();
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in context_prune_execute: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 11. find_references
  // ============================================================
  server.tool(
    "find_references",
    "Finds all semantic references to a symbol (variable, function, class, interface, etc.) across the entire project. Uses TypeScript Language Server for accurate results - unlike smart_grep which only does text matching.",
    {
      filePath: z.string().min(1).describe("Path to the file containing the symbol"),
      line: z.number().min(0).describe("Line number (0-indexed)"),
      character: z.number().min(0).describe("Character position (0-indexed)"),
    },
    async (params) => {
      try {
        const result = await handleFindReferences(params);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in find_references: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 12. go_to_definition
  // ============================================================
  server.tool(
    "go_to_definition",
    "Navigate to the definition of a symbol at a given position. Returns file path, line number, and surrounding context.",
    {
      filePath: z.string().min(1).describe("Path to the file containing the symbol"),
      line: z.number().min(0).describe("Line number (0-indexed)"),
      character: z.number().min(0).describe("Character position (0-indexed)"),
    },
    async (params) => {
      try {
        const result = await handleGoToDefinition(params);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in go_to_definition: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 13. rename_symbol
  // ============================================================
  server.tool(
    "rename_symbol",
    "Renames a symbol across all files in the project (global rename). Uses TypeScript Language Server to find and update all references. Applied changes are written directly to files. Use dryRun: false on precise_diff_editor if you want preview first.",
    {
      filePath: z.string().min(1).describe("Path to the file containing the symbol to rename"),
      line: z.number().min(0).describe("Line number (0-indexed) where the symbol is"),
      character: z.number().min(0).describe("Character position (0-indexed) where the symbol is"),
      newName: z.string().min(1).describe("New name for the symbol"),
    },
    async (params) => {
      try {
        const result = await handleRenameSymbol(params);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in rename_symbol: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // 14. get_type_info
  // ============================================================
  server.tool(
    "get_type_info",
    "Returns TypeScript type information for a symbol at a given position. Shows inferred types, interface shapes, and type definitions (like hover in IDE).",
    {
      filePath: z.string().min(1).describe("Path to the file"),
      line: z.number().min(0).describe("Line number (0-indexed)"),
      character: z.number().min(0).describe("Character position (0-indexed)"),
    },
    async (params) => {
      try {
        const result = await handleGetTypeInfo(params);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in get_type_info: ${err}` }],
          isError: true,
        };
      }
    }
  );

  console.error("[Manifest] Registered 14 tools.");
}
