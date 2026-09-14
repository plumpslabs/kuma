// ============================================================
// KUMA CODE SCANNER — AST & Topology Knowledge Graph Engine
// ============================================================
// Uses TypeScript Compiler API for accurate AST-level extraction:
//   - File nodes & Module topology
//   - Exported functions, classes, interfaces, types
//   - Deterministic import edges (ESM-aware .js/.ts resolution)
//   - Call graph edges (who calls which function)
//   - Test associations (connecting tests to tested files)
//   - Incremental mtime cache invalidation (anti-staleness)
// ============================================================

import fastGlob from "fast-glob";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { getProjectRoot } from "../utils/pathValidator.js";
import { getDb, saveDb } from "./kumaDb.js";
import { upsertNode, addEdge, nodeId } from "./kumaGraph.js";
import { DEFAULT_SOURCE_INCLUDES, SOURCE_EXTENSIONS, SOURCE_EXT_GLOB, isTestFile } from "./languageSupport.js";
import { parsePolyglotFile } from "./polyglotScanner.js";

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
  parserUsed?: string;
}

const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_FILE_SIZE = 250 * 1024; // 250KB

// Cache file mtimes to avoid re-scanning unchanged files
const fileMtimes = new Map<string, number>();

let _cachedRoot: string | null = null;
function getRoot(): string {
  if (!_cachedRoot) _cachedRoot = getProjectRoot();
  return _cachedRoot;
}

// ============================================================
// Parsed File Data Structure
// ============================================================

export interface ParsedSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "component" | "route";
  line: number;
  isExported: boolean;
  description?: string;
  signature?: string;
  params?: Array<{ name: string; type?: string }>;
  returnType?: string;
  methods?: string[];
  members?: string[];
  extends?: string;
  implements?: string[];
  routeMethod?: string;
  routePath?: string;
}

export interface ParsedImport {
  source: string;
  symbols: string[];
  isDefault: boolean;
}

export interface ParsedFile {
  filePath: string;
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  calledSymbols: string[];
  isTest: boolean;
}

// ============================================================
// AST Docstring & Signature Extraction Helpers
// ============================================================

/**
 * Extract leading JSDoc or block comments from an AST node.
 */
function extractLeadingDoc(sourceFile: ts.SourceFile, node: ts.Node): string | undefined {
  try {
    const comments = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart());
    if (!comments || comments.length === 0) return undefined;

    for (let i = comments.length - 1; i >= 0; i--) {
      const c = comments[i];
      const raw = sourceFile.text.substring(c.pos, c.end).trim();
      if (raw.startsWith("/**")) {
        const cleaned = raw
          .replace(/^\/\*\*|\*\/$/g, "")
          .split("\n")
          .map((l) => l.replace(/^\s*\*\s?/, "").trim())
          .filter(Boolean)
          .join("\n");
        if (cleaned) return cleaned;
      } else if (raw.startsWith("//")) {
        const cleaned = raw.replace(/^\/\/\s?/, "").trim();
        if (cleaned && !cleaned.startsWith("eslint") && !cleaned.startsWith("@ts-")) {
          return cleaned;
        }
      }
    }
  } catch {
    // Ignore extraction errors
  }
  return undefined;
}

/**
 * Extract signature, parameters, and return type from a function node.
 */
function extractFunctionDetails(
  fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
  sourceFile: ts.SourceFile
): {
  signature: string;
  params: Array<{ name: string; type?: string }>;
  returnType?: string;
} {
  const params: Array<{ name: string; type?: string }> = [];
  for (const p of fn.parameters) {
    const paramName = p.name.getText(sourceFile);
    const paramType = p.type ? p.type.getText(sourceFile) : undefined;
    params.push({ name: paramName, type: paramType });
  }

  const returnType = fn.type ? fn.type.getText(sourceFile) : undefined;
  const paramStr = params
    .map((p) => (p.type ? `${p.name}: ${p.type}` : p.name))
    .join(", ");
  const signature = `(${paramStr})${returnType ? `: ${returnType}` : ""}`;

  return { signature, params, returnType };
}

/**
 * Extract public methods from a class node.
 */
function extractClassDetails(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile
): { methods?: string[] } {
  const methods: string[] = [];
  for (const member of node.members) {
    if (ts.isMethodDeclaration(member) && member.name) {
      const mName = member.name.getText(sourceFile);
      const isPrivate =
        member.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword) ||
        mName.startsWith("#") ||
        mName.startsWith("_");
      if (!isPrivate) {
        const pStr = member.parameters
          .map((p) => p.name.getText(sourceFile))
          .join(", ");
        methods.push(`${mName}(${pStr})`);
      }
    }
  }
  return { methods: methods.length > 0 ? methods : undefined };
}

/**
 * Extract public members/properties from an interface node.
 */
function extractInterfaceDetails(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile
): { members?: string[] } {
  const members: string[] = [];
  for (const member of node.members) {
    if (member.name) {
      const mName = member.name.getText(sourceFile);
      members.push(mName);
    }
  }
  return { members: members.length > 0 ? members : undefined };
}

// ============================================================
// AST Parsing Engine (TypeScript Compiler API)
// ============================================================

export function parseFileAst(filePath: string, content: string): ParsedFile {
  const result: ParsedFile = {
    filePath,
    symbols: [],
    imports: [],
    calledSymbols: [],
    isTest: isTestFile(filePath),
  };

  const isTsOrJs = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(filePath);
  if (!isTsOrJs) {
    // Multi-Language Polyglot Grammar AST Parser (Python, Go, Rust, Java, C#, etc.)
    return parsePolyglotFile(filePath, content);
  }

  try {
    const isJsx = filePath.endsWith(".tsx") || filePath.endsWith(".jsx");
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    function visit(node: ts.Node) {
      if (!result.isTest) {
        // 1. Function Declaration
        if (ts.isFunctionDeclaration(node) && node.name) {
          const name = node.name.text;
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
          const description = extractLeadingDoc(sourceFile, node);
          const { signature, params, returnType } = extractFunctionDetails(node, sourceFile);

          result.symbols.push({
            name,
            kind: "function",
            line,
            isExported,
            description,
            signature,
            params,
            returnType,
          });
        }

        // 2. Variable Statements (e.g. export const myHandler = () => ...)
        else if (ts.isVariableStatement(node)) {
          const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
          const varDoc = extractLeadingDoc(sourceFile, node);
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.initializer) {
              const name = decl.name.text;
              if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
                const line = sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile)).line + 1;
                const fnDoc = extractLeadingDoc(sourceFile, decl) || varDoc;
                const { signature, params, returnType } = extractFunctionDetails(decl.initializer, sourceFile);

                result.symbols.push({
                  name,
                  kind: "function",
                  line,
                  isExported,
                  description: fnDoc,
                  signature,
                  params,
                  returnType,
                });
              }
            }
          }
        }

        // 3. Class Declaration
        else if (ts.isClassDeclaration(node) && node.name) {
          const name = node.name.text;
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
          const description = extractLeadingDoc(sourceFile, node);
          const { methods } = extractClassDetails(node, sourceFile);
          let extName: string | undefined;
          const implNames: string[] = [];

          if (node.heritageClauses) {
            for (const hc of node.heritageClauses) {
              if (hc.token === ts.SyntaxKind.ExtendsKeyword && hc.types.length > 0) {
                extName = hc.types[0].expression.getText(sourceFile);
              } else if (hc.token === ts.SyntaxKind.ImplementsKeyword) {
                for (const t of hc.types) {
                  implNames.push(t.expression.getText(sourceFile));
                }
              }
            }
          }

          result.symbols.push({
            name,
            kind: "class",
            line,
            isExported,
            description,
            extends: extName,
            implements: implNames.length > 0 ? implNames : undefined,
            methods,
          });
        }

        // 4. Interface Declaration
        else if (ts.isInterfaceDeclaration(node) && node.name) {
          const name = node.name.text;
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
          const description = extractLeadingDoc(sourceFile, node);
          const { members } = extractInterfaceDetails(node, sourceFile);

          result.symbols.push({
            name,
            kind: "interface",
            line,
            isExported,
            description,
            members,
          });
        }
      }

      // 5. Imports
      if (ts.isImportDeclaration(node)) {
        if (ts.isStringLiteral(node.moduleSpecifier)) {
          const source = node.moduleSpecifier.text;
          const symbols: string[] = [];
          let isDefault = false;

          if (node.importClause) {
            if (node.importClause.name) {
              symbols.push(node.importClause.name.text);
              isDefault = true;
            }
            if (node.importClause.namedBindings) {
              if (ts.isNamedImports(node.importClause.namedBindings)) {
                for (const elem of node.importClause.namedBindings.elements) {
                  symbols.push(elem.name.text);
                }
              } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                symbols.push(node.importClause.namedBindings.name.text);
              }
            }
          }

          if (source.startsWith(".") || source.startsWith("/")) {
            result.imports.push({ source, symbols, isDefault });
          }
        }
      }

      // 6. Export Declarations (e.g. export { a, b } from './sub')
      else if (ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const source = node.moduleSpecifier.text;
          if (source.startsWith(".") || source.startsWith("/")) {
            result.imports.push({ source, symbols: [], isDefault: false });
          }
        }
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const elem of node.exportClause.elements) {
            result.symbols.push({
              name: elem.name.text,
              kind: "function",
              line: 1,
              isExported: true,
            });
          }
        }
      }

      // 7. Function Calls
      else if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
          const fnName = node.expression.text;
          if (fnName.length >= 2 && !isJsBuiltin(fnName)) {
            result.calledSymbols.push(fnName);
          }
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          const propName = node.expression.name.text;
          if (propName.length >= 2 && !isJsBuiltin(propName)) {
            result.calledSymbols.push(propName);
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  } catch {
    return parseFallbackRegex(filePath, content);
  }

  return result;
}

function isJsBuiltin(name: string): boolean {
  return [
    "if", "for", "while", "switch", "catch", "return", "typeof", "delete", "throw",
    "import", "export", "function", "class", "new", "try", "yield", "await",
    "this", "super", "undefined", "null", "true", "false", "console", "log", "warn", "error",
    "describe", "it", "test", "expect", "assert", "beforeEach", "afterEach", "beforeAll", "afterAll",
    "jest", "require", "setTimeout", "setInterval", "clearTimeout", "clearInterval",
    "Math", "JSON", "Object", "Array", "String", "Number", "Boolean", "Promise",
    "Error", "Date", "RegExp", "Map", "Set", "Symbol", "push", "slice", "map", "filter",
    "forEach", "reduce", "find", "join", "split", "trim", "replace", "startsWith", "endsWith",
    "includes", "indexOf", "has", "get", "set", "add", "delete", "keys", "values", "entries",
  ].includes(name);
}

function parseFallbackRegex(filePath: string, content: string): ParsedFile {
  const result: ParsedFile = {
    filePath,
    symbols: [],
    imports: [],
    calledSymbols: [],
    isTest: isTestFile(filePath),
  };

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("//") || line.startsWith("#")) continue;

    // Functions (Python, Go, Rust, Ruby, PHP)
    const fnMatch = line.match(/(?:def|func|fn|function)\s+([a-zA-Z0-9_]+)\s*(\([^)]*\))?/);
    if (fnMatch) {
      const name = fnMatch[1];
      const signature = fnMatch[2] ? fnMatch[2] : undefined;
      let description: string | undefined;

      // Check preceding line for comment
      if (i > 0) {
        const prev = lines[i - 1].trim();
        if (prev.startsWith("#") || prev.startsWith("//")) {
          description = prev.replace(/^[#\/]+\s*/, "").trim();
        }
      }

      // Check Python docstring on next lines
      if (!description && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
          const quote = nextLine.slice(0, 3);
          const docLines: string[] = [];
          const restOfNext = nextLine.slice(3);
          if (restOfNext.endsWith(quote) && restOfNext.length > 3) {
            description = restOfNext.slice(0, -3).trim();
          } else {
            if (restOfNext) docLines.push(restOfNext);
            for (let j = i + 2; j < Math.min(lines.length, i + 15); j++) {
              const cur = lines[j].trim();
              if (cur.endsWith(quote)) {
                docLines.push(cur.slice(0, -3).trim());
                break;
              }
              docLines.push(cur);
            }
            description = docLines.filter(Boolean).join(" ");
          }
        }
      }

      result.symbols.push({
        name,
        kind: "function",
        line: i + 1,
        isExported: !name.startsWith("_"),
        signature,
        description,
      });
    }

    // Classes
    const clsMatch = line.match(/(?:class|struct|type)\s+([a-zA-Z0-9_]+)/);
    if (clsMatch) {
      result.symbols.push({
        name: clsMatch[1],
        kind: "class",
        line: i + 1,
        isExported: true,
      });
    }

    // Imports
    const impMatch = line.match(/(?:import|from)\s+['"]([^'"]+)['"]/);
    if (impMatch && (impMatch[1].startsWith(".") || impMatch[1].startsWith("/"))) {
      result.imports.push({ source: impMatch[1], symbols: [], isDefault: false });
    }
  }

  return result;
}

// ============================================================
// ESM-Aware Import Path Resolution
// ============================================================

export function resolveImportPath(fromFile: string, importPath: string, root: string): string | null {
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) return null;

  const fromDir = path.dirname(path.join(root, fromFile));
  const cleanPath = importPath.replace(/\.(js|jsx|mjs|cjs|ts|tsx|py|go|rs|java|kt|cs|rb|php)$/, "");

  const candidates = [
    path.resolve(fromDir, importPath),
    ...SOURCE_EXTENSIONS.map((ext) => path.resolve(fromDir, cleanPath + ext)),
    ...SOURCE_EXTENSIONS.map((ext) => path.resolve(fromDir, cleanPath, `index${ext}`)),
    path.resolve(fromDir, cleanPath, "__init__.py"),
    path.resolve(fromDir, cleanPath, "mod.rs"),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const rel = path.relative(root, candidate);
        return rel.replace(/\\/g, "/");
      }
    } catch { /* skip */ }
  }

  return null;
}

// ============================================================
// Main Scanner & Incremental Synchronizer
// ============================================================

export async function scanCodebase(options: ScanOptions = {}): Promise<ScanResult> {
  const root = getRoot();
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  const result: ScanResult = {
    nodeCount: 0,
    edgeCount: 0,
    filesScanned: 0,
    errors: [],
    parserUsed: "TypeScript Compiler API (AST)",
  };

  const includePatterns = options.include || [...DEFAULT_SOURCE_INCLUDES];
  if (options.scope) {
    includePatterns.length = 0;
    if (options.scope.includes("/") || options.scope.includes(".")) {
      includePatterns.push(options.scope);
    } else {
      includePatterns.push(`**/*${options.scope}*/**/*.${SOURCE_EXT_GLOB}`);
      includePatterns.push(`**/*${options.scope}*.${SOURCE_EXT_GLOB}`);
    }
  }

  const ignorePatterns = [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/coverage/**",
    "**/*.d.ts",
    "**/.kuma/**",
  ];

  let files: string[] = [];
  try {
    files = await fastGlob(includePatterns, {
      cwd: root,
      ignore: ignorePatterns,
      onlyFiles: true,
      deep: options.scope ? 10 : 7,
      dot: false,
    });
  } catch (err) {
    result.errors.push(`Glob failed: ${err}`);
    return result;
  }

  const targetCount = Math.min(files.length, maxFiles);
  const parsedFiles: ParsedFile[] = [];
  const symbolMap = new Map<string, string>(); // symbolName -> filePath

  for (let i = 0; i < targetCount; i++) {
    const filePath = files[i];
    const fullPath = path.join(root, filePath);

    if (!fs.existsSync(fullPath)) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
      if (stat.size > maxFileSize) continue;
    } catch {
      continue;
    }

    const mtime = stat.mtimeMs;
    const cachedMtime = fileMtimes.get(filePath);
    if (!options.force && cachedMtime === mtime) {
      continue; // Unchanged file
    }
    fileMtimes.set(filePath, mtime);

    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const parsed = parseFileAst(filePath, content);
      parsedFiles.push(parsed);

      for (const sym of parsed.symbols) {
        if (!symbolMap.has(sym.name)) {
          symbolMap.set(sym.name, filePath);
        }
      }
    } catch (err) {
      result.errors.push(`Failed to parse ${filePath}: ${err}`);
    }
  }

  // Database operations
  const db = await getDb();

  for (const parsed of parsedFiles) {
    const { filePath, symbols, imports, calledSymbols, isTest } = parsed;
    const fileId = nodeId("file", filePath);

    // 1. Upsert file node
    await upsertNode({
      id: fileId,
      type: "file",
      name: filePath,
      filePath,
      metadata: { symbolCount: symbols.length, isTest },
    });
    result.nodeCount++;

    // 2. If test file, upsert test node and link
    if (isTest) {
      const testId = nodeId("test", filePath);
      await upsertNode({
        id: testId,
        type: "test",
        name: filePath,
        filePath,
      });
      result.nodeCount++;
      await addEdge({ sourceId: fileId, targetId: testId, type: "contains" });
      result.edgeCount++;
    }

    // 3. Upsert symbols (functions, classes, interfaces)
    // High-Signal Filter: Only index public API contracts (exported symbols)
    // to keep knowledge graph clean, impactful, and noise-free for agents.
    let highSignalSymbols = symbols.filter((s) => s.isExported);
    if (highSignalSymbols.length === 0 && symbols.length > 0 && !isTest) {
      // If file has no exports (e.g. CLI entrypoint script), index only main entrypoints
      highSignalSymbols = symbols.filter((s) => s.name === "main" || !s.name.startsWith("_")).slice(0, 3);
    }

    for (const sym of highSignalSymbols) {
      const symId = `${sym.kind}::${filePath}::${sym.name}`;
      await upsertNode({
        id: symId,
        type: sym.kind as any,
        name: sym.name,
        filePath,
        metadata: {
          line: sym.line,
          isExported: sym.isExported,
          description: sym.description,
          signature: sym.signature,
          params: sym.params,
          returnType: sym.returnType,
          methods: sym.methods,
          members: sym.members,
        },
      });
      result.nodeCount++;

      // Edge: File -> defines -> Symbol
      await addEdge({
        sourceId: fileId,
        targetId: symId,
        type: "defines",
      });
      result.edgeCount++;

      // Class extends / implements
      if (sym.extends) {
        const parentFile = symbolMap.get(sym.extends) || filePath;
        const parentId = `class::${parentFile}::${sym.extends}`;
        await addEdge({ sourceId: symId, targetId: parentId, type: "extends" });
        result.edgeCount++;
      }
    }

    // 4. Resolve & link imports
    for (const imp of imports) {
      const resolved = resolveImportPath(filePath, imp.source, root);
      if (resolved) {
        const targetFileId = nodeId("file", resolved);
        // Edge: file -> imports -> targetFile
        await addEdge({
          sourceId: fileId,
          targetId: targetFileId,
          type: "imports",
        });
        result.edgeCount++;

        // If this file is a test, link to tested target
        if (isTest) {
          const testId = nodeId("test", filePath);
          await addEdge({
            sourceId: testId,
            targetId: targetFileId,
            type: "tests",
          });
          result.edgeCount++;
        }
      }
    }

    // 5. Connect function calls
    for (const callee of calledSymbols) {
      const calleeFile = symbolMap.get(callee);
      if (calleeFile && calleeFile !== filePath) {
        const calleeId = `function::${calleeFile}::${callee}`;
        await addEdge({
          sourceId: fileId,
          targetId: calleeId,
          type: "calls",
        });
        result.edgeCount++;
      }
    }

    result.filesScanned++;
  }

  saveDb(db);
  return result;
}

/**
 * Fast incremental sync: check if any files were touched and update their AST.
 */
export async function syncModifiedFiles(limit: number = 20): Promise<ScanResult> {
  return await scanCodebase({ maxFiles: limit, force: false });
}

export function formatScanResult(result: ScanResult): string {
  const lines = [
    `📊 **Scan Result (${result.parserUsed || "AST"})**`,
    `   Files scanned: ${result.filesScanned}`,
    `   Nodes indexed: ${result.nodeCount}`,
    `   Edges created: ${result.edgeCount}`,
  ];
  if (result.errors.length > 0) {
    lines.push(`   ⚠️ Warnings: ${result.errors.length}`);
  }
  return lines.join("\n");
}
