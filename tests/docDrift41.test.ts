// ============================================================
// ISSUE #41 — Doc-drift sensor fixtures
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractClaims, scanDocDrift } from "../src/engine/docDrift.js";

describe("issue #41 doc drift", () => {
  test("doc claiming a removed env var → drift flagged with file:line", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-docdrift-"));
    try {
      fs.mkdirSync(path.join(cwd, "docs"));
      fs.writeFileSync(
        path.join(cwd, "docs", "MAILGUN_SETUP.md"),
        "# Mailgun\nRequires MAILGUN_REMOVED_KEY in production.\n",
        "utf-8",
      );
      fs.writeFileSync(path.join(cwd, "app.ts"), "export const x = 1;\n", "utf-8");
      const { drifted } = scanDocDrift(cwd);
      const hit = drifted.find((d) => d.text === "MAILGUN_REMOVED_KEY");
      expect(hit).toBeDefined();
      expect(hit!.docFile).toContain("MAILGUN_SETUP.md");
      expect(hit!.docLine).toBe(2);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("env var present in code → no drift", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-docdrift-ok-"));
    try {
      fs.writeFileSync(path.join(cwd, "SETUP.md"), "Set LIVE_API_KEY before deploy.\n", "utf-8");
      fs.writeFileSync(path.join(cwd, "app.ts"), "const k = process.env.LIVE_API_KEY;\n", "utf-8");
      const { drifted } = scanDocDrift(cwd);
      expect(drifted.find((d) => d.text === "LIVE_API_KEY")).toBeUndefined();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("RFC/aspirational docs are exempt", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-docdrift-rfc-"));
    try {
      fs.writeFileSync(
        path.join(cwd, "RFC_FUTURE.md"),
        "# RFC: future plan\nRequires FUTURE_VAPOR_KEY eventually.\n",
        "utf-8",
      );
      const { drifted, skipped } = scanDocDrift(cwd);
      expect(drifted.find((d) => d.text === "FUTURE_VAPOR_KEY")).toBeUndefined();
      expect(skipped.join(",")).toContain("RFC_FUTURE.md");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("extractClaims finds env + absence claims", () => {
    const claims = extractClaims("d.md", "Needs SMTP_API_KEY.\nThere is no SMTP path anymore.\n");
    expect(claims.some((c) => c.kind === "env" && c.text === "SMTP_API_KEY")).toBe(true);
    expect(claims.some((c) => c.kind === "absence")).toBe(true);
  });
});
