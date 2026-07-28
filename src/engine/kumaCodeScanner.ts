// ============================================================
// KUMA CODE SCANNER — Automated Code Structure Analyzer
// ============================================================
// Scans source files to detect:
//   - Function declarations → function nodes
//   - Class declarations → class nodes
//   - React components → component nodes (functions returning JSX)
//   - API route handlers → api_route nodes
//   - Test files → test nodes
//   - Module directories → module nodes
//   - Import statements → imports edges
//   - Function calls → calls edges
//   - Class extends → extends edges
//   - Class implements → implements edges
//   - Component composition → composes edges
//   - File contains symbols → contains edges
//   - Module owns files → owns edges
//
// Lightweight regex-based (no full AST parser dependency).
// Integrates with kumaGraph.ts to populate the knowledge graph.
// ============================================================

import fastGlob from "fast-glob";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { upsertNode, addEdge, nodeId } from "./kumaGraph.js";

// ============================================================
// Types
// ============================================================

export interface ScanOptions {
  /** Directory scope to scan (relative to project root) */
  scope?: string;
  /** Max files to scan (safety limit) */
  maxFiles?: number;
  /** Max file size in bytes (skip large files) */
  maxFileSize?: number;
  /** Specific file patterns to include */
  include?: string[];
  /** Whether to force re-scan even if file hasn't changed */
  force?: boolean;
}

export interface ScanResult {
  nodeCount: number;
  edgeCount: number;
  filesScanned: number;
  errors: string[];
}

// ============================================================
// Configuration
// ============================================================

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_FILE_SIZE = 100 * 1024; // 100KB

// Cache of file modification times to avoid re-scanning unchanged files
const fileCache = new Map<string, number>();
// Cache getProjectRoot() result to avoid repeated calls
let _cachedRoot: string | null = null;
function getRoot(): string {
  if (!_cachedRoot) _cachedRoot = getProjectRoot();
  return _cachedRoot;
}

// ============================================================
// Regex Patterns
// ============================================================

// Function declarations: export function foo(), async function foo(), function* foo()
const FUNCTION_DECL_RE = /(?:export\s+)?(?:async\s+)?function\s*(?:\*\s*)?(\w+)\s*\(/g;

// Arrow function assignments: const foo = (...) => ...
const ARROW_FN_RE = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*\w+(?:<[^>]*>)?)?\s*=>/g;

// Typed arrow function assignments: const foo: Type = (...) => ...
const TYPED_ARROW_RE = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*:\s*(?:\w+(?:<[^>]*>)?)?\s*=\s*(?:async\s*)?\(/g;

// Class declarations: export class Foo extends Bar implements Baz
const CLASS_RE = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g;

// Import statements: import { X } from 'y', import X from 'y', import * as X from 'y'
const IMPORT_RE = /import\s+(?:\{([^}]*)\}\s+from\s+)?(?:\w+\s+from\s+)?(?:\*\s+as\s+\w+\s+from\s+)?['"]([^'"]+)['"]/g;

// JSX detection
const JSX_RETURN_RE = /return\s*\(?\s*</;
const JSX_ELEMENT_RE = /<([A-Z]\w+)[\s/>]/g;

// Route patterns
const EXPRESS_ROUTE_RE = /\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g;
const HONO_ROUTE_RE = /c\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;

// Test patterns
const TEST_PATTERNS = [".test.", ".spec.", "__tests__", "/test/"];

// Export declarations
const EXPORT_RE = /export\s+(?:default\s+)?(\w+)/g;

// Function call pattern: knownFunctionName(
const CALL_RE = /(\w+)\s*\(/g;

// Cross-scan caches
const knownComponents = new Set<string>();
const knownFunctions = new Set<string>();
// Track where each function/component/class is defined: name → filePath
const symbolLocations = new Map<string, string>();

// ============================================================
// Helper
// ============================================================

function lineAt(content: string, index: number): number {
  return content.substring(0, index).split("\n").length;
}

/** Extract directory tree from file paths — returns all ancestor dirs */
function getDirectoryDirs(filePaths: string[]): string[] {
  const dirs = new Set<string>();
  for (const fp of filePaths) {
    let dir = path.dirname(fp);
    while (dir && dir !== "." && dir !== "/") {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  }
  return [...dirs].sort();
}

// ============================================================
// Main Scanner
// ============================================================

export async function scanCodebase(options: ScanOptions = {}): Promise<ScanResult> {
  const root = getRoot();
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  const result: ScanResult = { nodeCount: 0, edgeCount: 0, filesScanned: 0, errors: [] };

  // 1. Discover source files
  const includePatterns = options.include || [
    "src/**/*.{ts,tsx,js,jsx}",
    "app/**/*.{ts,tsx,js,jsx}",
    "lib/**/*.{ts,tsx,js,jsx}",
    "packages/**/*.{ts,tsx,js,jsx}",
    "server/**/*.{ts,tsx,js,jsx}",
    "api/**/*.{ts,tsx,js,jsx}",
  ];

  if (options.scope) {
    includePatterns.length = 0;
    if (options.scope.includes("/") || options.scope.includes(".")) {
      includePatterns.push(options.scope);
    } else {
      includePatterns.push(`**/*${options.scope}*/**/*.{ts,tsx,js,jsx}`);
      includePatterns.push(`**/*${options.scope}*.{ts,tsx,js,jsx}`);
    }
  }

  const ignorePatterns = [
    "**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**",
    "**/.next/**", "**/coverage/**", "**/*.d.ts",
  ];

  let files: string[];
  try {
    files = await fastGlob(includePatterns, {
      cwd: root, ignore: ignorePatterns, onlyFiles: true,
      deep: options.scope ? 10 : 6, dot: false,
    });
  } catch (err) {
    result.errors.push(`Glob failed: ${err}`);
    return result;
  }

  // Clear cross-scan caches
  knownComponents.clear();
  knownFunctions.clear();
  symbolLocations.clear();

  // First pass: parse all files + collect names
  const scannedCount = Math.min(files.length, maxFiles);
  const allParsed: Array<{ filePath: string; parsed: ParsedFile; content: string }> = [];
  const scannedFilePaths: string[] = [];

  for (let i = 0; i < scannedCount; i++) {
    const filePath = files[i];
    const fullPath = path.join(root, filePath);

    if (!fs.existsSync(fullPath)) continue;
    const stat = fs.statSync(fullPath);
    if (stat.size > maxFileSize) continue;

    const mtime = stat.mtimeMs;
    const cached = fileCache.get(filePath);
    if (cached === mtime && !options.force) continue;
    fileCache.set(filePath, mtime);

    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const parsed = parseFile(filePath, content);
      allParsed.push({ filePath, parsed, content });
      scannedFilePaths.push(filePath);

      // Collect names + locations for cross-reference (Fix #1: scoped ID)
      for (const comp of parsed.components) {
        knownComponents.add(comp.name);
        if (!symbolLocations.has(comp.name)) symbolLocations.set(comp.name, filePath);
      }
      for (const fn of parsed.functions) {
        knownFunctions.add(fn.name);
        if (!symbolLocations.has(fn.name)) symbolLocations.set(fn.name, filePath);
      }
    } catch (err) {
      result.errors.push(`Error scanning ${filePath}: ${err}`);
    }
  }

  // Also collect function names from classes
  for (const { parsed } of allParsed) {
    for (const cls of parsed.classes) {
      knownFunctions.add(cls.name);
      if (!symbolLocations.has(cls.name)) symbolLocations.set(cls.name, parsed.filePath);
    }
  }

  // Second pass: record graph data
  for (const { filePath, parsed, content } of allParsed) {
    try {
      await recordParsedFile(filePath, parsed, content, result);
      result.filesScanned++;
    } catch (err) {
      result.errors.push(`Error recording ${filePath}: ${err}`);
    }
  }

  // Third pass: create module nodes from directory structure
  if (scannedFilePaths.length > 0) {
    try {
      const dirs = getDirectoryDirs(scannedFilePaths);
      for (const dir of dirs) {
        const moduleId = nodeId("module", dir);
        await upsertNode({
          id: moduleId,
          type: "module",
          name: dir,
          metadata: { path: dir },
        });
        result.nodeCount++;

        // Find files in this directory and create owns edges
        for (const fp of scannedFilePaths) {
          if (path.dirname(fp) === dir) {
            const fileId = nodeId("file", fp);
            try {
              await addEdge({ sourceId: moduleId, targetId: fileId, type: "owns" });
              result.edgeCount++;
            } catch { /* edge may already exist */ }
          }
        }
      }
    } catch (err) {
      result.errors.push(`Module nodes error: ${err}`);
    }
  }

  return result;
}

// ============================================================
// File Parsing
// ============================================================

interface ParsedFile {
  filePath: string;
  functions: Array<{ name: string; line: number }>;
  classes: Array<{ name: string; extends?: string; implements?: string[]; line: number }>;
  components: Array<{ name: string; line: number }>;
  routes: Array<{ method: string; pathPattern: string; handler: string; line: number }>;
  imports: Array<{ source: string; symbols: string[]; isDefault: boolean }>;
  exports: string[];
  isTest: boolean;
}

function parseFile(filePath: string, content: string): ParsedFile {
  const result: ParsedFile = {
    filePath, functions: [], classes: [], components: [],
    routes: [], imports: [], exports: [],
    isTest: TEST_PATTERNS.some((p) => filePath.includes(p)),
  };

  const lines = content.split("\n");
  const isTsx = /\.(tsx|jsx)$/.test(filePath);
  const hasJSX = isTsx && content.includes("<") && content.includes(">");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    let m: RegExpExecArray | null;

    // 1. Function declarations
    FUNCTION_DECL_RE.lastIndex = 0;
    while ((m = FUNCTION_DECL_RE.exec(line)) !== null) {
      const fnName = m[1];
      if (fnName) {
        const prevLine = (lines[i - 1] || "").trim();
        if (!prevLine.match(/^\s*(?:export\s+)?(?:abstract\s+)?class\s+/)) {
          result.functions.push({ name: fnName, line: lineNum });
        }
      }
    }

    // 2. Arrow function assignments
    ARROW_FN_RE.lastIndex = 0;
    while ((m = ARROW_FN_RE.exec(line)) !== null) {
      const fnName = m[1];
      if (fnName && !fnName.startsWith("_")) result.functions.push({ name: fnName, line: lineNum });
    }

    // 3. Typed arrow functions
    TYPED_ARROW_RE.lastIndex = 0;
    while ((m = TYPED_ARROW_RE.exec(line)) !== null) {
      const fnName = m[1];
      if (fnName && !fnName.startsWith("_") && /^\s*(?:const|let|var)\s+/.test(line)) {
        if (line.includes("=>") || line.includes("function(") || line.includes("async")) {
          result.functions.push({ name: fnName, line: lineNum });
        }
      }
    }

    // 4. Class declarations
    CLASS_RE.lastIndex = 0;
    while ((m = CLASS_RE.exec(line)) !== null) {
      const cls: ParsedFile["classes"][0] = { name: m[1], line: lineNum };
      if (m[2]) cls.extends = m[2];
      if (m[3]) cls.implements = m[3].split(",").map((s) => s.trim());
      result.classes.push(cls);
    }

    // 5. Imports
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(line)) !== null) {
      const symbols = m[1] ? m[1].split(",").map((s) => s.trim().split(" as ")[0].trim()) : [];
      const source = m[2] || "";
      if (source.startsWith(".") || source.startsWith("/")) {
        result.imports.push({ source, symbols, isDefault: false });
      }
    }

    // 6. Exports
    EXPORT_RE.lastIndex = 0;
    while ((m = EXPORT_RE.exec(line)) !== null) {
      const exportName = m[1];
      if (exportName && !["const", "let", "var", "function", "class", "interface", "type", "default"].includes(exportName)) {
        result.exports.push(exportName);
      }
    }
  }

  // 7. React components — explicit + implicit return (Fix #2)
  const JSX_IMPLICIT_RE = /=>\s*(?:\(\s*)?</;
  if (hasJSX) {
    for (const fn of [...result.functions]) {
      const fnStartLine = fn.line - 1;
      const fnLine = lines[fnStartLine];
      const endLine = Math.min(fnStartLine + 50, lines.length);
      let isComponent = false;
      // Check explicit return: return <Jsx ...
      for (let i = fnStartLine; i < endLine; i++) {
        if (JSX_RETURN_RE.test(lines[i])) { isComponent = true; break; }
      }
      // Check implicit return: () => <Jsx
      if (!isComponent && JSX_IMPLICIT_RE.test(fnLine)) isComponent = true;
      // Check implicit return multi-line: () => newline then <Jsx
      if (!isComponent && fnLine.includes('=>') && (fnStartLine + 1) < endLine) {
        const nextLine = lines[fnStartLine + 1].trim();
        if (nextLine.startsWith('<') || nextLine.startsWith('(') || nextLine.startsWith('<>')) {
          isComponent = true;
        }
      }
      if (isComponent) {
        result.components.push({ name: fn.name, line: fn.line });
        result.functions = result.functions.filter((f) => f.name !== fn.name);
      }
    }
  }

  // 8. Route handlers (Express)
  let rm: RegExpExecArray | null;
  EXPRESS_ROUTE_RE.lastIndex = 0;
  while ((rm = EXPRESS_ROUTE_RE.exec(content)) !== null) {
    result.routes.push({
      method: rm[1].toUpperCase(),
      pathPattern: rm[2],
      handler: rm[3],
      line: lineAt(content, rm.index),
    });
  }

  // 9. Route handlers (Hono)
  HONO_ROUTE_RE.lastIndex = 0;
  while ((rm = HONO_ROUTE_RE.exec(content)) !== null) {
    result.routes.push({
      method: rm[1].toUpperCase(), pathPattern: rm[2], handler: "",
      line: lineAt(content, rm.index),
    });
  }

  return result;
}

// ============================================================
// Graph Recording
// ============================================================

async function recordParsedFile(
  filePath: string,
  parsed: ParsedFile,
  content: string,
  result: ScanResult,
): Promise<void> {
  const { functions, classes, components, routes, imports } = parsed;
  const root = getRoot();

  // File node
  const fileNodeId = nodeId("file", filePath);
  await upsertNode({ id: fileNodeId, type: "file", name: filePath });
  result.nodeCount++;

  // Test node
  if (parsed.isTest) {
    const testNodeId = nodeId("test", filePath);
    await upsertNode({ id: testNodeId, type: "test", name: filePath, filePath });
    result.nodeCount++;
    try { await addEdge({ sourceId: fileNodeId, targetId: testNodeId, type: "contains" }); result.edgeCount++; } catch {}
  }

  // 1. Imports
  for (const imp of imports) {
    const resolved = resolveImportPath(filePath, imp.source, root);
    if (resolved) {
      const targetId = nodeId("file", resolved);
      await upsertNode({ id: targetId, type: "file", name: resolved });
      result.nodeCount++;
      try { await addEdge({ sourceId: fileNodeId, targetId, type: "imports" }); result.edgeCount++; } catch {}
    }
  }

  // Helper: scoped node ID for file-specific symbols (Fix #1: prevent collision)
  function scopedId(type: string, name: string, fp: string): string {
    return `${type}::${fp}::${name}`;
  }

  // 2. Functions (Fix #1: use scoped ID)
  for (const fn of functions) {
    const fnNodeId = scopedId("function", fn.name, filePath);
    await upsertNode({ id: fnNodeId, type: "function", name: fn.name, filePath });
    result.nodeCount++;
    try { await addEdge({ sourceId: fileNodeId, targetId: fnNodeId, type: "contains" }); result.edgeCount++; } catch {}
  }

  // 3. Components (Fix #1: use scoped ID)
  for (const comp of components) {
    const compNodeId = scopedId("component", comp.name, filePath);
    await upsertNode({ id: compNodeId, type: "component", name: comp.name, filePath });
    result.nodeCount++;
    try { await addEdge({ sourceId: fileNodeId, targetId: compNodeId, type: "contains" }); result.edgeCount++; } catch {}
  }

  // 4. Classes + extends/implements (Fix #1: use scoped ID for class, unscoped for parent/interface)
  for (const cls of classes) {
    const clsNodeId = scopedId("class", cls.name, filePath);
    await upsertNode({ id: clsNodeId, type: "class", name: cls.name, filePath });
    result.nodeCount++;
    try { await addEdge({ sourceId: fileNodeId, targetId: clsNodeId, type: "contains" }); result.edgeCount++; } catch {}

    if (cls.extends) {
      const parentFile = symbolLocations.get(cls.extends) || filePath;
      const parentId = scopedId("class", cls.extends, parentFile);
      await upsertNode({ id: parentId, type: "class", name: cls.extends, filePath: parentFile });
      result.nodeCount++;
      try { await addEdge({ sourceId: clsNodeId, targetId: parentId, type: "extends" }); result.edgeCount++; } catch {}
    }
    if (cls.implements) {
      for (const iface of cls.implements) {
        const ifaceId = nodeId("interface", iface);
        await upsertNode({ id: ifaceId, type: "interface", name: iface });
        result.nodeCount++;
        try { await addEdge({ sourceId: clsNodeId, targetId: ifaceId, type: "implements" }); result.edgeCount++; } catch {}
      }
    }
  }

  // 5. Routes
  for (const route of routes) {
    const routeName = `${route.method} ${route.pathPattern}`;
    const routeNodeId = nodeId("api_route", routeName);
    await upsertNode({
      id: routeNodeId, type: "api_route", name: routeName, filePath,
      metadata: { method: route.method, path: route.pathPattern },
    });
    result.nodeCount++;
    try { await addEdge({ sourceId: fileNodeId, targetId: routeNodeId, type: "contains" }); result.edgeCount++; } catch {}
    if (route.handler) {
      const handlerPath = symbolLocations.get(route.handler) || filePath;
      const handlerId = scopedId("function", route.handler, handlerPath);
      await upsertNode({ id: handlerId, type: "function", name: route.handler, filePath: handlerPath });
      result.nodeCount++;
      try { await addEdge({ sourceId: routeNodeId, targetId: handlerId, type: "routes" }); result.edgeCount++; } catch {}
    }
  }

  // 6. Component composition (composes edges) (Fix #1: scoped ID)
  if (content.includes("<")) {
    JSX_ELEMENT_RE.lastIndex = 0;
    let jm: RegExpExecArray | null;
    while ((jm = JSX_ELEMENT_RE.exec(content)) !== null) {
      const subComp = jm[1];
      if (knownComponents.has(subComp) && components.some((c) => c.name === subComp) === false) {
        const tagLine = lineAt(content, jm.index);
        const parentComp = components.find((c) => {
          const endLine = c.line + 80;
          return tagLine >= c.line && tagLine <= endLine;
        });
        if (parentComp) {
          const childFile = symbolLocations.get(subComp) || filePath;
          const parentId = scopedId("component", parentComp.name, filePath);
          const childId = scopedId("component", subComp, childFile);
          try { await addEdge({ sourceId: parentId, targetId: childId, type: "composes" }); result.edgeCount++; } catch {}
        }
      }
    }
  }

  // 7. Function calls detection (calls edges) — Fix #1: use scoped ID + Fix #4: strip regex literals
  // Strip comments, string literals, AND regex literals (Fix #4: /regex\/containing\/slash/)
  const callContent = content
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // multi-line comments (before single-line to avoid overlap)
    .replace(/\/\/.*$/gm, ' ')            // single-line comments
    .replace(/\/[^\n\s][^\n]*?\/[gimsuy]*/g, ' ') // regex literals (Fix #4)
    .replace(/['"`][^'"`]*['"`]/g, ' ');   // string literals
  CALL_RE.lastIndex = 0;
  const fileCalls = new Set<string>(); // deduplicate per file
  let cm: RegExpExecArray | null;
  while ((cm = CALL_RE.exec(callContent)) !== null) {
    const callee = cm[1];
    if (!callee || callee.length < 2) continue;
    // Skip reserved words (Fix #3: expanded skip list)
    if (["if", "for", "while", "switch", "catch", "return", "typeof", "delete", "throw",
         "import", "export", "function", "class", "new", "try", "yield", "await",
         "this", "super", "undefined", "null", "true", "false", "console",
         "describe", "it", "test", "expect", "assert", "beforeEach", "afterEach",
         "beforeAll", "afterAll", "jest", "process", "require", "setTimeout",
         "setInterval", "clearTimeout", "clearInterval", "Math", "JSON",
         "Object", "Array", "String", "Number", "Boolean", "Promise",
         "Error", "Date", "RegExp", "Map", "Set", "Symbol",
         "fetch", "localStorage", "sessionStorage", "exports",
         "call", "apply", "bind", "then", "finally",
         "resolve", "reject", "next", "value", "done",
    ].includes(callee)) continue;

    // Check if it's a known function from a DIFFERENT file (Fix #1: scoped ID)
    if (knownFunctions.has(callee)) {
      const isSelf = functions.some((f) => f.name === callee) ||
                     components.some((c) => c.name === callee);
      if (!isSelf && !fileCalls.has(callee)) {
        fileCalls.add(callee);
        // Use scoped ID from symbolLocations (Fix #1)
        const calleeFile = symbolLocations.get(callee) || filePath;
        const fnId = `function::${calleeFile}::${callee}`;
        try {
          await addEdge({ sourceId: fileNodeId, targetId: fnId, type: "calls" });
          result.edgeCount++;
        } catch {}
      }
    }
  }
}

// ============================================================
// Import Path Resolution
// ============================================================

function resolveImportPath(fromFile: string, importPath: string, root: string): string | null {
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) return null;

  const fromDir = path.dirname(path.join(root, fromFile));
  const exts = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

  for (const ext of exts) {
    const resolved = path.resolve(fromDir, importPath + ext);
    if (fs.existsSync(resolved)) return path.relative(root, resolved);
  }

  const dirPath = path.resolve(fromDir, importPath);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
      const indexPath = path.join(dirPath, `index${ext}`);
      if (fs.existsSync(indexPath)) return path.relative(root, indexPath);
    }
  }

  return null;
}

// ============================================================
// Format Results
// ============================================================

export function formatScanResult(result: ScanResult): string {
  const lines: string[] = [
    "🔬 **Kuma Code Scan Complete**",
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📁 **${result.filesScanned}** files scanned`,
    `📊 **${result.nodeCount}** nodes added to knowledge graph`,
    `🔗 **${result.edgeCount}** edges added to knowledge graph`,
  ];

  if (result.errors.length > 0) {
    lines.push("");
    lines.push(`⚠️ **${result.errors.length}** warning(s):`);
    for (const err of result.errors.slice(0, 5)) {
      lines.push(`  • ${err.substring(0, 120)}`);
    }
    if (result.errors.length > 5) {
      lines.push(`  • ... and ${result.errors.length - 5} more`);
    }
  }

  lines.push(
    "",
    "💡 The knowledge graph now has richer code structure data.",
    "💡 Use kuma_context({ action: 'visualize' }) to see the graph.",
  );

  return lines.join("\n");
}

export async function scanAndFormat(options: ScanOptions = {}): Promise<string> {
  const result = await scanCodebase(options);
  return formatScanResult(result);
}
