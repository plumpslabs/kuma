// ============================================================
// ISSUE #33 REGRESSION — comment/config-only changes must be LOW
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { calculateBlastRadius, classifyDiffShape } from "../src/engine/impactAnalysis.js";

describe("issue #33: non-runtime impact is capped at LOW", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-impact33-"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }), "utf-8");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("classifyDiffShape: .env.example → config-or-docs", () => {
    expect(classifyDiffShape("backend/.env.example", root).shape).toBe("config-or-docs");
  });

  test("classifyDiffShape: .md → config-or-docs", () => {
    expect(classifyDiffShape("docs/MAILGUN_SETUP.md", root).shape).toBe("config-or-docs");
  });

  test("comment-only .env.example edit → LOW risk, ~0 suites", async () => {
    fs.mkdirSync(path.join(root, "backend"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "backend", ".env.example"),
      "# example config\n# PLACEHOLDER_API_KEY=xxx\n",
      "utf-8",
    );
    // An unrelated auth test that must NOT be recommended
    fs.writeFileSync(path.join(root, "slug.utils.test.ts"), "test('x', () => {})", "utf-8");

    const blast = await calculateBlastRadius("backend/.env.example", { root });
    expect(blast.risk).toBe("low");
    expect(blast.affectedTests).toEqual([]);
    expect(blast.directDependents).toEqual([]);
    expect(blast.diffShape).toBe("config-or-docs");
    expect(blast.summary).toContain("LOW");
  });

  test("runtime code keeps full analysis (no cap)", async () => {
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "auth.ts"), "export const token = 1;", "utf-8");
    const blast = await calculateBlastRadius("src/auth.ts", { root });
    expect(blast.diffShape).toBe("runtime-code");
    // No artificial LOW cap: risk comes from real grounded analysis
    expect(blast.summary).toContain("runtime-code");
  });
});
