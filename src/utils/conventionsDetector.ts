import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./pathValidator.js";

// ============================================================
// CONVENTIONS DETECTOR — Auto-detect project configuration
// ============================================================

export interface ProjectConventions {
  framework: string;
  testRunner: string;
  styling: string;
  importAlias?: string;
  lintRules: string[];
  packageManager: string;
  moduleSystem: "esm" | "cjs";
  language: "typescript" | "javascript";
  features: string[];
}

let cachedConventions: ProjectConventions | null = null;

export async function detectConventions(forceRescan = false): Promise<ProjectConventions> {
  if (cachedConventions && !forceRescan) {
    return cachedConventions;
  }

  const projectRoot = getProjectRoot();

  const conventions: ProjectConventions = {
    framework: detectFramework(projectRoot),
    testRunner: detectTestRunner(projectRoot),
    styling: detectStyling(projectRoot),
    importAlias: detectImportAlias(projectRoot),
    lintRules: detectLintRules(projectRoot),
    packageManager: detectPackageManager(),
    moduleSystem: detectModuleSystem(projectRoot),
    language: detectLanguage(projectRoot),
    features: detectFeatures(projectRoot),
  };

  cachedConventions = conventions;
  return conventions;
}

function detectFramework(root: string): string {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  if (!pkg) return "unknown";

  const pkgDeps = (pkg.dependencies ?? {}) as Record<string, string>;
  const pkgDevDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  const deps: Record<string, string> = { ...pkgDeps, ...pkgDevDeps };

  if (deps.next) return "Next.js";
  if (deps["@remix-run/react"]) return "Remix";
  if (deps.gatsby) return "Gatsby";
  if (deps.nuxt || deps["@nuxt/core"]) return "Nuxt.js";
  if (deps.vue) return "Vue";
  if (deps.react) return "React";
  if (deps.express) return "Express";
  if (deps.fastify) return "Fastify";
  if (deps.nest) return "NestJS";
  if (deps.svelte) return "Svelte";
  if (deps.astro) return "Astro";

  return "unknown";
}

function detectTestRunner(root: string): string {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  if (!pkg) return "unknown";

  const pkgDeps2 = (pkg.dependencies ?? {}) as Record<string, string>;
  const pkgDevDeps2 = (pkg.devDependencies ?? {}) as Record<string, string>;
  const deps: Record<string, string> = { ...pkgDeps2, ...pkgDevDeps2 };

  if (deps.vitest) return "Vitest";
  if (deps.jest) return "Jest";
  if (deps.mocha) return "Mocha";
  if (deps.ava) return "AVA";
  if (deps.cypress) return "Cypress";
  if (deps.playwright) return "Playwright";
  if (deps["@testing-library/react"]) return "React Testing Library";

  // Check for script patterns
  const scripts: Record<string, string> = (pkg.scripts ?? {}) as Record<string, string>;
  if (scripts.test) {
    if (scripts.test.includes("vitest")) return "Vitest";
    if (scripts.test.includes("jest")) return "Jest";
    if (scripts.test.includes("mocha")) return "Mocha";
  }

  return "unknown";
}

function detectStyling(root: string): string {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  if (!pkg) return "unknown";

  const pkgDeps3 = (pkg.dependencies ?? {}) as Record<string, string>;
  const pkgDevDeps3 = (pkg.devDependencies ?? {}) as Record<string, string>;
  const deps: Record<string, string> = { ...pkgDeps3, ...pkgDevDeps3 };

  if (deps.tailwindcss) return "Tailwind CSS";
  if (deps["styled-components"]) return "Styled Components";
  if (deps["@emotion/react"]) return "Emotion";
  if (deps.linaria) return "Linaria";
  if (deps.sass || deps["node-sass"]) return "SCSS";
  if (deps.less) return "Less";
  if (deps["@vanilla-extract/css"]) return "Vanilla Extract";
  if (deps.cssmodules || hasCSSModules(root)) return "CSS Modules";

  const srcDir = path.join(root, "src");
  if (fs.existsSync(srcDir)) {
    const cssFiles = findFiles(srcDir, [".css", ".scss", ".less"]);
    if (cssFiles.length > 0) return "Plain CSS/SCSS";
  }

  return "unknown";
}

function detectImportAlias(root: string): string | undefined {
  // Check tsconfig paths
  const tsconfig = readJsonSafe(path.join(root, "tsconfig.json"));
  const tsconfigPaths = (tsconfig as Record<string, unknown>)?.compilerOptions as Record<string, unknown> | undefined;
  if (tsconfigPaths?.paths) {
    const paths = tsconfigPaths.paths as Record<string, string[]>;
    const alias = Object.keys(paths)[0];
    if (alias) return alias.replace("/*", "");
  }

  // Check jsconfig
  const jsconfig = readJsonSafe(path.join(root, "jsconfig.json"));
  const jsconfigPaths = (jsconfig as Record<string, unknown>)?.compilerOptions as Record<string, unknown> | undefined;
  if (jsconfigPaths?.paths) {
    const paths = jsconfigPaths.paths as Record<string, string[]>;
    const alias = Object.keys(paths)[0];
    if (alias) return alias.replace("/*", "");
  }

  return undefined;
}

function detectLintRules(root: string): string[] {
  const rules: string[] = [];

  if (fs.existsSync(path.join(root, ".eslintrc"))) rules.push("ESLint (.eslintrc)");
  if (fs.existsSync(path.join(root, ".eslintrc.js"))) rules.push("ESLint (.eslintrc.js)");
  if (fs.existsSync(path.join(root, ".eslintrc.json"))) rules.push("ESLint (.eslintrc.json)");
  if (fs.existsSync(path.join(root, "eslint.config.js"))) rules.push("ESLint (flat config)");
  if (fs.existsSync(path.join(root, ".prettierrc"))) rules.push("Prettier");
  if (fs.existsSync(path.join(root, ".prettierrc.json"))) rules.push("Prettier");
  if (fs.existsSync(path.join(root, ".prettierrc.js"))) rules.push("Prettier");
  if (fs.existsSync(path.join(root, ".stylelintrc"))) rules.push("StyleLint");
  if (fs.existsSync(path.join(root, ".stylelintrc.json"))) rules.push("StyleLint");

  return rules;
}

function detectPackageManager(): string {
  const root = getProjectRoot();

  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(root, "package-lock.json"))) return "npm";
  if (fs.existsSync(path.join(root, "bun.lockb"))) return "bun";

  return "npm"; // Default
}

function detectModuleSystem(root: string): "esm" | "cjs" {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  if (pkg?.type === "module") return "esm";

  // Check for import/export syntax in source files
  const srcDir = path.join(root, "src");
  if (fs.existsSync(srcDir)) {
    const tsFiles = findFiles(srcDir, [".ts", ".tsx", ".js", ".jsx", ".mjs"]);
    for (const file of tsFiles.slice(0, 20)) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        if (content.includes("import ") || content.includes("export ")) return "esm";
      } catch {
        continue;
      }
    }
  }

  return "cjs";
}

function detectLanguage(root: string): "typescript" | "javascript" {
  if (fs.existsSync(path.join(root, "tsconfig.json"))) return "typescript";

  // Check for .ts files
  const srcDir = path.join(root, "src");
  if (fs.existsSync(srcDir)) {
    const tsFiles = findFiles(srcDir, [".ts", ".tsx"]);
    if (tsFiles.length > 0) return "typescript";
  }

  return "javascript";
}

function detectFeatures(root: string): string[] {
  const features: string[] = [];
  const pkg = readJsonSafe(path.join(root, "package.json"));
  if (!pkg) return features;

  const pkgDeps4 = (pkg.dependencies ?? {}) as Record<string, string>;
  const pkgDevDeps4 = (pkg.devDependencies ?? {}) as Record<string, string>;
  const deps: Record<string, string> = { ...pkgDeps4, ...pkgDevDeps4 };

  if (deps["@prisma/client"] || deps.prisma) features.push("Prisma ORM");
  if (deps.typeorm) features.push("TypeORM");
  if (deps["drizzle-orm"]) features.push("Drizzle ORM");
  if (deps.graphql || deps["@graphql-tools"]) features.push("GraphQL");
  if (deps.trpc || deps["@trpc/client"]) features.push("tRPC");
  if (deps["socket.io"] || deps.ws) features.push("WebSockets");
  if (deps["@reduxjs/toolkit"] || deps.redux) features.push("Redux");
  if (deps.zustand) features.push("Zustand");
  if (deps["react-router"] || deps["react-router-dom"]) features.push("React Router");
  if (deps["next-auth"] || deps["next-auth/react"]) features.push("NextAuth");
  if (deps["@tanstack/react-query"]) features.push("React Query");
  if (deps.jest || deps.vitest) features.push("Unit Testing");
  if (deps.cypress || deps.playwright) features.push("E2E Testing");
  if (deps.storybook || deps["@storybook/react"]) features.push("Storybook");
  if (deps.i18next || deps["react-i18next"]) features.push("i18n");

  return features;
}

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {
    // Ignore
  }
  return null;
}

function hasCSSModules(root: string): boolean {
  const srcDir = path.join(root, "src");
  if (!fs.existsSync(srcDir)) return false;

  const files = findFiles(srcDir, [".module.css", ".module.scss", ".module.less"]);
  return files.length > 0;
}

function findFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        results.push(...findFiles(fullPath, extensions));
      } else if (entry.isFile()) {
        if (extensions.some((ext) => entry.name.endsWith(ext))) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore
  }

  return results;
}
