// ============================================================
// ISSUES #43 + #44 — worktree-aware sync + actionable drift report
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  getWorktreeChangedFiles,
  updateWorktreeDirty,
  isWorktreeDirty,
} from "../src/engine/mapBackbone.js";
import { toDriftActionItem, writeDriftReport, readDriftReport } from "../src/engine/kumaDriftDetector.js";

function git(cwd: string, cmd: string): void {
  execSync(cmd, { cwd, stdio: "pipe", timeout: 8000 });
}

describe("issue #43 worktree-aware sync", () => {
  test("modified + untracked files detected (fixture feature branch)", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-wt43-"));
    try {
      git(cwd, "git init -b main && git config user.email t@t.t && git config user.name t");
      fs.writeFileSync(path.join(cwd, "a.ts"), "export const a = 1;\n", "utf-8");
      git(cwd, "git add -A && git commit -qm init");
      fs.writeFileSync(path.join(cwd, "a.ts"), "export const a = 2;\n", "utf-8");
      fs.writeFileSync(path.join(cwd, "newmod.ts"), "export const n = 1;\n", "utf-8");
      fs.writeFileSync(path.join(cwd, "notes.txt"), "do not index me\n", "utf-8");

      const files = getWorktreeChangedFiles(cwd, 50);
      const byName = new Map(files.map((f) => [f.file, f.state]));
      expect(byName.get("a.ts")).toBe("modified");
      expect(byName.get("newmod.ts")).toBe("untracked");
      expect(byName.has("notes.txt")).toBe(false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("non-git dir → [] without throwing", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-wt43b-"));
    try {
      expect(getWorktreeChangedFiles(cwd, 50)).toEqual([]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("dirty set roundtrip + surfacing predicate", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-wt43c-"));
    try {
      fs.mkdirSync(path.join(cwd, ".kuma"), { recursive: true });
      updateWorktreeDirty(["src/feat/x.ts"], cwd);
      expect(isWorktreeDirty("src/feat/x.ts", cwd)).toBe(true);
      expect(isWorktreeDirty("src/other/y.ts", cwd)).toBe(false);
      updateWorktreeDirty([], cwd);
      expect(isWorktreeDirty("src/feat/x.ts", cwd)).toBe(false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("issue #44 actionable drift report", () => {
  test("stale record → item with reason + suggested action", () => {
    const item = toDriftActionItem({
      id: 7, source: "research_cache", description: "auth", filePath: null,
      oldHash: "a", currentHash: "b", age: "12d", severity: "stale",
    });
    expect(item.id).toBe("research_cache#7");
    expect(item.reason).toContain("hash mismatch");
    expect(item.action).toContain("research");
  });

  test("missing record → gone reason", () => {
    const item = toDriftActionItem({
      id: 3, source: "file_summaries", description: "x.ts", filePath: "x.ts",
      oldHash: "a", currentHash: "", age: "—", severity: "missing",
    });
    expect(item.reason).toContain("gone");
  });

  test("write + read roundtrip (bounded items)", async () => {
    const { items, path: fp } = await writeDriftReport(20);
    expect(typeof items).toBe("number");
    expect(fs.existsSync(fp)).toBe(true);
    const report = readDriftReport();
    expect(report).not.toBeNull();
    expect(report!.items.length).toBeLessThanOrEqual(20);
    expect(report!.items.length).toBe(items);
  });
});
