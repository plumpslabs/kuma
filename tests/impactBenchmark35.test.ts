// ============================================================
// ISSUE #35 — Benchmark: precision/recall of affected-test prediction
// Three fixture repos (ts/py/go) with KNOWN ground truth. Each case:
// change X → expected test set E. Metrics vs full-suite baseline:
// recall (must be 1.0 — never miss), precision, and selection reduction.
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { calculateBlastRadius } from "../src/engine/impactAnalysis.js";

function mkroot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-bench35-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "bench-fixture" }), "utf-8");
  return root;
}

function w(root: string, rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, "utf-8");
}

function metrics(selected: string[], expected: string[], total: number): { recall: number; precision: number; reduction: number } {
  const sel = new Set(selected.map((s) => s.replace(/\\/g, "/")));
  const exp = new Set(expected);
  const tp = [...exp].filter((e) => sel.has(e)).length;
  return {
    recall: exp.size === 0 ? 1 : tp / exp.size,
    precision: sel.size === 0 ? 1 : tp / sel.size,
    reduction: total === 0 ? 0 : 1 - sel.size / total,
  };
}

describe("issue #35 benchmark (fixture repos, known ground truth)", () => {
  test("repo A (ts): change lib → only its consumer test selected", async () => {
    const root = mkroot();
    try {
      w(root, "src/zeta_math.ts", "export function zetaAdd(a: number, b: number): number { return a + b; }\n");
      w(root, "src/zeta_calc.ts", "import { zetaAdd } from './zeta_math';\nexport const zetaSum = zetaAdd(1, 2);\n");
      w(root, "tests/zeta_calc.test.ts", "import { zetaSum } from '../src/zeta_calc';\ntest('s', () => {});\n");
      w(root, "tests/zeta_unrelated.test.ts", "test('u', () => {});\n");

      const blast = await calculateBlastRadius("src/zeta_math.ts", { root });
      const m = metrics(blast.affectedTests, ["tests/zeta_calc.test.ts"], 2);
      expect(m.recall).toBe(1);
      expect(m.precision).toBe(1);
      expect(m.reduction).toBeGreaterThanOrEqual(0.5);
      expect(blast.evidence?.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("repo B (py): change lib → its named test selected", async () => {
    const root = mkroot();
    try {
      w(root, "lib/theta_math.py", "def theta_add(a, b):\n    return a + b\n");
      w(root, "app/theta_calc.py", "from lib.theta_math import theta_add\nprint(theta_add(1, 2))\n");
      w(root, "tests/test_theta_math.py", "from lib.theta_math import theta_add\ndef test_add():\n    assert theta_add(1, 2) == 3\n");
      w(root, "tests/test_theta_other.py", "def test_other():\n    assert True\n");

      const blast = await calculateBlastRadius("lib/theta_math.py", { root });
      const m = metrics(blast.affectedTests, ["tests/test_theta_math.py"], 2);
      expect(m.recall).toBe(1);
      expect(m.precision).toBe(1);
      expect(m.reduction).toBeGreaterThanOrEqual(0.5);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("repo C (go): change pkg → its consumer test selected", async () => {
    const root = mkroot();
    try {
      w(root, "pkg/gamma_math.go", "package gmath\nfunc GammaAdd(a, b int) int { return a + b }\n");
      w(root, "cmd/gamma_calc.go", 'package main\nimport gmath "bench/pkg/gamma_math"\nfunc main() { _ = gmath.GammaAdd(1, 2) }\n');
      w(root, "cmd/gamma_calc_test.go", "package main\nimport testing\nfunc TestCalc(t *testing.T) {}\n");
      w(root, "cmd/other_test.go", "package main\nimport testing\nfunc TestOther(t *testing.T) {}\n");

      const blast = await calculateBlastRadius("pkg/gamma_math.go", { root });
      const m = metrics(blast.affectedTests, ["cmd/gamma_calc_test.go"], 2);
      expect(m.recall).toBe(1);
      expect(m.precision).toBeGreaterThanOrEqual(0.5);
      expect(m.reduction).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
