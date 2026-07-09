import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// DEPENDENCY GUARD — Check if a new dependency is really needed
// ============================================================

interface DependencyGuardParams {
  packageName: string;
}

// Known native JS alternatives for common npm packages
const NATIVE_JS_ALTERNATIVES: Record<string, Array<{ method: string; description: string }>> = {
  "lodash": [
    { method: "Array.prototype.map()", description: "Replace _.map()" },
    { method: "Array.prototype.filter()", description: "Replace _.filter()" },
    { method: "Array.prototype.reduce()", description: "Replace _.reduce()" },
    { method: "Object.groupBy()", description: "Replace _.groupBy() (ES2024)" },
    { method: "Array.prototype.toSorted()", description: "Replace _.sortBy() (ES2023)" },
    { method: "Array.prototype.toReversed()", description: "Replace _.reverse() (ES2023)" },
    { method: "structuredClone()", description: "Replace _.cloneDeep() (global)" },
  ],
  "lodash.merge": [
    { method: "structuredClone() + Object.assign()", description: "Merge objects natively" },
    { method: "Spread operator: {...a, ...b}", description: "Shallow merge" },
  ],
  "moment": [
    { method: "Intl.DateTimeFormat", description: "Date formatting" },
    { method: "Intl.RelativeTimeFormat", description: "Relative time" },
    { method: "Temporal API (Stage 3)", description: "Modern date/time" },
  ],
  "date-fns": [
    { method: "Intl.DateTimeFormat", description: "Date formatting" },
    { method: "Intl.RelativeTimeFormat", description: "Relative time" },
  ],
  "axios": [
    { method: "fetch()", description: "Built-in HTTP (Node 18+)" },
    { method: "node:http", description: "Built-in HTTP module" },
  ],
  "node-fetch": [
    { method: "fetch()", description: "Built-in HTTP (Node 18+). No polyfill needed." },
  ],
  "got": [
    { method: "fetch()", description: "Built-in HTTP (Node 18+)" },
  ],
  "request": [
    { method: "fetch()", description: "Built-in HTTP (Node 18+). request is deprecated." },
  ],
  "chalk": [
    { method: "ANSI escape codes", description: "Inline color codes. No dependency needed." },
    { method: "picocolors", description: "Smaller alternative (3KB vs 20KB)" },
  ],
  "colors": [
    { method: "ANSI escape codes", description: "Inline color codes. No dependency needed." },
  ],
  "uuid": [
    { method: "crypto.randomUUID()", description: "Built-in UUID v4 (Node 19+)" },
    { method: "crypto.randomBytes()", description: "Custom UUID (Node built-in)" },
  ],
  "nanoid": [
    { method: "crypto.randomUUID()", description: "Built-in UUID (Node 19+)" },
  ],
  "dotenv": [
    { method: "Node --env-file flag", description: "Built-in .env loading (Node 20.6+)" },
  ],
  "express": [
    { method: "node:http", description: "Built-in HTTP server" },
    { method: "fastify", description: "Faster alternative" },
  ],
  "body-parser": [
    { method: "express.json()", description: "Built into Express 4.16+" },
    { method: "express.urlencoded()", description: "Built into Express 4.16+" },
  ],
  "cors": [
    { method: "Custom middleware", description: "~10 lines of code" },
  ],
  "helmet": [
    { method: "Custom security headers", description: "~15 lines of code" },
  ],
  "morgan": [
    { method: "Custom logger middleware", description: "~10 lines of code" },
  ],
  "compression": [
    { method: "Custom zlib middleware", description: "~15 lines of code" },
  ],
  "rimraf": [
    { method: "fs.rmSync(dir, { recursive: true })", description: "Built-in (Node 14.14+)" },
    { method: "fs.promises.rm(dir, { recursive: true })", description: "Async version (Node 14.14+)" },
  ],
  "mkdirp": [
    { method: "fs.mkdirSync(dir, { recursive: true })", description: "Built-in (Node 10.12+)" },
  ],
  "glob": [
    { method: "fast-glob", description: "Kuma already uses this" },
  ],
};

/**
 * Check if a package is already installed in the project.
 */
function findExistingDependency(packageName: string): { found: boolean; version?: string; inDev?: boolean } {
  const root = getProjectRoot();
  const packageJsonPath = path.join(root, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return { found: false };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

    // Check dependencies
    const deps = pkg.dependencies || {};
    if (deps[packageName]) {
      return { found: true, version: deps[packageName] };
    }

    // Check devDependencies
    const devDeps = pkg.devDependencies || {};
    if (devDeps[packageName]) {
      return { found: true, version: devDeps[packageName], inDev: true };
    }

    return { found: false };
  } catch {
    return { found: false };
  }
}

/**
 * Scan package.json for similar existing dependencies that could serve the same purpose.
 */
function findSimilarExisting(packageName: string): string[] {
  const root = getProjectRoot();
  const packageJsonPath = path.join(root, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const installedPackages = Object.keys(allDeps);

    // Check for known alternatives
    const alternativeMap: Record<string, string[]> = {
      "lodash": ["lodash-es", "radash", "remeda"],
      "axios": ["got", "node-fetch", "ky", "ofetch", "undici"],
      "node-fetch": ["axios", "got", "ky", "ofetch", "undici"],
      "moment": ["date-fns", "dayjs", "luxon"],
      "chalk": ["picocolors", "kleur", "colorette"],
      "express": ["fastify", "hono", "koa"],
      "rimraf": ["fs-extra"],
      "glob": ["fast-glob", "tiny-glob"],
    };

    const similar = alternativeMap[packageName] || [];
    return similar.filter((alt) => installedPackages.includes(alt));
  } catch {
    return [];
  }
}

export async function handleDependencyGuard(params: DependencyGuardParams): Promise<string> {
  const { packageName } = params;

  sessionMemory.recordToolCall("kuma_dependency_guard", { packageName });

  const existing = findExistingDependency(packageName);
  const similarExisting = findSimilarExisting(packageName);
  const nativeAlternatives = NATIVE_JS_ALTERNATIVES[packageName] || null;

  const lines: string[] = [
    `📦 **Dependency Guard** — "${packageName}"`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
  ];

  // Case 1: Already installed
  if (existing.found) {
    lines.push(`✅ **Already installed** — ${packageName}@${existing.version}${existing.inDev ? " (devDependency)" : ""}`);
    lines.push("  No action needed — the package is already available in this project.");
    lines.push("");
    lines.push("💡 Use the package directly — no install needed.");
    return lines.join("\n");
  }

  // Case 2: Similar existing dependency found
  if (similarExisting.length > 0) {
    lines.push("⚠️ **Similar package(s) already installed:**");
    for (const similar of similarExisting) {
      lines.push(`  • ${similar}`);
    }
    lines.push("");
    lines.push(`Instead of installing "${packageName}", consider using "${similarExisting[0]}" which is already in your project.`);
    lines.push("");
  }

  // Case 3: Native JS alternatives
  if (nativeAlternatives && nativeAlternatives.length > 0) {
    lines.push("🇯​🇸 **Native JavaScript alternatives available:**");
    for (const alt of nativeAlternatives) {
      lines.push(`  • ${alt.method} — ${alt.description}`);
    }
    lines.push("");
    lines.push("These use built-in APIs and require zero additional dependencies.");
    lines.push("");
  }

  // Compute risk
  const estimatedSize = getEstimatedPackageSize(packageName);
  if (estimatedSize > 0) {
    const riskLevel = estimatedSize > 500 ? "HIGH" : estimatedSize > 100 ? "MEDIUM" : "LOW";
    lines.push(`📊 **Risk Assessment:**`);
    lines.push(`  • Estimated package size: ~${estimatedSize}KB`);
    lines.push(`  • Dependency count impact: +1 (direct) + transitive dependencies`);
    lines.push(`  • Risk level: ${riskLevel === "HIGH" ? "🔴 HIGH" : riskLevel === "MEDIUM" ? "🟡 MEDIUM" : "🟢 LOW"}`);
    lines.push("");
  }

  // Summary
  if (nativeAlternatives && nativeAlternatives.length > 0) {
    lines.push("💡 **Recommendation:** Consider using native JS alternatives before installing a new dependency.");
  } else if (similarExisting.length > 0) {
    lines.push(`💡 **Recommendation:** Use "${similarExisting[0]}" which already exists in your project.`);
  } else {
    lines.push(`💡 **Recommendation:** If needed, install with: npm install ${packageName}`);
    lines.push("  Make sure there isn't already a built-in way to do what you need.");
  }

  return lines.join("\n");
}

/**
 * Rough estimate of package size. Returns KB.
 */
function getEstimatedPackageSize(packageName: string): number {
  const sizeEstimates: Record<string, number> = {
    "lodash": 550,
    "lodash-es": 300,
    "axios": 250,
    "express": 500,
    "moment": 350,
    "date-fns": 300,
    "dayjs": 50,
    "luxon": 150,
    "chalk": 20,
    "picocolors": 3,
    "uuid": 10,
    "nanoid": 5,
    "dotenv": 15,
    "cors": 20,
    "helmet": 40,
    "morgan": 15,
    "compression": 30,
    "rimraf": 10,
    "mkdirp": 5,
    "glob": 50,
    "fast-glob": 100,
    "prettier": 1000,
    "eslint": 2000,
    "typescript": 5000,
    "jest": 2000,
    "vitest": 500,
    "react": 300,
    "vue": 200,
    "next": 5000,
    "vite": 1000,
  };
  return sizeEstimates[packageName] || 0;
}
