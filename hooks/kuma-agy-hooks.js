/**
 * 🐻 Kuma MCP — JIT Gotcha Guard Hook
 * Intercepts file writes/edits in real time to inject active gotcha warnings.
 */
import fs from "node:fs";
import path from "node:path";

const GENERIC_FILENAMES = new Set([
  "index.ts", "index.js", "index.tsx", "index.jsx",
  "types.ts", "types.d.ts", "constants.ts", "utils.ts",
  "config.ts", "schema.ts", "styles.css", "main.ts", "main.js"
]);

function findGotchasForFile(targetPath) {
  if (!targetPath) return [];
  const results = [];
  const normalized = targetPath.replace(/\\/g, "/");
  const baseName = path.basename(normalized);
  const isGeneric = GENERIC_FILENAMES.has(baseName.toLowerCase());

  const gotchasMd = path.resolve(process.cwd(), ".kuma", "KNOWN_GOTCHAS.md");
  if (fs.existsSync(gotchasMd)) {
    try {
      const content = fs.readFileSync(gotchasMd, "utf-8");
      const sections = content.split(/(?=^###\s+)/m);
      for (const sec of sections) {
        // Skip resolved or deprecated gotchas
        if (/[-*]\s*(?:🏷️\s*)?\*\*Status\*\*:\s*(?:resolved|deprecated)/i.test(sec)) {
          continue;
        }

        const headingLine = sec.split("\n")[0] || "";
        const headingMatch = headingLine.match(/^###\s+\[?(.+?)\]?\s*(?:[—–-]+\s*(.+))?$/);
        if (!headingMatch) continue;

        const secFilePath = headingMatch[1].trim().replace(/\\/g, "/");
        const secBase = path.basename(secFilePath);

        // Path matching: exact match, suffix match, or non-generic basename match
        const isMatch =
          normalized.endsWith(secFilePath) ||
          secFilePath.endsWith(normalized) ||
          (!isGeneric && secBase.toLowerCase() === baseName.toLowerCase());

        if (isMatch) {
          const firstLine = headingLine.replace(/^###\s+/, "").trim();
          const trapMatch = sec.match(/- \S*\s*\*\*Trap\*\*:\s*([^\n]+)/i) || sec.match(/- \*\*Issue\*\*:\s*([^\n]+)/i);
          const ruleMatch = sec.match(/- \S*\s*\*\*Rule(?:\/Fix)?\*\*:\s*([^\n]+)/i) || sec.match(/- \*\*Workaround\*\*:\s*([^\n]+)/i);
          const trap = trapMatch ? trapMatch[1].trim() : (headingMatch[2]?.trim() || firstLine);
          const rule = ruleMatch ? ruleMatch[1].trim() : "";
          results.push({ file: baseName, trap, rule });
        }
      }
    } catch {}
  }
  return results;
}

function processPayload(rawInput) {
  let data = {};
  if (rawInput && typeof rawInput === "string") {
    try { data = JSON.parse(rawInput); } catch {}
  } else if (rawInput && typeof rawInput === "object") {
    data = rawInput;
  }

  const input = data.input || data;
  const targetFile = input.TargetFile || input.targetFile || input.file_path || input.path || input.file || "";

  if (!targetFile) {
    return { decision: "allow" };
  }

  const gotchas = findGotchasForFile(targetFile);
  if (gotchas.length > 0) {
    const baseName = path.basename(targetFile);
    const lines = [
      `⚠️ [🐻 Kuma JIT Warning] File "${baseName}" has ${gotchas.length} known gotcha(s):`
    ];
    for (const g of gotchas.slice(0, 3)) {
      lines.push(`  • 🪤 Trap: ${g.trap}`);
      if (g.rule) lines.push(`    🛡️ Rule: ${g.rule}`);
    }
    lines.push("💡 Review before modifying to prevent known regressions.");

    const message = lines.join("\n");
    return {
      decision: "allow",
      systemMessage: message,
      additionalContext: message,
    };
  }

  return { decision: "allow" };
}

let inputBuffer = "";
const timer = setTimeout(() => {
  const envInput = process.env.AGY_TOOL_INPUT || process.env.TOOL_INPUT || "";
  const result = processPayload(envInput);
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
}, 150);

process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  clearTimeout(timer);
  inputBuffer += chunk;
});
process.stdin.on("end", () => {
  clearTimeout(timer);
  const result = processPayload(inputBuffer || process.env.AGY_TOOL_INPUT || "");
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
});
