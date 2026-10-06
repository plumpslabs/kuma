// ============================================================
// DOC DRIFT SENSOR — Issue #41 (continuous sensor, Fowler drift)
// ============================================================
// Extracts verifiable claims from docs (env names, endpoints, "no X"
// statements) and cross-checks them against the repo. Aspirational /
// RFC-style docs are exempt. Bounded: max 20 docs, 200 claims, 3s grep.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getProjectRoot } from "../utils/pathValidator.js";

export interface DocClaim {
  kind: "env" | "endpoint" | "absence";
  text: string;
  docFile: string;
  docLine: number;
}

export interface DriftedClaim extends DocClaim {
  codeHint: string;
}

const MAX_DOCS = 20;
const MAX_CLAIMS = 200;
const EXEMPT_PATTERN = /(rfc|proposal|draft|roadmap|aspirational|vision|wishlist)/i;

const ENV_PATTERN = /\b([A-Z][A-Z0-9_]{3,})\b/g;
const ENDPOINT_PATTERN = /(https?:\/\/[^\s)"']+|\/[a-z][a-z0-9/_.-]{2,})/g;
const ABSENCE_PATTERN = /\b(?:no|without|does not use|doesn't use|never)\s+([A-Za-z][A-Za-z0-9_. -]{2,40}?)(?:\.|,|;|$)/gi;

const ENV_ALLOWLIST_HINTS = ["key", "secret", "token", "url", "dsn", "endpoint", "host", "port", "id", "name", "path", "dir", "debug"];

/** Collect candidate doc files (bounded). */
export function collectDocFiles(root?: string): string[] {
  const cwd = root || getProjectRoot();
  const out: string[] = [];
  const pushIfMd = (dir: string, rel: (f: string) => string) => {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (out.length >= MAX_DOCS) return;
        const full = path.join(dir, f);
        try {
          if (fs.statSync(full).isFile() && /\.md$/i.test(f)) out.push(rel(f));
        } catch {}
      }
    } catch {}
  };
  pushIfMd(path.join(cwd, "docs"), (f) => path.join("docs", f));
  pushIfMd(cwd, (f) => f);
  return out;
}

function isExemptDoc(relPath: string, content: string): boolean {
  if (EXEMPT_PATTERN.test(relPath)) return true;
  const head = content.split("\n").slice(0, 15).join("\n");
  return EXEMPT_PATTERN.test(head);
}

/** Extract verifiable claims from one doc (bounded). */
export function extractClaims(relPath: string, content: string): DocClaim[] {
  const claims: DocClaim[] = [];
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    for (const m of line.matchAll(ENV_PATTERN)) {
      const name = m[1];
      if (ENV_ALLOWLIST_HINTS.some((h) => name.toLowerCase().includes(h))) {
        claims.push({ kind: "env", text: name, docFile: relPath, docLine: lineNo });
      }
    }
    for (const m of line.matchAll(ENDPOINT_PATTERN)) {
      const ep = m[1];
      if (ep.length > 60) continue;
      claims.push({ kind: "endpoint", text: ep, docFile: relPath, docLine: lineNo });
    }
    for (const m of line.matchAll(ABSENCE_PATTERN)) {
      const thing = (m[1] || "").trim();
      if (thing.length >= 3 && thing.length <= 40) {
        claims.push({ kind: "absence", text: thing, docFile: relPath, docLine: lineNo });
      }
    }
  });
  return claims;
}

function codeContainsBatch(root: string, needles: string[]): Set<string> {
  const found = new Set<string>();
  const clean = [...new Set(needles.map((n) => n.replace(/"/g, "").trim()).filter((n) => n.length >= 3))];
  if (clean.length === 0) return found;
  // Chunk to keep argv bounded; one grep process per chunk (not per claim).
  for (let i = 0; i < clean.length; i += 50) {
    const chunk = clean.slice(i, i + 50);
    try {
      const args = chunk.map((n) => `-e "${n}"`).join(" ");
      const out = execSync(
        `grep -rn --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.py" --include="*.go" --include="*.rs" --include="*.json" --include="*.yml" --include="*.yaml" --include="*.toml" --include=".env*" -F ${args} . 2>/dev/null | grep -v node_modules | grep -v "/dist/" | grep -v "/.git/" | grep -v "/.kuma/" | head -100`,
        { cwd: root, encoding: "utf-8", timeout: 8000, maxBuffer: 256 * 1024 },
      ).trim();
      for (const n of chunk) {
        // Word-boundary match for identifier needles (avoids KEY ⊂ MONKEY);
        // substring match for URLs/paths where boundaries don't apply.
        const isIdent = /^[A-Za-z0-9_]+$/.test(n);
        const hit = isIdent
          ? new RegExp(`\\b${n}\\b`).test(out)
          : out.includes(n);
        if (hit) found.add(n);
      }
    } catch { /* grep exits 1 on no match — chunk simply unfound */ }
  }
  return found;
}

/**
 * Scan docs vs code. Returns drifted claims (doc says X, code shows otherwise).
 * - env/endpoint claim drifted when the name appears NOWHERE in code.
 * - absence claim drifted when the thing DOES appear in code.
 * Batched: exactly 2 grep waves regardless of claim count.
 */
export function scanDocDrift(root?: string): { checked: number; drifted: DriftedClaim[]; skipped: string[] } {
  const cwd = root || getProjectRoot();
  const skipped: string[] = [];
  let claims: DocClaim[] = [];
  for (const rel of collectDocFiles(cwd)) {
    try {
      const content = fs.readFileSync(path.join(cwd, rel), "utf-8");
      if (isExemptDoc(rel, content)) {
        skipped.push(rel);
        continue;
      }
      claims.push(...extractClaims(rel, content));
      if (claims.length >= MAX_CLAIMS) break;
    } catch {}
  }
  claims = claims.slice(0, MAX_CLAIMS);
  const present = codeContainsBatch(cwd, claims.map((c) => c.text));
  const drifted: DriftedClaim[] = [];
  for (const c of claims) {
    if (c.kind === "absence") {
      if (present.has(c.text)) {
        drifted.push({ ...c, codeHint: `code references "${c.text}" but doc claims absence` });
      }
    } else {
      if (!present.has(c.text)) {
        drifted.push({ ...c, codeHint: `"${c.text}" found in no code/config file` });
      }
    }
    if (drifted.length >= 10) break;
  }
  return { checked: claims.length, drifted, skipped };
}

export function formatDocDrift(checked: number, drifted: DriftedClaim[], skipped: string[]): string {
  if (drifted.length === 0) {
    return `📄 **Doc drift**: ${checked} claim(s) checked, no drift detected.`;
  }
  const lines = [
    `📄 **Doc drift detected** — ${drifted.length} stale claim(s) of ${checked} checked:`,
  ];
  for (const d of drifted) {
    lines.push(`  ⚠️ [${d.kind}] "${d.text}" — ${d.docFile}:${d.docLine} vs ${d.codeHint}`);
  }
  if (skipped.length > 0) lines.push(`  ℹ️ exempt (RFC/aspirational): ${skipped.slice(0, 3).join(", ")}`);
  lines.push(`  💡 Confirm with a human, then patch the doc or the code.`);
  return lines.join("\n");
}
