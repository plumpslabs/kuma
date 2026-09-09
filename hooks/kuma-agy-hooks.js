/**
 * 🐻 Kuma MCP — Antigravity Lifecycle Hook
 * Intercepts file writes to warn about known gotchas and fragile files.
 */
import fs from "node:fs";
import path from "node:path";

function runHook() {
  try {
    const input = process.env.AGY_TOOL_INPUT ? JSON.parse(process.env.AGY_TOOL_INPUT) : {};
    const targetFile = input.TargetFile || input.file || "";

    if (!targetFile) {
      process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
      return;
    }

    const gotchasFile = path.resolve(process.cwd(), ".kuma", "KNOWN_GOTCHAS.md");
    if (fs.existsSync(gotchasFile)) {
      const content = fs.readFileSync(gotchasFile, "utf-8");
      const baseName = path.basename(targetFile);
      if (content.includes(baseName) || content.includes(targetFile)) {
        process.stdout.write(JSON.stringify({
          decision: "allow",
          systemMessage: `⚠️ Kuma Gotcha Warning: ${baseName} has recorded gotchas in .kuma/KNOWN_GOTCHAS.md. Review before editing!`
        }) + "\n");
        return;
      }
    }

    process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
  } catch {
    process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
  }
}

runHook();
