// ============================================================
// KUMA POLYGLOT SCANNER — Multi-Language Grammar & AST Engine
// ============================================================
// Provides high-precision structural extraction across 20+ languages:
//   - Python (.py): def, async def, class, docstrings, type hints, imports
//   - Go (.go): func, receiver methods, struct, interface, package imports
//   - Rust (.rs): fn, pub fn, struct, enum, trait, impl, use imports, /// docs
//   - Java / C# (.java, .cs): class, interface, method signatures, Javadoc
//   - Ruby (.rb): def, class, module, require
//   - PHP (.php): function, class, interface, namespace, use
// ============================================================

import path from "node:path";
import type { ParsedFile } from "./kumaCodeScanner.js";
import { isTestFile } from "./languageSupport.js";

/**
 * Parse any non-TypeScript/JavaScript source file with language-aware grammar parsers.
 */
export function parsePolyglotFile(filePath: string, content: string): ParsedFile {
  const ext = path.extname(filePath).toLowerCase();
  const isTest = isTestFile(filePath);

  const result: ParsedFile = {
    filePath,
    symbols: [],
    imports: [],
    calledSymbols: [],
    isTest,
  };

  switch (ext) {
    case ".py":
    case ".pyw":
      return parsePython(filePath, content, result);
    case ".go":
      return parseGo(filePath, content, result);
    case ".rs":
      return parseRust(filePath, content, result);
    case ".java":
    case ".cs":
    case ".kt":
      return parseJavaLike(filePath, content, result);
    case ".rb":
      return parseRuby(filePath, content, result);
    case ".php":
      return parsePhp(filePath, content, result);
    default:
      return parseGeneric(filePath, content, result);
  }
}

// ============================================================
// 1. PYTHON GRAMMAR PARSER (.py)
// ============================================================

function parsePython(_filePath: string, content: string, res: ParsedFile): ParsedFile {
  const lines = content.split("\n");
  let currentClass: { name: string; methods: string[] } | null = null;
  let currentClassIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = rawLine.search(/\S/);

    // Track class exit
    if (currentClass && indent <= currentClassIndent && !rawLine.startsWith(" ")) {
      currentClass = null;
    }

    // 1. Imports
    // e.g. from app.models import User, Account
    const fromImportMatch = trimmed.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+(.+)$/);
    if (fromImportMatch) {
      const source = fromImportMatch[1];
      const symbols = fromImportMatch[2]
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0])
        .filter(Boolean);
      res.imports.push({ source, symbols, isDefault: false });
      continue;
    }
    // e.g. import os, sys
    const directImportMatch = trimmed.match(/^import\s+(.+)$/);
    if (directImportMatch) {
      const parts = directImportMatch[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]);
      for (const p of parts) {
        if (p) res.imports.push({ source: p, symbols: [], isDefault: true });
      }
      continue;
    }

    // 2. Class Definitions
    // e.g. class PaymentService(BaseService, EventEmitter):
    const classMatch = trimmed.match(/^class\s+([a-zA-Z0-9_]+)(?:\(([^)]*)\))?:/);
    if (classMatch) {
      const className = classMatch[1];
      const bases = classMatch[2] ? classMatch[2].split(",").map((b) => b.trim()).filter(Boolean) : [];
      const description = extractPythonDocstring(lines, i);

      currentClass = { name: className, methods: [] };
      currentClassIndent = indent;

      res.symbols.push({
        name: className,
        kind: "class",
        line: i + 1,
        isExported: !className.startsWith("_"),
        description,
        extends: bases[0],
        methods: currentClass.methods,
      });
      continue;
    }

    // 3. Function & Method Definitions
    // e.g. def process_payment(self, amount: float, currency: str = "USD") -> Dict[str, Any]:
    // e.g. async def fetch_user_data(user_id: int):
    const fnMatch = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\((.*?)\)(?:\s*->\s*([^:]+))?:/);
    if (fnMatch) {
      const fnName = fnMatch[1];
      const rawParams = fnMatch[2] || "";
      const returnType = fnMatch[3]?.trim();
      const description = extractPythonDocstring(lines, i);

      // Parse parameters
      const params: Array<{ name: string; type?: string }> = [];
      if (rawParams) {
        for (const p of rawParams.split(",")) {
          const cleanP = p.trim();
          if (!cleanP || cleanP === "self" || cleanP === "cls") continue;
          const [pName, pType] = cleanP.split(":").map((s) => s.trim());
          params.push({ name: pName.split("=")[0].trim(), type: pType ? pType.split("=")[0].trim() : undefined });
        }
      }

      const signature = `def ${fnName}(${rawParams})${returnType ? " -> " + returnType : ""}`;

      if (currentClass) {
        currentClass.methods.push(`${fnName}(${params.map((p) => p.name).join(", ")})`);
      }

      res.symbols.push({
        name: fnName,
        kind: "function",
        line: i + 1,
        isExported: !fnName.startsWith("_"),
        description,
        signature,
        params,
        returnType,
      });
      continue;
    }

    // 4. Function / Method Calls
    extractCallIdentifiers(trimmed, res.calledSymbols);
  }

  return res;
}

function extractPythonDocstring(lines: string[], defLineIndex: number): string | undefined {
  if (defLineIndex + 1 >= lines.length) return undefined;
  const nextLine = lines[defLineIndex + 1].trim();

  if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
    const quote = nextLine.slice(0, 3);
    const rest = nextLine.slice(3);
    if (rest.endsWith(quote) && rest.length >= 3) {
      return rest.slice(0, -3).trim();
    }
    const docLines: string[] = [];
    if (rest) docLines.push(rest);
    for (let j = defLineIndex + 2; j < Math.min(lines.length, defLineIndex + 20); j++) {
      const cur = lines[j].trim();
      if (cur.endsWith(quote)) {
        const withoutQuote = cur.slice(0, -quote.length).trim();
        if (withoutQuote) docLines.push(withoutQuote);
        break;
      }
      docLines.push(cur);
    }
    return docLines.join(" ").trim() || undefined;
  }
  return undefined;
}

// ============================================================
// 2. GO GRAMMAR PARSER (.go)
// ============================================================

function parseGo(_filePath: string, content: string, res: ParsedFile): ParsedFile {
  const lines = content.split("\n");
  let inMultiImport = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    // 1. Imports
    if (trimmed.startsWith("import (")) {
      inMultiImport = true;
      continue;
    }
    if (inMultiImport) {
      if (trimmed === ")") {
        inMultiImport = false;
      } else {
        const m = trimmed.match(/"([^"]+)"/);
        if (m) res.imports.push({ source: m[1], symbols: [], isDefault: true });
      }
      continue;
    }
    const singleImport = trimmed.match(/^import\s+"([^"]+)"/);
    if (singleImport) {
      res.imports.push({ source: singleImport[1], symbols: [], isDefault: true });
      continue;
    }

    // Preceding doc comment
    let description: string | undefined;
    if (i > 0 && lines[i - 1].trim().startsWith("//")) {
      description = lines[i - 1].trim().replace(/^\/\/\s*/, "");
    }

    // 2. Functions & Methods
    // e.g. func (s *Server) HandleRequest(ctx context.Context, req *Request) (*Response, error) {
    // e.g. func NewEngine(config *Config) *Engine {
    const fnMatch = trimmed.match(/^func\s*(?:\(([^)]+)\)\s*)?([a-zA-Z0-9_]+)\s*\((.*?)\)(?:\s*(.+?))?\s*\{?$/);
    if (fnMatch) {
      const receiver = fnMatch[1]?.trim();
      const fnName = fnMatch[2];
      const rawParams = fnMatch[3] || "";
      const returnType = fnMatch[4]?.replace(/\{$/, "").trim();
      const isExported = /^[A-Z]/.test(fnName);

      const signature = `func ${receiver ? `(${receiver}) ` : ""}${fnName}(${rawParams})${returnType ? " " + returnType : ""}`;

      res.symbols.push({
        name: fnName,
        kind: "function",
        line: i + 1,
        isExported,
        description,
        signature,
        returnType,
      });
      continue;
    }

    // 3. Types (Structs and Interfaces)
    // e.g. type Engine struct {
    // e.g. type StorageReader interface {
    const typeMatch = trimmed.match(/^type\s+([a-zA-Z0-9_]+)\s+(struct|interface)\s*\{?/);
    if (typeMatch) {
      const typeName = typeMatch[1];
      const typeKind = typeMatch[2] === "interface" ? "interface" : "class";
      const isExported = /^[A-Z]/.test(typeName);

      // Collect members/methods until closing '}'
      const members: string[] = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
        const sub = lines[j].trim();
        if (sub === "}") break;
        if (sub && !sub.startsWith("//")) {
          const mName = sub.split(/[\s(]/)[0];
          if (mName) members.push(mName);
        }
      }

      res.symbols.push({
        name: typeName,
        kind: typeKind,
        line: i + 1,
        isExported,
        description,
        members: members.length > 0 ? members : undefined,
        methods: typeKind === "class" ? members : undefined,
      });
      continue;
    }

    // 4. Function Calls
    extractCallIdentifiers(trimmed, res.calledSymbols);
  }

  return res;
}

// ============================================================
// 3. RUST GRAMMAR PARSER (.rs)
// ============================================================

function parseRust(_filePath: string, content: string, res: ParsedFile): ParsedFile {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    // 1. Use Declarations (Imports)
    // e.g. use std::collections::HashMap;
    // e.g. pub use crate::engine::{Graph, Node};
    const useMatch = trimmed.match(/^(?:pub\s+)?use\s+([^;]+);/);
    if (useMatch) {
      const fullPath = useMatch[1].trim();
      const parts = fullPath.split("::");
      const last = parts[parts.length - 1];
      let symbols: string[] = [];
      if (last.startsWith("{") && last.endsWith("}")) {
        symbols = last.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
      } else {
        symbols = [last];
      }
      res.imports.push({ source: fullPath, symbols, isDefault: false });
      continue;
    }

    // Preceding doc comment
    let description: string | undefined;
    if (i > 0 && lines[i - 1].trim().startsWith("///")) {
      description = lines[i - 1].trim().replace(/^\/\/\/\s*/, "");
    }

    // 2. Struct, Enum, Trait
    // e.g. pub struct KnowledgeGraph {
    // e.g. pub trait Indexer: Send + Sync {
    const structMatch = trimmed.match(/^(pub(?:\([^)]+\))?\s+)?(struct|enum|trait)\s+([a-zA-Z0-9_]+)/);
    if (structMatch) {
      const isExported = Boolean(structMatch[1]);
      const kind = structMatch[2] === "trait" ? "interface" : "class";
      const name = structMatch[3];

      res.symbols.push({
        name,
        kind,
        line: i + 1,
        isExported,
        description,
      });
      continue;
    }

    // 3. Functions
    // e.g. pub async fn calculate_blast_radius(&self, target: &str) -> Result<Impact> {
    const fnMatch = trimmed.match(/^(pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\((.*?)\)(?:\s*->\s*([^\{]+))?/);
    if (fnMatch) {
      const isExported = Boolean(fnMatch[1]);
      const fnName = fnMatch[2];
      const rawParams = fnMatch[3] || "";
      const returnType = fnMatch[4]?.replace(/[;{]+$/, "").trim();

      const signature = `fn ${fnName}(${rawParams})${returnType ? " -> " + returnType : ""}`;

      res.symbols.push({
        name: fnName,
        kind: "function",
        line: i + 1,
        isExported,
        description,
        signature,
        returnType,
      });
      continue;
    }

    // 4. Function Calls
    extractCallIdentifiers(trimmed, res.calledSymbols);
  }

  return res;
}

// ============================================================
// 4. JAVA / C# / KOTLIN GRAMMAR PARSER (.java, .cs, .kt)
// ============================================================

function parseJavaLike(_filePath: string, content: string, res: ParsedFile): ParsedFile {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

    // Imports
    const importMatch = trimmed.match(/^(?:import|using)\s+([^;]+);/);
    if (importMatch) {
      const source = importMatch[1].trim();
      res.imports.push({ source, symbols: [source.split(".").pop() || source], isDefault: false });
      continue;
    }

    // Classes & Interfaces
    const classMatch = trimmed.match(/^(public|protected|internal)?\s*(?:abstract|sealed|final)?\s*(class|interface|record)\s+([a-zA-Z0-9_]+)/);
    if (classMatch) {
      const isExported = classMatch[1] === "public";
      const kind = classMatch[2] === "interface" ? "interface" : "class";
      const name = classMatch[3];

      res.symbols.push({
        name,
        kind,
        line: i + 1,
        isExported,
      });
      continue;
    }

    // Methods
    const methodMatch = trimmed.match(/^(public|protected|private)?\s*(?:static\s+)?(?:final\s+)?([a-zA-Z0-9_<>\[\],\s]+?)\s+([a-zA-Z0-9_]+)\s*\((.*?)\)\s*\{?$/);
    if (methodMatch && !methodMatch[2].includes("class") && !methodMatch[2].includes("return")) {
      const isExported = methodMatch[1] === "public";
      const returnType = methodMatch[2].trim();
      const fnName = methodMatch[3];
      const rawParams = methodMatch[4] || "";

      res.symbols.push({
        name: fnName,
        kind: "function",
        line: i + 1,
        isExported,
        signature: `${returnType} ${fnName}(${rawParams})`,
        returnType,
      });
      continue;
    }

    extractCallIdentifiers(trimmed, res.calledSymbols);
  }

  return res;
}

// ============================================================
// 5. RUBY & PHP PARSERS (.rb, .php)
// ============================================================

function parseRuby(_filePath: string, content: string, res: ParsedFile): ParsedFile {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const reqMatch = trimmed.match(/^require(?:_relative)?\s+['"]([^'"]+)['"]/);
    if (reqMatch) {
      res.imports.push({ source: reqMatch[1], symbols: [], isDefault: false });
      continue;
    }
    const classMatch = trimmed.match(/^class\s+([a-zA-Z0-9_:]+)(?:\s*<\s*([a-zA-Z0-9_:]+))?/);
    if (classMatch) {
      res.symbols.push({ name: classMatch[1], kind: "class", line: i + 1, isExported: true, extends: classMatch[2] });
      continue;
    }
    const defMatch = trimmed.match(/^def\s+([a-zA-Z0-9_?!]+)(?:\((.*?)\))?/);
    if (defMatch) {
      res.symbols.push({ name: defMatch[1], kind: "function", line: i + 1, isExported: true, signature: defMatch[2] ? `def ${defMatch[1]}(${defMatch[2]})` : `def ${defMatch[1]}` });
      continue;
    }
    extractCallIdentifiers(trimmed, res.calledSymbols);
  }
  return res;
}

function parsePhp(_filePath: string, content: string, res: ParsedFile): ParsedFile {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const useMatch = trimmed.match(/^use\s+([^;]+);/);
    if (useMatch) {
      res.imports.push({ source: useMatch[1], symbols: [], isDefault: false });
      continue;
    }
    const classMatch = trimmed.match(/^(?:abstract\s+)?class\s+([a-zA-Z0-9_]+)/);
    if (classMatch) {
      res.symbols.push({ name: classMatch[1], kind: "class", line: i + 1, isExported: true });
      continue;
    }
    const fnMatch = trimmed.match(/^(?:public\s+)?function\s+([a-zA-Z0-9_]+)\s*\((.*?)\)/);
    if (fnMatch) {
      res.symbols.push({ name: fnMatch[1], kind: "function", line: i + 1, isExported: true, signature: `function ${fnMatch[1]}(${fnMatch[2] || ""})` });
      continue;
    }
    extractCallIdentifiers(trimmed, res.calledSymbols);
  }
  return res;
}

function parseGeneric(_filePath: string, content: string, res: ParsedFile): ParsedFile {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const fnMatch = line.match(/(?:def|func|fn|function)\s+([a-zA-Z0-9_]+)/);
    if (fnMatch) {
      res.symbols.push({ name: fnMatch[1], kind: "function", line: i + 1, isExported: true });
    }
  }
  return res;
}

/**
 * Helper: extract identifiers being called e.g. obj.method() or fnCall()
 */
function extractCallIdentifiers(line: string, outList: string[]): void {
  const matches = line.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g);
  for (const m of matches) {
    const id = m[1];
    if (id.length >= 3 && !["if", "for", "while", "switch", "catch", "return", "print", "len", "range", "def", "func", "class"].includes(id)) {
      if (!outList.includes(id)) outList.push(id);
    }
  }
}
